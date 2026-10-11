import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { copyBuildDirectory, inventory, verifyWebAssets } from '../build-vercel.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, '.vercel/output');
const bundle = join(output, 'functions/server.func');

async function temporary(t) {
  const boundary = await realpath(tmpdir());
  const directory = await mkdtemp(join(boundary, 'futureroi-vercel-test-'));
  t.after(async () => {
    const path = relative(boundary, directory);
    assert.ok(path !== '..' && !path.startsWith('..') && !isAbsolute(path));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('配備構造: handler/route・全Web assetのhashを照合し、開発設定を同梱しない', async () => {
  const config = JSON.parse(await readFile(join(output, 'config.json'), 'utf8'));
  assert.deepEqual(config, { version: 3, routes: [{ src: '/(.*)', dest: '/server' }] });
  assert.deepEqual(JSON.parse(await readFile(join(bundle, '.vc-config.json'), 'utf8')),
    { runtime: 'nodejs24.x', handler: 'apps/api/dist/vercel.js', launcherType: 'Nodejs', shouldAddHelpers: false });
  const original = await inventory(join(root, 'apps/web/dist'));
  const copied = await inventory(join(bundle, 'apps/web/dist'));
  assert.deepEqual(copied, original);
  const files = await inventory(bundle);
  assert.ok(!files.some(file => /node_modules\/(?:typescript|vite|embedded-postgres)\//.test(file.path)));
  const manifest = JSON.parse(await readFile(join(output, 'bundle-manifest.json'), 'utf8'));
  assert.ok(manifest.bytes < 250 * 1024 * 1024);
  assert.equal(manifest.assetReferences, await verifyWebAssets(join(bundle, 'apps/web/dist')));
  // config自体は最後に追加される。manifestはその前の配備ファイルを記録する。
  assert.deepEqual(files.filter(file => file.path !== '.vc-config.json'), manifest.files);
});

test('コピー前に境界外・循環junctionとローカル設定を拒否し、内部linkは同じhashで収容する', async t => {
  const directory = await temporary(t);
  const source = join(directory, 'source');
  const destination = join(directory, 'destination');
  const outside = join(directory, 'outside');
  await mkdir(source);
  await mkdir(outside);
  await writeFile(join(outside, 'sentinel.css'), '/* harmless synthetic sentinel */');
  await symlink(outside, join(source, 'escape'), 'junction');
  await assert.rejects(copyBuildDirectory(source, destination), /escapes/);
  await assert.rejects(lstat(destination), { code: 'ENOENT' });
  await rm(join(source, 'escape'));
  await symlink(source, join(source, 'cycle'), 'junction');
  await assert.rejects(copyBuildDirectory(source, destination), /cycle/);
  await rm(join(source, 'cycle'));
  await writeFile(join(source, '.env.fixture'), 'synthetic=fixture');
  await assert.rejects(copyBuildDirectory(source, destination), /Local configuration/);
  await rm(join(source, '.env.fixture'));
  const linkedRoot = join(directory, 'linked-root');
  await symlink(outside, linkedRoot, 'junction');
  await assert.rejects(copyBuildDirectory(linkedRoot, destination), /linked build directory/);
  await assert.rejects(lstat(destination), { code: 'ENOENT' });
  await mkdir(join(source, 'internal'));
  await writeFile(join(source, 'internal/sentinel.css'), '/* owned internal fixture */');
  await symlink(join(source, 'internal'), join(source, 'internal-link'), 'junction');
  await copyBuildDirectory(source, destination);
  assert.deepEqual(await inventory(destination), await inventory(source));
});

// Windowsの1万ファイル前後のcopy/cleanupを含む期限。childの実行上限50秒・各asset応答5秒は別に維持する。
test('Functionだけを外部Tempへ移してHTTP/SPA/assetsを実行し、失敗設定でもSecretを生成しない', { timeout: 180000 }, async t => {
  const isolated = await temporary(t);
  await cp(bundle, isolated, { recursive: true, dereference: true });
  const files = await inventory(join(isolated, 'apps/web/dist'));
  const assets = files.filter(file => file.path.startsWith('assets/'));
  assert.ok(assets.some(file => file.path.endsWith('.js')));
  assert.ok(assets.some(file => file.path.endsWith('.css')));
  const script = `
    import assert from 'node:assert/strict';
    import { createHash } from 'node:crypto';
    import { existsSync } from 'node:fs';
    import { readFile } from 'node:fs/promises';
    import { createServer } from 'node:http';
    import { once } from 'node:events';
    import { fileURLToPath } from 'node:url';
    import pg from 'pg';
    await import('@futureroi/prediction');
    const {buildApp}=await import('./apps/api/dist/app.js');
    const {default: defaultHandler,createVercelHandler}=await import('./apps/api/dist/vercel.js');
    const pool=new pg.Pool({connectionString:'postgres://127.0.0.1:1/unused'});
    const app=await buildApp({pool,logger:false,webDist:fileURLToPath(new URL('./apps/web/dist/',import.meta.url))});
    await app.ready();
    let handler=createVercelHandler(async()=>app);
    const server=createServer((req,res)=>void handler(req,res));
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    try {
      for(const path of ['/','/goals/fixture','/login?next=%2Fgoals']){
        const res=await fetch(origin+path);assert.equal(res.status,200);
        assert.match(res.headers.get('content-type'),/^text[/]html/);assert.equal(res.headers.get('cache-control'),'no-cache');await res.text();
      }
      const assets=JSON.parse(await readFile(new URL('./assets-fixture.json',import.meta.url),'utf8'));
      for(let i=0;i<assets.length;i+=4)await Promise.all(assets.slice(i,i+4).map(async file=>{
        const res=await fetch(origin+'/'+file.path,{signal:AbortSignal.timeout(5000)});assert.equal(res.status,200,file.path);
        assert.equal(res.headers.get('cache-control'),'public, max-age=31536000, immutable',file.path);
        assert.equal(createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex'),file.sha256,file.path);
      }));
      for(const [method,path] of [['GET','/assets/missing.js'],['GET','/api/unknown'],['GET','/api%2Funknown'],['POST','/goals/fixture']]){
        const res=await fetch(origin+path,{method});assert.equal(res.status,404,method+path);
        assert.match(res.headers.get('content-type'),/^application[/]json/);
        if(path.startsWith('/api'))assert.equal(res.headers.get('cache-control'),'no-store');await res.text();
      }
      const head=await fetch(origin+'/goals/fixture',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
      handler=defaultHandler;
      for(const mode of [undefined,'production']){
        if(mode){process.env.NODE_ENV=mode;process.env.DATABASE_URL='postgres://127.0.0.1:1/unused';}else delete process.env.NODE_ENV;
        const res=await fetch(origin+'/');assert.equal(res.status,503);assert.equal(res.headers.get('cache-control'),'no-store');
        assert.equal((await res.json()).error.code,'UNAVAILABLE');
        assert.ok(!existsSync('./apps/api/.local/auth-secret'));assert.ok(!existsSync('./apps/api/dist/.local/auth-secret'));
      }
      console.log(JSON.stringify({isolatedImport:true,httpAssetHashes:assets.length,fonts:assets.filter(f=>/[.]woff2?$/.test(f.path)).length,secretFiles:0}));
    }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await app.close();await pool.end();}
  `;
  // 多数の分離フォントをargvへ埋めるとWindowsのcommand-line上限に達する。fixtureファイルで渡す。
  await writeFile(join(isolated, 'assets-fixture.json'), JSON.stringify(assets));
  await writeFile(join(isolated, 'verify.mjs'), script);
  const child = spawnSync(process.execPath, ['verify.mjs'], { cwd: isolated, encoding: 'utf8', timeout: 50000,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH } });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /"isolatedImport":true/);
  console.log(child.stdout.trim());
  // fixtureの期待値は実Web assetから作るが、HTTP応答のhashは外部processで独立して比較する。
  assert.equal(createHash('sha256').update(await readFile(join(bundle, 'apps/web/dist/index.html'))).digest('hex'),
    files.find(file => file.path === 'index.html').sha256);
});

test('欠落asset・境界外参照・秘密ファイル・外部junction・循環junctionを拒否する', async t => {
  const directory = await temporary(t);
  const web = join(directory, 'web');
  await mkdir(web);
  await writeFile(join(web, 'index.html'), '<link href="/missing.css">');
  await assert.rejects(verifyWebAssets(web));
  await writeFile(join(directory, 'outside.css'), 'fixture');
  await writeFile(join(web, 'index.html'), '<link href="../outside.css">');
  await assert.rejects(verifyWebAssets(web), /escaping/);
  await writeFile(join(web, '.env.fixture'), 'synthetic=fixture');
  await assert.rejects(inventory(web), /Local configuration/);
  await rm(join(web, '.env.fixture'));
  const outside = join(directory, 'outside');
  await mkdir(outside);
  await symlink(outside, join(web, 'escape'), 'junction');
  await assert.rejects(inventory(web), /escapes/);
  await rm(join(web, 'escape'));
  await symlink(web, join(web, 'cycle'), 'junction');
  await assert.rejects(inventory(web), /cycle/);
});
