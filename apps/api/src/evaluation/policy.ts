import type { EvaluationPolicy } from '../contracts/evaluation.ts';

export type EvaluationOptions = {
  enabled: boolean; retentionDays?: number; maxSnapshots?: number; observationDays?: number;
  /** 保存値を作った実装の識別。認証情報や端末IDには使わない。 */
  buildVersion: string;
};
export function evaluationPolicy(options?: EvaluationOptions): EvaluationPolicy {
  const policy = { enabled: options?.enabled ?? false, policyVersion: 'self-evaluation-v1' as const,
    retentionDays: options?.retentionDays ?? 90, maxSnapshots: options?.maxSnapshots ?? 90,
    observationDays: options?.observationDays ?? 30 };
  const bounds: [number, number, number][] = [[policy.retentionDays, 3, 90], [policy.maxSnapshots, 1, 90], [policy.observationDays, 1, 30]];
  for (const [value, min, max] of bounds) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid evaluation limits');
  }
  if (policy.retentionDays < policy.observationDays + 2) throw new Error('Evaluation retention must include the correction window');
  if (policy.enabled && (!options?.buildVersion || !/^[a-zA-Z0-9._-]{1,80}$/.test(options.buildVersion))) throw new Error('Evaluation build version required');
  return policy;
}

// 既定OFF。設定値を追加しただけでは保持運用/参加説明の採択にならない。
export function loadEvaluationOptions(env: NodeJS.ProcessEnv = process.env): EvaluationOptions {
  if (env.EVALUATION_ENABLED !== undefined && !['0', '1'].includes(env.EVALUATION_ENABLED)) throw new Error('EVALUATION_ENABLED must be 0 or 1');
  const options: EvaluationOptions = { enabled: env.EVALUATION_ENABLED === '1',
    buildVersion: env.EVALUATION_BUILD_VERSION ?? env.VERCEL_GIT_COMMIT_SHA ?? '',
    ...(env.EVALUATION_RETENTION_DAYS ? { retentionDays: Number(env.EVALUATION_RETENTION_DAYS) } : {}),
    ...(env.EVALUATION_MAX_SNAPSHOTS ? { maxSnapshots: Number(env.EVALUATION_MAX_SNAPSHOTS) } : {}),
    ...(env.EVALUATION_OBSERVATION_DAYS ? { observationDays: Number(env.EVALUATION_OBSERVATION_DAYS) } : {}) };
  evaluationPolicy(options);
  return options;
}
