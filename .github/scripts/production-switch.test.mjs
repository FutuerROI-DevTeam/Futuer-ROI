import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { BUDGET, attemptPromotion, preflight, recover, requestState, runCommand, verify } from './production-switch.mjs';

const config = { projectId: 'prj_test', candidate: 'dpl_new', previous: 'dpl_old',
  sha: 'a'.repeat(40), started: 10000, baseline: '1' };
const deployment = id => ({ id, target: 'production', readyState: 'READY', meta: { cdSha: config.sha } });
const request = (type = 'promote', jobStatus = 'succeeded', extra = {}) => ({ type,
  toDeploymentId: type === 'promote' ? config.candidate : config.previous,
  requestedAt: type === 'promote' ? 2 : 3, jobStatus, ...extra });

function fixture({ delay = 0, cliFails = false, promotionState = 'succeeded', missing = false,
  rollbackState = 'succeeded', rollbackDelay = 0, currentId = 'dpl_new', apiFails = false } = {}) {
  let time = 10000;
  let rollbackAt;
  const calls = [];
  const io = {
    now: () => time,
    sleep: async ms => { time += ms; },
    log: message => calls.push(['log', message]),
    project: async () => {
      if (apiFails) { time += BUDGET.request; throw new Error('API deadline'); }
      const r = rollbackAt === undefined ? (missing ? undefined : request('promote',
        time - 10000 >= delay ? promotionState : 'in-progress'))
        : request('rollback', time - rollbackAt >= rollbackDelay ? rollbackState : 'pending');
      return { id: config.projectId, lastAliasRequest: r };
    },
    current: async () => deployment(rollbackAt !== undefined && time - rollbackAt >= rollbackDelay
      && rollbackState === 'succeeded' ? 'dpl_old' : currentId),
    command: async (action, id) => {
      calls.push([action, id, time]);
      if (action === 'rollback') rollbackAt = time;
      if (cliFails) throw new Error('CLI connection lost after acceptance');
    },
    smoke: async () => { calls.push(['smoke']); },
  };
  return { io, calls };
}

test('success requires a fresh terminal request, production SHA and smoke', async () => {
  const { io, calls } = fixture({ delay: 9000 });
  assert.equal(await verify(io, config), 'verified');
  assert.equal(io.now(), 19000);
  assert.equal(calls.filter(c => c[0] === 'smoke').length, 1);
  assert.equal(calls.filter(c => c[0] === 'rollback').length, 0);
});

test('CLI connection loss waits over three minutes for delayed promotion before rollback', async () => {
  const { io, calls } = fixture({ delay: 210000, cliFails: true, rollbackDelay: 12000 });
  assert.equal(await recover(io, config), 'rolled-back');
  assert.deepEqual(calls.find(c => c[0] === 'rollback'), ['rollback', 'dpl_old', 220000]);
  assert.equal(calls.filter(c => c[0] === 'smoke').length, 1);
});

test('failed promotion can partially move aliases, so it still rolls back', async () => {
  const { io, calls } = fixture({ promotionState: 'failed', currentId: 'dpl_old' });
  assert.equal(await recover(io, config), 'rolled-back');
  assert.equal(calls.filter(c => c[0] === 'rollback').length, 1);
});

test('pending beyond the budget or absent/unreachable API cannot prove safety or issue premature rollback', async () => {
  for (const options of [{ delay: BUDGET.promotion + 1 }, { missing: true }, { apiFails: true }]) {
    const { io, calls } = fixture(options);
    await assert.rejects(recover(io, config), /proven terminal state/);
    assert.ok(io.now() <= 10000 + BUDGET.promotion + BUDGET.request);
    assert.equal(calls.filter(c => c[0] === 'rollback').length, 0);
  }
});

test('stale or unrelated alias request and unsupported status are not terminal evidence', () => {
  for (const r of [request('promote', 'succeeded', { requestedAt: 1 }),
    request('promote', 'succeeded', { toDeploymentId: 'dpl_other' }),
    request('rollback'), request('promote', 'unknown'), request('promote', 'succeeded', { requestedAt: 'bad' })]) {
    assert.equal(requestState({ lastAliasRequest: r }, { ...config, type: 'promote', target: config.candidate }), 'unknown');
  }
  // Server and runner clocks need not agree; freshness is compared with server baseline.
  assert.equal(requestState({ lastAliasRequest: request() }, { ...config, type: 'promote', target: config.candidate }), 'succeeded');
});

test('acceptance journal precedes a CLI failure; failed preflight makes no attempt', async () => {
  const { io } = fixture({ currentId: 'dpl_old', cliFails: true });
  const events = [];
  const command = io.command;
  io.command = async (...args) => { events.push(['command']); return command(...args); };
  await assert.rejects(attemptPromotion(io, config, values => events.push(['journal', values])), /connection lost/);
  assert.deepEqual(events, [['journal', { attempted: true, started: 10000, baseline: '2' }], ['command']]);
  const blocked = fixture();
  await assert.rejects(attemptPromotion(blocked.io, config, () => assert.fail('must not journal')), /Production changed/);
  assert.equal(blocked.calls.filter(c => c[0] === 'promote').length, 0);
});

// Evaluate the actual workflow step conditions with a synthetic runner status.
// This checks our cancellation boundary, not GitHub runner/environment integration.
function condition(name, { cancelled, success, steps }) {
  const workflow = readFileSync(new URL('../workflows/deploy-production.yml', import.meta.url), 'utf8');
  const block = workflow.split(`- name: ${name}\n`)[1].split('\n      - ')[0];
  const lines = block.split('\n');
  const index = lines.findIndex(line => line.trim().startsWith('if:'));
  let expression = lines[index].trim().slice(4).trim();
  if (expression === '>-') {
    expression = lines.slice(index + 1).filter((line, i, rest) =>
      line.startsWith('          ') && rest.slice(0, i).every(l => l.startsWith('          '))).join(' ');
  }
  expression = expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  return Function('cancelled', 'success', 'always', 'steps', `return (${expression})`)(
    () => cancelled, () => success, () => true, steps);
}

test('cancellation before promote skips the actual workflow condition and makes no remote attempt', () => {
  const steps = { head: { outcome: 'success' }, promote: { outputs: {} }, verify: { outcome: 'skipped' } };
  assert.equal(condition('Promote to production', { cancelled: true, success: true, steps }), false);
  assert.equal(condition('Recover any failed or cancelled switch attempt', { cancelled: true, success: false, steps }), false);
});

test('SIGINT after mock CLI acceptance preserves the journal and selects always recovery', async () => {
  const { io, calls } = fixture({ delay: 9000 });
  let cancelled = false;
  let journal;
  const project = io.project;
  const current = io.current;
  const command = io.command;
  io.project = async () => cancelled ? project() : { id: config.projectId, lastAliasRequest: request('promote', 'succeeded', { requestedAt: 1 }) };
  io.current = async () => cancelled ? current() : deployment('dpl_old');
  io.command = async (action, id) => {
    if (action !== 'promote') return command(action, id);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', 'process.stdout.write("accepted");setInterval(() => {}, 1000)']);
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Mock CLI never accepted')); }, 3000);
      child.stdout.once('data', () => { cancelled = true; child.kill('SIGINT'); });
      child.on('error', reject);
      child.on('close', () => { clearTimeout(timer); reject(new Error('Cancelled after acceptance')); });
    });
  };
  await assert.rejects(attemptPromotion(io, config, output => { journal = output; }), /Cancelled after acceptance/);
  assert.equal(journal.attempted, true);
  const steps = { promote: { outputs: { attempted: 'true' } }, verify: { outcome: 'skipped' } };
  assert.equal(condition('Recover any failed or cancelled switch attempt', { cancelled, success: false, steps }), true);
  assert.equal(await recover(io, { ...config, ...journal }), 'rolled-back');
  assert.deepEqual(calls.find(c => c[0] === 'rollback'), ['rollback', 'dpl_old', 19000]);
});

test('cancellation during verification re-evaluates recovery after that step exits', async () => {
  const { io } = fixture();
  let cancelled = false;
  const steps = { promote: { outputs: { attempted: 'true' } }, verify: { outcome: 'success' } };
  assert.equal(condition('Verify the asynchronous promotion and production', { cancelled, success: true, steps }), true);
  io.smoke = async () => { cancelled = true; throw new Error('Cancelled smoke'); };
  await assert.rejects(verify(io, config), /Cancelled smoke/);
  steps.verify.outcome = 'cancelled';
  assert.equal(condition('Recover any failed or cancelled switch attempt', { cancelled, success: false, steps }), true);
  io.smoke = async () => {};
  assert.equal(await recover(io, config), 'rolled-back');
});

test('an operator deployment is never overwritten by automatic recovery', async () => {
  const { io, calls } = fixture({ currentId: 'dpl_operator' });
  await assert.rejects(recover(io, config), /unrelated deployment/);
  assert.equal(calls.filter(c => c[0] === 'rollback').length, 0);
});

test('rollback failure, pending state, alias mismatch and failed rollback smoke stay unverified', async () => {
  for (const options of [{ rollbackState: 'failed' }, { rollbackDelay: BUDGET.rollback + 1 }]) {
    const { io } = fixture(options);
    await assert.rejects(recover(io, config), /Rollback server state|proven terminal state/);
  }
  const mismatch = fixture();
  mismatch.io.current = async () => deployment('dpl_new');
  await assert.rejects(recover(mismatch.io, config), /alias could not be verified/);
  const failedSmoke = fixture();
  failedSmoke.io.smoke = async () => { throw new Error('smoke deadline'); };
  await assert.rejects(recover(failedSmoke.io, config), /smoke deadline/);
});

test('post-promote bad SHA or stalled smoke fails verification and can be recovered', async () => {
  for (const problem of ['sha', 'smoke']) {
    const { io } = fixture();
    if (problem === 'sha') io.current = async () => ({ ...deployment('dpl_new'), meta: { cdSha: 'b'.repeat(40) } });
    else io.smoke = async () => { throw new Error('smoke deadline'); };
    await assert.rejects(verify(io, config), /SHA mismatch|smoke deadline/);
    // The separate always() recovery step uses fresh status after the failed/cancelled verification.
    assert.equal(await recover(fixture().io, config), 'rolled-back');
  }
});

test('preflight rejects pending promotion, rolling releases and changed production before journaling', async () => {
  const { io } = fixture({ currentId: 'dpl_old' });
  assert.equal(await preflight(io, config), '2');
  for (const project of [{ id: config.projectId, rollingRelease: {} },
    { id: config.projectId, lastAliasRequest: request('promote', 'pending') },
    { id: config.projectId, lastAliasRequest: request('promote', 'queued') },
    { id: config.projectId, lastAliasRequest: request('promote', undefined, { jobStatus: undefined }) },
    { id: config.projectId, lastAliasRequest: request('promote', 'succeeded', { requestedAt: null }) },
    { id: 'prj_other' }]) {
    const candidate = fixture({ currentId: 'dpl_old' });
    candidate.io.project = async () => project;
    await assert.rejects(preflight(candidate.io, config));
  }
  await assert.rejects(preflight(fixture().io, config), /Production changed/);
});

test('a stalled CLI subprocess is terminated within an external deadline', async () => {
  const start = Date.now();
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], 150), /deadline/);
  assert.ok(Date.now() - start < 3000);
});

test('workflow cancellation boundary permits migrate skip, stops new promote and preserves attempted recovery', () => {
  const workflow = readFileSync(new URL('../workflows/deploy-production.yml', import.meta.url), 'utf8');
  const prepare = workflow.split('\n  deploy:')[1].split('\n  switch:')[0];
  const critical = workflow.split('\n  switch:')[1];
  assert.match(prepare, /if: >-\s+!cancelled\(\)/);
  assert.match(critical, /if: >-\s+always\(\)\s+&& needs.deploy.result == 'success'/);
  assert.match(critical, /id: promote\s+if:.*!cancelled\(\).*success\(\)/);
  assert.match(critical, /id: verify\s+if:.*!cancelled\(\).*success\(\)/);
  assert.match(critical, /always\(\) && steps.promote.outputs.attempted == 'true'\s+&& \(cancelled\(\) \|\| steps.verify.outcome != 'success'\)/);
  const deployRuns = (cancelled, schema, migration) => !cancelled && (schema === 'ok' || migration === 'success');
  assert.equal(deployRuns(false, 'ok', 'skipped'), true);
  assert.equal(deployRuns(true, 'ok', 'skipped'), false);
  assert.equal(deployRuns(false, 'pending', 'failure'), false);
  assert.equal(deployRuns(false, 'pending', 'success'), true);
  const jobMinutes = Number(critical.match(/timeout-minutes: (\d+)/)[1]);
  const stepMinutes = [...critical.split('    steps:')[1].matchAll(/timeout-minutes: (\d+)/g)]
    .reduce((sum, match) => sum + Number(match[1]), 0);
  assert.equal(stepMinutes, 29);
  assert.ok(stepMinutes < jobMinutes, 'pre-switch setup must leave the entire recovery step budget');
});
