// Supporting Artifact / Not a Source of Truth. No adopted API/Engine DTO or props.
export type Answer = "LOW" | "MID" | "HIGH" | "UNKNOWN" | null;
export type Origin = "a" | "b";
export type Answers = Readonly<Record<Origin, Answer>>;
export type Source = "NONE" | "QUESTION" | "QUESTION_AND_RECORDS" | "RECORDS";
export type SufficientSource = Exclude<Source, "NONE">;
export type Unit = "minutes" | "sessions";
export interface ActualProgress {
  readonly done: number;
  readonly total: number;
  readonly unit: Unit;
}
export interface Counts {
  readonly success: number;
  readonly total: number;
}
export interface Plan {
  readonly remainingAmount: number;
  readonly sessions: number;
  readonly sessionAmount: number;
  readonly lastAmount: number;
  readonly unit: Unit;
}
export type CorePresentation =
  | { readonly kind: "insufficient"; readonly message?: string }
  | { readonly kind: "estimate"; readonly days: number; readonly source: SufficientSource };
export type CompletionPresentation =
  | { readonly kind: "insufficient"; readonly message: string }
  | { readonly kind: "conditional"; readonly plan: Plan; readonly reason: string }
  | {
      readonly kind: "estimate";
      readonly scenario: "TODAY_DONE" | "CURRENT_STATE";
      readonly sources: Readonly<Record<Origin, SufficientSource>>;
      // Keep Engine days for display geometry; never parse them from formatted week labels.
      readonly p50Days: number | null;
      readonly p80Days: number | null;
      readonly p50Label: string | null;
      readonly p80Label: string | null;
    };
export type CurrentStateCompletionPresentation =
  | Extract<CompletionPresentation, { kind: "conditional" | "insufficient" }>
  | (Omit<Extract<CompletionPresentation, { kind: "estimate" }>, "scenario"> & { readonly scenario: "CURRENT_STATE" });
export type ForecastPresentation =
  | { readonly kind: "loading" | "saved-refresh-failed" | "save-unknown" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "completed"; readonly progress: ActualProgress }
  | {
      readonly kind: "forecast";
      readonly progress: ActualProgress;
      readonly core: CorePresentation;
      readonly resumed: Counts;
      readonly completion: CompletionPresentation;
    }
  | {
      readonly kind: "today-recorded";
      readonly progress: ActualProgress;
      readonly resumed: Counts;
      readonly completion: CurrentStateCompletionPresentation;
    };
export interface QuestionPriorFieldsProps {
  readonly value: Answers;
  readonly onChange: (next: Answers) => void;
  readonly disabled?: boolean;
  readonly fieldErrors?: Readonly<Partial<Record<Origin, string>>>;
  // Optional (#259): an origin with false shows no option checked, even when its value is null.
  readonly chosen?: Readonly<Record<Origin, boolean>>;
  readonly onChoose?: (origin: Origin) => void;
  readonly className?: string;
  // Parent must render this visible heading. Its presence suppresses only the internal h2.
  readonly externalHeadingId?: string;
}
export interface PriorForecastProps { readonly view: ForecastPresentation; readonly className?: string }
// Example FE-owned state, never a mutation implementation.
export type SavePresentation =
  | { readonly kind: "idle" | "saving" | "saved" | "saved-refresh-failed" | "save-unknown" }
  | { readonly kind: "failed"; readonly message: string };
