import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { Value } from '@sinclair/typebox/value';
import { mixtureCompletionQuantiles } from '../../../packages/prediction/src/completion.ts';

// 実部品のHTMLと読み上げを検査する。SSRではCSS・幅の測定は実行せず、実ブラウザ確認とは区別する。
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context);
    const { outputText } = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
      fileName: fileURLToPath(url),
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});

const { CompletionBrief, OutlookPanel } = await import('../src/features/today/OutlookPanel.tsx');
const { toForecastView } = await import('../src/features/today/forecast-view.ts');
const { assertForecastPresentation, PriorForecast } = await import('../src/features/prior/PriorForecast.tsx');
const { todayCopy, completionNoteFor } = await import('../src/copy/today.ts');
const { amountFormat } = await import('../src/copy/amount.ts');
const { shortDate, parseLocalDate } = await import('../src/copy/date.ts');
const { buildR11Today } = await import('../../api/src/prediction/r11.ts');
const { makeQuestionSnapshot } = await import('../../api/src/questions/snapshot.ts');
const { TodayR11 } = await import('../../api/src/contracts/r11.ts');
const examples = JSON.parse(readFileSync(new URL('./fixtures/engine-examples.json', import.meta.url), 'utf8'));
const base = examples.cases.find(({ prediction }) => prediction.todayStatus === 'UNRECORDED' && prediction.completion.status === 'available').prediction;
const today = '2026-10-09';
const horizon = 1095;
const outsideText = '10回中8回の完了時期の目安は、計算範囲の約3年以内には収まりません。';
const p50OutsideText = '約3年以内の目安なし';
const p50Reason = '約3年の計算範囲内で、完了する見込みが50%（半分）に届かないためです。材料不足や、将来も完了できないという意味ではありません。';
const p80Reason = '約3年の計算範囲内で、完了する見込みが80%に届かないためです。材料不足や、将来も完了できないという意味ではありません。';
const quantiles = (a) => mixtureCompletionQuantiles([{ a, b: 0 }], 'DONE', 1, horizon);

function present(q, provenance, recorded = false, date = today) {
  // b=0の人工境界条件。利用者の実データ・発生頻度・予測精度を検証する例ではない。
  const prediction = { ...base, today: date, todayStatus: recorded ? 'DONE' : 'UNRECORDED', completion: { status: 'available', scenario: recorded ? 'CURRENT_STATE' : 'TODAY_DONE', ...q } };
  const extras = provenance ? { provenance, plan: null, sessionAmount: 15 } : undefined;
  const view = toForecastView(prediction, 'minutes', extras);
  assertForecastPresentation(view);
  return view;
}

function render(completion, options = {}) {
  return renderToStaticMarkup(createElement(OutlookPanel, { completion, today, sessionAmount: 20, ...options, title: '完了の目安', fmt: amountFormat({ unit: 'minutes' }) }));
}

test('F(H)=0.79では有限P50を保持し、P80の範囲外を期間外80%と説明しない', () => {
  const q = quantiles(0.79);
  assert.deepEqual(q, { p50Days: 1, p80Days: null });
  const view = present(q);
  assert.equal(view.completion.p50Label, '10月5日の週');
  const html = render(view.completion);
  assert.match(html, /fr-outlook__p50">10月5日の週ごろ/);
  assert.ok(html.includes(outsideText));
  assert.ok(html.includes(p80Reason));
  assert.ok(!html.includes(p50Reason));
  assert.match(html, /aria-label="日付の軸。目安の日付に印。10回中8回の完了時期の目安は、計算範囲/);
  assert.doesNotMatch(html, /10回中8回は3年以上先|10回中8回の日付は3年以上先/);
  assert.equal(todayCopy.completionP80Over3Years, outsideText);
});

test('F(H)=0.20では両方nullを有限P50の場合と区別する', () => {
  const q = quantiles(0.20);
  assert.deepEqual(q, { p50Days: null, p80Days: null });
  const view = present(q);
  assert.equal(view.completion.p50Label, null);
  const html = render(view.completion);
  assert.ok(html.includes('fr-outlook__p50">' + p50OutsideText));
  assert.ok(html.includes(p50Reason));
  assert.ok(!html.includes(p80Reason));
  assert.ok(html.includes(outsideText));
  assert.doesNotMatch(html, /日付の軸|10回中8回は3年以上先/);
});

test('0.80ちょうどと既存ε内は有限P80、εより外はnullのまま表示する', () => {
  for (const a of [0.8, 0.8 - 0.5e-12]) {
    const q = quantiles(a);
    assert.deepEqual(q, { p50Days: 1, p80Days: 1 });
    const html = render(present(q).completion);
    assert.match(html, /10回中8回は10月5日の週まで/);
    assert.ok(!html.includes(outsideText));
  }
  assert.equal(quantiles(0.8 - 2e-12).p80Days, null);
});

test('H日目と0日の有限分位点を週丸めによって範囲外にしない', () => {
  const q = mixtureCompletionQuantiles([{ a: Math.pow(0.8, 1 / horizon), b: 0 }], 'DONE', horizon, horizon);
  assert.deepEqual(q, { p50Days: horizon, p80Days: horizon });
  assert.ok(!render(present(q).completion).includes(outsideText));
  const zero = mixtureCompletionQuantiles([{ a: 0.2, b: 0 }], 'DONE', 0, horizon);
  assert.deepEqual(zero, { p50Days: 0, p80Days: 0 });
  const view = present(zero);
  assert.equal(view.completion.p50Label, '10月5日の週');
  assert.equal(view.completion.p80Label, '10月5日の週');
  assert.ok(!render(view.completion).includes(outsideText));
  const nextWeek = present({ p50Days: 3, p80Days: 3 });
  assert.equal(nextWeek.completion.p80Label, '10月12日の週');
});

test('質問・実記録・両者併用と記録済みでも、P80の意味と出所・注釈を保持する', () => {
  for (const provenance of [{ a: 'RECORDS', b: 'RECORDS' }, { a: 'QUESTION', b: 'QUESTION' }, { a: 'QUESTION_AND_RECORDS', b: 'RECORDS' }]) {
    for (const recorded of [false, true]) {
      const view = present(quantiles(0.79), provenance, recorded);
      assert.equal(view.kind, recorded ? 'today-recorded' : 'forecast');
      assert.equal(view.completion.scenario, recorded ? 'CURRENT_STATE' : 'TODAY_DONE');
      assert.deepEqual(view.completion.sources, provenance);
      const html = render(view.completion);
      assert.ok(html.includes(outsideText));
      assert.ok(html.includes(completionNoteFor(provenance)));
      if (provenance.a === 'QUESTION' || provenance.a === 'QUESTION_AND_RECORDS') assert.match(html, /初期の回答は仮定です/);
      const bothOutside = render(present(quantiles(0.20), provenance, recorded).completion);
      assert.ok(bothOutside.includes(p50Reason));
      assert.ok(bothOutside.includes(completionNoteFor(provenance)));
      assert.doesNotMatch(bothOutside, /今の記録の傾向|3年より先になる見込み|3年以上先/);
    }
  }
});

test('実APIの純粋変換でも、未回答・不明・片方回答の材料不足と範囲外を区別する', () => {
  // 必要回数1500はH=1095より多い。範囲外の実Engine出力を得る合成条件であり、実ユーザーの発生頻度ではない。
  const context = { unit: 'minutes', sessionAmount: 10, recordStartDate: '2026-10-01' };
  const goal = { ...context, id: 'synthetic-reason-goal', timezone: 'UTC', totalRequired: 15000, initialProgress: 0, goalSettingsRevision: 0, unitLocked: false };
  const dtoFor = (answers) => buildR11Today({
    goal,
    question: { question_prior: answers, answer_revision: '0', question_prior_snapshot: makeQuestionSnapshot(answers, context) },
    logs: [], now: new Date('2026-10-09T12:00:00Z'),
  });
  for (const { answers, provenance, reason, text } of [
    { answers: { a: null, b: null }, provenance: { a: 'NONE', b: 'NONE' }, reason: 'NO_DONE_ORIGIN_TRANSITION', text: '「取り組めた日の翌日」と「休んだ日の翌日」の材料が不足しています。' },
    { answers: { a: 'UNKNOWN', b: 'UNKNOWN' }, provenance: { a: 'NONE', b: 'NONE' }, reason: 'NO_DONE_ORIGIN_TRANSITION', text: '「取り組めた日の翌日」と「休んだ日の翌日」の材料が不足しています。' },
    { answers: { a: 'MID', b: null }, provenance: { a: 'QUESTION', b: 'NONE' }, reason: 'NO_SKIP_ORIGIN_TRANSITION', text: '「休んだ日の翌日」の材料が不足しています。' },
    { answers: { a: null, b: 'HIGH' }, provenance: { a: 'NONE', b: 'QUESTION' }, reason: 'NO_DONE_ORIGIN_TRANSITION', text: '「取り組めた日の翌日」の材料が不足しています。' },
  ]) {
    const dto = dtoFor(answers);
    assert.equal(Value.Check(TodayR11, dto), true);
    assert.deepEqual(dto.prediction.completion, { status: 'insufficient', reason });
    assert.deepEqual(dto.provenance, provenance);
    const view = toForecastView(dto.prediction, context.unit, { provenance: dto.provenance, plan: dto.plan, sessionAmount: context.sessionAmount });
    assertForecastPresentation(view);
    assert.equal(view.completion.kind, 'conditional');
    const html = render(view.completion);
    assert.ok(html.includes(text));
    assert.match(html, /日数の予測ではありません/);
    assert.ok(!html.includes(p50OutsideText) && !html.includes(outsideText));
  }
  const dto = dtoFor({ a: 'HIGH', b: 'HIGH' });
  assert.equal(Value.Check(TodayR11, dto), true);
  assert.deepEqual(dto.prediction.completion, { status: 'available', scenario: 'TODAY_DONE', p50Days: null, p80Days: null });
  assert.deepEqual(dto.provenance, { a: 'QUESTION', b: 'QUESTION' });
  assert.equal(dto.plan, null);
  const view = toForecastView(dto.prediction, context.unit, { provenance: dto.provenance, plan: dto.plan, sessionAmount: context.sessionAmount });
  assertForecastPresentation(view);
  assert.equal(view.completion.kind, 'estimate');
  const html = render(view.completion);
  assert.ok(html.includes(p50OutsideText) && html.includes(p50Reason));
  assert.doesNotMatch(html, /今の記録の傾向|材料が不足しています|日数の予測ではありません/);
});

test('達成済み・不足・条件付き計画はP80 nullの説明と混同しない', () => {
  const completed = toForecastView({ ...base, progress: { ...base.progress, done: base.progress.total, completed: true }, completion: { status: 'completed' } }, 'minutes');
  assert.equal(completed.kind, 'completed');
  const completedHtml = renderToStaticMarkup(createElement(PriorForecast, { view: completed }));
  assert.match(completedHtml, /目標を達成しました/);
  assert.ok(!completedHtml.includes(outsideText));
  const insufficient = { ...base, coreMetric: { status: 'insufficient', reason: 'NO_SKIP_ORIGIN_TRANSITION' }, completion: { status: 'insufficient', reason: 'NO_DONE_ORIGIN_TRANSITION' } };
  const unavailable = toForecastView(insufficient, 'minutes');
  assert.equal(unavailable.completion.kind, 'insufficient');
  assert.ok(!render(unavailable.completion).includes(outsideText));
  const planned = toForecastView(insufficient, 'minutes', { provenance: { a: 'NONE', b: 'NONE' }, plan: { remainingAmount: 40, remainingSessions: 3, lastSessionAmount: 10 }, sessionAmount: 15 });
  assert.equal(planned.completion.kind, 'conditional');
  const planHtml = render(planned.completion);
  assert.match(planHtml, /あと3回分|日数の予測ではありません/);
  assert.ok(!planHtml.includes(outsideText));
});

// 到達予定日との差は実部品の最終文言を検査する。純粋な差分計算だけではprefixの重複を検出できない。
for (const { kind, days, expected } of [
  { kind: 'near', days: 177, expected: '到達予定日ごろ' },
  { kind: 'early', days: 163, expected: '到達予定日より約2週早い' },
  { kind: 'late', days: 191, expected: '到達予定日より約2週遅い' },
]) {
  test('到達予定日の' + kind + '比較をP50・P80の最終文言として表示する', () => {
    const date = '2026-10-05';
    const targetDate = '2027-03-31';
    const html = render(present({ p50Days: days, p80Days: days }, undefined, false, date).completion, { today: date, targetDate });
    const text = html.replace(/<[^>]*>/g, '');
    assert.equal(text.split(expected).length - 1, 2);
    assert.doesNotMatch(text, /到達予定日より到達予定日/);
    assert.match(html, new RegExp('fr-gap--' + kind));
  });
}

test('設定量の仮実行と保存済み実績を表示で区別し、予測の単位を明示する', () => {
  const forecast = present({ p50Days: 1, p80Days: 3 }).completion;
  const minutes = render(forecast, { sessionAmount: 30 });
  assert.match(minutes, /設定量（30分）で続ける場合/);
  assert.match(minutes, /今日は設定量（30分）を行い、今後も同じ量ずつ行う想定/);
  const sessions = renderToStaticMarkup(createElement(OutlookPanel, { completion: forecast, today, title: '完了の目安', sessionAmount: 2, fmt: amountFormat({ unit: 'sessions' }) }));
  assert.match(sessions, /設定量（2回）で続ける場合/);
  assert.match(sessions, /今日は設定量（2回）を行い、今後も同じ量ずつ行う想定/);
  const recorded = render(present({ p50Days: 1, p80Days: 3 }, undefined, true).completion);
  assert.match(recorded, /設定量（20分）で続ける場合/);
  assert.match(recorded, /今後も設定量（20分）ずつ行う想定/);
  assert.doesNotMatch(recorded, /今日は設定量/);
});

test('スマホ完了要約は同じAPI週と欠如理由を保ち、設定量の前提を明示する', () => {
  const renderBrief = completion => renderToStaticMarkup(createElement(CompletionBrief, { completion }));
  for (const recorded of [false, true]) {
    const completion = present({ p50Days: 1, p80Days: 3 }, undefined, recorded).completion;
    assert.ok(renderBrief(completion).includes(todayCopy.completionBrief(completion.p50Label)));
    assert.match(renderBrief(completion), /設定量/);
  }
  const outside = present({ p50Days: null, p80Days: null }).completion;
  assert.ok(renderBrief(outside).includes(todayCopy.completionBriefOutside));
  for (const completion of [{ kind: 'insufficient', message: '材料不足' }, { kind: 'conditional', plan: { sessions: 2 }, reason: '材料不足' }]) {
    assert.ok(renderBrief(completion).includes(todayCopy.completionBriefUnavailable));
    assert.doesNotMatch(renderBrief(completion), /週ごろ/);
  }
});

test('到達予定日が見通しの3倍より先なら、軸を省いたことを読み上げでも伝える（#187）', () => {
  const date = '2026-10-05';
  const view = present({ p50Days: 30, p80Days: 45 }, undefined, false, date).completion;
  const far = render(view, { today: date, targetDate: '2029-07-01' });
  assert.ok(far.includes(todayCopy.targetDateAxisCut));
  // 軸を省くと位置から遠さが読めないため、年まで書く
  assert.ok(far.includes(todayCopy.targetDateAxis('2029年7月1日')));
  const near = render(view, { today: date, targetDate: '2026-12-01' });
  assert.ok(!near.includes(todayCopy.targetDateAxisCut));
  assert.ok(near.includes('fr-chart__due'));
  assert.ok(near.includes(todayCopy.targetDateAxis(shortDate(parseLocalDate('2026-12-01')))));
});
