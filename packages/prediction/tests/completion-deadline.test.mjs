import test from 'node:test';
import assert from 'node:assert/strict';
import { completionPmf, mixtureCompletionQuantiles } from '../dist/src/completion.js';

test('n=H has exactly the all-DONE path, including endpoints and H=1', () => {
  for (const initialState of ['DONE', 'SKIPPED']) {
    for (let h = 1; h <= 8; h++) {
      for (const a of [0, .25, .5, .75, 1]) {
        for (const b of [0, .25, .5, .75, 1]) {
          const args = { initialState, requiredFutureDone: h, horizonDays: h, a, b };
          // Dyadic inputs and these short paths are represented exactly. This uses the unique
          // path's product, independently of the DP recurrence and scratch-buffer handling.
          const expected = new Float64Array(h + 1);
          expected[h] = (initialState === 'DONE' ? a : b) * a ** (h - 1);
          assert.deepEqual(completionPmf(args), expected);
          assert.deepEqual(completionPmf({ ...args, prune: false }), expected);
          assert.deepEqual(mixtureCompletionQuantiles([{ a, b }], initialState, h, h), {
            p50Days: expected[h] >= .5 - 1e-12 ? h : null,
            p80Days: expected[h] >= .8 - 1e-12 ? h : null,
          });
        }
      }
    }
  }
});

test('zero/beyond-horizon returns and n=H-1 keep their original semantics', () => {
  for (const initialState of ['DONE', 'SKIPPED']) {
    assert.deepEqual(
      completionPmf({ initialState, requiredFutureDone: 0, horizonDays: 0, a: .5, b: .5 }),
      new Float64Array([1]),
    );
    assert.deepEqual(
      completionPmf({ initialState, requiredFutureDone: 2, horizonDays: 1, a: .5, b: .5 }),
      new Float64Array(2),
    );
    for (let h = 2; h <= 8; h++) {
      // Fair independent Bernoulli first passage: C(day-1,n-1) / 2^day.
      const n = h - 1;
      const expected = new Float64Array(h + 1);
      expected[n] = 2 ** -n;
      expected[h] = n * 2 ** -h;
      for (const prune of [true, false]) {
        assert.deepEqual(
          completionPmf({ initialState, requiredFutureDone: n, horizonDays: h, a: .5, b: .5, prune }),
          expected,
        );
      }
    }
  }
});
