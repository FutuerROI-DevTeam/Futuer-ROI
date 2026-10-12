// application.ymlが毎job作るCI専用service。任意の外部admin接続を許可しない。
const SYNTHETIC_CI_DATABASE = 'postgres://futureroi:ci-only-placeholder@127.0.0.1:5432/futureroi';
export function assertSyntheticMilestoneDatabase(env: NodeJS.ProcessEnv): void {
  if (env.DATABASE_URL && !(env.GITHUB_ACTIONS === 'true' && env.DATABASE_URL === SYNTHETIC_CI_DATABASE)) {
    throw new Error('Milestone tests require DATABASE_URL unset or the exact disposable GitHub Actions service');
  }
}
