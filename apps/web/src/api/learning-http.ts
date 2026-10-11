import { LearningPolicy, LearningReport, LearningArtifactSummary, TodayLearning, LearningComparison } from '@contracts';
import type { LearningParticipation, LearningFit, LearningActivate, LearningRollback, LearningWithdraw } from '@contracts';
import { requestJson, requestNoContent } from './http.ts';
import { goalKeys } from './goals-http.ts';
const base = (id: string) => `/api/goals/${encodeURIComponent(id)}/learning`;
export const learningKeys = {
  capability: () => [...goalKeys.all, 'learning', 'capability'] as const,
  report: (id: string) => [...goalKeys.all, 'learning', id, 'report'] as const,
  today: (id: string) => [...goalKeys.all, 'learning', id, 'today'] as const,
  confirmation: (id: string) => [...goalKeys.all, 'learning', id, 'confirmation'] as const,
};
export const learningHttp = {
  capability: (signal?: AbortSignal) => requestJson(LearningPolicy, '/api/learning', { signal }),
  report: (id: string, signal?: AbortSignal) => requestJson(LearningReport, base(id), { signal }),
  participate: (id: string, body: LearningParticipation, signal?: AbortSignal) => requestNoContent(`${base(id)}/participation`, { method: 'PUT', body, signal }),
  withdraw: (id: string, body: LearningWithdraw, signal?: AbortSignal) => requestNoContent(`${base(id)}/participation`, { method: 'DELETE', body, signal }),
  fit: (id: string, body: LearningFit, signal?: AbortSignal) => requestJson(LearningArtifactSummary, `${base(id)}/fits`, { method: 'POST', body, signal }),
  experiment: (id: string, body: LearningFit, signal?: AbortSignal) => requestJson(LearningArtifactSummary, `${base(id)}/experiments`, { method: 'POST', body, signal }),
  compare: (id: string, artifactId: string, artifactHash: string, amount: number, signal?: AbortSignal) => requestJson(LearningComparison,
    `${base(id)}/compare?${new URLSearchParams({ artifactId, artifactHash, amount: String(amount) })}`, { signal }),
  activate: (id: string, body: LearningActivate, signal?: AbortSignal) => requestNoContent(`${base(id)}/active`, { method: 'PUT', body, signal }),
  rollback: (id: string, body: LearningRollback, signal?: AbortSignal) => requestNoContent(`${base(id)}/active`, { method: 'DELETE', body, signal }),
  today: (id: string, amount?: number, signal?: AbortSignal) => requestJson(TodayLearning,
    `${base(id)}/today${amount === undefined ? '' : `?amount=${amount}`}`, { signal }),
};
