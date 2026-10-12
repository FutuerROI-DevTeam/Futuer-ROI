// テスト用PostgreSQL。DATABASE_URLがあればその管理用接続を使い、なければembedded-postgresの
// ローカルクラスタ（apps/api/.local、Git除外）を起動する。テストファイルごとに専用databaseを作り、終了時に削除する。
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { restoreEmbeddedLinks } from './embedded-binaries.ts';
import { createWindowsEmbeddedStop } from './windows-embedded-stop.ts';
import { cleanupAfterFailure, cleanupAll, closeOnce } from './cleanup.ts';

export type TestDatabase = {
  connectionString: string;
  pool: pg.Pool;
  close: () => Promise<void>;
};

type AdminConnection = { url: string; stop: () => Promise<void> };

const localDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.local');

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startEmbedded(): Promise<AdminConnection> {
  await restoreEmbeddedLinks();
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  mkdirSync(localDir, { recursive: true });
  // Windowsの停止後のworkerが旧data dirを保持していても、新しいテストのschemaを混ぜない。
  // 既存clusterは削除・再利用しない。失敗したclusterの証跡も.localに保持する。
  const runDir = mkdtempSync(join(localDir, 'pg-test-'));
  const dataDir = join(runDir, 'data');
  const credentialFile = join(runDir, 'credential.json');
  const isNew = !existsSync(join(dataDir, 'PG_VERSION'));
  let credential: { user: string; password: string };
  if (isNew) {
    credential = { user: 'futureroi_test', password: randomBytes(18).toString('base64url') };
    writeFileSync(credentialFile, JSON.stringify(credential), { mode: 0o600 });
  } else {
    credential = JSON.parse(readFileSync(credentialFile, 'utf8')) as { user: string; password: string };
  }
  const port = await freePort();
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: credential.user,
    password: credential.password,
    port,
    persistent: true,
    // LANGのないシェルでもSQL_ASCIIへ落とさず、titleのUnicode文字数契約を実DBで検証する。
    // CはOSに追加localeを導入せず使える。既存cluster・外部DATABASE_URLの設定は変更しない。
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (message) => console.error(String(message).replaceAll(credential.password, '[redacted]')),
  });
  if (process.platform === 'win32') {
    // 固定platform配布物の公開binaryだけを使う。Linuxのsignal停止・外部DBには適用しない。
    const { pg_ctl } = await import(`@embedded-postgres/windows-${process.arch}`) as { pg_ctl: string };
    server.stop = createWindowsEmbeddedStop(pg_ctl, dataDir);
  }
  try {
    if (isNew) await server.initialise();
    await server.start();
  } catch (error) {
    return cleanupAfterFailure(error, async () => {
      // 起動途中で作られた、このrunだけのPID fileがある場合に停止を試みる。
      if (existsSync(join(dataDir, 'postmaster.pid'))) await server.stop();
    });
  }
  return {
    url: `postgres://${credential.user}:${encodeURIComponent(credential.password)}@127.0.0.1:${port}/postgres`,
    stop: () => server.stop(),
  };
}

async function adminConnection(): Promise<AdminConnection> {
  const url = process.env.DATABASE_URL;
  if (url) return { url, stop: async () => {} };
  return startEmbedded();
}

async function waitForNoBackends(adminPool: pg.Pool, name: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await adminPool.query<{ n: number }>(
      'select count(*)::int as n from pg_stat_activity where datname = $1', [name],
    );
    if (result.rows[0]?.n === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Test database still has connections after its pools were closed');
}

type DatabaseFactories = {
  connectAdmin: typeof adminConnection;
  createPool: (options: pg.PoolConfig) => pg.Pool;
};

export async function createTestDatabase(factories: Partial<DatabaseFactories> = {}): Promise<TestDatabase> {
  const deps = {
    connectAdmin: adminConnection,
    createPool: (options: pg.PoolConfig) => new pg.Pool(options),
    ...factories,
  };
  const admin = await deps.connectAdmin();
  const name = `t_${randomBytes(6).toString('hex')}`;
  let adminPool: pg.Pool | undefined;
  let pool: pg.Pool | undefined;
  let created = false;
  const close = closeOnce(() => cleanupAll([
    async () => { await pool?.end(); },
    async () => {
      if (!created || !adminPool) return;
      // 自分のCREATE成功を確認したdatabaseだけを削除する。FORCEや既存DBの操作はしない。
      await waitForNoBackends(adminPool, name);
      await adminPool.query(`drop database "${name}"`);
    },
    async () => { await adminPool?.end(); },
    () => admin.stop(),
  ]));
  try {
    adminPool = deps.createPool({ connectionString: admin.url, max: 1 });
    await adminPool.query(`create database "${name}"`);
    created = true;
    const url = new URL(admin.url);
    url.pathname = `/${name}`;
    const connectionString = url.toString();
    pool = deps.createPool({ connectionString, max: 3 });
    return { connectionString, pool, close };
  } catch (error) {
    return cleanupAfterFailure(error, close);
  }
}
