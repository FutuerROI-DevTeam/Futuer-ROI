import test from 'node:test';
import assert from 'node:assert/strict';
import { observeDuration, PredictionInputError } from '../dist/src/index.js';
const input = logs => ({ goal: { totalRequired: 1000, initialProgress: 0, sessionAmount: 10 }, today: '2026-10-31', logs });
const done = localDate => ({ localDate, status: 'DONE', amount: 10 });
const skip = localDate => ({ localDate, status: 'SKIPPED', amount: null });

test('duration extracts each adjacent pair once and resets a known run at DONE', () => {
  const logs = [done('2026-10-04'),skip('2026-10-03'),done('2026-10-01'),skip('2026-10-02'),done('2026-10-05')];
  const frozen = structuredClone(logs);
  const got=observeDuration(input(logs),14);
  assert.deepEqual(got.transitions.map(t => [t.from,t.to,t.restDays]), [['DONE','SKIPPED',0],['SKIPPED','SKIPPED',1],['SKIPPED','DONE',2],['DONE','DONE',0]]);
  assert.deepEqual(logs,frozen);
  assert.equal(new Set(got.transitions.map(t=>t.originDate+'/'+t.outcomeDate)).size,got.transitions.length);
});
test('left-censored and missing-day SKIP ages stay unknown until a recorded DONE', () => {
  const got=observeDuration(input([skip('2026-10-01'),skip('2026-10-02'),done('2026-10-03'),skip('2026-10-04'),skip('2026-10-06'),skip('2026-10-07'),done('2026-10-08'),skip('2026-10-09')]),14);
  assert.deepEqual(got.records.map(r=>r.restDays),[null,null,0,1,null,null,0,1]);
  assert.equal(got.transitions.length,6);
  assert.equal(got.transitions.some(t=>t.originDate==='2026-10-04'),false);
  assert.deepEqual(got.transitions.filter(t=>t.from==='SKIPPED').map(t=>t.restDays),[null,null,null,null]);
});
test('a contiguous left-censored run can prove the fixed cap without inventing its true age', () => {
  const got=observeDuration(input([skip('2026-10-01'),skip('2026-10-02'),skip('2026-10-03'),skip('2026-10-04'),done('2026-10-05')]),3);
  assert.deepEqual(got.records.map(r=>[r.restDays,r.restAgeKnowledge]),[[null,'UNKNOWN'],[null,'UNKNOWN'],[3,'CAPPED_LOWER_BOUND'],[3,'CAPPED_LOWER_BOUND'],[0,'EXACT']]);
  assert.deepEqual(got.transitions.map(t=>t.restDays),[null,null,3,3]);
});
test('duration adjacency follows Gregorian dates across leap days and year boundaries', () => {
  const got=observeDuration(input([done('2024-02-28'),skip('2024-02-29'),done('2024-03-01'),done('2025-12-31'),skip('2026-01-01')]),14);
  assert.equal(got.transitions.length,3);
  assert.deepEqual(got.transitions.map(t=>t.restDays),[0,1,0]);
});
test('duration rejects duplicates, future dates, invalid calendar dates and cap rather than cleaning them silently', () => {
  for(const logs of [[done('2026-10-01'),done('2026-10-01')],[done('2026-11-01')],[done('2026-02-29')]])assert.throws(()=>observeDuration(input(logs),14),PredictionInputError);
  for(const cap of [1,31,2.5,NaN])assert.throws(()=>observeDuration(input([]),cap),RangeError);
});
