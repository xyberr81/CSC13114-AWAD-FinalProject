// PA#3: the TA's review: GET /v1/labs/{labId}/review-queue (FAQ-09, FAQ-10) and
// GET /v1/submissions/{submissionId}/review. Contract pa3-api.md §6. Verdicts are visible here and nowhere else.
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { createAccess } from '../access.js';
import { labConstraints, submissions, users, verdicts, type EvidenceLine } from '../db/schema.js';
import { ProblemError, type ProblemFieldError } from '../problem.js';
import { responses } from '../schemas.js';
import type { RouteDeps } from './deps.js';

const MAX_PAGE = 2_147_483_647;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

interface QueueRoute {
  Querystring: { page?: string; pageSize?: string };
}

const verdictFields = {
  constraint: {
    type: 'object',
    properties: {
      code: { type: 'string' },
      text: { type: 'string' },
      deduction: { type: 'integer' },
    },
  },
  verdict: { type: 'string' },
  evidence: {
    type: 'array',
    items: {
      type: 'object',
      properties: { line: { type: 'integer' }, text: { type: 'string' } },
    },
  },
  source: { type: 'string' },
  unsureReason: { type: 'string', nullable: true },
} as const;

const studentSchema = {
  type: 'object',
  properties: { id: { type: 'integer' }, email: { type: 'string' } },
} as const;

const queueSchema = {
  type: 'object',
  properties: {
    provisional: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          submissionId: { type: 'integer' },
          student: studentSchema,
          submittedAt: { type: 'string' },
          ...verdictFields,
        },
      },
    },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
    total: { type: 'integer' },
  },
} as const;

const reviewSchema = {
  type: 'object',
  properties: {
    submissionId: { type: 'integer' },
    labId: { type: 'integer' },
    student: studentSchema,
    submittedAt: { type: 'string' },
    status: { type: 'string' },
    code: { type: 'string' },
    verdicts: { type: 'array', items: { type: 'object', properties: verdictFields } },
  },
} as const;

/** `fallback` if absent, the number if it is digits from 1 to `max` (leading zeros allowed), else null. */
function readDigits(raw: string | undefined, fallback: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) return null;
  const digits = raw.replace(/^0+/, '');
  // Compare the length first: Number() of a long digit string loses digits, never errors.
  if (digits.length === 0 || digits.length > String(max).length) return null;
  const n = Number(digits);
  return n <= max ? n : null;
}

/** Check 5 of §1 for the query: both parameters are checked, and every bad one is listed. */
function readPaging(query: QueueRoute['Querystring']) {
  const page = readDigits(query.page, 1, MAX_PAGE);
  const pageSize = readDigits(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const errors: ProblemFieldError[] = [];
  if (page === null) {
    errors.push({
      parameter: 'page',
      detail: `must be an integer from 1 to ${MAX_PAGE}, in digits`,
    });
  }
  if (pageSize === null) {
    errors.push({
      parameter: 'pageSize',
      detail: `must be an integer from 1 to ${MAX_PAGE_SIZE}, in digits`,
    });
  }
  if (page === null || pageSize === null) {
    const n = errors.length;
    throw new ProblemError(
      'validation',
      `${n} ${n === 1 ? 'parameter is' : 'parameters are'} invalid`,
      errors,
    );
  }
  return { page, pageSize };
}

interface QueueRow extends Record<string, unknown> {
  total: number;
  submission_id: number | null;
  student_id: number;
  student_email: string;
  submitted_ms: string;
  code: string;
  text: string;
  deduction: number;
  verdict: string;
  evidence: EvidenceLine[];
  source: string;
  unsure_reason: string | null;
}

export const reviewQueueRoutes: FastifyPluginCallback<RouteDeps> = (app, deps, done) => {
  const { db } = deps;
  const access = createAccess(deps);

  const labTa = access.guard(['ta'], (caller, params) => access.labOf(caller, params.labId));
  const submissionTa = access.guard(['ta'], (caller, params) =>
    access.submissionOf(caller, params.submissionId),
  );

  app.get<QueueRoute>(
    '/labs/:labId/review-queue',
    {
      onRequest: labTa.onRequest,
      schema: {
        // Only for the documentation and the type of the values: they are read by hand, so that a
        // bad value of either parameter is reported together with a bad value of the other.
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'string', description: 'An integer from 1, in digits. Default 1.' },
            pageSize: {
              type: 'string',
              description: `An integer from 1 to ${MAX_PAGE_SIZE}, in digits. Default ${DEFAULT_PAGE_SIZE}.`,
            },
          },
        },
        response: responses({ 200: queueSchema }),
      },
    },
    async (request) => {
      const { target: lab } = labTa.of(request);
      const { page, pageSize } = readPaging(request.query);
      const offset = (page - 1) * pageSize; // at most about 2e11: too big for int4, fine for bigint

      // One statement, so `total` and the page come from the same snapshot. Items are the
      // verdicts of each student's counted (latest) submission: every violation and unsure, and
      // the first ceil(10%) of the passes in the order of a hash of the two ids.
      const { rows } = await db.execute<QueueRow>(sql`
        with counted as (
          select distinct on (s.student_id) s.id, s.student_id, s.created_at
          from ${submissions} s
          where s.lab_id = ${lab.id}
          order by s.student_id, s.created_at desc, s.id desc
        ),
        passes as (
          select v.id,
                 row_number() over (order by md5(v.submission_id || ':' || v.constraint_id), v.id) as rank,
                 count(*) over () as total
          from ${verdicts} v
          join counted c on c.id = v.submission_id
          where v.verdict = 'pass'
        ),
        chosen as (
          select v.id
          from ${verdicts} v
          join counted c on c.id = v.submission_id
          where v.verdict in ('violation', 'unsure')
          union all
          select id from passes where rank <= (total + 9) / 10
        ),
        items as (
          select v.submission_id, v.constraint_id, c.student_id, u.email as student_email,
                 floor(extract(epoch from c.created_at) * 1000)::bigint as submitted_ms,
                 lc.code, lc.text, lc.deduction,
                 v.verdict, v.evidence, v.source, v.unsure_reason
          from chosen
          join ${verdicts} v on v.id = chosen.id
          join counted c on c.id = v.submission_id
          join ${users} u on u.id = c.student_id
          join ${labConstraints} lc on lc.id = v.constraint_id
        )
        select (select count(*) from items)::int as total, page.*
        from (select 1) as one
        left join (
          select * from items order by submission_id, constraint_id
          limit ${pageSize} offset ${offset}::bigint
        ) page on true
        order by page.submission_id, page.constraint_id
      `);

      return {
        provisional: Date.now() <= lab.deadline.getTime(),
        items: rows.flatMap((r) =>
          r.submission_id === null
            ? []
            : [
                {
                  submissionId: r.submission_id,
                  student: { id: r.student_id, email: r.student_email },
                  submittedAt: new Date(Number(r.submitted_ms)).toISOString(),
                  constraint: { code: r.code, text: r.text, deduction: r.deduction },
                  verdict: r.verdict,
                  evidence: r.evidence,
                  source: r.source,
                  unsureReason: r.unsure_reason,
                },
              ],
        ),
        page,
        pageSize,
        total: rows[0]?.total ?? 0,
      };
    },
  );

  app.get(
    '/submissions/:submissionId/review',
    {
      onRequest: submissionTa.onRequest,
      schema: { response: responses({ 200: reviewSchema }) },
    },
    async (request) => {
      const { target: submission } = submissionTa.of(request);
      const rows = await db
        .select({
          code: labConstraints.code,
          text: labConstraints.text,
          deduction: labConstraints.deduction,
          verdict: verdicts.verdict,
          evidence: verdicts.evidence,
          source: verdicts.source,
          unsureReason: verdicts.unsureReason,
        })
        .from(verdicts)
        .innerJoin(labConstraints, eq(labConstraints.id, verdicts.constraintId))
        .where(eq(verdicts.submissionId, submission.id))
        .orderBy(asc(verdicts.constraintId));
      return {
        submissionId: submission.id,
        labId: submission.labId,
        student: { id: submission.studentId, email: submission.studentEmail },
        submittedAt: submission.createdAt.toISOString(),
        status: submission.status,
        code: submission.code,
        verdicts: rows.map(({ code, text, deduction, ...rest }) => ({
          constraint: { code, text, deduction },
          ...rest,
        })),
      };
    },
  );

  done();
};
