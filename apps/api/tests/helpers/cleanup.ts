// 後続の資源を残さず、元エラーと各cleanup失敗を呼出元へ返す。
export async function cleanupAll(actions: Array<() => Promise<unknown>>): Promise<void> {
  const errors: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Multiple resource cleanup failures');
}

export async function cleanupAfterFailure(error: unknown, close: () => Promise<void>): Promise<never> {
  try {
    await close();
  } catch (cleanupError) {
    const failures = cleanupError instanceof AggregateError ? cleanupError.errors : [cleanupError];
    throw new AggregateError([error, ...failures], 'Initialization and resource cleanup failed', { cause: error });
  }
  throw error;
}

// 初期化失敗時の即時cleanupとtest.afterが同じ資源を二重に閉じない。
export function closeOnce(close: () => Promise<void>): () => Promise<void> {
  let result: Promise<void> | undefined;
  return () => result ??= Promise.resolve().then(close);
}
