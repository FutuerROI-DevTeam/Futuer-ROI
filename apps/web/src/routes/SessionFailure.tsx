import { authClient } from '../auth/client.ts';
import { appCopy } from '../copy/app.ts';
import { Button } from '../ui/components/Button.tsx';
import { ErrorPanel } from '../ui/components/Notice.tsx';
import './route-states.css';

const c = appCopy;

/**
 * ログイン後の画面で、ウィンドウへ戻ったときなどの session の再確認が通信の失敗・API の 5xx で終わったとき（#279）。
 * 再確認中・失敗中は usePrivateEpoch / PrivateCacheGuard が私的な取得・入力を止め、各画面は「読み込み中」のままになる
 * （未ログインと取り違えず、他人のデータを見せないため。#155・#190。その境界はここで変えない）。
 * 失敗はこの1か所で伝え、「再読み込み」で session の再取得から回復できるようにする。各画面には分岐を足さない。
 * 未ログインは 200 で session なしなので error にならず、ここは出ない（ログイン画面へは送らない）。
 * 初回のルート読み込みの失敗は router の beforeLoad → RouteErrorPage が扱う。
 */
export function SessionFailure() {
  const session = authClient.useSession();
  if (session.isPending || session.isRefetching || !session.error) return null;
  return (
    <div className="fr fr-route__pad fr-route__pad--top">
      <ErrorPanel
        title={c.error.unreachableTitle}
        action={
          <Button icon="retry" onClick={() => void session.refetch()}>
            {c.error.retry}
          </Button>
        }
      >
        {c.error.unreachable}
      </ErrorPanel>
    </div>
  );
}
