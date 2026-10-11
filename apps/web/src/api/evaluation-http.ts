import { EvaluationPolicy, EvaluationReport, EvaluationForecast } from '@contracts';
import type { EvaluationParticipation, EvaluationCapture } from '@contracts';
import { requestJson, requestNoContent } from './http.ts';
import { goalKeys } from './goals-http.ts';

const path = (goalId: string) => `/api/goals/${encodeURIComponent(goalId)}/evaluation`;
export const evaluationKeys = {
  capability: () => [...goalKeys.all, 'evaluation', 'capability'] as const,
  report: (goalId: string) => [...goalKeys.all, 'evaluation', goalId] as const,
};
export const evaluationHttp = {
  capability: (signal?: AbortSignal) => requestJson(EvaluationPolicy, '/api/evaluation', { signal }),
  report: (goalId: string, signal?: AbortSignal) => requestJson(EvaluationReport, path(goalId), { signal }),
  participate: (goalId: string, body: EvaluationParticipation, signal?: AbortSignal) =>
    requestNoContent(`${path(goalId)}/participation`, { method: 'PUT', body, signal }),
  withdraw: (goalId: string, signal?: AbortSignal) =>
    requestNoContent(`${path(goalId)}/participation`, { method: 'DELETE', signal }),
  capture: (goalId: string, body: EvaluationCapture, signal?: AbortSignal) =>
    requestJson(EvaluationForecast, `${path(goalId)}/forecasts`, { method: 'POST', body, signal }),
};
