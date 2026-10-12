import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_JOBS, checkDeployment, classifySchema, decideGate, evaluateCurrentMain, parseSchemaReport, switchBlocks } from './deploy-gate.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
let nextId = 1;
const run = (name, overrides = {}) => ({ id: nextId++, run_attempt: 1, name, head_sha: A, head_branch: 'main', event: 'push',
  status: 'completed', conclusion: 'success', ...overrides });
const jobsFor = (name, conclusion = 'success') => REQUIRED_JOBS[name].map(job => ({ name: job, conclusion }));
const green = () => {
  const app = run('Application');
  const foundation = run('Foundation');
  return { runs: [app, foundation], jobsByRunId: { [app.id]: jobsFor('Application'), [foundation.id]: jobsFor('Foundation') } };
};
const input = overrides => ({ enabled: true, targetSha: A, mainSha: A, ...green(), ...overrides });

test('同じSHAの必須CIがすべて成功し、mainの先頭のときだけ配備する', () => {
  assert.deepEqual(decideGate(input()), { deploy: true, reason: 'ci-passed' });
});

test('CD無効・mainの先頭でない・不正SHAでは配備しない', () => {
  assert.equal(decideGate(input({ enabled: false })).reason, 'cd-disabled');
  assert.equal(decideGate(input({ mainSha: B })).reason, 'not-main-head');
  assert.equal(decideGate(input({ targetSha: 'main' })).reason, 'invalid-sha');
});

test('片方のCIが未完了・未実行なら待つ', () => {
  const { runs, jobsByRunId } = green();
  assert.equal(decideGate(input({ runs: [runs[0]], jobsByRunId })).reason, 'waiting:Foundation');
  runs[1].status = 'in_progress';
  assert.equal(decideGate(input({ runs, jobsByRunId })).reason, 'waiting:Foundation');
});

test('CIの失敗・job欠落・jobのskipでは配備しない', () => {
  const failed = green();
  failed.runs[0].conclusion = 'failure';
  assert.equal(decideGate(input(failed)).reason, 'ci-failed:Application');
  const missing = green();
  missing.jobsByRunId[missing.runs[0].id] = jobsFor('Application').slice(1);
  assert.match(decideGate(input(missing)).reason, /^job-missing:/);
  const skipped = green();
  skipped.jobsByRunId[skipped.runs[1].id] = jobsFor('Foundation', 'skipped');
  assert.equal(decideGate(input(skipped)).reason, 'job-not-success:Repository checks');
});

test('別SHA・PR・別branchのrunは数えず、同じSHAの最新runの結果を使う', () => {
  const { runs, jobsByRunId } = green();
  const others = [run('Foundation', { head_sha: B }), run('Foundation', { event: 'pull_request' }), run('Foundation', { head_branch: 'x' })];
  assert.equal(decideGate(input({ runs: [runs[0], ...others], jobsByRunId })).reason, 'waiting:Foundation');
  const rerunFailed = run('Application', { conclusion: 'failure' });
  assert.equal(decideGate(input({ runs: [...runs, rerunFailed], jobsByRunId })).reason, 'ci-failed:Application');
});

const report = (status, app, findings) => ({ version: 1, status, findings,
  app: { historyTable: 'present', applied: [], pending: [], checksumMismatch: [], unknownHistory: [], ...app } });

test('schemaは差分なしならok、追加migrationだけ未適用ならpending', () => {
  assert.equal(classifySchema(report('ok', {}, []), 0), 'ok');
  assert.equal(classifySchema(report('drift', { pending: ['0009_x.sql'] }, [{ code: 'pending_migration', target: '0009_x.sql' }]), 1), 'pending');
});

test('空DB・checksum不一致・不明履歴・認証差分・判定不能はstop', () => {
  const pending = [{ code: 'pending_migration', target: '0009_x.sql' }];
  assert.equal(classifySchema(report('drift', { historyTable: 'missing', pending: ['0001.sql'] }, [{ code: 'empty_database' }]), 1), 'stop');
  assert.equal(classifySchema(report('drift', { pending: ['0009_x.sql'], checksumMismatch: ['0001.sql'] }, pending), 1), 'stop');
  assert.equal(classifySchema(report('drift', { pending: ['0009_x.sql'], unknownHistory: ['9999.sql'] }, pending), 1), 'stop');
  assert.equal(classifySchema(report('drift', { pending: ['0009_x.sql'] }, [...pending, { code: 'auth_table_missing', target: 'user' }]), 1), 'stop');
  assert.equal(classifySchema(null, 3), 'stop');
  assert.equal(classifySchema(report('ok', {}, []), 1), 'stop');
});

test('db:checkの出力から結果JSONだけを取り出す', () => {
  const json = JSON.stringify(report('ok', {}, []));
  assert.deepEqual(parseSchemaReport(`> npm banner\n(node) Warning: x\n${json}\nnpm error x`), JSON.parse(json));
  assert.equal(parseSchemaReport('no json'), null);
});

test('deploymentは対象SHA・production・READYのときだけok', () => {
  const ok = { readyState: 'READY', target: 'production', meta: { cdSha: A } };
  assert.equal(checkDeployment(ok, A), 'ok');
  assert.equal(checkDeployment({ ...ok, meta: { cdSha: B } }, A), 'sha-mismatch');
  assert.equal(checkDeployment({ ...ok, target: null }, A), 'not-production:null');
  assert.equal(checkDeployment({ ...ok, readyState: 'ERROR' }, A), 'not-ready:ERROR');
  assert.equal(checkDeployment(null, A), 'missing');
});

test('古いAが待機Bを置換しても、ロック後のgateは最新main BのCIを照合する', async () => {
  const app = run('Application', { head_sha: B });
  const foundation = run('Foundation', { head_sha: B });
  const paths = [];
  const api = async path => {
    paths.push(path);
    if (path === '/git/ref/heads/main') return { object: { sha: B } };
    if (path.startsWith('/actions/workflows/')) return { workflow_runs: [] };
    if (path.startsWith('/actions/runs?')) return { workflow_runs: [app, foundation] };
    return { jobs: jobsFor(path.includes(`/${app.id}/`) ? 'Application' : 'Foundation') };
  };
  // GitHub single-pending queue: X running; B waits; stale A's rerun replaces B.
  let pendingEvent = B;
  pendingEvent = A;
  assert.equal(pendingEvent, A);
  assert.equal(decideGate(input({ targetSha: pendingEvent, mainSha: B })).reason, 'not-main-head'); // old bug
  const result = await evaluateCurrentMain({ enabled: true, api, currentRunId: '10' });
  assert.deepEqual(result, { sha: B, deploy: true, reason: 'ci-passed' });
  assert.ok(paths.includes(`/actions/runs?head_sha=${B}&event=push&branch=main&per_page=100`));
  app.conclusion = 'failure';
  assert.equal((await evaluateCurrentMain({ enabled: true, api })).reason, 'ci-failed:Application');
});

test('失敗・取消された切替は後続CDを止め、gate-only/skipでは解除しない', async () => {
  assert.equal(switchBlocks([]), null);
  assert.equal(switchBlocks([{ name: 'Reconcile production switch', conclusion: 'skipped' }]), null);
  for (const conclusion of ['failure', 'cancelled', 'timed_out', null]) {
    assert.equal(switchBlocks([{ name: 'Reconcile production switch', conclusion }]), true);
  }
  assert.equal(switchBlocks([{ name: 'Reconcile production switch', conclusion: 'success' }]), false);
  const { runs, jobsByRunId } = green();
  const api = async path => {
    if (path === '/git/ref/heads/main') return { object: { sha: A } };
    if (path.startsWith('/actions/workflows/')) return { workflow_runs: [{ id: 100 }, { id: 99, run_attempt: 2 }, { id: 98 }] };
    if (path.startsWith('/actions/runs?')) return { workflow_runs: runs };
    if (path.includes('/100/')) return { jobs: [] };
    if (path.includes('/99/')) return { jobs: [{ name: 'Reconcile production switch',
      conclusion: path.includes('/attempts/1/') ? 'failure' : 'skipped' }] };
    if (path.includes('/98/')) return { jobs: [{ name: 'Reconcile production switch', conclusion: 'success' }] };
    return { jobs: jobsByRunId[Number(path.split('/')[3])] };
  };
  assert.equal((await evaluateCurrentMain({ enabled: true, api, currentRunId: '100' })).reason, 'previous-switch-needs-review');
  assert.equal((await evaluateCurrentMain({ enabled: true, api, currentRunId: '99' })).deploy, true); // operator-approved full retry
  assert.deepEqual(await evaluateCurrentMain({ enabled: false, api: () => { throw new Error('must not call'); } }),
    { deploy: false, reason: 'cd-disabled' });
});
