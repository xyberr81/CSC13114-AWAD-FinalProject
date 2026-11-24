// Contract pa3-api.md §1, checks 1–3: token, role, then the resource and the caller's right to it.
// A guard runs in onRequest, so a refusal comes before the body is read.
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { FastifyRequest } from 'fastify';
import { bearerToken, parseId, verifyToken } from './auth.js';
import { classMembers, classes, labs, submissions, users } from './db/schema.js';
import { ProblemError } from './problem.js';
import type { RouteDeps } from './routes/deps.js';

export type Role = 'admin' | 'ta' | 'student';

export interface Caller {
  id: number;
  email: string;
  role: Role;
}

type Params = Record<string, string | undefined>;

export interface Guard<T> {
  onRequest: (request: FastifyRequest) => Promise<void>;
  /** The caller and what the path named, as found by this guard's onRequest. */
  of: (request: FastifyRequest) => { caller: Caller; target: T };
}

const notFound = (what: string) => new ProblemError('not-found', `No such ${what}.`);

/** An admin sees every class; a TA or student only the classes they belong to in that role. */
function mayUse(classId: PgColumn, caller: Caller): SQL {
  if (caller.role === 'admin') return sql`true`;
  return sql`exists (
    select 1 from ${classMembers}
    where ${classMembers.classId} = ${classId}
      and ${classMembers.userId} = ${caller.id}
      and ${classMembers.role} = ${caller.role}
  )`;
}

export function createAccess({ db, jwtSecret }: RouteDeps) {
  const found = new WeakMap<FastifyRequest, { caller: Caller; target: unknown }>();

  async function authenticate(request: FastifyRequest): Promise<Caller> {
    const token = bearerToken(request.headers.authorization);
    const userId = token ? await verifyToken(token, jwtSecret) : null;
    const [user] = userId
      ? await db
          .select({ id: users.id, email: users.email, role: users.role })
          .from(users)
          .where(eq(users.id, userId))
      : [];
    if (!user) throw new ProblemError('unauthenticated', 'A valid bearer token is required.');
    return user;
  }

  /** The classes the caller may use. */
  function classesOf(caller: Caller) {
    return db
      .select({ id: classes.id, code: classes.code, name: classes.name })
      .from(classes)
      .where(mayUse(classes.id, caller))
      .orderBy(classes.id);
  }

  async function classOf(caller: Caller, raw: string | undefined) {
    const id = parseId(raw);
    const [row] = id
      ? await db
          .select({ id: classes.id, code: classes.code, name: classes.name })
          .from(classes)
          .where(and(eq(classes.id, id), mayUse(classes.id, caller)))
      : [];
    if (!row) throw notFound('class');
    return row;
  }

  async function labOf(caller: Caller, raw: string | undefined) {
    const id = parseId(raw);
    const [row] = id
      ? await db
          .select()
          .from(labs)
          .where(and(eq(labs.id, id), mayUse(labs.classId, caller)))
      : [];
    if (!row) throw notFound('lab');
    return row;
  }

  /** A student's own submission, or any submission of a lab in the TA's class. */
  async function submissionOf(caller: Caller, raw: string | undefined) {
    const id = parseId(raw);
    const [row] = id
      ? await db
          .select({
            id: submissions.id,
            labId: submissions.labId,
            studentId: submissions.studentId,
            studentEmail: users.email,
            language: submissions.language,
            code: submissions.code,
            status: submissions.status,
            createdAt: submissions.createdAt,
          })
          .from(submissions)
          .innerJoin(users, eq(users.id, submissions.studentId))
          .innerJoin(labs, eq(labs.id, submissions.labId))
          .where(
            and(
              eq(submissions.id, id),
              caller.role === 'student'
                ? eq(submissions.studentId, caller.id)
                : mayUse(labs.classId, caller),
            ),
          )
      : [];
    if (!row) throw notFound('submission');
    return row;
  }

  function guard(roles: readonly Role[]): Guard<undefined>;
  function guard<T>(
    roles: readonly Role[],
    find: (caller: Caller, params: Params) => Promise<T>,
  ): Guard<T>;
  function guard(
    roles: readonly Role[],
    find?: (caller: Caller, params: Params) => Promise<unknown>,
  ): Guard<unknown> {
    return {
      onRequest: async (request) => {
        const caller = await authenticate(request);
        if (!roles.includes(caller.role)) {
          throw new ProblemError('forbidden', 'Your role may not call this endpoint.');
        }
        const target = find ? await find(caller, request.params as Params) : undefined;
        found.set(request, { caller, target });
      },
      of: (request) => {
        const result = found.get(request);
        if (!result) throw new Error('guard.of() called on a route that did not run its guard');
        return result;
      },
    };
  }

  return { guard, classesOf, classOf, labOf, submissionOf };
}

export type Access = ReturnType<typeof createAccess>;
