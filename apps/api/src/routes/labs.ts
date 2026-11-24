// PA#3: a TA creates a lab (statement, tests, constraints with deductions); a student views it (FAQ-06).
// Contract pa3-api.md §4.
import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import { createAccess } from '../access.js';
import { labConstraints, labTests, labs } from '../db/schema.js';
import { responses, text } from '../schemas.js';
import type { RouteDeps } from './deps.js';

const CREATE_BODY_LIMIT = 8 * 1024 * 1024;

// FAQ-06: what a student is told about the review before they submit.
const REVIEW_NOTICE =
  'Your code will be reviewed by hard rules and by a model. The model gets only the statement, ' +
  'the constraints and your code without comments, names or student IDs. A TA decides every ' +
  'deduction before marks are published.';

interface Constraint {
  code: string;
  text: string;
  deduction: number;
}
interface CreateLabRoute {
  Body: {
    title: string;
    statement: string;
    deadline: string;
    timeLimitMs: number;
    memoryLimitMb: number;
    constraints: Constraint[];
    tests: { input: string; expectedOutput: string }[];
  };
}

const constraintSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    text: { type: 'string' },
    deduction: { type: 'integer' },
  },
} as const;

const labSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    classId: { type: 'integer' },
    title: { type: 'string' },
    statement: { type: 'string' },
    deadline: { type: 'string' },
    timeLimitMs: { type: 'integer' },
    memoryLimitMb: { type: 'integer' },
    constraints: { type: 'array', items: constraintSchema },
    reviewNotice: { type: 'string' },
  },
} as const;

const createLabBody = {
  type: 'object',
  required: ['title', 'statement', 'deadline', 'constraints', 'tests'],
  properties: {
    title: text(1, 200),
    statement: text(1, 65_536),
    deadline: { type: 'string', 'x-instant': true },
    timeLimitMs: { type: 'integer', minimum: 1000, maximum: 5000, default: 1000 },
    memoryLimitMb: { type: 'integer', minimum: 64, maximum: 512, default: 256 },
    constraints: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      'x-unique-code': true,
      items: {
        type: 'object',
        required: ['code', 'text', 'deduction'],
        properties: {
          code: text(1, 20),
          text: text(1, 4000),
          deduction: { type: 'integer', minimum: 0, maximum: 10 },
        },
      },
    },
    tests: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        required: ['input', 'expectedOutput'],
        properties: {
          input: { type: 'string', 'x-text': 'any' },
          expectedOutput: { type: 'string', 'x-text': 'any' },
        },
      },
    },
  },
} as const;

type LabRow = typeof labs.$inferSelect;

function labView(lab: LabRow, constraints: Constraint[]) {
  return {
    id: lab.id,
    classId: lab.classId,
    title: lab.title,
    statement: lab.statement,
    deadline: lab.deadline.toISOString(),
    timeLimitMs: lab.timeLimitMs,
    memoryLimitMb: lab.memoryLimitMb,
    constraints,
    reviewNotice: REVIEW_NOTICE,
  };
}

export const labRoutes: FastifyPluginCallback<RouteDeps> = (app, deps, done) => {
  const { db } = deps;
  const access = createAccess(deps);

  const classTa = access.guard(['ta'], (caller, params) => access.classOf(caller, params.classId));
  const classMember = access.guard(['ta', 'student'], (caller, params) =>
    access.classOf(caller, params.classId),
  );
  const labMember = access.guard(['ta', 'student'], (caller, params) =>
    access.labOf(caller, params.labId),
  );

  app.post<CreateLabRoute>(
    '/classes/:classId/labs',
    {
      onRequest: classTa.onRequest,
      bodyLimit: CREATE_BODY_LIMIT,
      schema: { body: createLabBody, response: responses({ 201: labSchema }) },
    },
    async (request, reply) => {
      const { target: cls } = classTa.of(request);
      const { deadline, constraints, tests, ...fields } = request.body;

      // The lab, its constraints and its tests are stored together or not at all.
      const lab = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(labs)
          .values({ ...fields, classId: cls.id, deadline: new Date(deadline) })
          .returning();
        await tx
          .insert(labConstraints)
          .values(constraints.map((c) => ({ ...c, labId: created!.id })));
        await tx
          .insert(labTests)
          .values(tests.map((t, i) => ({ ...t, labId: created!.id, position: i + 1 })));
        return created!;
      });
      return reply.status(201).send(labView(lab, constraints));
    },
  );

  app.get(
    '/labs/:labId',
    {
      onRequest: labMember.onRequest,
      schema: { response: responses({ 200: labSchema }) },
    },
    async (request) => {
      const { target: lab } = labMember.of(request);
      const constraints = await db
        .select({
          code: labConstraints.code,
          text: labConstraints.text,
          deduction: labConstraints.deduction,
        })
        .from(labConstraints)
        .where(eq(labConstraints.labId, lab.id))
        .orderBy(asc(labConstraints.id));
      return labView(lab, constraints);
    },
  );

  app.get(
    '/classes/:classId/labs',
    {
      onRequest: classMember.onRequest,
      schema: {
        response: responses({
          200: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'integer' },
                    title: { type: 'string' },
                    deadline: { type: 'string' },
                  },
                },
              },
            },
          },
        }),
      },
    },
    async (request) => {
      const { target: cls } = classMember.of(request);
      const rows = await db
        .select({ id: labs.id, title: labs.title, deadline: labs.deadline })
        .from(labs)
        .where(eq(labs.classId, cls.id))
        .orderBy(asc(labs.id));
      return { items: rows.map((r) => ({ ...r, deadline: r.deadline.toISOString() })) };
    },
  );

  done();
};
