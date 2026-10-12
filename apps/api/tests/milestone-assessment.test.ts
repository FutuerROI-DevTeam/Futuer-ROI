import assert from 'node:assert/strict';
import test from 'node:test';
import type { TodaySnapshot } from '../src/prediction/store.ts';
import { assessEpisode, contextKey, makeEpisode, type EpisodeRow } from '../src/milestone/assessment.ts';
import { localDateIn, shiftLocalDate } from '../src/goals/local-date.ts';
const BUILD = 'synthetic-milestone-assessment';
const origin = '2026-03-28';
function base(): TodaySnapshot {
  return { now: new Date('2026-03-28T12:00:00Z'), goal: { totalRequired: 300, initialProgress: 0, sessionAmount: 10,
    timezone: 'Europe/Berlin', recordStartDate: '2026-03-25', unit: 'minutes', goalSettingsRevision: 0, unitLocked: true },
    question: { question_prior: { a: null, b: null }, answer_revision: '0', question_prior_snapshot: null },
    logs: [-3, -2, -1, 0].map((d, i) => ({ localDate: shiftLocalDate(origin, d), status: i % 2 === 0 ? 'SKIPPED' as const : 'DONE' as const, amount: i % 2 === 0 ? null : 10 })) };
}
function fixture() {
  const snapshot = base();
  const scope = { ownerId: 'synthetic-owner', goalId: 'synthetic-goal', participationId: 'synthetic-participant', contextKey: contextKey(snapshot, BUILD) };
  const row: EpisodeRow = { id: 'synthetic-forecast', issued_at: snapshot.now, expires_at: new Date('2026-06-26T12:00:00Z'), payload: makeEpisode(snapshot, scope, BUILD) };
  return { snapshot, row };
}
test('#248 H+2 is the frozen local calendar maturity across DST, never raw elapsed time', () => {
  const { snapshot, row } = fixture();
  snapshot.logs.push({ localDate: '2026-03-29', status: 'DONE', amount: 10 });
  snapshot.now = new Date('2026-03-30T21:30:00Z');
  assert.equal(localDateIn(snapshot.now, row.payload.timezone), '2026-03-30');
  assert.equal(assessEpisode(row, snapshot, BUILD).state, 'PENDING');
  snapshot.now = new Date('2026-03-31T00:00:00Z');
  assert.deepEqual(assessEpisode(row, snapshot, BUILD).observation, { kind: 'EVENT', lower: 0, upper: 1 });
});
test('#248 missing is not skip; confirmed arrival with a gap yields an interval', () => {
  const { snapshot, row } = fixture();
  snapshot.now = new Date('2026-04-03T12:00:00Z');
  snapshot.logs.push({ localDate: '2026-03-29', status: 'SKIPPED', amount: null }, { localDate: '2026-03-31', status: 'DONE', amount: 10 });
  assert.deepEqual(assessEpisode(row, snapshot, BUILD).observation, { kind: 'INTERVAL', lower: 1, upper: 3 });
  snapshot.logs.pop();
  const censored = assessEpisode(row, snapshot, BUILD);
  assert.deepEqual(censored.observation, { kind: 'CENSOR', lower: 1, upper: 1 });
  assert.equal(censored.reason, 'CENSORED_BEFORE_MISSING');
  assert.equal(censored.closed, false);
  snapshot.logs.pop();
  assert.equal(assessEpisode(row, snapshot, BUILD).state, 'UNKNOWN');
});
test('#248 real amounts and first arrival are used; issuance day is not counted twice', () => {
  const { snapshot, row } = fixture();
  snapshot.now = new Date('2026-04-02T12:00:00Z');
  snapshot.logs.push({ localDate: '2026-03-29', status: 'DONE', amount: 4 }, { localDate: '2026-03-30', status: 'DONE', amount: 6 });
  assert.deepEqual(assessEpisode(row, snapshot, BUILD).observation, { kind: 'EVENT', lower: 1, upper: 2 });
  assert.equal(row.payload.q, 10);
  assert.equal(row.payload.threshold, 30);
  assert.equal(row.payload.comparison.appliedToStandard, false);
});
test('#248 future records do not alter the fixed training cutoff; later corrections do', () => {
  const { snapshot, row } = fixture();
  snapshot.now = new Date('2026-04-01T12:00:00Z');
  snapshot.logs.push({ localDate: '2026-03-29', status: 'SKIPPED', amount: null }, { localDate: '2026-03-30', status: 'SKIPPED', amount: null });
  const training = assessEpisode(row, snapshot, BUILD);
  snapshot.now = new Date('2026-04-04T12:00:00Z');
  snapshot.logs.push({ localDate: '2026-04-02', status: 'DONE', amount: 10 });
  assert.equal(assessEpisode(row, snapshot, BUILD, training.observedThrough).labelHash, training.labelHash);
  snapshot.logs.find(log => log.localDate === '2026-03-29')!.status = 'DONE';
  snapshot.logs.find(log => log.localDate === '2026-03-29')!.amount = 10;
  assert.notEqual(assessEpisode(row, snapshot, BUILD, training.observedThrough).labelHash, training.labelHash);
  assert.throws(() => assessEpisode(row, snapshot, BUILD, '2026-04-04'), /IMMATURE_CUTOFF/);
});
test('#248 prefix, settings, question, build and exact expiry invalidate old observations', () => {
  for (const change of ['prefix', 'settings', 'question', 'build', 'expiry']) {
    const { snapshot, row } = fixture();
    snapshot.now = new Date('2026-04-02T12:00:00Z');
    snapshot.logs.push({ localDate: '2026-03-29', status: 'DONE', amount: 10 });
    if (change === 'prefix') snapshot.logs[3]!.amount = 11;
    if (change === 'settings') snapshot.goal.goalSettingsRevision++;
    if (change === 'question') snapshot.question.answer_revision = '1';
    if (change === 'expiry') snapshot.now = row.expires_at;
    const checked = assessEpisode(row, snapshot, change === 'build' ? 'new-build' : BUILD);
    assert.equal(checked.observation, null);
    assert.ok(checked.state === 'INVALID' || checked.state === 'EXPIRED');
  }
});
test('#248 H30 closure and original fixed final target differ from the recurring milestone', () => {
  const { snapshot, row } = fixture();
  snapshot.now = new Date('2026-04-29T12:00:00Z');
  for (let d = 1; d <= 30; d++) snapshot.logs.push({ localDate: shiftLocalDate(origin, d), status: 'SKIPPED', amount: null });
  const result = assessEpisode(row, snapshot, BUILD);
  assert.deepEqual(result.observation, { kind: 'CENSOR', lower: 30, upper: 30 });
  assert.equal(result.closed, true);
  assert.equal(row.payload.finalCdf[0], 0);
  assert.ok(row.payload.milestone.cdf[0]! > 0);
  assert.equal(row.payload.comparison.finalExtrapolation, true);
});
