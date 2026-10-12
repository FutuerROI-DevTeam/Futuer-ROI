import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { ErrorBody, GoalParams } from '../contracts/index.ts';
import {
  MilestoneArtifact, MilestoneCapture, MilestoneFitRequest, MilestoneForecast,
  MilestoneJoin, MilestonePolicy, MilestonePreview, MilestonePreviewQuery,
  MilestoneReport, MilestoneWithdraw,
} from '../contracts/milestone.ts';
import { errorBody } from '../http/errors.ts';
import { requireUserId } from '../http/guards.ts';
import { milestonePolicy, type MilestoneOptions } from './policy.ts';
import { captureMilestone, fitMilestone, joinMilestone, MilestoneConflict, milestoneReport, previewMilestone, withdrawMilestone } from './store.ts';

export async function registerMilestoneRoutes(
  app: FastifyInstance,
  deps: { pool: Pool; now: () => Date; options?: MilestoneOptions | undefined },
) {
  const policy = milestonePolicy(deps.options);
  await app.register(async instance => {
    requireUserId(instance);
    const api = instance.withTypeProvider<TypeBoxTypeProvider>();
    api.get('/api/milestone-calibration', { schema: { response: { 200: MilestonePolicy } } }, async () => policy);
    if (!policy.enabled) return;
    // Keep the legacy upper/lowercase Goal UUID allowance; scope comparisons use canonical UUIDs.
    const base = '/api/goals/:goalId/milestone-calibration', build = deps.options!.buildVersion;
    const missing = errorBody('NOT_FOUND', 'Goal not found.');
    instance.setErrorHandler((error, _request, reply) => {
      if (error instanceof MilestoneConflict) return reply.code(409).send(errorBody(error.code, error.message));
      // 親のvalidation/認証/DBエラー変換を保持する。
      throw error;
    });
    api.get(base, { schema: { params: GoalParams, response: { 200: MilestoneReport, 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) =>
      await milestoneReport(deps.pool, request.userId, request.params.goalId.toLowerCase(), deps.now, build) ?? reply.code(404).send(missing));
    api.put(`${base}/participation`, { schema: { params: GoalParams, body: MilestoneJoin, response: { 204: Type.Null(), 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
      const result = await joinMilestone(
        deps.pool, request.userId, request.params.goalId.toLowerCase(),
        request.body.expectedGoalSettingsRevision, request.body.expectedConsentRevision,
        deps.now, build,
      );
      return result ? reply.code(204).send(null) : reply.code(404).send(missing);
    });
    api.delete(`${base}/participation`, { schema: { params: GoalParams, body: MilestoneWithdraw, response: { 204: Type.Null(), 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
      const result = await withdrawMilestone(
        deps.pool, request.userId, request.params.goalId.toLowerCase(),
        request.body.expectedParticipationId, deps.now, build,
      );
      return result ? reply.code(204).send(null) : reply.code(404).send(missing);
    });
    api.post(`${base}/forecasts`, { schema: { params: GoalParams, body: MilestoneCapture,
      response: { 200: MilestoneForecast, 201: MilestoneForecast, 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) => {
      const result = await captureMilestone(deps.pool, request.userId, request.params.goalId.toLowerCase(), request.body, deps.now, build);
      return result ? reply.code(result.replayed ? 200 : 201).send(result.forecast) : reply.code(404).send(missing);
    });
    api.post(`${base}/fits`, { schema: { params: GoalParams, body: MilestoneFitRequest, response: { 200: MilestoneArtifact, 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) =>
      await fitMilestone(deps.pool, request.userId, request.params.goalId.toLowerCase(), request.body, deps.now, build) ?? reply.code(404).send(missing));
    api.get(`${base}/compare`, { schema: { params: GoalParams, querystring: MilestonePreviewQuery, response: { 200: MilestonePreview, 404: ErrorBody, 409: ErrorBody } } }, async (request, reply) =>
      await previewMilestone(
        deps.pool, request.userId, request.params.goalId.toLowerCase(),
        request.query.artifactId, request.query.artifactHash, deps.now, build,
      ) ?? reply.code(404).send(missing));
  });
}
