// 応答の後も完了まで走らせる処理（再設定メールの送信など）の受け皿。Better Authの
// `advanced.backgroundTasks.handler`へ渡す。失敗の記録はSDK側（runInBackgroundOrAwait）が行う。
//
// - 常駐server：このtrackerで預かり、終了時に`drain()`で送信の完了を待ってからDB接続を返す
// - Vercel：`@vercel/functions`の`waitUntil`を渡し、Functionを送信完了まで生かす（[vercel.ts](../vercel.ts)）

export type BackgroundTasks = {
  run: (task: Promise<unknown>) => void;
  /** 預かった処理がすべて終わるまで待つ（成否は問わない）。 */
  drain: () => Promise<void>;
};

export function createBackgroundTasks(): BackgroundTasks {
  const pending = new Set<Promise<unknown>>();
  return {
    run(task) {
      const tracked = task.catch(() => undefined).finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    async drain() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}
