import test from 'node:test';
import assert from 'node:assert/strict';
import {
  durationBetaQuadrature, durationConditionalCdf, fitDurationModel, forecastDurationModel,
} from '../dist/src/duration-model.js';

const prior = { a: { alpha: 1, beta: 1 }, b: { alpha: 1, beta: 1 } };
const atoms = [-Math.log(2), 0, Math.log(2)].map(gamma => ({ gamma, mass: 1 / 3 }));
const transition = (i, from, to, restDays = null) => ({ from, to, restDays,
  originDate: `origin-${i}`, outcomeDate: `outcome-${i}` });
const oracleFit = () => fitDurationModel([
  transition(0, 'DONE', 'DONE'), transition(1, 'SKIPPED', 'DONE', 2),
], prior, { capDays: 2, gammaPrior: atoms });
function close(actual, expected, tolerance = 1e-11) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
}
function moments(artifact) {
  const joint = artifact.joint;
  const meanP = joint.reduce((s, x) => s + x.weight * x.pDoneAfterSkip, 0);
  const meanG = joint.reduce((s, x) => s + x.weight * x.gamma, 0);
  return { meanP, meanG, covariance: joint.reduce((s, x) => s + x.weight *
    (x.pDoneAfterSkip - meanP) * (x.gamma - meanG), 0) };
}
function betaRatio(a, b, successes, failures) {
  let result = 1;
  for (let i = 0; i < successes; i++) result *= (a + i) / (a + b + i);
  for (let i = 0; i < failures; i++) result *= (b + i) / (a + b + successes + i);
  return result;
}

// Independent full-state absorbing DP: no pruning, fast boundary formulas or
// production conditional helper. Both buffers are cleared in full every day.
function denseConditional(hazards, initialAge, n, h) {
  const stride = hazards.length, cap = stride - 1, cdf = Array(h + 1).fill(0);
  let current = new Float64Array(n * stride), next = new Float64Array(n * stride);
  current[initialAge] = 1;
  for (let day = 1; day <= h; day++) {
    next.fill(0); let reached = 0;
    for (let count = 0; count < n; count++) for (let age = 0; age <= cap; age++) {
      const mass = current[count * stride + age], done = mass * hazards[age];
      if (count + 1 === n) reached += done; else next[(count + 1) * stride] += done;
      next[count * stride + Math.min(age + 1, cap)] += mass * (1 - hazards[age]);
    }
    cdf[day] = cdf[day - 1] + reached; [current, next] = [next, current];
  }
  return cdf;
}

test('Reachable-cell DP agrees with independent dense DP for every N<=H<=30 and boundary hazards', () => {
  for (const cap of [2, 14, 30]) for (let h = 1; h <= 30; h++) for (let n = 1; n <= h; n++) {
    for (const [p1, p0, gamma] of [[.25, .005, 3.5], [.55, .4, -3], [0, .3, 4], [1, .8, -4], [0, 0, 0], [1, 1, 0]]) {
      const hazards = Array.from({ length: cap + 1 }, (_, r) => r === 0 ? p1 : p0 === 0 ? 0 : p0 === 1 ? 1 :
        1 / (1 + Math.exp(-(Math.log(p0 / (1 - p0)) + gamma * Math.log(r) / Math.log(cap)))));
      for (const initialAge of [0, 1, 7, cap]) {
        const expected = denseConditional(hazards, Math.min(initialAge, cap), n, h);
        const actual = durationConditionalCdf({ pDoneAfterDone: p1, pDoneAfterSkip: p0, gamma, capDays: cap,
          initialState: initialAge === 0 ? 'DONE' : 'SKIPPED', initialRestDays: initialAge,
          requiredFutureDone: n, horizonDays: h });
        actual.forEach((p, i) => close(p, expected[i], 1e-12));
      }
    }
  }
});

test('Reused posterior DP buffers retain full dense CDFs for formerly dense-clear-limited N16 and N29', () => {
  for (const cap of [14, 30]) {
    const fit = fitDurationModel([transition(0, 'DONE', 'DONE'), transition(1, 'SKIPPED', 'DONE', 2)],
      prior, { capDays: cap, gammaPrior: atoms });
    assert.equal(fit.status, 'available'); const artifact = fit.artifact;
    for (const n of [16, 29]) for (const state of ['SKIPPED', 'DONE']) {
      const output = forecastDurationModel(artifact, { initialState: state, initialRestDays: 7,
        remainingAmount: n, sessionAmount: 1, horizonDays: 30, samples: 8192, seed: 20261011 });
      assert.equal(output.status, 'available');
      const p1 = durationBetaQuadrature(artifact.donePosterior.alpha, artifact.donePosterior.beta,
        Math.ceil((Math.min(30, n - (state === 'SKIPPED' ? 1 : 0)) + 1) / 2));
      const expected = Array(31).fill(0);
      for (const node of artifact.joint) {
        const hazards = Array.from({ length: cap + 1 }, (_, r) => r === 0 ? 0 :
          1 / (1 + Math.exp(-(Math.log(node.pDoneAfterSkip / (1 - node.pDoneAfterSkip)) + node.gamma * Math.log(r) / Math.log(cap)))));
        for (let j = 0; j < p1.nodes.length; j++) {
          hazards[0] = p1.nodes[j];
          const cdf = denseConditional(hazards, state === 'DONE' ? 0 : 7, n, 30);
          cdf.forEach((p, day) => { expected[day] += p * node.weight * p1.weights[j]; });
        }
      }
      output.cdf.forEach((p, day) => close(p, expected[day], 1e-11));
    }
  }
});

// Independent exhaustive paths: no DP, quadrature or production probability helper.
function enumerate({ p1, p0, gamma, cap, initialState, age, n, h, a, b }) {
  if (n === 0) return Array(h + 1).fill(1);
  const hits = Array(h + 1).fill(0);
  for (let bits = 0; bits < 2 ** h; bits++) {
    let state = initialState, run = initialState === 'DONE' ? 0 : age, count = 0, first = null;
    let weight = 1, dd = 0, ds = 0, sd = 0, ss = 0;
    for (let day = 1; day <= h; day++) {
      const done = (bits & (1 << (day - 1))) !== 0;
      if (a) {
        if (state === 'DONE') { if (done) dd++; else ds++; }
        else { if (done) sd++; else ss++; }
      } else {
        if (state === 'DONE' && b) { if (done) dd++; else ds++; }
        else {
          const odds = Math.exp(gamma * Math.log(Math.min(run, cap)) / Math.log(cap));
          const q = state === 'DONE' ? p1 : p0 * odds / (1 - p0 + p0 * odds);
          weight *= done ? q : 1 - q;
        }
      }
      state = done ? 'DONE' : 'SKIPPED'; run = done ? 0 : run + 1;
      if (done && ++count === n && first === null) first = day;
    }
    if (a) weight = betaRatio(a.alpha, a.beta, dd, ds) * betaRatio(b.alpha, b.beta, sd, ss);
    else if (b) weight *= betaRatio(b.alpha, b.beta, dd, ds);
    if (first !== null) hits[first] += weight;
  }
  let total = 0; return hits.map(value => total += value);
}

test('Beta Jacobi quadrature matches Uniform n=2 and analytic moments, including s=1 and tails', () => {
  const uniform = durationBetaQuadrature(1, 1, 2);
  close(uniform.nodes[0], (1 - 1 / Math.sqrt(3)) / 2, 1e-15);
  close(uniform.nodes[1], (1 + 1 / Math.sqrt(3)) / 2, 1e-15);
  uniform.weights.forEach(w => close(w, .5, 1e-15));
  for (const [a, b] of [[.1, .1], [.5, .5], [1, 1], [.1, 4], [2, 5], [400, 600], [10000, .5]]) {
    for (const order of [2, 16, 32, 64]) {
      const rule = durationBetaQuadrature(a, b, order); let expected = 1;
      for (let degree = 0; degree < 2 * order; degree++) {
        if (degree) expected *= (a + degree - 1) / (a + b + degree - 1);
        close(rule.nodes.reduce((s, p, i) => s + rule.weights[i] * p ** degree, 0), expected, 5e-11);
      }
      close(rule.weights.reduce((s, w) => s + w, 0), 1, 1e-14);
    }
  }
});

test('Joint normalization agrees with independent analytic Uniform success oracle and retains covariance', () => {
  const result = oracleFit(); assert.equal(result.status, 'available');
  const artifact = result.artifact; assert.equal(artifact.kind, 'DURATION_JOINT_V1');
  assert.equal(artifact.integration.order, 64); assert.equal(artifact.integration.converged, true);
  close(artifact.integration.logEvidence, Math.log(.5));
  const evidence = [.3862943611198906, .5, .6137056388801094];
  const masses = [.25752957407992705, 1 / 3, .40913709258673964];
  const means = [.705650275218955, 2 / 3, .6294456766354646];
  atoms.forEach((atom, i) => {
    const nodes = artifact.joint.filter(x => x.gamma === atom.gamma);
    const mass = nodes.reduce((s, x) => s + x.weight, 0);
    close(mass, masses[i]); close(mass * 1.5, evidence[i]);
    close(nodes.reduce((s, x) => s + x.weight * x.pDoneAfterSkip, 0) / mass, means[i]);
  });
  const m = moments(artifact);
  close(m.meanP, .66147761112867); close(m.meanG, .10508632400468687);
  close(m.covariance, -.016969088562570248);
});

test('Transitions update exactly once, unknown rest length is excluded, and gamma=0 is strict Beta', () => {
  const input = [transition(0, 'DONE', 'DONE'), transition(1, 'DONE', 'SKIPPED'),
    transition(2, 'SKIPPED', 'DONE', 1), transition(3, 'SKIPPED', 'SKIPPED', 2),
    transition(4, 'SKIPPED', 'DONE', null)];
  const frozen = structuredClone(input);
  const result = fitDurationModel(input, prior, { capDays: 30, gammaPrior: [{ gamma: 0, mass: 1 }] });
  assert.equal(result.status, 'available'); assert.equal(result.artifact.kind, 'BETA_BASELINE_V1');
  assert.deepEqual(result.artifact.posterior, { a: { alpha: 2, beta: 2 }, b: { alpha: 2, beta: 2 } });
  assert.deepEqual(result.artifact.training, { doneOrigins: 2, skipOrigins: 2, excludedUnknownDuration: 1 });
  assert.deepEqual(input, frozen);
  assert.throws(() => fitDurationModel([...input, input[0]], prior, { capDays: 2, gammaPrior: atoms }), /Duplicate/);
  assert.equal(fitDurationModel([], prior, { capDays: 2, gammaPrior: atoms }).reason, 'NO_DONE_ORIGIN_TRANSITION');
  assert.equal(fitDurationModel([input[0], input[4]], prior, { capDays: 2, gammaPrior: atoms }).reason, 'NO_SKIP_ORIGIN_TRANSITION');
  const tight = fitDurationModel([input[0], transition(5, 'SKIPPED', 'DONE', 2)], prior,
    { capDays: 2, gammaPrior: atoms, tolerance: Number.MIN_VALUE });
  assert.equal(tight.status, 'insufficient'); assert.equal(tight.reason, 'NUMERICAL_INSUFFICIENCY');
  assert.ok(!('artifact' in tight));
});

test('Long-history gamma proposals with density correction agree with independent Simpson likelihood integration', () => {
  const transitions = [transition(0, 'DONE', 'DONE'), ...Array.from({ length: 80 }, (_, i) =>
    transition(i + 1, 'SKIPPED', i < 30 ? 'DONE' : 'SKIPPED', 2))];
  const result = fitDurationModel(transitions, prior, { capDays: 2, gammaPrior: atoms });
  assert.equal(result.status, 'available'); const artifact = result.artifact;
  const integrals = atoms.map(atom => {
    const steps = 10000; let evidence = 0, firstMoment = 0;
    for (let i = 1; i < steps; i++) {
      const p = i / steps, odds = Math.exp(atom.gamma), q = p * odds / (1 - p + p * odds);
      const likelihood = q ** 30 * (1 - q) ** 50, w = i % 2 ? 4 : 2;
      evidence += w * likelihood; firstMoment += w * likelihood * p;
    }
    return { evidence: evidence / (3 * steps), mean: firstMoment / evidence };
  });
  const total = integrals.reduce((s, x) => s + x.evidence / 3, 0);
  close(artifact.integration.logEvidence, Math.log(total), 1e-9);
  atoms.forEach((atom, i) => {
    const nodes = artifact.joint.filter(x => x.gamma === atom.gamma);
    const mass = nodes.reduce((s, x) => s + x.weight, 0);
    close(mass, integrals[i].evidence / (3 * total), 1e-9);
    close(nodes.reduce((s, x) => s + x.weight * x.pDoneAfterSkip, 0) / mass, integrals[i].mean, 1e-9);
  });
});

test('Conditional capped-duration DP matches exhaustive paths through H=10, preserving tail and origin age', () => {
  for (const initialState of ['DONE', 'SKIPPED']) for (const age of [1, 2, 100]) {
    for (const gamma of [-Math.log(2), 0, Math.log(2)]) for (const n of [0, 1, 3, 11]) {
      const args = { p1: .7, p0: .25, gamma, cap: 2, initialState, age, n, h: 10 };
      const expected = enumerate(args);
      const actual = durationConditionalCdf({ pDoneAfterDone: args.p1, pDoneAfterSkip: args.p0,
        gamma, capDays: 2, initialState, initialRestDays: age, requiredFutureDone: n, horizonDays: 10 });
      actual.forEach((value, i) => close(value, expected[i]));
    }
  }
});

test('Gamma-zero forecast agrees with independent Beta-ratio whole-path integration and exact tail boundaries', () => {
  const fit = fitDurationModel([transition(0, 'DONE', 'DONE'), transition(1, 'SKIPPED', 'DONE', 2)], prior,
    { capDays: 2, gammaPrior: [{ gamma: 0, mass: 1 }] });
  assert.equal(fit.status, 'available');
  for (const initialState of ['DONE', 'SKIPPED']) for (const n of [0, 1, 3, 10, 11]) {
    const output = forecastDurationModel(fit.artifact, { initialState, initialRestDays: null,
      remainingAmount: n, sessionAmount: 1, horizonDays: 10, samples: 500, seed: 42 });
    assert.equal(output.status, 'available'); assert.equal(output.computation.method, 'EXACT_BETA');
    const expected = enumerate({ a: fit.artifact.posterior.a, b: fit.artifact.posterior.b, initialState, n, h: 10 });
    output.cdf.forEach((value, i) => close(value, expected[i]));
  }
});

test('Accepted quadrature retains joint dependence and agrees with independent whole-path integration', () => {
  const fit = oracleFit(); assert.equal(fit.status, 'available'); const artifact = fit.artifact;
  const input = { initialState: 'SKIPPED', initialRestDays: 2, remainingAmount: 2,
    sessionAmount: 1, horizonDays: 8, samples: 12800, seed: 20261011 };
  const output = forecastDurationModel(artifact, input); assert.equal(output.status, 'available');
  assert.deepEqual(output, forecastDurationModel(artifact, input));
  const expected = Array(9).fill(0);
  for (const node of artifact.joint) {
    const cdf = enumerate({ p0: node.pDoneAfterSkip, gamma: node.gamma, cap: 2,
      initialState: input.initialState, age: 2, n: 2, h: 8, b: artifact.donePosterior });
    cdf.forEach((p, i) => { expected[i] += node.weight * p; });
  }
  output.cdf.forEach((value, i) => close(value, expected[i], 1e-11));
  assert.deepEqual(output.computation, { method: 'POSTERIOR_QUADRATURE', samples: null, seed: null });
  assert.deepEqual(output, forecastDurationModel(artifact, { ...input, samples: 1, seed: 0 }));
  assert.deepEqual(output, forecastDurationModel(artifact, { ...input, samples: 65536, seed: 0xffffffff }));
  const largerDose = forecastDurationModel(artifact, { ...input, sessionAmount: 2 });
  assert.equal(largerDose.status, 'available');
  output.cdf.forEach((value, i) => assert.ok(value <= largerDose.cdf[i]));
  const short = forecastDurationModel(artifact, { ...input, horizonDays: 5 });
  assert.deepEqual(short.cdf, output.cdf.slice(0, 6));
  const unknown = forecastDurationModel(artifact, { ...input, initialRestDays: null });
  assert.deepEqual(unknown, { status: 'insufficient', reason: 'UNKNOWN_CURRENT_DURATION' });
  const impossible = forecastDurationModel(artifact, { ...input, remainingAmount: 10 });
  assert.ok(impossible.cdf.every(p => p === 0)); assert.equal(impossible.p80Days, null);
});

test('Legacy sample input remains valid; finite quadrature rejects unsupported horizon and input limits', () => {
  const fit = oracleFit(); assert.equal(fit.status, 'available');
  const input = { initialState: 'SKIPPED', initialRestDays: 2, remainingAmount: 2,
    sessionAmount: 1, horizonDays: 8, samples: 65536, seed: 20261011 };
  const output = forecastDurationModel(fit.artifact, input);
  assert.equal(output.status, 'available'); assert.equal(output.computation.method, 'POSTERIOR_QUADRATURE');
  assert.equal(output.computation.samples, null); assert.equal(output.computation.seed, null);
  assert.ok(output.cdf.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= output.cdf[i - 1])));
  assert.deepEqual(forecastDurationModel(fit.artifact, { ...input, horizonDays: 10000 }),
    { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' });
  assert.throws(() => forecastDurationModel(fit.artifact, { ...input, samples: 65537 }), RangeError);
});

test('Final refinement may converge after a coarse first rule; the historical difference remains diagnostic', () => {
  const gammaPrior = [-Math.log(4), 0, Math.log(4)].map(gamma => ({ gamma, mass: 1 / 3 }));
  const rows = [transition(0, 'DONE', 'DONE'), ...Array.from({ length: 8 }, (_, i) =>
    transition(i + 1, 'SKIPPED', i < 4 ? 'DONE' : 'SKIPPED', 2))];
  const result = fitDurationModel(rows, prior, { capDays: 2, gammaPrior });
  assert.equal(result.status, 'available');
  assert.ok(result.artifact.integration.maxDifference < 1e-7);
  assert.ok(result.artifact.integration.maxObservedDifference > 1e-7);
  assert.deepEqual(result.artifact.integration.checks.map(rule => rule.order), [16, 32]);
});

test('Long-horizon endpoint bias and old artifacts fall back, preserving checked JSON replay', () => {
  const rows = [transition(0, 'DONE', 'DONE'), transition(1, 'SKIPPED', 'SKIPPED', 1)];
  const fit = fitDurationModel(rows, { a: prior.a, b: { alpha: .1, beta: .1 } }, { capDays: 2, gammaPrior: atoms });
  assert.equal(fit.status, 'available'); const artifact = fit.artifact;
  const H = 10000;
  const discrete = artifact.joint.reduce((s, node) => {
    const odds = Math.exp(node.gamma), p = node.pDoneAfterSkip, q = p * odds / (1 - p + p * odds);
    return s + node.weight * -Math.expm1(H * Math.log1p(-q));
  }, 0);
  // Independent normalized Simpson integral after p=u^10 removes p^(-.9).
  const steps = 100000; let numerator = 0, denominator = 0;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, p = u ** 10, density = (1 - p) ** .1;
    const reached = atoms.reduce((s, atom) => {
      const odds = Math.exp(atom.gamma), q = p * odds / (1 - p + p * odds);
      return s + atom.mass * -Math.expm1(H * Math.log1p(-q));
    }, 0);
    const weight = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2;
    numerator += weight * density * reached; denominator += weight * density;
  }
  const continuous = numerator / denominator;
  close(discrete, .6518722537116225, 1e-11); close(continuous, .61516620, 2e-6);
  assert.ok(discrete - continuous > .036);
  const input = { initialState: 'SKIPPED', initialRestDays: 2, remainingAmount: 1,
    sessionAmount: 1, horizonDays: H, samples: 10000, seed: 20261011 };
  assert.deepEqual(forecastDurationModel(artifact, input), { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' });
  const safe = oracleFit().artifact, short = { ...input, horizonDays: 30, samples: 8192 };
  const result = forecastDurationModel(safe, short); assert.equal(result.status, 'available');
  assert.deepEqual(forecastDurationModel(JSON.parse(JSON.stringify(safe)), short), result);
  const old = structuredClone(safe); delete old.integration.checks; delete old.integration.tolerance;
  assert.deepEqual(forecastDurationModel(old, short), { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' });
});

test('First-passage p1 degree bound integrates H=4..8 against independent whole-path Beta ratios', () => {
  const beta = { alpha: .5, beta: 2 }, p0 = .3, gamma = .6, cap = 3;
  for (let h = 4; h <= 8; h++) for (const initialState of ['DONE', 'SKIPPED']) for (const n of [1, 2, 3, 4]) {
    const degree = Math.min(h, n - Number(initialState === 'SKIPPED'));
    const rule = durationBetaQuadrature(beta.alpha, beta.beta, Math.ceil((degree + 1) / 2));
    const actual = Array(h + 1).fill(0);
    rule.nodes.forEach((p1, i) => {
      const cdf = durationConditionalCdf({ pDoneAfterDone: p1, pDoneAfterSkip: p0, gamma,
        capDays: cap, initialState, initialRestDays: 2, requiredFutureDone: n, horizonDays: h });
      cdf.forEach((value, day) => { actual[day] += rule.weights[i] * value; });
    });
    const expected = enumerate({ p0, gamma, cap, initialState, age: 2, n, h, b: beta });
    actual.forEach((value, i) => close(value, expected[i], 2e-12));
  }
});

test('Many-spell continuous Beta-binomial oracle exposes long-H completion refinement bias', () => {
  const fit = fitDurationModel([transition(0, 'DONE', 'SKIPPED'), transition(1, 'SKIPPED', 'DONE', 1),
    transition(2, 'DONE', 'SKIPPED'), transition(3, 'SKIPPED', 'SKIPPED', 1)],
  { a: { alpha: 1, beta: 999999997 }, b: { alpha: 4, beta: 4 } },
  { capDays: 2, gammaPrior: [-1e-12, 0, 1e-12].map(gamma => ({ gamma, mass: 1 / 3 })) });
  assert.equal(fit.status, 'available');
  const L = 6801, N = 3200;
  // Independent continuous Beta-binomial recurrence, with exact integer shapes.
  let mass = 1; for (let j = 0; j < 5; j++) mass *= (5 + j) / (L + 5 + j);
  let total = mass, tail = 0;
  for (let k = 1; k <= L; k++) {
    mass *= (L - k + 1) / k * (k + 4) / (L - k + 5);
    total += mass; if (k >= N) tail += mass;
  }
  close(total, 1, 1e-11); close(tail, .5723412928, 1e-10);
  // Independent fixed-p binomial weights scaled at their mode avoid endpoint underflow.
  const binomialTail = p => {
    const mode = Math.floor((L + 1) * p); let sum = 1, reached = mode >= N ? 1 : 0, weight = 1;
    for (let k = mode + 1; k <= L; k++) {
      weight *= (L - k + 1) / k * p / (1 - p); sum += weight; if (k >= N) reached += weight;
    }
    weight = 1;
    for (let k = mode - 1; k >= 0; k--) {
      weight *= (k + 1) / (L - k) * (1 - p) / p; sum += weight; if (k >= N) reached += weight;
    }
    return reached / sum;
  };
  const values = [32, 64].map(order => {
    const rule = durationBetaQuadrature(5, 5, order);
    return rule.nodes.reduce((s, p, i) => s + rule.weights[i] * binomialTail(p), 0);
  });
  close(values[0], .5955421968, 1e-10); close(values[1], .5679429142, 1e-10);
  assert.ok(Math.abs(values[1] - values[0]) > .027);
  const input = { initialState: 'SKIPPED', initialRestDays: 2, remainingAmount: N,
    sessionAmount: 1, horizonDays: 10000, samples: 10000, seed: 20261011 };
  assert.deepEqual(forecastDurationModel(fit.artifact, input), { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' });
});

test('Completion checks bound H/work while keeping completed, unknown-age, impossible and exact-baseline boundaries', () => {
  const artifact = oracleFit().artifact;
  const input = { initialState: 'SKIPPED', initialRestDays: 2, remainingAmount: 3,
    sessionAmount: 1, horizonDays: 31, samples: 8192, seed: 20261011 };
  assert.deepEqual(forecastDurationModel(artifact, input), { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' });
  assert.deepEqual(forecastDurationModel(artifact, { ...input, initialRestDays: null }),
    { status: 'insufficient', reason: 'UNKNOWN_CURRENT_DURATION' });
  const completed = forecastDurationModel(artifact, { ...input, remainingAmount: 0, initialRestDays: null });
  assert.equal(completed.status, 'available'); assert.equal(completed.p50Days, 0);
  const impossible = forecastDurationModel(artifact, { ...input, remainingAmount: 32 });
  assert.equal(impossible.status, 'available'); assert.ok(impossible.cdf.every(p => p === 0));
  const baseline = fitDurationModel([transition(0, 'DONE', 'DONE'), transition(1, 'SKIPPED', 'DONE', 2)], prior,
    { capDays: 2, gammaPrior: [{ gamma: 0, mass: 1 }] }).artifact;
  assert.equal(forecastDurationModel(baseline, input).status, 'available');
  const broad = fitDurationModel([transition(0, 'DONE', 'DONE'), transition(1, 'SKIPPED', 'DONE', 2)], prior,
    { capDays: 30, gammaPrior: Array.from({ length: 65 }, (_, i) => ({ gamma: (i - 32) * 1e-10, mass: 1 })) });
  assert.equal(broad.status, 'available');
  assert.deepEqual(forecastDurationModel(broad.artifact, { ...input, initialState: 'DONE', remainingAmount: 16, horizonDays: 30 }),
    { status: 'insufficient', reason: 'NUMERICAL_INSUFFICIENCY' });
});
