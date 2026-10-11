import assert from 'node:assert/strict';
import test from 'node:test';
import { learningPolicy, loadLearningOptions } from '../src/learning/policy.ts';

test('#227 learning defaults OFF and has bounded distinct policy', () => {
  assert.deepEqual(learningPolicy(), { enabled: false, policyVersion: 'self-learning-v1', retentionDays: 90,
    maxArtifacts: 5, observationDays: 30, capDays: 14 });
  assert.equal(loadLearningOptions({}).enabled, false);
  assert.equal(loadLearningOptions({ LEARNING_ENABLED: '1' }).enabled, true);
});
test('#227 learning rejects malformed enablement and unsafe operational bounds', () => {
  for (const value of ['', 'true', 'yes', '2']) assert.throws(() => loadLearningOptions({ LEARNING_ENABLED: value }));
  for (const options of [{ retentionDays: 91 }, { retentionDays: 1 }, { maxArtifacts: 6 }, { maxArtifacts: 0 },
    { observationDays: 31 }, { observationDays: NaN }, { capDays: 1 }, { capDays: 31 },
    { retentionDays: 3, observationDays: 2 }]) assert.throws(() => learningPolicy({ enabled: true, ...options }));
});
