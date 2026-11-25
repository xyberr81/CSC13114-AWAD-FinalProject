// PA#3: a student views their submission: status and per-test results, no test data (FAQ-02), no constraint verdicts (FAQ-08).
// Contract pa3-api.md §5.1. The response schema lists the only fields a student may see.
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { createAccess } from '../access.js';
import { labTests, submissionTestResults } from '../db/schema.js';
import { responses } from '../schemas.js';
import type { RouteDeps } from './deps.js';

const submissionResultSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    labId: { type: 'integer' },
    language: { type: 'string' },
    status: { type: 'string' },
    createdAt: { type: 'string' },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          position: { type: 'integer' },
          status: { type: 'string' },
          timeMs: { type: 'integer', nullable: true },
          memoryKb: { type: 'integer', nullable: true },
        },
      },
    },
  },
} as const;

export const submissionResultRoutes: FastifyPluginCallback<RouteDeps> = (app, deps, done) => {
  const { db } = deps;
  const access = createAccess(deps);

  const ownSubmission = access.guard(['student'], (caller, params) =>
    access.submissionOf(caller, params.submissionId),
  );

  app.get(
    '/submissions/:submissionId',
    {
      onRequest: ownSubmission.onRequest,
      schema: { response: responses({ 200: submissionResultSchema }) },
    },
    async (request) => {
      const { target: submission } = ownSubmission.of(request);
      const tests = await db
        .select({
          position: labTests.position,
          status: submissionTestResults.status,
          timeMs: submissionTestResults.timeMs,
          memoryKb: submissionTestResults.memoryKb,
        })
        .from(submissionTestResults)
        .innerJoin(labTests, eq(labTests.id, submissionTestResults.testId))
        .where(eq(submissionTestResults.submissionId, submission.id))
        .orderBy(asc(labTests.position));
      return {
        id: submission.id,
        labId: submission.labId,
        language: submission.language,
        status: submission.status,
        createdAt: submission.createdAt.toISOString(),
        tests,
      };
    },
  );

  done();
};
