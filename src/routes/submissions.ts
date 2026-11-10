// Contract: docs/contract/post-lab-submissions.md
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { bearerToken, parseId, verifyToken } from '../auth.js';
import type { Db } from '../db/client.js';
import { classMembers, idempotencyKeys, labs, submissions, users } from '../db/schema.js';
import { isValidIdempotencyKey, submissionFingerprint } from '../idempotency.js';
import { ProblemError } from '../problem.js';

export interface SubmissionRouteDeps {
  db: Db;
  jwtSecret: string;
}

interface SubmitRoute {
  Params: { labId: string };
  Body: { language: 'cpp'; code: string };
}

interface Caller {
  id: number;
  role: 'admin' | 'ta' | 'student';
}

interface LabRef {
  id: number;
  deadline: Date;
}

const BODY_LIMIT = 512 * 1024;

const bodySchema = {
  type: 'object',
  required: ['language', 'code'],
  properties: {
    language: { type: 'string', enum: ['cpp'] },
    code: { type: 'string', minLength: 1, maxLength: 65_536, pattern: '\\S' },
  },
} as const;

type SubmissionRow = typeof submissions.$inferSelect;

function toJson(s: SubmissionRow) {
  return {
    id: s.id,
    labId: s.labId,
    language: s.language,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
  };
}

export const submissionRoutes: FastifyPluginCallback<SubmissionRouteDeps> = (
  app,
  { db, jwtSecret },
  done,
) => {
  const callers = new WeakMap<FastifyRequest, Caller>();
  const targetLabs = new WeakMap<FastifyRequest, LabRef>();

  // Checks 1–3 of §4.1: token, role, then the lab and ownership — before the body is read.
  async function authorise(request: FastifyRequest<SubmitRoute>) {
    const token = bearerToken(request.headers.authorization);
    const userId = token ? await verifyToken(token, jwtSecret) : null;
    const [user] = userId
      ? await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId))
      : [];
    if (!user) throw new ProblemError('unauthenticated', 'A valid bearer token is required.');

    if (user.role !== 'student') {
      throw new ProblemError('forbidden', 'Only students can submit code.');
    }

    const labId = parseId(request.params.labId);
    const [lab] = labId
      ? await db
          .select({ id: labs.id, deadline: labs.deadline })
          .from(labs)
          .innerJoin(
            classMembers,
            and(
              eq(classMembers.classId, labs.classId),
              eq(classMembers.userId, user.id),
              eq(classMembers.role, 'student'),
            ),
          )
          .where(eq(labs.id, labId))
          .limit(1)
      : [];
    // Same answer for "no such lab" and "not your class" (contract §4.1, D2).
    if (!lab) throw new ProblemError('not-found', 'No such lab.');

    callers.set(request, user);
    targetLabs.set(request, lab);
  }

  // Check 7: after the body is parsed (checks 4–6), before it is validated (check 8).
  function requireIdempotencyKey(request: FastifyRequest, _reply: FastifyReply, next: () => void) {
    if (!isValidIdempotencyKey(request.headers['idempotency-key'])) {
      throw new ProblemError(
        'idempotency-key-missing',
        'Send an Idempotency-Key header of 1 to 255 visible ASCII characters.',
      );
    }
    next();
  }

  app.post<SubmitRoute>(
    '/labs/:labId/submissions',
    {
      bodyLimit: BODY_LIMIT,
      schema: { body: bodySchema },
      onRequest: authorise,
      preValidation: requireIdempotencyKey,
    },
    async (request, reply) => {
      const caller = callers.get(request)!;
      const lab = targetLabs.get(request)!;
      const key = request.headers['idempotency-key'] as string;
      const { language, code } = request.body;
      const fingerprint = submissionFingerprint(lab.id, language, code);

      // The key row is inserted first: a concurrent request with the same key blocks on it until
      // this transaction ends, then sees the stored result. Any error rolls the key back too.
      const result = await db.transaction(async (tx) => {
        const claimed = await tx
          .insert(idempotencyKeys)
          .values({ userId: caller.id, key, fingerprint })
          .onConflictDoNothing()
          .returning({ key: idempotencyKeys.key });

        if (claimed.length === 0) {
          const [stored] = await tx
            .select()
            .from(idempotencyKeys)
            .where(and(eq(idempotencyKeys.userId, caller.id), eq(idempotencyKeys.key, key)));
          if (!stored || stored.fingerprint !== fingerprint || stored.submissionId === null) {
            throw new ProblemError(
              'idempotency-key-reused',
              'This Idempotency-Key was already used for a different submission.',
            );
          }
          const [previous] = await tx
            .select()
            .from(submissions)
            .where(eq(submissions.id, stored.submissionId));
          return { replayed: true, submission: previous! };
        }

        if (Date.now() > lab.deadline.getTime()) {
          throw new ProblemError('lab-closed', 'The deadline for this lab has passed.');
        }

        const [created] = await tx
          .insert(submissions)
          .values({ labId: lab.id, studentId: caller.id, language, code })
          .returning();
        await tx
          .update(idempotencyKeys)
          .set({ submissionId: created!.id })
          .where(and(eq(idempotencyKeys.userId, caller.id), eq(idempotencyKeys.key, key)));
        return { replayed: false, submission: created! };
      });

      if (result.replayed) void reply.header('Idempotent-Replayed', 'true');
      return reply.status(201).send(toJson(result.submission));
    },
  );

  done();
};
