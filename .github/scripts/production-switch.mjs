// Issue #275: CLI exit/timeout is not server state. Only a fresh terminal alias
// request plus the actual production alias proves completion. See release-guide 12-A.
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { checkDeployment } from './deploy-gate.mjs';

export const BUDGET = Object.freeze({ request: 15000, command: 45000, promotion: 240000,
  rollback: 180000, smoke: 125000, poll: 3000 });
const terminal = new Set(['succeeded', 'failed', 'skipped']);
const pending = new Set(['pending', 'in-progress']);

export function assertProject(project, projectId) {
  if (project.id !== projectId) throw new Error('Unexpected project');
  if (project.rollingRelease) throw new Error('Rolling releases are not supported by this CD');
}

export function requestState(project, { type, target, baseline }) {
  const r = project.lastAliasRequest;
  if (!r || r.type !== type || r.toDeploymentId !== target
      || typeof r.requestedAt !== 'number' || !Number.isFinite(r.requestedAt) || r.requestedAt <= 0
      || (baseline !== 'none' && !Number.isFinite(Number(baseline)))
      || (baseline !== 'none' && Number(r.requestedAt) <= Number(baseline))) return 'unknown';
  if (terminal.has(r.jobStatus) || pending.has(r.jobStatus)) return r.jobStatus;
  return 'unknown';
}

// The injected boundary is also used by regression tests: real delays/errors can
// be simulated without Vercel credentials, a production API, or a database.
export async function waitRequest(io, config, ms) {
  const deadline = io.now() + ms;
  while (io.now() < deadline) {
    try {
      const project = await io.project();
      assertProject(project, config.projectId);
      const state = requestState(project, config);
      if (terminal.has(state)) return { state, project };
    } catch (error) {
      io.log(`Alias state unavailable: ${error.message}`);
    }
    await io.sleep(Math.min(BUDGET.poll, Math.max(0, deadline - io.now())));
  }
  throw new Error('Alias request did not reach a proven terminal state; manual reconciliation required');
}

async function waitAlias(io, id, ms) {
  const deadline = io.now() + ms;
  while (io.now() < deadline) {
    try {
      const d = await io.current();
      if (d.id === id && d.readyState === 'READY' && d.target === 'production') return d;
    } catch (error) { io.log(`Production alias unavailable: ${error.message}`); }
    await io.sleep(Math.min(BUDGET.poll, Math.max(0, deadline - io.now())));
  }
  throw new Error('Production alias could not be verified');
}

export async function preflight(io, config) {
  const project = await io.project();
  assertProject(project, config.projectId);
  const prior = project.lastAliasRequest;
  if (prior && (!terminal.has(prior.jobStatus) || !['promote', 'rollback'].includes(prior.type)
      || typeof prior.requestedAt !== 'number' || !Number.isFinite(prior.requestedAt) || prior.requestedAt <= 0)) {
    throw new Error('An alias request is pending or cannot be classified');
  }
  const current = await io.current();
  if (current.id !== config.previous || current.readyState !== 'READY' || current.target !== 'production') {
    throw new Error('Production changed since candidate preparation');
  }
  return String(project.lastAliasRequest?.requestedAt ?? 'none');
}

export async function attemptPromotion(io, config, persist) {
  const baseline = await preflight(io, config);
  // Persist BEFORE any command: its request may survive cancellation/transport loss.
  const started = io.now();
  persist({ attempted: true, started, baseline });
  io.log(`Switch attempt ${started}: candidate=${config.candidate}, previous=${config.previous}, prior request=${baseline}`);
  await io.command('promote', config.candidate);
}

export async function verify(io, config) {
  const { state } = await waitRequest(io, { ...config, type: 'promote', target: config.candidate }, BUDGET.promotion);
  if (state !== 'succeeded') throw new Error(`Promotion server state: ${state}`);
  const deployed = await waitAlias(io, config.candidate, BUDGET.request * 2);
  if (checkDeployment(deployed, config.sha) !== 'ok') throw new Error('Production SHA mismatch');
  await io.smoke();
  io.log('Production SHA and smoke verified');
  return 'verified';
}

export async function recover(io, config) {
  // Never issue rollback while promotion is still running: it could finish later
  // and overwrite the rollback. Unknown/timeout stays failed and blocks later CD.
  const { project } = await waitRequest(io, { ...config, type: 'promote', target: config.candidate }, BUDGET.promotion);
  const current = await io.current();
  if (current.id !== config.candidate && current.id !== config.previous) {
    throw new Error('Production points at an unrelated deployment; do not overwrite an operator change');
  }
  // CLI failure or cancellation is conservatively recovered even if the server
  // succeeded later. A terminal failed request can have moved only some aliases.
  const started = io.now();
  const baseline = String(project.lastAliasRequest.requestedAt);
  const latest = await io.project();
  assertProject(latest, config.projectId);
  if (String(latest.lastAliasRequest?.requestedAt) !== baseline
      || !terminal.has(requestState(latest, { ...config, type: 'promote', target: config.candidate }))) {
    throw new Error('Alias request changed before recovery; manual reconciliation required');
  }
  try { await io.command('rollback', config.previous); }
  catch (error) { io.log(`Rollback CLI failed; checking server state: ${error.message}`); }
  const rollback = await waitRequest(io, { ...config, type: 'rollback', target: config.previous, started, baseline }, BUDGET.rollback);
  if (rollback.state !== 'succeeded') throw new Error(`Rollback server state: ${rollback.state}; manual recovery required`);
  await waitAlias(io, config.previous, BUDGET.request * 2);
  await io.smoke();
  io.log(`Verified rollback to ${config.previous}; database was not reverted`);
  return 'rolled-back';
}

function output(values) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
}

// Bound the whole process as well as CLI's own wait. The server can outlive both.
export function runCommand(command, args, ms) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, ms);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve();
      else reject(new Error(timedOut ? 'Command deadline exceeded' : `Command exit ${code}`));
    });
  });
}

function realIO(config) {
  const api = async path => {
    const url = new URL(path, 'https://api.vercel.com');
    url.searchParams.set('teamId', process.env.VERCEL_ORG_ID);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}`, 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(BUDGET.request),
    });
    if (!response.ok) throw new Error(`Vercel API ${response.status}`);
    return response.json();
  };
  return {
    now: Date.now,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log: message => {
      console.log(message);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${message}\n`);
    },
    // The pinned CLI requests rollbackInfo=true to include lastAliasRequest.
    project: () => api(`/v9/projects/${config.projectId}?rollbackInfo=true`),
    current: () => api(`/v13/deployments/${new URL(process.env.PRODUCTION_URL).hostname}`),
    command: (action, id) => runCommand(join(process.env.RUNNER_TEMP, 'cd-cli/node_modules/.bin/vercel'),
      [action, id, '--yes', '--timeout', '30s', '--token', process.env.VERCEL_TOKEN], BUDGET.command),
    smoke: () => runCommand('bash', ['.github/scripts/smoke-deployment.sh', process.env.PRODUCTION_URL], BUDGET.smoke),
  };
}

async function main(mode) {
  const config = { projectId: process.env.VERCEL_PROJECT_ID, candidate: process.env.CANDIDATE_ID,
    previous: process.env.PREVIOUS_ID, sha: process.env.TARGET_SHA };
  for (const key of ['projectId', 'candidate', 'previous']) {
    if (!/^[\w-]+$/.test(config[key] ?? '')) throw new Error(`Invalid ${key}`);
  }
  const io = realIO(config);
  if (mode === 'promote') {
    await attemptPromotion(io, config, output);
  } else if (mode === 'verify' || mode === 'recover') {
    const started = Number(process.env.PROMOTE_STARTED);
    if (!Number.isFinite(started) || started <= 0) throw new Error('Missing promotion journal');
    const result = await (mode === 'verify' ? verify : recover)(io, { ...config, started, baseline: process.env.PROMOTE_BASELINE });
    output({ recovery: result });
    if (result !== 'verified') process.exitCode = 1;
  } else throw new Error('usage: production-switch.mjs promote|verify|recover');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { await main(process.argv[2]); }
  catch (error) {
    console.error(error.message);
    output({ recovery: 'unverified' });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `- Switch/recovery unverified: ${error.message}. Stop CD and reconcile the alias request before any manual switch.\n`);
    process.exitCode = 1;
  }
}
