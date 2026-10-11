import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluationPolicy, loadEvaluationOptions } from '../src/evaluation/policy.ts';

test('evaluation configuration defaults OFF and has finite collection bounds', () => {
  assert.deepEqual(evaluationPolicy(loadEvaluationOptions({})), {
    enabled: false, policyVersion: 'self-evaluation-v1', retentionDays: 90,
    maxSnapshots: 90, observationDays: 30,
  });
  assert.equal(loadEvaluationOptions({ EVALUATION_ENABLED: '0' }).enabled, false);
});
test('enabled evaluation requires a bounded non-secret build identifier', () => {
  for (const buildVersion of ['', 'x'.repeat(81), 'space name', 'https://build', '\n']) {
    assert.throws(() => loadEvaluationOptions({ EVALUATION_ENABLED: '1', EVALUATION_BUILD_VERSION: buildVersion }));
  }
  assert.equal(loadEvaluationOptions({ EVALUATION_ENABLED: '1', VERCEL_GIT_COMMIT_SHA: 'abc123' }).buildVersion, 'abc123');
  assert.equal(loadEvaluationOptions({ EVALUATION_ENABLED: '1', EVALUATION_BUILD_VERSION: 'build-1.2', VERCEL_GIT_COMMIT_SHA: 'abc123' }).buildVersion, 'build-1.2');
  for (const flag of ['true', 'false', '', '2']) assert.throws(() => loadEvaluationOptions({ EVALUATION_ENABLED: flag }));
});
test('evaluation limits reject overflow, fractional/NaN values and an incomplete correction window', () => {
  for (const [key, invalid] of [
    ['EVALUATION_RETENTION_DAYS', ['2', '91', '3.5', 'NaN', 'Infinity']],
    ['EVALUATION_MAX_SNAPSHOTS', ['0', '91', '1.5', 'NaN', 'Infinity']],
    ['EVALUATION_OBSERVATION_DAYS', ['0', '31', '1.5', 'NaN', 'Infinity']],
  ] as const) for (const value of invalid) assert.throws(() => loadEvaluationOptions({ [key]: value }));
  assert.throws(() => loadEvaluationOptions({ EVALUATION_RETENTION_DAYS: '31', EVALUATION_OBSERVATION_DAYS: '30' }));
  assert.deepEqual(evaluationPolicy(loadEvaluationOptions({ EVALUATION_RETENTION_DAYS: '3', EVALUATION_OBSERVATION_DAYS: '1', EVALUATION_MAX_SNAPSHOTS: '1' })), {
    enabled: false, policyVersion: 'self-evaluation-v1', retentionDays: 3, observationDays: 1, maxSnapshots: 1,
  });
});
