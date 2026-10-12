import test from 'node:test';
import assert from 'node:assert/strict';
import { completionPmf, mixtureCompletionQuantiles } from '../dist/src/completion.js';

function close(actual, expected, epsilon = 1e-12) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < epsilon, `day ${i}: ${value} vs ${expected[i]}`));
}

// 2状態の全経路を独立に列挙し、整数の重み / 4^H で確率を計算する。
function rationalPaths(initialState, n, h, aQuarter, bQuarter) {
  const weights = Array(h + 1).fill(0n);
  for (let bits = 0; bits < 2 ** h; bits++) {
    let state = initialState;
    let count = 0;
    let first = null;
    let weight = 1n;
    for (let day = 1; day <= h; day++) {
      const p = state === 'DONE' ? aQuarter : bQuarter;
      const done = (bits & (1 << (day - 1))) !== 0;
      weight *= BigInt(done ? p : 4 - p);
      state = done ? 'DONE' : 'SKIPPED';
      if (done && ++count === n) {
        first = day;
      }
    }
    if (first !== null) {
      weights[first] += weight;
    }
  }
  return weights.map(w => Number(w) / 4 ** h);
}

test('DP agrees with exhaustive rational paths, with and without unreachable pruning', () => {
  for (const initialState of ['DONE', 'SKIPPED']) {
    for (const aQuarter of [0, 1, 2, 3, 4]) {
      for (const bQuarter of [0, 1, 2, 3, 4]) {
        for (let h = 1; h <= 7; h++) {
          for (let n = 0; n <= h + 1; n++) {
            const args = {
              initialState,
              requiredFutureDone: n,
              horizonDays: h,
              a: aQuarter / 4,
              b: bQuarter / 4,
            };
            const expected = n === 0
              ? [1, ...Array(h).fill(0)]
              : rationalPaths(initialState, n, h, aQuarter, bQuarter);
            const pruned = completionPmf(args);
            const unpruned = completionPmf({ ...args, prune: false });
            close(pruned, expected);
            close(unpruned, expected);

            // 分母が2の累乗なので厳密。到達不能な状態の除去後も確率と分位点が一致する。
            assert.deepEqual(pruned, unpruned);
            const firstReached = q => {
              let cdf = 0;
              for (let day = 0; day <= h; day++) {
                cdf += unpruned[day];
                if (cdf >= q - 1e-12) {
                  return day;
                }
              }
              return null;
            };
            assert.deepEqual(
              mixtureCompletionQuantiles([{ a: args.a, b: args.b }], initialState, n, h),
              { p50Days: firstReached(.5), p80Days: firstReached(.8) },
            );
          }
        }
      }
    }
  }
});

test('T10 partial horizon retains an available median and null 80% tail', () => {
  assert.deepEqual(mixtureCompletionQuantiles([{ a: 0.6, b: 0.6 }], 'DONE', 1, 1),
    { p50Days: 1, p80Days: null });
});

test('T06 skip first passage is conditional convolution for the same posterior draw', () => {
  for (const [a, b] of [[0.85, 0.15], [0.2, 0.7], [1, 0.3]]) {
    const args = { requiredFutureDone: 4, horizonDays: 30, a, b };
    // 再開した最初のDONEも、必要な将来DONE4回のうち1回として数える。
    const done = completionPmf({ ...args, initialState: 'DONE', requiredFutureDone: 3 });
    const expected = Array(31).fill(0);
    for (let day = 1; day <= 30; day++) {
      for (let gap = 1; gap <= day; gap++) {
        expected[day] += b * (1 - b) ** (gap - 1) * done[day - gap];
      }
    }
    close(completionPmf({ ...args, initialState: 'SKIPPED' }), expected);
  }
});

test('T10 tiny masses, exact threshold equality, tail and zero-day completion', () => {
  const samples = [{ a: 0.9999999995, b: 0.5 }, { a: 1e-10, b: 1e-10 }];
  assert.equal(mixtureCompletionQuantiles(samples, 'DONE', 1, 10).p50Days, 3);
  assert.equal(mixtureCompletionQuantiles([{ a: 1, b: 0.3 }, { a: 0, b: 0 }], 'DONE', 1, 10).p50Days, 1);
  assert.deepEqual(mixtureCompletionQuantiles([{ a: 0.1, b: 0.1 }], 'DONE', 1, 1), { p50Days: null, p80Days: null });
  assert.deepEqual(mixtureCompletionQuantiles(samples, 'DONE', 0, 10), { p50Days: 0, p80Days: 0 });
  assert.deepEqual(mixtureCompletionQuantiles(samples, 'DONE', 11, 10), { p50Days: null, p80Days: null });
  for (const initialState of ['DONE', 'SKIPPED']) {
    for (const [a, b] of [[1e-10, 1e-10], [1 - 5e-10, 0.5], [1, 0], [0, 1]]) {
      const pmf = completionPmf({ initialState, requiredFutureDone: 1, horizonDays: 10, a, b });
      const first = initialState === 'DONE' ? a : b;
      close(pmf, [0, first, ...Array.from({ length: 9 }, (_, i) => (1 - first) * (1 - b) ** i * b)], 1e-15);
    }
  }
  for (const draws of [samples, [{ a: 1, b: 0.3 }, { a: 0, b: 0 }],
    [{ a: 0, b: 1 }, { a: 1, b: 0 }], [{ a: 0.6, b: 0.6 }]]) {
    const closedQuantile = q => {
      for (let day = 1; day <= 10; day++) {
        const cdf = 1 - draws.reduce((sum, s) => sum + (1 - s.a) * (1 - s.b) ** (day - 1), 0) / draws.length;
        if (cdf >= q - 1e-12) {
          return day;
        }
      }
      return null;
    };
    assert.deepEqual(mixtureCompletionQuantiles(draws, 'DONE', 1, 10),
      { p50Days: closedQuantile(.5), p80Days: closedQuantile(.8) });
  }
});
