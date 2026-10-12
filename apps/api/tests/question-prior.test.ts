import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { migrate } from '../src/db/migrate.ts';
import { createGoal, getGoal, updateGoal } from '../src/goals/store.ts';
import { putLog } from '../src/logs/store.ts';
import { loadTodaySnapshot } from '../src/prediction/store.ts';
import { runQuestionPrediction } from '../src/prediction/engine.ts';
import { buildR11Today } from '../src/prediction/r11.ts';
import { validateSavedQuestion } from '../src/questions/snapshot.ts';
import { createTestDatabase } from './helpers/database.ts';
import { setup, signedInClient } from './helpers/stack.ts';

const NOW = new Date('2026-10-06T15:30:00Z');
const input = { title: 'practice', unit: 'minutes', totalRequired: 100, sessionAmount: 10, timezone: 'Asia/Tokyo' } as const;
const answers = { a: 'HIGH', b: 'LOW' } as const;

async function setupStore(t: test.TestContext) {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await migrate(db.pool);
  await db.pool.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ('owner', 'owner', 'owner@example.test', false, now(), now())`);
  return { db, goal: await createGoal(db.pool, 'owner', { ...input, questionPrior: answers }, () => NOW) };
}
async function waitFor(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw Error('Expected normal operation did not reach its barrier');
}

test('R11 保存・編集・撤回: 版0から開始し、nullとUNKNOWNを保持し、no-opでは版・snapshotを変えない', async t => {
  const { db, goal } = await setupStore(t);
  assert.deepEqual(goal.questionPrior, answers);
  assert.equal(goal.answerRevision, 0);
  const original = (await db.pool.query('select question_prior_snapshot, updated_at from goal where id = $1', [goal.id])).rows[0];
  assert.equal((await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, questionPrior: answers, expectedAnswerRevision: 0 }, () => NOW)).kind, 'updated');
  assert.equal((await getGoal(db.pool, 'owner', goal.id, () => NOW))!.answerRevision, 0);
  assert.deepEqual((await db.pool.query('select question_prior_snapshot, updated_at from goal where id = $1', [goal.id])).rows[0], original);
  const edit = await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, questionPrior: { a: null, b: 'UNKNOWN' }, expectedAnswerRevision: 0 }, () => NOW);
  assert.equal(edit.kind, 'updated');
  if (edit.kind !== 'updated') return;
  assert.deepEqual(edit.goal.questionPrior, { a: null, b: 'UNKNOWN' });
  assert.equal(edit.goal.answerRevision, 1);
  assert.deepEqual(await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, title: 'stale', questionPrior: edit.goal.questionPrior, expectedAnswerRevision: 0 }, () => NOW), { kind: 'answer_conflict' });
  assert.equal((await getGoal(db.pool, 'owner', goal.id, () => NOW))!.title, input.title);
  const clear = await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, questionPrior: { a: null, b: null }, expectedAnswerRevision: 1 }, () => NOW);
  assert.equal(clear.kind, 'updated');
  if (clear.kind !== 'updated') return;
  assert.equal(clear.goal.answerRevision, 2);
  assert.deepEqual(clear.goal.questionPrior, { a: null, b: null });
  assert.equal((await db.pool.query('select question_prior_snapshot from goal where id = $1', [goal.id])).rows[0].question_prior_snapshot, null);
  assert.deepEqual(await updateGoal(db.pool, 'other-owner', goal.id, { expectedGoalSettingsRevision: 0, questionPrior: answers, expectedAnswerRevision: 2 }, () => NOW), { kind: 'not_found' });
  assert.equal(await getGoal(db.pool, 'other-owner', goal.id, () => NOW), null);
});

test('R11 文脈変更: title/total/initial/timezoneは回答を保ち、unit/sessionAmountだけ撤回、実記録は保持する', async t => {
  const { db, goal } = await setupStore(t);
  const start = goal.recordStartDate;
  let settingsRevision = 0;
  for (const patch of [{ title: 'other' }, { totalRequired: 125 }, { initialProgress: 3 }, { timezone: 'UTC' }, { unit: input.unit, expectedAnswerRevision: 0 }]) {
    const result = await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: settingsRevision, ...patch }, () => NOW);
    assert.equal(result.kind, 'updated');
    if (result.kind === 'updated') {
      settingsRevision = result.goal.goalSettingsRevision;
      assert.equal(result.goal.answerRevision, 0);
      assert.deepEqual(result.goal.questionPrior, answers);
      assert.equal(result.goal.recordStartDate, start);
    }
  }
  const later = new Date('2026-10-07T12:00:00Z');
  assert.equal((await putLog(db.pool, 'owner', goal.id, '2026-10-07', { expectedGoalSettingsRevision: settingsRevision, status: 'DONE', amount: 7 }, () => later)).kind, 'saved');
  for (const answer of [answers, { a: null, b: 'UNKNOWN' }] as const) {
    assert.deepEqual(await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: settingsRevision, sessionAmount: 4, title: 'must rollback', questionPrior: answer, expectedAnswerRevision: 0 }, () => NOW), { kind: 'invalid_question_patch', field: 'questionPrior' });
  }
  const changed = await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: settingsRevision, sessionAmount: 4, expectedAnswerRevision: 0 }, () => NOW);
  assert.equal(changed.kind, 'updated');
  if (changed.kind !== 'updated') return;
  settingsRevision = changed.goal.goalSettingsRevision;
  assert.equal(changed.goal.unit, 'minutes');
  assert.equal(changed.goal.unitLocked, true);
  assert.equal(changed.goal.answerRevision, 1);
  assert.deepEqual(changed.goal.questionPrior, { a: null, b: null });
  assert.equal(changed.goal.recordStartDate, start);
  assert.equal(changed.goal.title, 'other');
  assert.deepEqual((await db.pool.query('select amount from action_log where goal_id = $1', [goal.id])).rows, [{ amount: 7 }]);
  const snapshot = (await loadTodaySnapshot(db.pool, 'owner', goal.id, () => later))!;
  const saved = validateSavedQuestion(snapshot.question, { unit: snapshot.goal.unit, sessionAmount: snapshot.goal.sessionAmount, recordStartDate: snapshot.goal.recordStartDate });
  const result = runQuestionPrediction({ prediction: { goal: snapshot.goal, logs: snapshot.logs, today: '2026-10-07' }, answers: saved.answers, mapping: saved.mapping });
  assert.equal(result.prediction.progress.done, 10, 'initial 3 + stored actual 7; no unit conversion or new default amount');
  assert.deepEqual(result.plan, { remainingAmount: 115, remainingSessions: 29, lastSessionAmount: 3 });
  const legacy = await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: settingsRevision, sessionAmount: 5 }, () => NOW);
  assert.equal(legacy.kind, 'updated');
  if (legacy.kind === 'updated') assert.equal(legacy.goal.answerRevision, 2, 'legacy context write also invalidates old answer tokens');
});

test('R11 同時回答変更: Goal lock待機後に版を確認し、同じ古い版の片方は全体rollbackする', async t => {
  const { db, goal } = await setupStore(t);
  const held = await db.pool.connect();
  const patchPool = new pg.Pool({ connectionString: db.connectionString, max: 2 });
  let writes: Promise<unknown>[] = [];
  try {
    await held.query('begin');
    await held.query('select id from goal where id = $1 for update', [goal.id]);
    writes = [
      updateGoal(patchPool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, title: 'first', questionPrior: { a: 'LOW', b: 'LOW' }, expectedAnswerRevision: 0 }, () => NOW),
      updateGoal(patchPool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, title: 'second', questionPrior: { a: 'MID', b: 'MID' }, expectedAnswerRevision: 0 }, () => NOW),
    ];
    await waitFor(async () => (await db.pool.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%for update of g%'`)).rows[0]!.n === 2);
    await held.query('commit');
    const results = await Promise.all(writes) as Awaited<ReturnType<typeof updateGoal>>[];
    assert.deepEqual(results.map(r => r.kind).sort(), ['settings_conflict', 'updated']);
    const winner = results.find(r => r.kind === 'updated')!;
    const stored = (await getGoal(db.pool, 'owner', goal.id, () => NOW))!;
    if (winner.kind === 'updated') assert.deepEqual(stored, winner.goal);
    assert.equal(stored.answerRevision, 1);
  } finally {
    await held.query('rollback').catch(() => {});
    held.release();
    await Promise.allSettled(writes);
    await patchPool.end();
  }
});

test('R11 文脈変更と回答編集を両順序で固定し、古い回答を新しい単位・量へ保存しない', async t => {
  const { db } = await setupStore(t);
  for (const contextFirst of [true, false]) {
    const goal = await createGoal(db.pool, 'owner', { ...input, questionPrior: answers }, () => NOW);
    const held = await db.pool.connect();
    const writePool = new pg.Pool({ connectionString: db.connectionString, max: 2 });
    let first: ReturnType<typeof updateGoal> | undefined, second: ReturnType<typeof updateGoal> | undefined;
    const context = { unit: 'sessions', sessionAmount: 4 } as const;
    const edit = { questionPrior: { a: 'MID', b: 'MID' }, expectedAnswerRevision: 0 } as const;
    const blocked = async (count: number) => waitFor(async () => (await db.pool.query<{ n: number }>(`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%for update of g%'`)).rows[0]!.n === count);
    try {
      await held.query('begin');
      await held.query('select id from goal where id = $1 for update', [goal.id]);
      first = updateGoal(writePool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, ...contextFirst ? context : edit }, () => NOW);
      await blocked(1);
      second = updateGoal(writePool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, ...contextFirst ? edit : context }, () => NOW);
      await blocked(2);
      await held.query('commit');
      const results = await Promise.all([first, second]);
      assert.equal(results[0].kind, 'updated');
      assert.equal(results[1].kind, contextFirst ? 'settings_conflict' : 'updated');
      const stored = (await getGoal(db.pool, 'owner', goal.id, () => NOW))!;
      assert.equal(stored.unit, 'sessions');
      assert.equal(stored.sessionAmount, 4);
      assert.deepEqual(stored.questionPrior, { a: null, b: null });
      assert.equal(stored.answerRevision, contextFirst ? 1 : 2);
      assert.equal(stored.title, input.title);
    } finally {
      await held.query('rollback').catch(() => {});
      held.release();
      await Promise.allSettled([first, second]);
      await writePool.end();
    }
  }
});

test('R11 同値no-opを同時に再送しても両方成功し、版・snapshot・timestampを保持する', async t => {
  const { db, goal } = await setupStore(t);
  const before = (await db.pool.query('select * from goal where id = $1', [goal.id])).rows[0];
  const patch = { title: input.title, unit: input.unit, sessionAmount: input.sessionAmount, questionPrior: answers, expectedAnswerRevision: 0 };
  const results = await Promise.all([updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, ...patch }, () => NOW), updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, ...patch }, () => NOW)]);
  assert.deepEqual(results.map(r => r.kind), ['updated', 'updated']);
  assert.deepEqual((await db.pool.query('select * from goal where id = $1', [goal.id])).rows[0], before);
});

test('R11 Todayは途中の通常回答更新と記録commitを混ぜず、接続返却後に同じsnapshotを計算する', async t => {
  const { db, goal } = await setupStore(t);
  let writes = 0;
  const interleaved = { connect: async () => {
    const client = await db.pool.connect();
    const query = client.query, release = client.release;
    let used = false;
    client.query = ((...args: unknown[]) => {
      const result = Reflect.apply(query, client, args);
      if (!used && typeof args[0] === 'string' && args[0].startsWith('select total_required')) {
        used = true;
        return Promise.resolve(result).then(async rows => {
          assert.equal((await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, questionPrior: { a: 'LOW', b: 'HIGH' }, expectedAnswerRevision: 0 }, () => NOW)).kind, 'updated');
          assert.equal((await putLog(db.pool, 'owner', goal.id, '2026-10-07', { expectedGoalSettingsRevision: 0, status: 'DONE', amount: 7 }, () => NOW)).kind, 'saved');
          writes++;
          return rows;
        });
      }
      return result;
    }) as typeof client.query;
    client.release = (...args) => {
      client.query = query;
      client.release = release;
      Reflect.apply(release, client, args);
    };
    return client;
  } } as pg.Pool;
  const old = (await loadTodaySnapshot(interleaved, 'owner', goal.id, () => NOW))!;
  assert.equal(writes, 1);
  assert.equal(db.pool.totalCount - db.pool.idleCount, 0, 'snapshot返却時に接続を持たない');
  const original = buildR11Today(old);
  assert.deepEqual(original.prediction.posterior, { a: { alpha: 3, beta: 1 }, b: { alpha: 1, beta: 3 } });
  assert.equal(original.prediction.progress.done, 0);
  assert.equal(original.todayLog, null);
  const fresh = buildR11Today((await loadTodaySnapshot(db.pool, 'owner', goal.id, () => NOW))!);
  assert.deepEqual(fresh.prediction.posterior, { a: { alpha: 1, beta: 3 }, b: { alpha: 3, beta: 1 } });
  assert.equal(fresh.prediction.progress.done, 7);
  assert.equal(fresh.todayLog?.amount, 7);
  assert.deepEqual(fresh.provenance, { a: 'QUESTION', b: 'QUESTION' }, '初日のDONEだけでは実遷移の材料を作らない');
});

test('R11 版上限・保存snapshot破損: 500にして全体rollbackし、最新mappingへのfallbackをしない', async t => {
  const { db, goal } = await setupStore(t);
  await db.pool.query('update goal set answer_revision = $2 where id = $1', [goal.id, String(Number.MAX_SAFE_INTEGER)]);
  const noOp = await updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, questionPrior: answers, expectedAnswerRevision: Number.MAX_SAFE_INTEGER }, () => NOW);
  assert.equal(noOp.kind, 'updated');
  await assert.rejects(updateGoal(db.pool, 'owner', goal.id, { expectedGoalSettingsRevision: 0, title: 'must rollback', questionPrior: { a: null, b: null }, expectedAnswerRevision: Number.MAX_SAFE_INTEGER }, () => NOW), e => e instanceof Error && 'reason' in e && e.reason === 'ANSWER_REVISION_EXHAUSTED');
  assert.equal((await getGoal(db.pool, 'owner', goal.id, () => NOW))!.title, input.title);
  await db.pool.query(`update goal set question_prior_snapshot = jsonb_set(question_prior_snapshot, '{mapping,version}', '"unknown-version"'::jsonb) where id = $1`, [goal.id]);
  await assert.rejects(getGoal(db.pool, 'owner', goal.id, () => NOW), e => e instanceof Error && 'reason' in e && e.reason === 'INVALID_SAVED_QUESTION');
});

test('R11 HTTP書込: 旧応答を保持し、不正raw・内部Beta・版省略は422、古い版は409でGoalも変えない', async t => {
  const { db, stack } = await setup(t, { now: () => NOW });
  const a = await signedInClient(stack.app, 'questions');
  const res = await a.call('POST', '/api/goals', { ...input, questionPrior: { a: null, b: 'UNKNOWN' } });
  assert.equal(res.status, 201, res.body);
  const id = String(res.json!.id);
  assert.ok(!Object.hasOwn(res.json!, 'questionPrior'));
  for (const questionPrior of [null, { a: 'LOW' }, { a: 'INVALID', b: null }, { a: null, b: null, alpha: 1 }]) {
    assert.equal((await a.call('PATCH', `/api/goals/${id}`, { questionPrior, expectedAnswerRevision: 0 })).status, 422);
  }
  assert.equal((await a.call('PATCH', `/api/goals/${id}`, { questionPrior: answers })).status, 422);
  assert.equal((await a.call('PATCH', `/api/goals/${id}`, { expectedAnswerRevision: 0 })).status, 422);
  assert.equal((await a.call('PATCH', `/api/goals/${id}`, { questionPrior: answers, expectedAnswerRevision: 0 })).status, 200);
  const conflict = await a.call('PATCH', `/api/goals/${id}`, { title: 'must rollback', questionPrior: answers, expectedAnswerRevision: 0 });
  assert.equal(conflict.status, 409, conflict.body);
  assert.equal((conflict.json!.error as { code: string }).code, 'ANSWER_CONFLICT');
  assert.equal((await db.pool.query('select title from goal where id = $1', [id])).rows[0].title, input.title);
});
