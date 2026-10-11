import type { LearningPolicy } from '../contracts/learning.ts';

export type LearningOptions = { enabled: boolean; retentionDays?: number; maxArtifacts?: number; observationDays?: number; capDays?: number };
export function learningPolicy(options?: LearningOptions): LearningPolicy {
  const policy: LearningPolicy = { enabled: options?.enabled ?? false, policyVersion: 'self-learning-v1',
    retentionDays: options?.retentionDays ?? 90, maxArtifacts: options?.maxArtifacts ?? 5,
    observationDays: options?.observationDays ?? 30, capDays: options?.capDays ?? 14 };
  for (const [value, min, max] of [[policy.retentionDays, 3, 90], [policy.maxArtifacts, 1, 5],
    [policy.observationDays, 1, 30], [policy.capDays, 2, 30]]) {
    if (!Number.isSafeInteger(value) || value! < min! || value! > max!) throw new Error('Invalid learning limits');
  }
  if (policy.retentionDays < policy.observationDays + 2) throw new Error('Learning retention must include the correction window');
  return policy;
}
export function loadLearningOptions(env: NodeJS.ProcessEnv = process.env): LearningOptions {
  if (env.LEARNING_ENABLED !== undefined && !['0', '1'].includes(env.LEARNING_ENABLED)) throw new Error('LEARNING_ENABLED must be 0 or 1');
  const options: LearningOptions = { enabled: env.LEARNING_ENABLED === '1',
    ...(env.LEARNING_RETENTION_DAYS ? { retentionDays: Number(env.LEARNING_RETENTION_DAYS) } : {}),
    ...(env.LEARNING_MAX_ARTIFACTS ? { maxArtifacts: Number(env.LEARNING_MAX_ARTIFACTS) } : {}),
    ...(env.LEARNING_OBSERVATION_DAYS ? { observationDays: Number(env.LEARNING_OBSERVATION_DAYS) } : {}),
    ...(env.LEARNING_CAP_DAYS ? { capDays: Number(env.LEARNING_CAP_DAYS) } : {}) };
  learningPolicy(options);
  return options;
}
