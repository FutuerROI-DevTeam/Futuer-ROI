import assert from 'node:assert/strict';
import { test } from 'node:test';
import { targetGap, targetGapText } from '../src/features/today/target-gap.ts';
import { outlookAxis } from '../src/features/today/chart-geometry.ts';

// 今日 2026-10-05（月）。到達予定日 2027-03-31（水）
const today = '2026-10-05';
const target = '2027-03-31';
const daysTo = (iso) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

test('ずれは、目安の週の月曜日と到達予定日の差。8週未満は週、それ以上は月で書く（#157、B案）', () => {
  // 3月1日の週（月曜 3/1）：30日早い → 約4週早い
  assert.equal(targetGapText(targetGap(today, daysTo('2027-03-03'), target)), '約4週早い');
  // 2月1日の週：58日早い（8週以上）→ 約2か月早い
  assert.equal(targetGapText(targetGap(today, daysTo('2027-02-04'), target)), '約2か月早い');
  // 4月12日の週：12日遅い → 約2週遅い
  assert.equal(targetGapText(targetGap(today, daysTo('2027-04-14'), target)), '約2週遅い');
  // 7月5日の週：96日遅い → 約3か月遅い
  assert.equal(targetGapText(targetGap(today, daysTo('2027-07-06'), target)), '約3か月遅い');
  // 3月29日の週（月曜 3/29）：2日差 → 到達予定日ごろ
  assert.deepEqual(targetGap(today, daysTo('2027-03-31'), target), { kind: 'near' });
  // 3年より先（日数なし）はずれを出さない
  assert.equal(targetGap(today, null, target), null);
});

test('日付の軸は、到達予定日が見通しより先ならそこまで伸ばし、今日以前なら印を出さない', () => {
  const axis = outlookAxis(today, 30, 60, false, 350, daysTo(target));
  assert.ok(axis.target && axis.target.x <= axis.axisRight && axis.target.x > axis.markers[1].x);
  assert.equal(outlookAxis(today, 30, 60, false, 350, 0).target, null);
  assert.equal(outlookAxis(today, 30, 60, false, 350).target, null);
});

// #187（案C）：到達予定日が「10回中8回（なければ目安）」の3倍より先なら、見通しまでの軸を右端の手前で省き、
// 到達予定日を右端に置く。印が「今日」に詰まらず、右端の到達予定日のラベルの下にも入らないことを、極端な比で確かめる
test('到達予定日が見通しの3倍より先なら軸を省き、印を今日と右端のラベルから離す（#187）', () => {
  for (const width of [322, 350, 358, 600]) {
    for (const [p50, p80, targetDays] of [
      [30, 45, 1000],
      [5, 8, 365],
      [200, null, 1500],
      [1, 1, 100_000],
    ]) {
      const axis = outlookAxis(today, p50, p80, false, width, targetDays);
      const label = `${width}px ${p50}/${p80}/${targetDays}日`;
      assert.ok(axis.cut && axis.target, label);
      assert.equal(axis.target.x, axis.axisRight);
      assert.ok(axis.markers.every((m) => m.x <= axis.axisRight - 170), `${label}：印が右端のラベルの下に入らない`);
      assert.ok(axis.ticks.every((t) => t.x < axis.cut.x), `${label}：目盛りは省いた位置より左`);
      // 省いた内側は日付に比例する（印の間隔の比が日数の比と一致する）
      if (p80 !== null) {
        const r = (axis.markers[1].x - axis.axisLeft) / (axis.markers[0].x - axis.axisLeft);
        assert.ok(Math.abs(r - p80 / p50) < 1e-9, `${label}：比例`);
      }
    }
  }
  // 以前は 350px・30/45/1000日で目安 x≈28、10回中8回 x≈32（今日は x=20）に詰まっていた
  const far = outlookAxis(today, 30, 45, false, 350, 1000);
  assert.ok(far.markers[0].x - far.axisLeft >= 40 && far.markers[1].x - far.markers[0].x >= 40);
});

test('3倍ちょうどまでは省かず、到達予定日まで日付に比例した軸を保つ（#187）', () => {
  const at = outlookAxis(today, 30, 45, false, 350, 135);
  assert.equal(at.cut, null);
  assert.ok(at.target.x < at.axisRight && at.target.x > at.markers[1].x);
  assert.ok(outlookAxis(today, 30, 45, false, 350, 136).cut);
  // 10回中8回がないときは目安の3倍で判定する
  assert.equal(outlookAxis(today, 30, null, false, 350, 90).cut, null);
  assert.ok(outlookAxis(today, 30, null, false, 350, 91).cut);
  // 到達予定日がない・今日以前なら省かない
  assert.equal(outlookAxis(today, 30, 45, false, 350).cut, null);
  assert.equal(outlookAxis(today, 30, 45, false, 350, 0).cut, null);
});

// 月ラベルと年ラベルから実際の日付を読む。xだけの検査では、右端の過去targetへの逆戻りを見逃す。
function assertAxisOrder(date, p50, p80, sameWeek, width, targetDays) {
  const axis = outlookAxis(date, p50, p80, sameWeek, width, targetDays);
  const start = Date.parse(`${date}T00:00:00Z`);
  let year = Number(date.slice(0, 4));
  const dated = [{ x: axis.axisLeft, day: 0 }];
  for (const tick of axis.ticks) {
    if (tick.yearLabel) year = Number(tick.yearLabel.slice(0, -1));
    const day = (Date.UTC(year, Number(tick.label.slice(0, -1)) - 1, 1) - start) / 86_400_000;
    dated.push({ x: tick.x, day });
    if (axis.cut) {
      assert.ok(day < targetDays, `${date}/${width}: 月目盛り${year}/${tick.label}はtargetより前`);
      assert.ok(tick.x < axis.cut.x);
    }
  }
  for (const marker of axis.markers) dated.push({ x: marker.x, day: marker.kind === 'p50' ? p50 : p80 });
  if (axis.target) dated.push({ x: axis.target.x, day: targetDays });
  for (const point of dated) assert.ok(Number.isFinite(point.x) && point.x >= axis.axisLeft && point.x <= axis.axisRight);
  dated.sort((a, b) => a.x - b.x);
  for (let i = 1; i < dated.length; i++) {
    assert.ok(dated[i].day >= dated[i - 1].day, `${date}/${width}: 左→右の日付が逆戻りしない ${JSON.stringify(dated)}`);
  }
  return axis;
}

test('cut軸の4反例: spanがtargetを越えても未来月をtargetの左に置かない（PR212）', () => {
  for (const [p50, p80, width, targetDays] of [[3, 3, 322, 10], [3, 3, 581, 10], [0, 0, 322, 1], [30, 30, 252, 91]]) {
    const axis = assertAxisOrder('2026-10-20', p50, p80, true, width, targetDays);
    assert.ok(axis.cut);
  }
});

test('有限/範囲外P80・短期/長期・狭幅/PC幅で軸の日付順とboundsを保つ（PR212）', () => {
  for (const date of ['2026-10-20', '2026-12-31', '2028-02-28']) {
    for (const width of [252, 322, 350, 581, 600]) {
      for (const [p50, p80, targetDays] of [
        [0, 0, 1], [3, 3, 10], [3, 3, 12], [30, 30, 91], [5, 8, 365],
        [200, 400, 1500], [200, null, 1500], [1, null, 100_000],
        [30, 45, 135], [30, null, 90], [30, 45, 0], [30, 45, null],
      ]) assertAxisOrder(date, p50, p80, p50 === p80, width, targetDays);
    }
  }
});
