import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG, completionDistributionForFrozenState, frozenCompletionCdf } from '@futureroi/prediction';
import { applyOffset, fitMilestoneOffset, identityFit, MILESTONE_PROTOCOL, observationLoss, offsetObjective,
  type FitEpisode, type Scope } from '../src/milestone/core.ts';
import { fingerprint } from '../src/milestone/assessment.ts';
const scope: Scope = { ownerId: 'synthetic-owner', goalId: 'synthetic-goal', participationId: 'synthetic-participation', contextKey: 'fixed-context' };
const rows = (cdf: number[], kind: 'EVENT' | 'INTERVAL' | 'CENSOR', lower: number, upper: number): FitEpisode[] =>
  ['01', '04', '07'].map(d => ({ id: `synthetic-${d}`, origin: `2026-10-${d}`, scope, cdf: [...cdf],
    observation: { kind, lower, upper }, labelHash: 'fixed-label' }));
const harmonic = Array.from({ length: 30 }, (_, i) => (i + 1) / (i + 11));

test('#248 survival losses agree with direct probabilities for events, intervals and censoring', () => {
  for (const observation of [{ kind: 'EVENT', lower: 7, upper: 8 }, { kind: 'INTERVAL', lower: 3, upper: 9 }, { kind: 'CENSOR', lower: 12, upper: 12 }] as const) {
    const u = .1, k = Math.exp(u), at = (d: number) => d === 0 ? 0 : k * harmonic[d - 1]! / (1 - harmonic[d - 1]! + k * harmonic[d - 1]!);
    const probability = observation.kind === 'CENSOR' ? 1 - at(observation.upper) : at(observation.upper) - at(observation.lower);
    const score = observationLoss(harmonic, observation, u);
    assert.ok(Math.abs(score.loss + Math.log(probability)) < 1e-12);
    const h = 1e-5;
    const finiteDifference = (observationLoss(harmonic, observation, u + h).loss - observationLoss(harmonic, observation, u - h).loss) / (2 * h);
    assert.ok(Math.abs(score.gradient - finiteDifference) < 1e-8);
  }
});
test('#248 interior fits match an independent 70-digit Decimal probability oracle', () => {
  // Oracle computes -log(phi(b)-phi(a)) / -log(1-phi(p)) directly, not the implementation logDen.
  const event = fitMilestoneOffset(rows(harmonic, 'EVENT', 7, 8), scope);
  assert.equal(event.status, 'FIT');
  assert.ok(Math.abs(event.u - 0.0963648230614086242367000250291982306384) < 1e-12);
  assert.ok(Math.abs(event.objective! - 3.41406742049560974190875327311481056030) < 1e-12);
  const censored = fitMilestoneOffset(rows(Array(30).fill(.1), 'CENSOR', 5, 5), scope);
  assert.ok(Math.abs(censored.u + 0.0920178278324264961539594450641131823596) < 1e-12);
  assert.ok(Math.abs(censored.objective! - 0.1007641750697769335393334473228612797326) < 1e-12);
  for (const fit of [event, censored]) assert.ok(fit.kktResidual! < 1e-12);
});
test('#248 nonzero bounded correction works in both directions and obeys KKT', () => {
  const positive = fitMilestoneOffset(rows(Array(30).fill(.5), 'EVENT', 0, 1), scope);
  const negative = fitMilestoneOffset(rows(Array(30).fill(.5), 'CENSOR', 30, 30), scope);
  assert.equal(positive.u, MILESTONE_PROTOCOL.bound);
  assert.equal(negative.u, -MILESTONE_PROTOCOL.bound);
  assert.ok(positive.gradient! <= 0 && negative.gradient! >= 0);
  assert.equal(positive.kktResidual, 0);
  assert.equal(negative.kktResidual, 0);
  const prediction = applyOffset(Array(30).fill(.5), positive);
  assert.ok(prediction.cdf[0]! > .5);
  assert.equal(prediction.appliedToStandard, false);
  assert.ok(prediction.oddsMultiplier <= 1.25);
  // This is a separate prospective event's log score; no training-score efficacy claim.
  assert.ok(observationLoss(prediction.cdf, { kind: 'EVENT', lower: 0, upper: 1 }, 0).loss < Math.log(2));
});
test('#248 identity, structural endpoints, tail and support failures remain explicit', () => {
  const cdf = Array.from({ length: 30 }, (_, i) => i < 2 ? 0 : i > 25 ? 1 : i / 30);
  assert.deepEqual(applyOffset(cdf, identityFit('INSUFFICIENT_EPISODES')).cdf, cdf);
  const zero = fitMilestoneOffset(rows(Array(30).fill(1), 'EVENT', 0, 1), scope);
  assert.equal(zero.u, 0);
  assert.equal(zero.reason, 'FIT_ZERO');
  for (const material of [rows(Array(30).fill(0), 'EVENT', 0, 1), rows(Array(30).fill(1), 'CENSOR', 1, 1)]) {
    const failed = fitMilestoneOffset(material, scope);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.reason, 'INCOMPATIBLE_STRUCTURAL_SUPPORT');
    assert.equal(failed.u, 0);
  }
  const projected = applyOffset(cdf, { ...zero, u: MILESTONE_PROTOCOL.bound });
  assert.equal(projected.cdf[0], 0);
  assert.equal(projected.cdf[29], 1);
  assert.ok(projected.pmf.every(p => p >= 0));
  assert.ok(Math.abs(projected.pmf.reduce((a, b) => a + b, 0) + projected.tail - 1) < 1e-12);
});
test('#248 owner/Goal/participation/context are separated and duplicate weights are unchanged', () => {
  const material = rows(harmonic, 'EVENT', 7, 8), fit = fitMilestoneOffset(material, scope);
  const repeated = fitMilestoneOffset([...material, material[0]!, material[1]!].reverse(), scope);
  assert.equal(repeated.u, fit.u);
  assert.equal(repeated.objective, fit.objective);
  assert.equal(repeated.duplicates, 2);
  for (const field of ['ownerId', 'goalId', 'participationId', 'contextKey'] as const) {
    assert.throws(() => fitMilestoneOffset([{ ...material[0]!, scope: { ...scope, [field]: 'other' } }, ...material.slice(1)], scope), /SCOPE_MISMATCH/);
  }
  assert.throws(() => fitMilestoneOffset([...material, { ...material[0]!, labelHash: 'changed' }], scope), /CONFLICTING_DUPLICATE/);
  assert.throws(() => fitMilestoneOffset([...material, { ...material[0]!, id: 'other-id' }], scope), /DUPLICATE_ORIGIN/);
  assert.equal(fitMilestoneOffset(material.slice(0, 2), scope).reason, 'INSUFFICIENT_EPISODES');
});
test('#248 selection stays date-based; a bad latest episode is not replaced by older good data', () => {
  const material = rows(harmonic, 'EVENT', 7, 8);
  const old = { ...material[0]!, id: 'old', origin: '2026-09-01', observation: { kind: 'CENSOR' as const, lower: 30, upper: 30 } };
  assert.equal(fitMilestoneOffset([...material, old], scope).u, fitMilestoneOffset(material, scope).u);
  const bad = { ...material[2]!, id: 'latest', origin: '2026-10-10', cdf: Array(30).fill(0) };
  assert.equal(fitMilestoneOffset([...material, bad, old], scope).status, 'FAILED');
});
test('#248 malformed observations/CDF/nonfinite inputs are rejected', () => {
  assert.throws(() => observationLoss(Array(29).fill(.5), { kind: 'CENSOR', lower: 1, upper: 1 }, 0));
  assert.throws(() => observationLoss([.5, .4, ...Array(28).fill(.5)], { kind: 'CENSOR', lower: 1, upper: 1 }, 0));
  assert.throws(() => observationLoss(Array(30).fill(NaN), { kind: 'CENSOR', lower: 1, upper: 1 }, 0));
  assert.throws(() => observationLoss(harmonic, { kind: 'EVENT', lower: 1, upper: 4 }, 0));
  assert.throws(() => offsetObjective(rows(harmonic, 'EVENT', 7, 8), Infinity));
  assert.equal(fingerprint({ b: [1, { z: 2, a: 3 }], a: 4 }), fingerprint({ a: 4, b: [1, { a: 3, z: 2 }] }));
});
test('#248 CDF keeps original calculation method and handles kernel roundoff without endpoint epsilon', () => {
  const posterior = { a: { alpha: 2, beta: 35 }, b: { alpha: 35, beta: 2 } };
  const integrated = completionDistributionForFrozenState(posterior, 'DONE', 1, DEFAULT_CONFIG);
  assert.equal(integrated.computation.method, 'BETA_BINOMIAL');
  assert.equal(integrated.cdfRepresentation, 'bounded-monotone-roundoff-v1');
  assert.ok(integrated.cdf.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= integrated.cdf[i - 1]!)));
  const sampled = completionDistributionForFrozenState(posterior, 'DONE', 1, { ...DEFAULT_CONFIG, completionMethod: 'sampled' });
  assert.equal(sampled.computation.method, 'POSTERIOR_SAMPLING');
  assert.deepEqual(sampled.cdf, frozenCompletionCdf({ posterior, initialState: 'DONE', requiredFutureDone: 1, computation: sampled.computation }));
  assert.deepEqual(frozenCompletionCdf({ posterior, initialState: 'DONE', requiredFutureDone: 31, computation: integrated.computation }), Array(30).fill(0));
});
