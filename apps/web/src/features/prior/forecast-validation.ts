import type {
  ActualProgress,
  Counts,
  SufficientSource,
  CompletionPresentation,
  ForecastPresentation,
} from './presentation-types.ts';

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid presentation object.");
  }
}

function finite(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum;
}

function integer(value: unknown, minimum: number): value is number {
  return finite(value, minimum) && Number.isSafeInteger(value);
}

function assertSource(source: unknown): asserts source is SufficientSource {
  if (source !== "QUESTION" && source !== "QUESTION_AND_RECORDS" && source !== "RECORDS") {
    throw new TypeError("A displayed estimate needs resolved provenance.");
  }
}

function assertProgress(progress: unknown, completed: boolean): asserts progress is ActualProgress {
  assertObject(progress);
  if (!finite(progress.done, 0) || !finite(progress.total, 0) || progress.total <= 0
    || (progress.unit !== "minutes" && progress.unit !== "sessions")) {
    throw new TypeError("Invalid actual progress.");
  }
  // R-02 preserves accumulated actual amount; R-08 permits overrun only in completed.
  if ((progress.done >= progress.total) !== completed) {
    throw new TypeError("Actual progress must match the resolved completion state.");
  }
}

function assertCounts(counts: unknown): asserts counts is Counts {
  assertObject(counts);
  if (!integer(counts.success, 0) || !integer(counts.total, 0) || counts.total < counts.success) {
    throw new TypeError("Invalid observed counts.");
  }
}

function assertCompletion(completion: unknown): asserts completion is CompletionPresentation {
  assertObject(completion);
  if (completion.kind === "insufficient") {
    if (typeof completion.message !== "string" || !completion.message.trim()) {
      throw new TypeError("Insufficient completion needs resolved text.");
    }
    return;
  }
  if (completion.kind === "conditional") {
    const p = completion.plan;
    assertObject(p);
    if (!integer(p.sessions, 1)
      || !finite(p.remainingAmount, 0) || p.remainingAmount <= 0
      || !finite(p.sessionAmount, 0) || p.sessionAmount <= 0
      || !finite(p.lastAmount, 0) || p.lastAmount <= 0 || p.lastAmount > p.sessionAmount
      || (p.unit !== "minutes" && p.unit !== "sessions")
      || typeof completion.reason !== "string" || !completion.reason.trim()) {
      throw new TypeError("Invalid conditional plan.");
    }
    return;
  }
  if (completion.kind !== "estimate"
    || (completion.scenario !== "TODAY_DONE" && completion.scenario !== "CURRENT_STATE")) {
    throw new TypeError("Invalid completion presentation.");
  }
  assertObject(completion.sources);
  assertSource(completion.sources.a);
  assertSource(completion.sources.b);

  if (!(completion.p50Label === null || typeof completion.p50Label === "string")
    || !(completion.p80Label === null || typeof completion.p80Label === "string")) {
    throw new TypeError("Invalid completion labels.");
  }
  if (!(completion.p50Days === null || integer(completion.p50Days, 0))
    || !(completion.p80Days === null || integer(completion.p80Days, 0))) {
    throw new TypeError("Invalid completion days.");
  }
  if ((completion.p50Label === null) !== (completion.p50Days === null)
    || (completion.p80Label === null) !== (completion.p80Days === null)) {
    throw new TypeError("Completion labels must preserve null horizons.");
  }
  if (completion.p50Days === null && completion.p80Days !== null) {
    throw new TypeError("A finite p80 needs a finite p50.");
  }
  if (completion.p50Days !== null && completion.p80Days !== null
    && completion.p80Days < completion.p50Days) {
    throw new TypeError("Completion quantiles must be ordered.");
  }
}

// Also call this inside the FE prediction Boundary before its B renderer.
// Validates display values only; never resolves eligibility, freshness or API provenance.
export function assertForecastPresentation(view: unknown): asserts view is ForecastPresentation {
  assertObject(view);
  switch (view.kind) {
    case "loading":
    case "saved-refresh-failed":
    case "save-unknown":
      return;
    case "error":
      if (typeof view.message !== "string") {
        throw new TypeError("Invalid forecast error text.");
      }
      return;
    case "completed":
      assertProgress(view.progress, true);
      return;
    case "forecast":
    case "today-recorded":
      break;
    default:
      throw new TypeError("Invalid forecast presentation.");
  }
  assertProgress(view.progress, false);
  assertCounts(view.resumed);
  assertCompletion(view.completion);
  if (view.kind === "forecast") {
    assertObject(view.core);
    if (view.core.kind === "estimate") {
      if (!integer(view.core.days, 1)) {
        throw new TypeError("Invalid core estimate.");
      }
      assertSource(view.core.source);
    } else if (view.core.kind === "insufficient") {
      if (view.core.message !== undefined
        && (typeof view.core.message !== "string" || !view.core.message.trim())) {
        throw new TypeError("Invalid core insufficiency text.");
      }
    } else {
      throw new TypeError("Invalid core presentation.");
    }
  }
  const completion = view.completion;
  if (completion.kind === "estimate" && completion.scenario !== (view.kind === "today-recorded" ? "CURRENT_STATE" : "TODAY_DONE")) {
    throw new TypeError("Completion scenario must match the resolved Today state.");
  }
}
