// 本番CD（Issue #275）の判定器。配備してよいかの判断だけを行い、Secretや接続値は扱わない。
// 使い方:
//   node .github/scripts/deploy-gate.mjs gate     CI成功・main先頭・CD有効を確認しGITHUB_OUTPUTへdeploy/reasonを書く
//   node .github/scripts/deploy-gate.mjs head     対象SHAが今もmainの先頭かだけを確認する（promote直前）
//   node .github/scripts/deploy-gate.mjs schema FILE EXIT   db:checkの出力を ok / pending / stop に分類する
//   node .github/scripts/deploy-gate.mjs deployment FILE    Vercel deploymentのJSONが対象SHAの本番buildか確認する
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Application / Foundation の必須job名（required check名と同じ）。名前を変えたらここも更新する。
export const REQUIRED_JOBS = Object.freeze({
  Application: ['Production install and Vercel bundle smoke', 'Install, typecheck, test, build', 'Container build and smoke test'],
  Foundation: ['Repository checks'],
});

const SHA = /^[0-9a-f]{40}$/;

// runs: GitHub APIのworkflow run（name, head_sha, head_branch, event, status, conclusion, id, run_attempt）
// jobsByRunId: run idごとのjob一覧（name, conclusion）
export function decideGate({ enabled, targetSha, mainSha, runs, jobsByRunId }) {
  if (!enabled) return { deploy: false, reason: 'cd-disabled' };
  if (!SHA.test(targetSha ?? '') || !SHA.test(mainSha ?? '')) return { deploy: false, reason: 'invalid-sha' };
  if (targetSha !== mainSha) return { deploy: false, reason: 'not-main-head' };
  for (const [workflow, jobNames] of Object.entries(REQUIRED_JOBS)) {
    const candidates = runs.filter(run => run.name === workflow && run.head_sha === targetSha
      && run.event === 'push' && run.head_branch === 'main');
    if (candidates.length === 0) return { deploy: false, reason: `waiting:${workflow}` };
    // 同じSHAの再実行があれば最新のrunだけを見る。古い成功で新しい失敗を上書きしない。
    const latest = candidates.reduce((a, b) => (b.id > a.id || (b.id === a.id && b.run_attempt > a.run_attempt) ? b : a));
    if (latest.status !== 'completed') return { deploy: false, reason: `waiting:${workflow}` };
    if (latest.conclusion !== 'success') return { deploy: false, reason: `ci-failed:${workflow}` };
    const jobs = jobsByRunId[latest.id] ?? [];
    for (const name of jobNames) {
      const job = jobs.filter(j => j.name === name);
      if (job.length !== 1) return { deploy: false, reason: `job-missing:${name}` };
      if (job[0].conclusion !== 'success') return { deploy: false, reason: `job-not-success:${name}` };
    }
  }
  return { deploy: true, reason: 'ci-passed' };
}

// db:checkの結果を分類する。pendingは「アプリの追加migrationだけが未適用」の場合に限る。
// 空DB・認証schemaの差・checksum不一致・不明な履歴・判定不能はすべてstop（人が確認する）。
export function classifySchema(report, exitCode) {
  if (exitCode === 0 && report?.status === 'ok') return 'ok';
  if (exitCode !== 1 || report?.status !== 'drift') return 'stop';
  const app = report.app;
  if (!app || app.historyTable !== 'present' || app.pending.length === 0) return 'stop';
  if (app.checksumMismatch.length || app.unknownHistory.length) return 'stop';
  if (!report.findings.every(f => f.code === 'pending_migration')) return 'stop';
  return 'pending';
}

// db:checkの標準出力から結果JSON（1行）を取り出す。npmのbannerや警告は無視する。
export function parseSchemaReport(text) {
  const line = text.split(/\r?\n/).reverse().find(l => l.startsWith('{"version":'));
  return line ? JSON.parse(line) : null;
}

// Vercelのdeployment（/v13/deployments）が、対象SHAで作った本番向けbuildかを確認する。
export function checkDeployment(deployment, targetSha) {
  if (!deployment) return 'missing';
  if (deployment.readyState !== 'READY') return `not-ready:${deployment.readyState}`;
  if (deployment.target !== 'production') return `not-production:${deployment.target}`;
  if (deployment.meta?.cdSha !== targetSha) return 'sha-mismatch';
  return 'ok';
}

async function github(path) {
  const response = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`GitHub API ${path.split('?')[0]} -> ${response.status}`);
  return response.json();
}

const mainHead = async () => (await github('/git/ref/heads/main')).object.sha;

function output(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  for (const line of lines) console.log(line);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
}

async function main([mode, ...args]) {
  const targetSha = process.env.TARGET_SHA;
  if (mode === 'gate') {
    const enabled = process.env.CD_ENABLED === 'true';
    const mainSha = await mainHead();
    const { workflow_runs: runs } = await github(`/actions/runs?head_sha=${targetSha}&event=push&branch=main&per_page=100`);
    const jobsByRunId = {};
    for (const run of runs.filter(r => Object.hasOwn(REQUIRED_JOBS, r.name) && r.status === 'completed')) {
      jobsByRunId[run.id] = (await github(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs;
    }
    output(decideGate({ enabled, targetSha, mainSha, runs, jobsByRunId }));
  } else if (mode === 'head') {
    const mainSha = await mainHead();
    if (mainSha !== targetSha) { output({ head: 'false' }); process.exitCode = 1; return; }
    output({ head: 'true' });
  } else if (mode === 'schema') {
    const report = parseSchemaReport(readFileSync(args[0], 'utf8'));
    output({ schema: classifySchema(report, Number(args[1])) });
  } else if (mode === 'deployment') {
    const result = checkDeployment(JSON.parse(readFileSync(args[0], 'utf8')), targetSha);
    output({ deployment: result });
    if (result !== 'ok') process.exitCode = 1;
  } else {
    console.error('usage: deploy-gate.mjs gate|head|schema FILE EXIT|deployment FILE');
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
