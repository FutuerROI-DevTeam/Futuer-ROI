import { authClient } from '../auth/client.ts';
import { appCopy } from '../copy/app.ts';
import { Button } from '../ui/components/Button.tsx';
import { ErrorPanel } from '../ui/components/Notice.tsx';
import './route-states.css';

const c = appCopy;

/**
 * session再確認の通信失敗・5xxをまとめて示し、再取得で回復する（#279）。
 * 私的な取得・入力はusePrivateEpoch / PrivateCacheGuardが止める（#155・#190）。
 * 未ログイン（200・sessionなし）はerrorにならず、初回失敗はbeforeLoad → RouteErrorPageが扱う。
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
