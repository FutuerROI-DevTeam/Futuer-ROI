import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFor, splitmix32, uniform, gamma, beta, samplePosterior } from '../dist/src/random.js';

test('T15 adopted integer and Beta vectors fix consumption order', () => {
  assert.deepEqual([0, 1, 2].map(m => seedFor(20261012, m)), [3373737972, 1247035355, 785837188]);
  const ints = splitmix32(seedFor(20261012, 0));
  assert.deepEqual([ints(), ints(), ints()], [1452544342, 2306341868, 1978446536]);
  const next = splitmix32(seedFor(20261012, 0));
  assert.equal(beta(14, 7, next), 0.7650622193905133);
  assert.equal(beta(7, 9, next), 0.25593304542490336);
  const posterior = { a: { alpha: 14, beta: 7 }, b: { alpha: 7, beta: 9 } };
  const draws = samplePosterior(posterior, 3, 20261012);
  assert.deepEqual(draws[0], { a: 0.7650622193905133, b: 0.25593304542490336 });
  assert.deepEqual(draws, samplePosterior(posterior, 3, 20261012));
  assert.deepEqual(draws.slice(0, 2), samplePosterior(posterior, 2, 20261012));
});

test('uniform stays strictly inside endpoints', () => {
  assert.equal(uniform(() => 0), 0.5 / 4294967296);
  assert.equal(uniform(() => 0xffffffff), 1 - 0.5 / 4294967296);
});

function moments(draw, count = 60000) {
  let sum = 0;
  let squares = 0;
  for (let i = 0; i < count; i++) {
    const x = draw();
    assert.ok(Number.isFinite(x) && x >= 0);
    sum += x;
    squares += x * x;
  }

  const mean = sum / count;
  return { mean, variance: squares / count - mean * mean };
}

test('T15 Gamma and Beta moments including supported shape boundary', () => {
  for (const alpha of [1, 2, 30]) {
    const next = splitmix32(seedFor(20261012, alpha));
    const { mean, variance } = moments(() => gamma(alpha, next));
    assert.ok(Math.abs(mean - alpha) < 0.025 * Math.sqrt(alpha));
    assert.ok(Math.abs(variance - alpha) < 0.045 * alpha);
  }
  for (const [alpha, betaShape] of [[1, 1], [2, 2], [14, 7], [2, 100]]) {
    const next = splitmix32(seedFor(20261012, alpha + betaShape));
    const expectedMean = alpha / (alpha + betaShape);
    const expectedVariance = alpha * betaShape / ((alpha + betaShape) ** 2 * (alpha + betaShape + 1));
    const { mean, variance } = moments(() => {
      const x = beta(alpha, betaShape, next);
      assert.ok(x <= 1);
      return x;
    });
    assert.ok(Math.abs(mean - expectedMean) < 0.025 * Math.sqrt(expectedVariance));
    assert.ok(Math.abs(variance - expectedVariance) < 0.045 * expectedVariance);
  }
});
