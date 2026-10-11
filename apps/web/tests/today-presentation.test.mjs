import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { assertForecastPresentation } from '../src/features/prior/forecast-validation.ts';
const { toForecastView } = await import('../src/features/today/forecast-view.ts');
const { showYesterdayPrompt } = await import('../src/features/today/yesterday-later.ts');
const examples = JSON.parse(readFileSync(new URL('./fixtures/engine-examples.json', import.meta.url), 'utf8'));

const resumed = { success: 3, total: 4 };
const completion = { kind: 'estimate', scenario: 'TODAY_DONE', sources: { a: 'RECORDS', b: 'RECORDS' }, p50Days: 7, p80Days: 14, p50Label: '週A', p80Label: '週B' };
const forecast = (progress) => ({ kind: 'forecast', progress, resumed, completion, core: { kind: 'estimate', days: 2, source: 'RECORDS' } });
const recorded = (progress) => ({ kind: 'today-recorded', todayStatus: 'DONE', progress, resumed, completion: { ...completion, scenario: 'CURRENT_STATE' } });

test('Engineの実出力13件の変換結果は、PR #120最終版の検査を通る', () => {
  assert.equal(examples.cases.length, 13);
  // Engineの入力に単位はないため、両方の単位で確かめる
  for (const { name, prediction } of examples.cases)
    for (const unit of ['minutes', 'sessions']) {
      const view = toForecastView(prediction, unit);
      assert.doesNotThrow(() => assertForecastPresentation(view), `${name} (${unit})`);
      assert.equal(view.kind === 'completed', prediction.progress.completed, name);
    }
});

test('達成済みの超過実績（done > total）は切り詰めずに受け入れる（R-02・R-08）', () => {
  for (const unit of ['minutes', 'sessions'])
    for (const done of [100, 120]) {
      const view = { kind: 'completed', progress: { done, total: 100, unit } };
      assert.doesNotThrow(() => assertForecastPresentation(view));
      assert.equal(view.progress.done, done);
    }
});

test('進捗と状態が食い違う表示データは拒否する', () => {
  const unit = 'minutes';
  assert.throws(() => assertForecastPresentation({ kind: 'completed', progress: { done: 99, total: 100, unit } }), TypeError);
  for (const done of [100, 120]) {
    assert.throws(() => assertForecastPresentation(forecast({ done, total: 100, unit })), TypeError);
    assert.throws(() => assertForecastPresentation(recorded({ done, total: 100, unit })), TypeError);
  }
  assert.doesNotThrow(() => assertForecastPresentation(forecast({ done: 99, total: 100, unit })));
  assert.doesNotThrow(() => assertForecastPresentation(recorded({ done: 99, total: 100, unit })));
});

test('「後で答える」は押したときの対象日だけに効き、日付が変われば問いかけを出し直す', () => {
  const day1 = { yesterdayMissing: true, yesterday: '2026-10-06' };
  const day2 = { yesterdayMissing: true, yesterday: '2026-10-07' };
  assert.equal(showYesterdayPrompt(day1, null), true);
  assert.equal(showYesterdayPrompt(day1, '2026-10-06'), false);
  assert.equal(showYesterdayPrompt(day2, '2026-10-06'), true);
  assert.equal(showYesterdayPrompt({ yesterdayMissing: false, yesterday: '2026-10-06' }, null), false);
  assert.equal(showYesterdayPrompt(undefined, null), false);
});

test('R-11の出所と計画を、補わずにそのまま表示データへ渡す', () => {
  const available = examples.cases.find((c) => c.prediction.coreMetric.status === 'available' && c.prediction.completion.status === 'available' && c.prediction.todayStatus === 'UNRECORDED');
  const insufficient = examples.cases.find((c) => c.prediction.completion.status === 'insufficient' && c.prediction.todayStatus === 'UNRECORDED' && !c.prediction.progress.completed);
  assert.ok(available && insufficient);
  // 回答由来・混合の出所を、中心の数字（bの出所）と完了の目安（a／b）へそのまま
  const mixed = toForecastView(available.prediction, 'minutes', { provenance: { a: 'QUESTION', b: 'QUESTION_AND_RECORDS' }, plan: null, sessionAmount: 15 });
  assert.equal(mixed.core.source, 'QUESTION_AND_RECORDS');
  assert.deepEqual(mixed.completion.sources, { a: 'QUESTION', b: 'QUESTION_AND_RECORDS' });
  assert.doesNotThrow(() => assertForecastPresentation(mixed));
  // 出所なしでは従来どおり実績由来
  assert.equal(toForecastView(available.prediction, 'minutes').core.source, 'RECORDS');
  // 見通しを出しているのに出所がNONEなら、補わずに止める
  assert.throws(() => toForecastView(available.prediction, 'minutes', { provenance: { a: 'NONE', b: 'RECORDS' }, plan: null, sessionAmount: 15 }), TypeError);
  // 材料が足りず計画があるときは、設定量で行う場合の残り（日数ではない）
  const planned = toForecastView(insufficient.prediction, 'minutes', { provenance: { a: 'NONE', b: 'NONE' }, plan: { remainingAmount: 40, remainingSessions: 3, lastSessionAmount: 10 }, sessionAmount: 15 });
  assert.equal(planned.completion.kind, 'conditional');
  assert.deepEqual(planned.completion.plan, { remainingAmount: 40, sessions: 3, sessionAmount: 15, lastAmount: 10, unit: 'minutes' });
  assert.match(planned.completion.reason, /取り組めた日の翌日」と「休んだ日の翌日/);
  assert.doesNotThrow(() => assertForecastPresentation(planned));
  // 計画がなければ従来どおり不足の文言
  assert.equal(toForecastView(insufficient.prediction, 'minutes', { provenance: { a: 'NONE', b: 'NONE' }, plan: null, sessionAmount: 15 }).completion.kind, 'insufficient');
});

test('回答だけ・回答と記録の見通しでは、注釈で「あなたの記録から」「同じ記録から」を流用しない（R-11、#137）', async () => {
  const { completionNoteFor, coreNoteFor, todayCopy } = await import('../src/copy/today.ts');
  // 記録だけのときは Product Spec の固定文言のまま
  assert.equal(coreNoteFor('RECORDS'), todayCopy.coreNote);
  // g50の遅れ解釈を全面否定せず、どの出所でもモデル条件とP50差・因果の限界を伝える。
  for (const source of ['RECORDS', 'QUESTION', 'QUESTION_AND_RECORDS']) {
    const note = coreNoteFor(source);
    assert.match(note, /同じ継続傾向と設定量/);
    assert.match(note, /再開後に同じ道をたどるモデル/);
    assert.match(note, /完了が遅れる日数の中央値/);
    assert.match(note, /完了日の中央値どうしの差/);
    assert.match(note, /実際の因果効果.*表すものではなく/);
    assert.doesNotMatch(note, /完了日の差ではなく/);
  }
  assert.equal(completionNoteFor({ a: 'RECORDS', b: 'RECORDS' }), todayCopy.completionNote);
  // 実ログ0件・回答だけ
  assert.doesNotMatch(coreNoteFor('QUESTION'), /記録から推定した/);
  assert.match(coreNoteFor('QUESTION'), /回答/);
  assert.doesNotMatch(completionNoteFor({ a: 'QUESTION', b: 'QUESTION' }), /同じ記録|記録から推定した/);
  assert.match(completionNoteFor({ a: 'QUESTION', b: 'QUESTION' }), /回答/);
  // 回答と記録の両方
  assert.match(coreNoteFor('QUESTION_AND_RECORDS'), /回答と、あなたの記録/);
  assert.match(completionNoteFor({ a: 'QUESTION', b: 'RECORDS' }), /回答と、あなたの記録/);
  assert.match(completionNoteFor({ a: 'QUESTION_AND_RECORDS', b: 'RECORDS' }), /回答と、あなたの記録/);
  // sampling/積分のどちらでも正しい計算説明にし、出所別の説明は保持する（#204統合）。
  for (const a of ['RECORDS', 'QUESTION', 'QUESTION_AND_RECORDS']) {
    for (const b of ['RECORDS', 'QUESTION', 'QUESTION_AND_RECORDS']) {
      const note = completionNoteFor({ a, b });
      assert.match(note, /をもとに計算した見込みです/);
      assert.doesNotMatch(note, /シミュレーション/);
    }
  }

});
