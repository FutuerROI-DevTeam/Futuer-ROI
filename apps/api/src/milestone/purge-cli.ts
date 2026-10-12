import { createAppPool } from '../db/pool.ts';
import { purgeExpiredMilestone } from './store.ts';

// 読取のexpiry filterとは別の物理削除。接続先や本人の入力は出力しない。
if (process.argv.slice(2).join(' ') !== '--confirm-milestone-purge') throw new Error('Pass --confirm-milestone-purge after verifying the database and backup policy');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const pool = createAppPool({ connectionString: process.env.DATABASE_URL });
try {
  process.stdout.write(`${JSON.stringify(await purgeExpiredMilestone(pool, new Date()))}\n`);
} catch {
  process.stderr.write('Milestone purge failed. Verify the approved database and retry explicitly.\n');
  process.exitCode = 1;
} finally { await pool.end(); }
