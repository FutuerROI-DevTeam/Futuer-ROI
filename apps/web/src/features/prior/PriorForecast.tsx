// LOCAL REACT CANDIDATE. The FE passes the resolved state and display labels.
// No eligibility, quantile, conditional-count, API, persistence or priority calculation.
import type { ActualProgress, Counts, Source, SufficientSource, CompletionPresentation, PriorForecastProps } from "./presentation-types";
import { assertForecastPresentation } from "./forecast-validation.ts";

// 既存rendererの公開入口を保ち、表示検査だけのcallerは純粋moduleを直接読める。
export { assertForecastPresentation } from "./forecast-validation.ts";

const labels: Readonly<Record<Source, string>> = {
  QUESTION: "回答", QUESTION_AND_RECORDS: "回答＋実績", RECORDS: "実績", NONE: "不足",
};
export function sourceLabel(source: Source): string {
  if (!Object.hasOwn(labels, source)) {
    throw new TypeError("Invalid presentation source.");
  }
  return labels[source];
}
export function sourceNote(source: SufficientSource): string {
  switch (source) {
    case "QUESTION": return "回答に基づく仮の見通しです。将来を保証するものではありません。";
    case "RECORDS": return "記録に基づく見通しです。将来を保証するものではありません。";
    case "QUESTION_AND_RECORDS": return "回答と記録に基づく見通しです。初期の回答は仮定です。将来を保証するものではありません。";
    default: throw new TypeError("A displayed estimate needs resolved provenance.");
  }
}
function ActualProgressText({ progress }: { progress: ActualProgress }) {
  return <p>実際に完了した量：{progress.done}／{progress.total}{progress.unit === "minutes" ? "分" : "回"}</p>;
}
function ResumeRecords({ counts }: { counts: Counts }) {
  return (
    <section data-r11-aux="records">
      <h3>休んだ翌日の実績</h3>
      <p>{counts.total === 0 ? "休んだ翌日の実際の記録はまだありません。" : `休んだ翌日にやれたのは ${counts.total}回中${counts.success}回`}</p>
    </section>
  );
}
function Completion({ completion }: { completion: CompletionPresentation }) {
  if (completion.kind === "insufficient") {
    return <section data-r11-aux="completion"><h3>完了の目安</h3><p>{completion.message}</p></section>;
  }
  if (completion.kind === "conditional") {
    const p = completion.plan;
    const unit = p.unit === "minutes" ? "分" : "回";
    return (
      <section data-r11-aux="completion">
        <h3>設定量で行う場合の残り</h3>
        <p className="r11-qp-value">あと{p.sessions}回分</p>
        <p>残り{p.remainingAmount}{unit}。1回{p.sessionAmount}{unit}の設定量で行う場合。最後に必要な量は{p.lastAmount}{unit}です。これは日数の予測ではありません。</p>
        <p>{completion.reason}</p>
      </section>
    );
  }
  const hasQuestion = completion.sources.a !== "RECORDS" || completion.sources.b !== "RECORDS";
  const p80Text = completion.p80Label === null
    ? completion.p50Label === null
      ? "10回中8回の完了の目安も3年以上先です。"
      : "10回中8回の完了の目安は3年以上先です。"
    : `10回中8回の完了の目安：${completion.p80Label}`;
  return (
    <section data-r11-aux="completion">
      <h3>{completion.scenario === "TODAY_DONE" ? "今日やった場合の完了の目安" : "現在の状態からの完了の目安"}</h3>
      <p className="r11-qp-value">{completion.p50Label ?? "3年以上先"}</p>
      <p>{p80Text}</p>
      <p>取り組めた日の翌日：{sourceLabel(completion.sources.a)}／休んだ日の翌日：{sourceLabel(completion.sources.b)}</p>
      <p>{hasQuestion && "初期の回答は仮定です。"}将来を保証するものではありません。</p>
      {completion.scenario === "TODAY_DONE" && <p>今日やった場合の仮定です。まだ実際の記録・達成には反映されていません。</p>}
    </section>
  );
}

export function PriorForecast({ view, className }: PriorForecastProps) {
  assertForecastPresentation(view);
  const rootClass = ["r11-qp", className].filter(Boolean).join(" ");
  // Priority is represented by the parent's union; never inspect answers or logs here.
  switch (view.kind) {
    case "loading":
      return <div className={rootClass} role="status">最新の見通しを確認しています。</div>;
    case "saved-refresh-failed":
      return <div className={rootClass} role="status">回答は保存されました。見通しの更新に失敗しました。最新の見通しを再取得してください。</div>;
    case "save-unknown":
      return <div className={rootClass} role="status">保存できたか確認できていません。現在の回答を確認してから、保存するかを判断してください。</div>;
    case "error":
      return <div className={`${rootClass} r11-qp-error`} role="alert">{view.message}</div>;
    case "completed":
      return <section className={rootClass}><h2>目標を達成しました</h2><ActualProgressText progress={view.progress} /></section>;
    case "forecast":
    case "today-recorded":
      break;
    default:
      throw new TypeError("Invalid forecast presentation.");
  }
  return (
    <section className={rootClass}>
      {view.kind === "today-recorded" ? <p className="r11-qp-notice">今日は記録済みです。</p> : view.core.kind === "insufficient" ?
        <section>
          <h2>見通しの材料が不足しています</h2>
          <p>{view.core.message ?? "見通しを出すための材料がまだ足りません。"}</p>
        </section> :
        <section>
          <h2>ゴールが遠ざかる日数（目安）</h2>
          <p className="r11-qp-value">約{view.core.days}日</p>
          <p><span className="r11-qp-source">{sourceLabel(view.core.source)}</span> {sourceNote(view.core.source)}</p>
        </section>}
      <ActualProgressText progress={view.progress} />
      <div className="r11-qp-aux"><ResumeRecords counts={view.resumed} /><Completion completion={view.completion} /></div>
    </section>
  );
}
