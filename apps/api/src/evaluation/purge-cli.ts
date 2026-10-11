import { createAppPool } from '../db/pool.ts';
import { loadEvaluationOptions, evaluationPolicy } from './policy.ts';
import { purgeExpiredEvaluation } from './store.ts';

// 有効化とは別の明示運用。接続先/owner/保存入力は出力しない。
if (process.argv.slice(2).join(' ') !== '--confirm-evaluation-purge') throw new Error('Pass --confirm-evaluation-purge after verifying the database and backup policy');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
const options = loadEvaluationOptions({ ...process.env, EVALUATION_ENABLED: '0' });
const pool = createAppPool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await purgeExpiredEvaluation(pool, new Date(), evaluationPolicy(options).retentionDays);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  // 接続例外にURLやcredentialが含まれてもCLIの出力へ渡さない。
  process.stderr.write('Evaluation purge failed. Verify the approved database and retry explicitly.\n');
  process.exitCode = 1;
} finally { await pool.end(); }
