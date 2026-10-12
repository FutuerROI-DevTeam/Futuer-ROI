import { performance } from 'node:perf_hooks';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { DEFAULT_CONFIG } from '../dist/src/index.js';
import { evaluateGoalPriorCandidate } from '../dist/src/goal-prior-candidate.js';
import { evaluateQuestionPriorAdapterCandidate } from '../dist/src/question-prior-adapter-candidate.js';
import { readFileSync } from 'node:fs';

// D-26の強度・数値写像ではない合成パラメータ。同じ実Engine経路を代表入力で計測する。
const prior = { a: { alpha: 3, beta: 7, source: 'synthetic-benchmark', version: 'fixture-v1' },
  b: { alpha: 5, beta: 11, source: 'synthetic-benchmark', version: 'fixture-v1' } };
const config = { modelVersion: DEFAULT_CONFIG.modelVersion, samples: DEFAULT_CONFIG.samples,
  horizonDays: DEFAULT_CONFIG.horizonDays, seed: DEFAULT_CONFIG.seed };
const runs = [3, 3, 3, 3, 3, 3, 3, 2, 3, 1, 3];
const logs = runs.flatMap((length, run) => Array.from({ length }, () => ({
  status: run % 2 === 0 ? 'DONE' : 'SKIPPED', amount: run % 2 === 0 ? 1 : null,
}))).map((log, index) => ({ ...log, localDate: `2026-10-${String(index + 1).padStart(2, '0')}` }));
const cases = [];
for (const requiredFutureDone of [120, 400, 1095]) {
  const input = { goal: { totalRequired: 19 + requiredFutureDone, initialProgress: 0, sessionAmount: 1 },
    logs, today: '2026-10-31' };
  let result;
  const measuredMs = [];
  for (let iteration = 0; iteration < 6; iteration++) {
    const start = performance.now();
    result = evaluateGoalPriorCandidate(input, prior, config);
    measuredMs.push(performance.now() - start);
  }
  cases.push({ requiredFutureDone, input, priorSnapshot: result.priorSnapshot,
    observations: result.observations, posterior: result.posterior, completion: result.completion,
    measuredMs, maxMs: Math.max(...measuredMs), pass: measuredMs.every(value => value < 500) });
}
// 実遷移がないため旧入口は不足になる経路を、質問材料だけで実際にDPへ通して測る。
// 追加ケースは情報用。候補の任意強度への性能保証や新しいT-14ゲートにしない。
const mapping = JSON.parse(readFileSync(new URL('../tests/fixtures-pr118.json', import.meta.url), 'utf8')).mappingCandidate;
const adapterCases = [];
for (const requiredFutureDone of [120, 400, 1095]) {
  const input = { prediction: { goal: { totalRequired: 1 + requiredFutureDone, initialProgress: 0, sessionAmount: 1 },
    logs: [], today: '2026-10-31' }, answers: { a: 'HIGH', b: 'LOW' }, mapping };
  let result;
  const measuredMs = [];
  for (let iteration = 0; iteration < 6; iteration++) {
    const start = performance.now();
    result = evaluateQuestionPriorAdapterCandidate(input, config);
    measuredMs.push(performance.now() - start);
  }
  adapterCases.push({ requiredFutureDone, input, config, evidenceSource: result.evidenceSource,
    observations: result.observations, posterior: result.posterior, completion: result.completion,
    conditionalPlan: result.conditionalPlan, measuredMs, maxMs: Math.max(...measuredMs), requiredByT14: false });
}
console.log(JSON.stringify({ criterion: 'Existing T-14 comparison for cases only: each real calculation <500ms; K=200/H=1095. adapterCases are informational.',
  limitation: 'Internal candidate and synthetic prior on this machine; no D-26 adoption, production or worst-case guarantee.',
  environment: { node: process.version, platform: platform(), release: release(), arch: arch(),
    cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, memoryGiB: totalmem() / 2 ** 30 },
  config, cases, adapterCases }, null, 2));
if (cases.some(row => !row.pass)) process.exitCode = 1;
