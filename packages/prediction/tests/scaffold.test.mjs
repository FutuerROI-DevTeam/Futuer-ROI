import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as entry from '../dist/src/index.js';
import { recoveryExamples, unknownGapInput, unknownGapExpected, todayDoneInput,
  todayDoneExpected, dpBoundaryExample } from '../dist/tests/fixtures.js';

test('package: documented defaults and a real pure calculation entry', () => {
  assert.deepEqual(Object.keys(entry).sort(), ['DEFAULT_CONFIG', 'PredictionConfigError', 'PredictionInputError', 'QuestionPriorError', 'baselineCompletionCdf', 'fitDurationModel', 'forecastDurationModel', 'observeDuration', 'predict', 'predictWithQuestionPrior']);
  assert.equal(typeof entry.predict, 'function');
  assert.equal(typeof entry.predictWithQuestionPrior, 'function');
  assert.deepEqual(entry.DEFAULT_CONFIG, {
    modelVersion: 'behavior-persistence-m1-v1', prior: 2, samples: 200,
    horizonDays: 1095, seed: 20261012,
  });
  assert.ok(Object.isFrozen(entry.DEFAULT_CONFIG));
});

function* sourceFiles(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    assert.ok(!entry.isSymbolicLink(), `Source audit cannot follow symlink: ${name}`);
    if (entry.isDirectory()) yield* sourceFiles(new URL(entry.name + '/', directory), name + '/');
    else if (entry.isFile() && name.endsWith('.ts')) yield name;
  }
}

function auditSource(src) {
  for (const name of sourceFiles(src)) {
    const code = readFileSync(new URL(name, src), 'utf8').replace(/\/\/[^\n]*/g, '');
    for (const match of code.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) {
      assert.match(match[1], /^\.\.?\/.+\.js$/, name);
      const target = new URL(match[1], new URL(name, src));
      assert.ok(target.href.startsWith(src.href), `Import escapes src: ${name}`);
      assert.ok(existsSync(new URL(target.href.replace(/\.js$/, '.ts'))), name);
    }
    assert.doesNotMatch(code, /\b(?:Date|fetch|process|window|document|require)\b|Math\.random|import\s*\(/, name);
  }
}

test('scaffold: source imports stay inside the pure package; no ambient platform inputs', () => {
  auditSource(new URL('../src/', import.meta.url));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test('scaffold: nested sources allow local imports and reject platform or escaping dependencies', () => {
  const directory = mkdtempSync(join(tmpdir(), 'prediction-source-audit-'));
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  try {
    const src = join(directory, 'src');
    mkdirSync(join(src, 'nested'), { recursive: true });
    writeFileSync(join(src, 'types.ts'), 'export type Value = number;');
    const nested = join(src, 'nested', 'entry.ts');
    const url = pathToFileURL(src + sep);
    writeFileSync(nested, "import type { Value } from '../types.js';");
    assert.doesNotThrow(() => auditSource(url));
    for (const code of ["import fs from 'node:fs';", 'export const value = Math.random();',
      "import type { Value } from '../../outside.js';"]) {
      writeFileSync(nested, code);
      assert.throws(() => auditSource(url), assert.AssertionError, code);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fixture audit: known recovery quantiles match independent integer factorial ratios', () => {
  // Gamma関数の整数での階乗恒等式を固定参照値の確認だけに使う。本体計算は呼ばない。
  const factorial = n => {
    let result = 1n;
    for (let i = 2; i <= n; i++) result *= BigInt(i);
    return result;
  };
  for (const row of recoveryExamples) {
    for (const [key, multiplier] of [['g50', 2n], ['g80', 5n]]) {
      if (!(key in row)) continue;
      const reached = day => {
        const numerator = factorial(row.beta + day - 1) * factorial(row.alpha + row.beta - 1);
        const denominator = factorial(row.alpha + row.beta + day - 1) * factorial(row.beta - 1);
        return multiplier * numerator <= denominator;
      };
      assert.equal(reached(row[key]), true, row.name);
      assert.equal(reached(row[key] - 1), false, row.name);
    }
  }
});

test('fixture audit: UNKNOWN gap, actual today amount, and shared DP regression remain explicit', () => {
  assert.equal(unknownGapInput.logs.some(log => log.localDate === '2026-10-08'), false);
  assert.deepEqual(unknownGapExpected, { nDD: 1, nDS: 1, nSD: 1, nSS: 1 });
  assert.equal(todayDoneInput.logs.at(-1).amount, 3);
  assert.notEqual(todayDoneInput.logs.at(-1).amount, todayDoneInput.goal.sessionAmount);
  assert.deepEqual(todayDoneExpected, {
    actualDone: 7, projectedDone: 7, requiredFutureDone: 2, futureDoneCount: 0,
    coreMetric: { status: 'not_applicable', reason: 'TODAY_RECORDED' },
  });
  assert.equal(dpBoundaryExample.samples.length, 2);
  assert.equal(dpBoundaryExample.expectedP50Days, 3);
  assert.equal(dpBoundaryExample.quantileEpsilon, 1e-12);
});
