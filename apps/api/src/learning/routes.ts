import { Type } from '@sinclair/typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { requireUserId } from '../http/guards.ts';
import { GoalParams } from '../contracts/goal.ts';
import { LearningActivate, LearningArtifactSummary, LearningCompareQuery, LearningComparison, LearningFit, LearningParticipation, LearningPolicy,
  LearningReport, LearningRollback, LearningTodayQuery, LearningWithdraw, TodayLearning } from '../contracts/learning.ts';
import { ErrorBody } from '../contracts/index.ts';
import { errorBody } from '../http/errors.ts';
import { learningPolicy, type LearningOptions } from './policy.ts';
import { activateLearning, fitLearning, fitLearningExperiment, joinLearning, learningCompare, LearningConflict, learningReport, learningToday, rollbackLearning, withdrawLearning } from './store.ts';

export async function registerLearningRoutes(app: FastifyInstance, deps: { pool: Pool; now: () => Date; options?: LearningOptions | undefined }) {
  const policy = learningPolicy(deps.options);
  await app.register(async instance => {
    requireUserId(instance);
    const api = instance.withTypeProvider<TypeBoxTypeProvider>();
    api.get('/api/learning', { schema: { response: { 200: LearningPolicy } } }, async () => policy);
    // No learning-table reads or mutations are registered while disabled.
    if (!policy.enabled) return;
    const path = '/api/goals/:goalId/learning';
    const missing = errorBody('NOT_FOUND', 'Goal not found.');
    api.get(path, { schema: { params: GoalParams, response: { 200: LearningReport, 404: ErrorBody } } }, async (request, reply) => {
      const result = await learningReport(deps.pool, request.userId, request.params.goalId, deps.now, policy);
      return result ?? reply.code(404).send(missing);
    });
    api.get(`${path}/today`, { schema: { params: GoalParams, querystring: LearningTodayQuery,
      response: { 200: TodayLearning, 404: ErrorBody, 422: ErrorBody } } }, async (request, reply) => {
      const amount = request.query.amount === undefined ? undefined : Number(request.query.amount);
      if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647)) {
        return reply.code(422).send(errorBody('VALIDATION_ERROR', 'Request does not match the contract.',
          [{ path: 'querystring/amount', message: 'must be an integer between 0 and 2147483647' }]));
      }
      const result = await learningToday(deps.pool, request.userId, request.params.goalId, deps.now, policy, amount);
      return result ?? reply.code(404).send(missing);
    });
    api.get(`${path}/compare`, { schema: { params: GoalParams, querystring: LearningCompareQuery,
      response: { 200: LearningComparison, 404: ErrorBody, 409: ErrorBody, 422: ErrorBody } } }, async (request, reply) => {
      const amount = request.query.amount === undefined ? undefined : Number(request.query.amount);
      if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647)) {
        return reply.code(422).send(errorBody('VALIDATION_ERROR', 'Request does not match the contract.',
          [{ path: 'querystring/amount', message: 'must be an integer between 0 and 2147483647' }]));
      }
      try {
        const result = await learningCompare(deps.pool, request.userId, request.params.goalId,
          request.query.artifactId, request.query.artifactHash, deps.now, policy, amount);
        return result ?? reply.code(404).send(missing);
      } catch (error) { if (error instanceof LearningConflict) return reply.code(409).send(errorBody(error.code, error.message)); throw error; }
    });
    const mutationResponses = { 204: Type.Null(), 404: ErrorBody, 409: ErrorBody };
    api.put(`${path}/participation`, { schema: { params: GoalParams, body: LearningParticipation, response: mutationResponses } }, async (request, reply) => {
      try {
        const result = await joinLearning(deps.pool, request.userId, request.params.goalId, deps.now, policy);
        return result ? reply.code(204).send(null) : reply.code(404).send(missing);
      } catch (error) { if (error instanceof LearningConflict) return reply.code(409).send(errorBody(error.code, error.message)); throw error; }
    });
    api.delete(`${path}/participation`, { schema: { params: GoalParams, body: LearningWithdraw, response: mutationResponses } }, async (request, reply) => {
      try {
        const result = await withdrawLearning(deps.pool, request.userId, request.params.goalId, request.body, deps.now, policy);
        return result ? reply.code(204).send(null) : reply.code(404).send(missing);
      } catch (error) { if (error instanceof LearningConflict) return reply.code(409).send(errorBody(error.code, error.message)); throw error; }
    });
    api.post(`${path}/fits`, { schema: { params: GoalParams, body: LearningFit,
      response: { 201: LearningArtifactSummary, 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
      try {
        const result = await fitLearning(deps.pool, request.userId, request.params.goalId, request.body, deps.now, policy);
        return result ? reply.code(201).send(result) : reply.code(404).send(missing);
      } catch (error) { if (error instanceof LearningConflict) return reply.code(409).send(errorBody(error.code, error.message)); throw error; }
    });
    api.post(`${path}/experiments`, { schema: { params: GoalParams, body: LearningFit,
      response: { 201: LearningArtifactSummary, 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
      try {
        const result = await fitLearningExperiment(deps.pool, request.userId, request.params.goalId, request.body, deps.now, policy);
        return result ? reply.code(201).send(result) : reply.code(404).send(missing);
      } catch (error) { if (error instanceof LearningConflict) return reply.code(409).send(errorBody(error.code, error.message)); throw error; }
    });
    api.put(`${path}/active`, { schema: { params: GoalParams, body: LearningActivate, response: mutationResponses } }, async (request, reply) => {
      try {
        const result = await activateLearning(deps.pool, request.userId, request.params.goalId, request.body, deps.now, policy);
        return result ? reply.code(204).send(null) : reply.code(404).send(missing);
      } catch (error) { if (error instanceof LearningConflict) return reply.code(409).send(errorBody(error.code, error.message)); throw error; }
    });
    api.delete(`${path}/active`, { schema: { params: GoalParams, body: LearningRollback, response: mutationResponses } }, async (request, reply) => {
      try {
        const result = await rollbackLearning(deps.pool, request.userId, request.params.goalId, request.body, deps.now, policy);
        return result ? reply.code(204).send(null) : reply.code(404).send(missing);
      } catch (error) { if (error instanceof LearningConflict) return reply.code(409).send(errorBody(error.code, error.message)); throw error; }
    });
  });
}
