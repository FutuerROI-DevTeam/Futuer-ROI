import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { authSearch } from './auth/redirect.ts';
import { resetSearch } from './auth/reset.ts';
import { checkSession, SessionUnreachableError } from './auth/session.ts';
import { AppShell } from './routes/AppShell.tsx';
import { AuthPage } from './routes/AuthPage.tsx';
import { ForgotPasswordPage } from './routes/ForgotPasswordPage.tsx';
import { ResetPasswordPage } from './routes/ResetPasswordPage.tsx';
import { HealthPage } from './routes/HealthPage.tsx';
import { Home } from './routes/Home.tsx';
import { NotFoundPage, RouteErrorPage, RoutePendingPage } from './routes/RouteStates.tsx';
import { TodayPage } from './features/today/TodayPage.tsx';
import { GoalCreatePage, GoalEditPage } from './features/goals/GoalFormPage.tsx';
import { GoalListPage } from './features/goals/GoalListPage.tsx';
import { HistoryPage } from './features/history/HistoryPage.tsx';
import { EvaluationPage } from './features/evaluation/EvaluationPage.tsx';

/*
 * ルートの構成（#146）。
 *
 *   /                          公開トップ（ログイン不要）
 *   [auth]                     ログイン・新規登録・パスワード再設定。ログイン済みなら戻り先へ移る
 *     /login, /register
 *     /forgot-password         再設定メールの要求
 *     /reset-password          メールのリンクから戻り、新しいパスワードを保存（?token= か ?error=INVALID_TOKEN）
 *   [app]                      ログインが必要な画面。ログインの確認はここ1か所で行う
 *     /goals                   Goal一覧
 *     /goals/new               Goalの作成
 *     /goals/$goalId           Today
 *     /goals/$goalId/edit      Goalの編集
 *     /goals/$goalId/history   記録の履歴（カレンダー）
 *   /health                    接続確認（開発用。画面からはリンクしない）
 *   定義していないURL・読み込みの失敗・読込中は、ルーター全体の既定の画面で扱う
 *
 * [auth]・[app] はURLに現れないまとまり（pathless layout route）。
 */

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  // 依頼者承認の公開トップ（P-16）。Goal・記録は取得しない
  component: Home,
});

const authLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  validateSearch: authSearch,
  // ログイン済みなら、ログイン画面を出さずに戻り先へ移る（履歴を置き換え、「戻る」でこの画面へ戻らない）。
  // 確認できなかった（通信の失敗）ときは、そのままログイン画面を出す
  beforeLoad: async ({ search }) => {
    if ((await checkSession()).kind === 'signed-in') throw redirect({ href: search.redirect, replace: true });
  },
  component: Outlet,
});

const loginRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/login',
  component: function LoginRoute() {
    const { redirect: redirectTo, reason } = loginRoute.useSearch();
    return <AuthPage mode="login" redirectTo={redirectTo} reason={reason} />;
  },
});

const registerRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/register',
  component: function RegisterRoute() {
    const { redirect: redirectTo, reason } = registerRoute.useSearch();
    return <AuthPage mode="register" redirectTo={redirectTo} reason={reason} />;
  },
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => authLayout,
  path: '/reset-password',
  // 親（authLayout）の戻り先の検査に加えて、メールのリンクが付けたtoken／errorだけを受け取る
  validateSearch: (search: Record<string, unknown>) => ({ ...authSearch(search), ...resetSearch(search) }),
  component: function ResetPasswordRoute() {
    const { token, error } = resetPasswordRoute.useSearch();
    return <ResetPasswordPage search={token ? { token } : error ? { error } : {}} />;
  },
});

const appLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  // 未ログインは元のURLを戻り先にしてログインへ送る。確認できなかった（通信の失敗）ときは、
  // 未ログインと取り違えずにエラーの画面（接続できませんでした）を出す
  beforeLoad: async ({ location }) => {
    const session = await checkSession();
    if (session.kind === 'signed-out') throw redirect({ to: '/login', search: { redirect: location.href }, replace: true });
    if (session.kind === 'unreachable') throw new SessionUnreachableError();
  },
  // デスクトップ幅の上のバー（アプリ名とアカウント）を出す外側
  component: AppShell,
});

const goalsRoute = createRoute({ getParentRoute: () => appLayout, path: '/goals', component: GoalListPage });

const goalNewRoute = createRoute({ getParentRoute: () => appLayout, path: '/goals/new', component: GoalCreatePage });

const goalEditRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/goals/$goalId/edit',
  component: function GoalEditRoute() {
    const { goalId } = goalEditRoute.useParams();
    return <GoalEditPage goalId={goalId} />;
  },
});

const todayRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/goals/$goalId',
  component: function TodayRoute() {
    const { goalId } = todayRoute.useParams();
    return <TodayPage goalId={goalId} />;
  },
});

const historyRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/goals/$goalId/history',
  component: function HistoryRoute() {
    const { goalId } = historyRoute.useParams();
    return <HistoryPage goalId={goalId} />;
  },
});

const healthRoute = createRoute({ getParentRoute: () => rootRoute, path: '/health', component: HealthPage });

const evaluationRoute = createRoute({
  getParentRoute: () => appLayout,
  path: '/goals/$goalId/evaluation',
  component: function EvaluationRoute() {
    const { goalId } = evaluationRoute.useParams();
    return <EvaluationPage goalId={goalId} />;
  },
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  authLayout.addChildren([loginRoute, registerRoute, forgotPasswordRoute, resetPasswordRoute]),
  appLayout.addChildren([goalsRoute, goalNewRoute, goalEditRoute, todayRoute, historyRoute, evaluationRoute]),
  healthRoute,
]);

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFoundPage,
  defaultErrorComponent: RouteErrorPage,
  defaultPendingComponent: RoutePendingPage,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
