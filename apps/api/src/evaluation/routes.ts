import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  ErrorBody, GoalParams, EvaluationPolicy, EvaluationReport,
  EvaluationForecast, EvaluationParticipation, EvaluationCapture,
} from '../contracts/index.ts';
import { errorBody } from '../http/errors.ts';
import { requireUserId } from '../http/guards.ts';
import { evaluationPolicy, type EvaluationOptions } from './policy.ts';
import { captureEvaluation, EvaluationConflict, evaluationReport, joinEvaluation, withdrawEvaluation } from './store.ts';

export async function registerEvaluationRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; now: () => Date; options?: EvaluationOptions | undefined },
) {
  const policy = evaluationPolicy(deps.options);
  await app.register(async instance => {
    requireUserId(instance);
    const api = instance.withTypeProvider<TypeBoxTypeProvider>();
    api.get('/api/evaluation', { schema: { response: { 200: EvaluationPolicy } } }, async () => policy);
    // OFFなら新規tableを読むrouteも存在しない。Today/記録への副作用なし。
    if (!policy.enabled) return;
    const path = '/api/goals/:goalId/evaluation';
    const missing = errorBody('NOT_FOUND', 'Goal not found.');
    api.get(path, { schema: { params: GoalParams, response: { 200: EvaluationReport, 404: ErrorBody } } }, async (request, reply) => {
      const result = await evaluationReport(deps.pool, request.userId, request.params.goalId, deps.now, policy);
      return result ?? reply.code(404).send(missing);
    });
    api.put(`${path}/participation`, { schema: { params: GoalParams, body: EvaluationParticipation,
      response: { 204: Type.Null(), 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
      try {
        const result = await joinEvaluation(deps.pool, request.userId, request.params.goalId, deps.now, policy);
        return result ? reply.code(204).send(null) : reply.code(404).send(missing);
      } catch (error) {
        if (error instanceof EvaluationConflict) return reply.code(409).send(errorBody(error.code, error.message));
        throw error;
      }
    });
    api.delete(`${path}/participation`, { schema: { params: GoalParams, response: { 204: Type.Null(), 404: ErrorBody } } }, async (request, reply) => {
      const result = await withdrawEvaluation(deps.pool, request.userId, request.params.goalId, deps.now, policy);
      return result ? reply.code(204).send(null) : reply.code(404).send(missing);
    });
    api.post(`${path}/forecasts`, { schema: { params: GoalParams, body: EvaluationCapture,
      response: { 200: EvaluationForecast, 201: EvaluationForecast, 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
      try {
        const result = await captureEvaluation(
          deps.pool, request.userId, request.params.goalId,
          request.body.expectedGoalSettingsRevision, deps.now, policy, deps.options!.buildVersion,
        );
        return result ? reply.code(result.replayed ? 200 : 201).send(result.forecast) : reply.code(404).send(missing);
      } catch (error) {
        if (error instanceof EvaluationConflict) return reply.code(409).send(errorBody(error.code, error.message));
        throw error;
      }
    });
  });
}
