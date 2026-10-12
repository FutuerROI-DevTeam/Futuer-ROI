export type MilestoneOptions = { enabled: boolean; buildVersion: string };
export const MILESTONE_POLICY_VERSION = 'session-milestone-opt-in-v1';
export function milestonePolicy(options?: MilestoneOptions) {
  if (options?.enabled && !/^[a-zA-Z0-9._-]{1,80}$/.test(options.buildVersion)) throw new Error('Milestone build version required');
  return { enabled: options?.enabled ?? false, policyVersion: MILESTONE_POLICY_VERSION as typeof MILESTONE_POLICY_VERSION,
    retentionDays: 90 as const, observationDays: 30 as const, correctionDays: 2 as const,
    requiredEpisodes: 3 as const, standardAutoApply: false as const, evidenceScope: 'milestone' as const };
}
export function loadMilestoneOptions(env: NodeJS.ProcessEnv = process.env): MilestoneOptions {
  if (env.MILESTONE_CALIBRATION_ENABLED !== undefined && !['0', '1'].includes(env.MILESTONE_CALIBRATION_ENABLED)) throw new Error('Invalid milestone flag');
  const options = { enabled: env.MILESTONE_CALIBRATION_ENABLED === '1',
    buildVersion: env.MILESTONE_CALIBRATION_BUILD_VERSION ?? env.VERCEL_GIT_COMMIT_SHA ?? '' };
  milestonePolicy(options);
  return options;
}
