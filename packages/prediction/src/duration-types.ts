import type { Posterior } from './types.js';

/** Already-owned canonical logs only: missing days are not SKIPPED. */
export interface DurationTransition {
  readonly from: 'DONE' | 'SKIPPED';
  readonly to: 'DONE' | 'SKIPPED';
  readonly restDays: number | null;
  readonly originDate: string;
  readonly outcomeDate: string;
}
export interface DurationPrior { readonly a: { readonly alpha: number; readonly beta: number }; readonly b: { readonly alpha: number; readonly beta: number } }
export interface GammaAtom { readonly gamma: number; readonly mass: number }
export interface DurationFitOptions { readonly capDays: number; readonly gammaPrior: readonly GammaAtom[]; readonly tolerance?: number }
export interface DurationJointNode { readonly pDoneAfterSkip: number; readonly gamma: number; readonly weight: number }
export interface DurationTrainingDiagnostics { readonly doneOrigins: number; readonly skipOrigins: number; readonly excludedUnknownDuration: number }
export interface DurationIntegrationDiagnostics {
  readonly order: number;
  readonly converged: boolean;
  readonly maxDifference: number;
  readonly logEvidence: number;
  readonly checks?: readonly { readonly order: 16 | 32; readonly joint: readonly DurationJointNode[] }[];
  readonly tolerance?: number;
  readonly maxObservedDifference?: number;
}
export type DurationArtifact =
  | { readonly kind: 'BETA_BASELINE_V1'; readonly modelVersion: string; readonly capDays: number;
      readonly posterior: Posterior; readonly training: DurationTrainingDiagnostics }
  | { readonly kind: 'DURATION_JOINT_V1'; readonly modelVersion: string; readonly capDays: number;
      readonly donePosterior: { readonly alpha: number; readonly beta: number };
      readonly skipReferencePosterior: { readonly alpha: number; readonly beta: number };
      readonly joint: readonly DurationJointNode[]; readonly gammaPrior: readonly GammaAtom[];
      readonly training: DurationTrainingDiagnostics; readonly integration: DurationIntegrationDiagnostics };
export type DurationFitResult = { readonly status: 'available'; readonly artifact: DurationArtifact }
  | { readonly status: 'insufficient'; readonly reason: 'NO_DONE_ORIGIN_TRANSITION' | 'NO_SKIP_ORIGIN_TRANSITION' | 'NUMERICAL_INSUFFICIENCY'; readonly training: DurationTrainingDiagnostics };
export interface DurationForecastInput {
  readonly initialState: 'DONE' | 'SKIPPED'; readonly initialRestDays: number | null;
  readonly remainingAmount: number; readonly sessionAmount: number;
  readonly horizonDays: number; readonly samples: number; readonly seed: number;
}
export type DurationForecastResult = {
  readonly status: 'available'; readonly cdf: readonly number[];
  readonly p50Days: number | null; readonly p80Days: number | null;
  readonly computation: { readonly method: 'EXACT_BETA' | 'POSTERIOR_PATHS' | 'POSTERIOR_QUADRATURE'; readonly samples: number | null; readonly seed: number | null };
} | { readonly status: 'insufficient'; readonly reason: 'UNKNOWN_CURRENT_DURATION' | 'NUMERICAL_INSUFFICIENCY' };
/** Implementation owner: duration-model.ts. No log/DB/clock access in that module. */
export type FitDurationModel = (transitions: readonly DurationTransition[], prior: DurationPrior, options: DurationFitOptions) => DurationFitResult;
export type ForecastDurationModel = (artifact: DurationArtifact, input: DurationForecastInput) => DurationForecastResult;
