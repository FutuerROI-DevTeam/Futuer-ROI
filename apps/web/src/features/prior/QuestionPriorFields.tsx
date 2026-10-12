// LOCAL REACT CANDIDATE. Controlled input only; the FE owns draft and persistence.
import { useId } from "react";
import type { Answer, Origin, QuestionPriorFieldsProps } from "./presentation-types";

const options: readonly Readonly<{ value: Answer; label: string }>[] = [
  { value: "LOW", label: "少なかった（4回に1回くらい）" },
  { value: "MID", label: "半分くらい（4回に2回くらい）" },
  { value: "HIGH", label: "多かった（ほぼ毎回・毎回も含む）" },
  { value: "UNKNOWN", label: "経験がない・思い出せない" },
  { value: null, label: "回答しない" },
];
const questions: Readonly<Record<Origin, string>> = {
  a: "取り組めた日の翌日も、続けて取り組むことはどのくらいありましたか？",
  b: "休みをとった日の翌日に、また取り組むことはどのくらいありましたか？",
};
const origins: readonly Origin[] = ["a", "b"];

export function QuestionPriorFields({
  value,
  onChange,
  disabled = false,
  fieldErrors = {},
  className,
  externalHeadingId,
  chosen,
  onChoose,
}: QuestionPriorFieldsProps) {
  if (externalHeadingId !== undefined && (typeof externalHeadingId !== "string" || !/^\S+$/.test(externalHeadingId))) {
    throw new TypeError("externalHeadingId must identify one existing visible heading.");
  }
  // A stable per-instance prefix also separates two copies for the same Goal.
  const id = useId();
  const helpId = `${id}-help`;
  const unansweredId = `${id}-unanswered`;
  return (
    <section className={["r11-qp", className].filter(Boolean).join(" ")} aria-labelledby={externalHeadingId ?? `${id}-title`}>
      {externalHeadingId === undefined && <h2 id={`${id}-title`}>最初の見通しを調整する（必須）</h2>}
      <p id={helpId}>記録開始前の、今回に近い行動・量・生活状況を思い出して選んでください。これからの意欲や理想ではなく、過去の取り組み方を答えてください。少量でも取り組めた日を含みます。2問とも、どれか1つを選んでください。答えにくいときは「経験がない・思い出せない」か「回答しない」を選べます。</p>
      <p id={unansweredId}>「経験がない・思い出せない」はその回答を保存します。「回答しない」は回答を保存せずに進む選択です。どちらも、その質問の回数を見通しの材料には使いません。</p>
      {origins.map(origin => {
        const error = fieldErrors[origin];
        const errorId = `${id}-${origin}-error`;
        return (
          <fieldset key={origin} disabled={disabled} aria-describedby={error ? `${helpId} ${unansweredId} ${errorId}` : `${helpId} ${unansweredId}`}>
            <legend>{questions[origin]}</legend>
            {options.map(option => {
              const raw = option.value ?? "";
              const inputId = `${id}-${origin}-${raw || "missing"}`;
              return (
                <label key={raw || "missing"} className="r11-qp-option" htmlFor={inputId}>
                  <input id={inputId} name={`${id}-${origin}`} type="radio" value={raw}
                    checked={(chosen?.[origin] ?? true) && value[origin] === option.value}
                    aria-describedby={error ? errorId : undefined}
                    aria-invalid={error ? true : undefined}
                    onChange={() => {
                      if (disabled) return;
                      onChoose?.(origin);
                      onChange({ ...value, [origin]: option.value });
                    }} />
                  {option.label}
                </label>
              );
            })}
            {error && <p className="r11-qp-error" id={errorId} role="alert">{error}</p>}
          </fieldset>
        );
      })}
    </section>
  );
}
