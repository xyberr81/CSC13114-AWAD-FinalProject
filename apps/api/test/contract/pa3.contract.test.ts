// Written from docs/contract/pa3-api.md. HTTP only; rows are arranged directly in the database.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  classMembers,
  classes,
  labConstraints,
  labTests,
  labs,
  submissionTestResults,
  submissions,
  users,
  verdicts,
} from '../../src/db/schema.js';
import {
  enrol,
  expectProblem,
  makeClass,
  makeLab,
  makeUser,
  startEnv,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.close());

interface Who {
  id: number;
  token: string;
}
type Json = Record<string, unknown>;

function call(method: string, path: string, who?: { token: string }, body?: unknown) {
  return fetch(env.baseUrl + path, {
    method,
    headers: {
      ...(who ? { authorization: `Bearer ${who.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json<T = Json>(res: Response, status: number): Promise<T> {
  expect(res.status).toBe(status);
  return (await res.json()) as T;
}
const mail = () => `${randomUUID()}@test.local`;

async function emailOf(id: number) {
  const [row] = await env.db.select({ email: users.email }).from(users).where(eq(users.id, id));
  return row!.email;
}

/** Two classes, each with a TA, a student and a lab; and an admin. */
async function world() {
  const make = async () => {
    const classId = await makeClass(env);
    const labId = await makeLab(env, classId);
    const ta = await makeUser(env, 'ta');
    const student = await makeUser(env, 'student');
    await enrol(env, classId, ta.id, 'ta');
    await enrol(env, classId, student.id, 'student');
    return { classId, labId, ta, student };
  };
  const [a, b] = [await make(), await make()];
  const peer = await makeUser(env, 'student');
  await enrol(env, a.classId, peer.id, 'student');
  return { a, b, peer, admin: await makeUser(env, 'admin') };
}
type World = Awaited<ReturnType<typeof world>>;

async function submission(
  labId: number,
  studentId: number,
  status: 'queued' | 'accepted' | 'wrong_answer' = 'accepted',
  createdAt = new Date(),
) {
  const [row] = await env.db
    .insert(submissions)
    .values({ labId, studentId, language: 'cpp', code: 'int main() {}\n', status, createdAt })
    .returning({ id: submissions.id });
  return row!.id;
}
async function constraint(labId: number, code: string, deduction = 3) {
  const [row] = await env.db
    .insert(labConstraints)
    .values({ labId, code, text: `Rule ${code}`, deduction })
    .returning({ id: labConstraints.id });
  return row!.id;
}
async function verdict(
  submissionId: number,
  constraintId: number,
  value: 'pass' | 'violation' | 'unsure',
) {
  await env.db.insert(verdicts).values({
    submissionId,
    constraintId,
    verdict: value,
    evidence: value === 'violation' ? [{ line: 1, text: 'int main() {}' }] : [],
    source: 'model',
    unsureReason: value === 'unsure' ? 'timeout' : null,
  });
}

const lab = (over: Json = {}): Json => ({
  title: 'Sorting',
  statement: 'Sort.',
  deadline: '2030-01-01T00:00:00Z',
  constraints: [{ code: 'C1', text: 'Do not use `std::sort`.', deduction: 3 }],
  tests: [{ input: '1\n', expectedOutput: '1\n' }],
  ...over,
});

describe('PA3 §2 accounts', () => {
  it('§2.3 §2.1 §2.2 an account made by an admin can log in, in any letter case', async () => {
    const admin = await makeUser(env, 'admin');
    const email = mail();
    const created = await json(
      await call('POST', '/v1/users', admin, {
        email: email.toUpperCase(),
        password: 'correct horse',
        role: 'ta',
      }),
      201,
    );
    expect(created).toEqual({ id: expect.any(Number) as number, email, role: 'ta' });

    const before = Date.now();
    const login = await json<{ token: string; expiresAt: string; user: Json }>(
      await call('POST', '/v1/auth/login', undefined, {
        email: email.toUpperCase(),
        password: 'correct horse',
      }),
      200,
    );
    expect(login.user).toEqual(created);
    const hours = (new Date(login.expiresAt).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(7.99);
    expect(hours).toBeLessThan(8.01);
    expect(await json(await call('GET', '/v1/me', login), 200)).toEqual(created);
  });

  it('§2.1 a wrong password and an unknown email get the same problem', async () => {
    const admin = await makeUser(env, 'admin');
    const email = mail();
    await json(
      await call('POST', '/v1/users', admin, { email, password: 'correct horse', role: 'student' }),
      201,
    );
    const wrong = await call('POST', '/v1/auth/login', undefined, { email, password: 'nope nope' });
    const unknown = await call('POST', '/v1/auth/login', undefined, {
      email: mail(),
      password: 'nope nope',
    });
    expect(await expectProblem(wrong, 'invalid-credentials', 401)).toEqual(
      await expectProblem(unknown, 'invalid-credentials', 401),
    );
  });

  it('§2.1 lists every broken field', async () => {
    const res = await call('POST', '/v1/auth/login', undefined, { email: 5 });
    const body = await expectProblem(res, 'validation', 400);
    expect((body.errors as { pointer: string }[]).map((e) => e.pointer).sort()).toEqual([
      '/email',
      '/password',
    ]);
  });

  it('§2.3 stores no plain password', async () => {
    const admin = await makeUser(env, 'admin');
    const email = mail();
    await json(
      await call('POST', '/v1/users', admin, { email, password: 'correct horse', role: 'ta' }),
      201,
    );
    const [row] = await env.db.select().from(users).where(eq(users.email, email));
    expect(row!.passwordHash).not.toContain('correct horse');
  });

  it('§2.3 a taken email is 409, whatever its case', async () => {
    const admin = await makeUser(env, 'admin');
    const email = mail();
    const body = { email, password: 'correct horse', role: 'ta' };
    await json(await call('POST', '/v1/users', admin, body), 201);
    const again = await call('POST', '/v1/users', admin, { ...body, email: email.toUpperCase() });
    await expectProblem(again, 'email-taken', 409);
  });

  it.each([
    ['a short password', { password: 'short' }, '/password'],
    ['not an email', { email: 'nobody' }, '/email'],
    ['an unknown role', { role: 'root' }, '/role'],
  ])('§2.3 rejects %s', async (_name, over, pointer) => {
    const admin = await makeUser(env, 'admin');
    const res = await call('POST', '/v1/users', admin, {
      email: mail(),
      password: 'correct horse',
      role: 'ta',
      ...over,
    });
    const body = await expectProblem(res, 'validation', 400);
    expect((body.errors as { pointer: string }[])[0]!.pointer).toBe(pointer);
  });
});

describe('PA3 §3 classes', () => {
  it('§3.1 an admin makes a class; a taken code is 409', async () => {
    const admin = await makeUser(env, 'admin');
    const code = `K-${randomUUID().slice(0, 8)}`;
    const body = await json(await call('POST', '/v1/classes', admin, { code, name: 'Web' }), 201);
    expect(body).toEqual({ id: expect.any(Number) as number, code, name: 'Web' });
    await expectProblem(
      await call('POST', '/v1/classes', admin, { code, name: 'Other' }),
      'class-code-taken',
      409,
    );
  });

  it('§3.1 U+0000 and blank text are validation problems', async () => {
    const admin = await makeUser(env, 'admin');
    const res = await call('POST', '/v1/classes', admin, { code: 'a\u0000b', name: '   ' });
    const body = await expectProblem(res, 'validation', 400);
    expect((body.errors as { pointer: string }[]).map((e) => e.pointer).sort()).toEqual([
      '/code',
      '/name',
    ]);
  });

  it('§3.2 members see their own classes, an admin sees all', async () => {
    const w = await world();
    const ids = async (who: Who) =>
      (
        await json<{ items: { id: number }[] }>(await call('GET', '/v1/classes', who), 200)
      ).items.map((c) => c.id);
    expect(await ids(w.a.ta)).toEqual([w.a.classId]);
    expect(await ids(w.a.student)).toEqual([w.a.classId]);
    expect(await ids(w.admin)).toEqual(expect.arrayContaining([w.a.classId, w.b.classId]));
  });

  it('§3.3 adding twice gives the same 200 and one row', async () => {
    const w = await world();
    const student = await makeUser(env, 'student');
    const body = { email: await emailOf(student.id), role: 'student' };
    const path = `/v1/classes/${w.a.classId}/members`;
    const first = await json(await call('POST', path, w.a.ta, body), 200);
    expect(first).toEqual({
      classId: w.a.classId,
      user: { id: student.id, email: body.email, role: 'student' },
    });
    expect(await json(await call('POST', path, w.a.ta, body), 200)).toEqual(first);
    const rows = await env.db
      .select()
      .from(classMembers)
      .where(and(eq(classMembers.classId, w.a.classId), eq(classMembers.userId, student.id)));
    expect(rows).toHaveLength(1);
  });

  it('§3.3 an unknown email and an account of another role are 422', async () => {
    const w = await world();
    const path = `/v1/classes/${w.a.classId}/members`;
    const otherTa = await emailOf(w.b.ta.id);
    for (const email of [mail(), otherTa]) {
      const res = await call('POST', path, w.a.ta, { email, role: 'student' });
      await expectProblem(res, 'user-not-eligible', 422);
    }
  });
});

describe('PA3 §4 labs', () => {
  it('§4.1 takes the sort-merge problem of the dev set whole', async () => {
    const w = await world();
    const dir = new URL('../../../../eval/leetkob-eval/problems/sort-merge/', import.meta.url);
    const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');
    const constraints = (
      JSON.parse(read('constraints.json')) as { id: string; text: string; deduction: number }[]
    ).map(({ id, text, deduction }) => ({ code: id, text, deduction }));
    const tests = readdirSync(new URL('tests/', dir))
      .filter((f) => f.endsWith('.in'))
      .sort()
      .map((f) => ({
        input: read(`tests/${f}`),
        expectedOutput: read(`tests/${f.replace('.in', '.out')}`),
      }));
    expect(tests.length).toBeGreaterThan(0);
    const sent = lab({
      statement: read('statement.md'),
      timeLimitMs: 2000,
      constraints,
      tests,
    });
    const created = await json<Json & { id: number }>(
      await call('POST', `/v1/classes/${w.a.classId}/labs`, w.a.ta, sent),
      201,
    );
    expect(created).toMatchObject({ statement: sent.statement, timeLimitMs: 2000, constraints });
    const stored = await env.db
      .select({ input: labTests.input, expectedOutput: labTests.expectedOutput })
      .from(labTests)
      .where(eq(labTests.labId, created.id))
      .orderBy(labTests.position);
    expect(stored).toEqual(tests);

    const seen = await json(await call('GET', `/v1/labs/${created.id}`, w.a.student), 200);
    expect(seen).toEqual(created);
  });

  it('§4.2 a student sees constraints, deductions and the notice, and no tests', async () => {
    const w = await world();
    const { id } = await json<{ id: number }>(
      await call(
        'POST',
        `/v1/classes/${w.a.classId}/labs`,
        w.a.ta,
        lab({ tests: [{ input: 'SECRET-IN', expectedOutput: 'SECRET-OUT' }] }),
      ),
      201,
    );
    const res = await call('GET', `/v1/labs/${id}`, w.a.student);
    const text = await res.clone().text();
    const body = await json(res, 200);
    expect(Object.keys(body).sort()).toEqual([
      'classId',
      'constraints',
      'deadline',
      'id',
      'memoryLimitMb',
      'reviewNotice',
      'statement',
      'timeLimitMs',
      'title',
    ]);
    expect(body).toMatchObject({
      deadline: '2030-01-01T00:00:00.000Z',
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      constraints: [{ code: 'C1', text: 'Do not use `std::sort`.', deduction: 3 }],
    });
    expect(body.reviewNotice).toMatch(/hard rules/);
    expect(body.reviewNotice).toMatch(/model/);
    expect(body.reviewNotice).toMatch(/TA/);
    expect(text).not.toContain('SECRET');
  });

  it('§4.3 lists the labs of the class', async () => {
    const w = await world();
    const body = await json<{ items: Json[] }>(
      await call('GET', `/v1/classes/${w.a.classId}/labs`, w.a.student),
      200,
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: w.a.labId, title: 'Sorting' });
  });

  it('§4.1 a repeated constraint code points at the second one', async () => {
    const w = await world();
    const c = { code: 'C1', text: 'x', deduction: 1 };
    const res = await call(
      'POST',
      `/v1/classes/${w.a.classId}/labs`,
      w.a.ta,
      lab({ constraints: [c, c] }),
    );
    const body = await expectProblem(res, 'validation', 400);
    expect((body.errors as { pointer: string }[]).map((e) => e.pointer)).toEqual([
      '/constraints/1/code',
    ]);
  });

  it.each([
    ['a deadline that is not a date', { deadline: 'tomorrow' }, '/deadline'],
    ['a deadline on 30 February', { deadline: '2026-02-30T00:00:00Z' }, '/deadline'],
    ['a deadline without an offset', { deadline: '2030-01-01T00:00:00' }, '/deadline'],
    ['a leap second', { deadline: '2016-12-31T23:59:60Z' }, '/deadline'],
    ['a time limit over 5 s', { timeLimitMs: 5001 }, '/timeLimitMs'],
    ['a memory limit sent as text', { memoryLimitMb: '256' }, '/memoryLimitMb'],
    [
      'a deduction over 10',
      { constraints: [{ code: 'C1', text: 'x', deduction: 11 }] },
      '/constraints/0/deduction',
    ],
    ['no tests', { tests: [] }, '/tests'],
    ['U+0000 in a test', { tests: [{ input: 'a\u0000', expectedOutput: '' }] }, '/tests/0/input'],
  ])('§4.1 rejects %s and stores nothing', async (_name, over, pointer) => {
    const w = await world();
    const res = await call('POST', `/v1/classes/${w.a.classId}/labs`, w.a.ta, lab(over));
    const body = await expectProblem(res, 'validation', 400);
    expect((body.errors as { pointer: string }[]).map((e) => e.pointer)).toContain(pointer);
    const rows = await env.db.select().from(labs).where(eq(labs.classId, w.a.classId));
    expect(rows).toHaveLength(1); // the one world() made
  });
});

describe('PA3 §5 results', () => {
  it('§5.1 shows each test result and nothing about tests or verdicts', async () => {
    const w = await world();
    const c = await constraint(w.a.labId, 'C1');
    const [t2, t1] = await env.db
      .insert(labTests)
      .values([
        { labId: w.a.labId, position: 2, input: 'SECRET', expectedOutput: 'SECRET' },
        { labId: w.a.labId, position: 1, input: 'SECRET', expectedOutput: 'SECRET' },
      ])
      .returning({ id: labTests.id });
    const id = await submission(w.a.labId, w.a.student.id);
    await env.db.insert(submissionTestResults).values([
      { submissionId: id, testId: t2!.id, status: 'time_limit' },
      { submissionId: id, testId: t1!.id, status: 'accepted', timeMs: 12, memoryKb: 3500 },
    ]);
    await verdict(id, c, 'violation');
    const body = await json(await call('GET', `/v1/submissions/${id}`, w.a.student), 200);
    expect(body).toEqual({
      id,
      labId: w.a.labId,
      language: 'cpp',
      status: 'accepted',
      createdAt: expect.stringMatching(/Z$/) as string,
      tests: [
        { position: 1, status: 'accepted', timeMs: 12, memoryKb: 3500 },
        { position: 2, status: 'time_limit', timeMs: null, memoryKb: null },
      ],
    });
  });
});

interface Queue {
  provisional: boolean;
  items: {
    submissionId: number;
    student: { id: number; email: string };
    verdict: string;
    constraint: Json;
    evidence: Json[];
    unsureReason: string | null;
  }[];
  page: number;
  pageSize: number;
  total: number;
}

describe('PA3 §6 review', () => {
  const queue = async (labId: number, ta: Who, query = '') =>
    json<Queue>(await call('GET', `/v1/labs/${labId}/review-queue${query}`, ta), 200);

  it('§6.1 shows verdict, evidence, deduction and the cause of an unsure', async () => {
    const w = await world();
    const c1 = await constraint(w.a.labId, 'C1', 3);
    const c2 = await constraint(w.a.labId, 'C2', 4);
    const id = await submission(w.a.labId, w.a.student.id);
    await verdict(id, c2, 'unsure');
    await verdict(id, c1, 'violation');
    const body = await queue(w.a.labId, w.a.ta);
    const common = {
      submissionId: id,
      student: { id: w.a.student.id, email: await emailOf(w.a.student.id) },
      submittedAt: expect.stringMatching(/Z$/) as string,
      source: 'model',
    };
    expect(body).toEqual({
      provisional: true,
      page: 1,
      pageSize: 20,
      total: 2,
      items: [
        {
          ...common,
          constraint: { code: 'C1', text: 'Rule C1', deduction: 3 },
          verdict: 'violation',
          evidence: [{ line: 1, text: 'int main() {}' }],
          unsureReason: null,
        },
        {
          ...common,
          constraint: { code: 'C2', text: 'Rule C2', deduction: 4 },
          verdict: 'unsure',
          evidence: [],
          unsureReason: 'timeout',
        },
      ],
    });
  });

  it('§6.1 is not provisional after the deadline', async () => {
    const w = await world();
    const closed = await makeLab(env, w.a.classId, new Date(Date.now() - 1000));
    expect(await queue(closed, w.a.ta)).toMatchObject({ provisional: false, total: 0, items: [] });
  });

  it('§6.1 only the last submission of a student counts, whatever its result', async () => {
    const w = await world();
    const c = await constraint(w.a.labId, 'C1');
    const t = Date.now();
    // Inserted newest first: time decides, not the id.
    const counted = await submission(w.a.labId, w.a.student.id, 'accepted', new Date(t));
    const older = await submission(w.a.labId, w.a.student.id, 'accepted', new Date(t - 60_000));
    const replaced = await submission(w.a.labId, w.peer.id, 'accepted', new Date(t - 60_000));
    await submission(w.a.labId, w.peer.id, 'wrong_answer', new Date(t));
    for (const id of [counted, older, replaced]) await verdict(id, c, 'violation');
    const body = await queue(w.a.labId, w.a.ta);
    expect(body.items.map((i) => i.submissionId)).toEqual([counted]);
    expect(body.total).toBe(1);
  });

  it.each([
    [1, 1],
    [10, 1],
    [11, 2],
  ])('§6.1 of %i passes it samples %i, the same ones every time', async (passes, sampled) => {
    const w = await world();
    const id = await submission(w.a.labId, w.a.student.id);
    for (let i = 0; i < passes; i++)
      await verdict(id, await constraint(w.a.labId, `C${i}`), 'pass');
    const first = await queue(w.a.labId, w.a.ta);
    expect(first.items.map((i) => i.verdict)).toEqual(Array(sampled).fill('pass'));
    expect(first.total).toBe(sampled);
    expect(await queue(w.a.labId, w.a.ta)).toEqual(first);
  });

  it('§6.1 pages do not overlap and a page past the end is empty', async () => {
    const w = await world();
    const id = await submission(w.a.labId, w.a.student.id);
    for (let i = 0; i < 5; i++)
      await verdict(id, await constraint(w.a.labId, `C${i}`), 'violation');
    const codes = async (page: number) => {
      const q = await queue(w.a.labId, w.a.ta, `?page=${page}&pageSize=2`);
      expect(q).toMatchObject({ page, pageSize: 2, total: 5 });
      return q.items.map((i) => i.constraint.code);
    };
    expect(await codes(1)).toEqual(['C0', 'C1']);
    expect(await codes(3)).toEqual(['C4']);
    expect(await codes(4)).toEqual([]);
    expect(await codes(2_147_483_647)).toEqual([]);
  });

  it.each(['?page=0&pageSize=101', '?page=1.5&pageSize=x', '?page=&pageSize=-1'])(
    '§6.1 lists both bad parameters of %s',
    async (query) => {
      const w = await world();
      const res = await call('GET', `/v1/labs/${w.a.labId}/review-queue${query}`, w.a.ta);
      const body = await expectProblem(res, 'validation', 400);
      expect((body.errors as { parameter: string }[]).map((e) => e.parameter).sort()).toEqual([
        'page',
        'pageSize',
      ]);
    },
  );

  it('§6.2 a TA opens any submission with its code and every verdict', async () => {
    const w = await world();
    const c = await constraint(w.a.labId, 'C1');
    const old = await submission(w.a.labId, w.a.student.id, 'accepted', new Date(0));
    await submission(w.a.labId, w.a.student.id);
    await verdict(old, c, 'pass');
    const body = await json(await call('GET', `/v1/submissions/${old}/review`, w.a.ta), 200);
    expect(body).toEqual({
      submissionId: old,
      labId: w.a.labId,
      student: { id: w.a.student.id, email: await emailOf(w.a.student.id) },
      submittedAt: '1970-01-01T00:00:00.000Z',
      status: 'accepted',
      code: 'int main() {}\n',
      verdicts: [
        {
          constraint: { code: 'C1', text: 'Rule C1', deduction: 3 },
          verdict: 'pass',
          evidence: [],
          source: 'model',
          unsureReason: null,
        },
      ],
    });
  });
});

// ---- who may call what: role × ownership, one test per cell, database unchanged on a refusal ----

type Caller = 'admin' | 'own TA' | 'other TA' | 'own student' | 'peer student' | 'other student';
const CALLERS: Record<Caller, (w: World) => Who> = {
  admin: (w) => w.admin,
  'own TA': (w) => w.a.ta,
  'other TA': (w) => w.b.ta,
  'own student': (w) => w.a.student,
  'peer student': (w) => w.peer,
  'other student': (w) => w.b.student,
};
interface Target {
  w: World;
  submissionId: number;
  newTa: string;
  newStudent: string;
}
interface Endpoint {
  name: string;
  method: 'GET' | 'POST';
  path: (t: Target) => string;
  body?: (t: Target) => unknown;
  expected: Record<Caller, number>;
}
const row = (...s: [number, number, number, number, number, number]): Record<Caller, number> => ({
  admin: s[0],
  'own TA': s[1],
  'other TA': s[2],
  'own student': s[3],
  'peer student': s[4],
  'other student': s[5],
});
const MATRIX: Endpoint[] = [
  {
    name: '§2.3 POST /users',
    method: 'POST',
    path: () => '/v1/users',
    body: () => ({ email: mail(), password: 'correct horse', role: 'admin' }),
    expected: row(201, 403, 403, 403, 403, 403),
  },
  {
    name: '§3.1 POST /classes',
    method: 'POST',
    path: () => '/v1/classes',
    body: () => ({ code: randomUUID(), name: 'x' }),
    expected: row(201, 403, 403, 403, 403, 403),
  },
  {
    name: '§3.3 POST members, a TA',
    method: 'POST',
    path: ({ w }) => `/v1/classes/${w.a.classId}/members`,
    body: (t) => ({ email: t.newTa, role: 'ta' }),
    expected: row(200, 403, 404, 403, 403, 403),
  },
  {
    name: '§3.3 POST members, a student',
    method: 'POST',
    path: ({ w }) => `/v1/classes/${w.a.classId}/members`,
    body: (t) => ({ email: t.newStudent, role: 'student' }),
    expected: row(403, 200, 404, 403, 403, 403),
  },
  {
    name: '§4.1 POST labs',
    method: 'POST',
    path: ({ w }) => `/v1/classes/${w.a.classId}/labs`,
    body: () => lab(),
    expected: row(403, 201, 404, 403, 403, 403),
  },
  {
    name: '§4.2 GET lab',
    method: 'GET',
    path: ({ w }) => `/v1/labs/${w.a.labId}`,
    expected: row(403, 200, 404, 200, 200, 404),
  },
  {
    name: '§4.3 GET labs of a class',
    method: 'GET',
    path: ({ w }) => `/v1/classes/${w.a.classId}/labs`,
    expected: row(403, 200, 404, 200, 200, 404),
  },
  {
    name: '§5.1 GET submission',
    method: 'GET',
    path: (t) => `/v1/submissions/${t.submissionId}`,
    expected: row(403, 403, 403, 200, 404, 404),
  },
  {
    name: '§6.1 GET review queue',
    method: 'GET',
    path: ({ w }) => `/v1/labs/${w.a.labId}/review-queue`,
    expected: row(403, 200, 404, 403, 403, 403),
  },
  {
    name: '§6.2 GET submission review',
    method: 'GET',
    path: (t) => `/v1/submissions/${t.submissionId}/review`,
    expected: row(403, 200, 404, 403, 403, 403),
  },
];
const cells = MATRIX.flatMap((e) =>
  (Object.keys(CALLERS) as Caller[]).map((caller) => ({
    e,
    caller,
    status: e.expected[caller],
    title: `${e.name}: ${caller} gets ${e.expected[caller]}`,
  })),
);

async function rowCounts(t: Target) {
  const classId = t.w.a.classId;
  const n = async (q: PromiseLike<{ n: number }[]>) => (await q)[0]!.n;
  return {
    members: await n(
      env.db.select({ n: count() }).from(classMembers).where(eq(classMembers.classId, classId)),
    ),
    labs: await n(env.db.select({ n: count() }).from(labs).where(eq(labs.classId, classId))),
  };
}

// Other test files add users and classes in parallel, so those are looked up by the row the request
// would have made; members and labs are counted inside this test's own class.
describe('PA3 §1 role × ownership', () => {
  it.each(cells)('$title', async ({ e, caller, status }) => {
    const w = await world();
    const t: Target = {
      w,
      submissionId: await submission(w.a.labId, w.a.student.id),
      newTa: await emailOf((await makeUser(env, 'ta')).id),
      newStudent: await emailOf((await makeUser(env, 'student')).id),
    };
    const body = e.body?.(t) as Json | undefined;
    const before = await rowCounts(t);
    const res = await call(e.method, e.path(t), CALLERS[caller](w), body);
    if (status === 403) await expectProblem(res, 'forbidden', 403);
    else if (status === 404) await expectProblem(res, 'not-found', 404);
    else expect(res.status).toBe(status);

    const after = await rowCounts(t);
    const made = {
      users: body?.password
        ? (
            await env.db
              .select()
              .from(users)
              .where(eq(users.email, body.email as string))
          ).length
        : 0,
      classes:
        body && 'name' in body
          ? (
              await env.db
                .select()
                .from(classes)
                .where(eq(classes.code, body.code as string))
            ).length
          : 0,
      members: after.members - before.members,
      labs: after.labs - before.labs,
    };
    const writes = e.method === 'POST' && status < 400 ? 1 : 0;
    expect(Object.values(made).reduce((a, b) => a + b)).toBe(writes);
  });

  it.each(MATRIX)('$name: no token gets 401', async (e) => {
    const w = await world();
    const t: Target = { w, submissionId: 1, newTa: mail(), newStudent: mail() };
    const res = await call(e.method, e.path(t), undefined, e.body?.(t));
    await expectProblem(res, 'unauthenticated', 401);
  });

  it.each(['/v1/me', '/v1/classes'])('GET %s: no token gets 401', async (path) => {
    await expectProblem(await call('GET', path), 'unauthenticated', 401);
  });

  it("§1 someone else's resource and a missing one get the same response", async () => {
    const w = await world();
    const pairs: [string, string][] = [
      [`/v1/labs/${w.a.labId}`, '/v1/labs/2147483647'],
      [`/v1/labs/${w.a.labId}/review-queue`, '/v1/labs/nope/review-queue'],
      [`/v1/classes/${w.a.classId}/labs`, '/v1/classes/0/labs'],
    ];
    for (const [theirs, missing] of pairs) {
      const a = await expectProblem(await call('GET', theirs, w.b.ta), 'not-found', 404);
      const b = await expectProblem(await call('GET', missing, w.b.ta), 'not-found', 404);
      expect(a).toEqual(b);
    }
  });

  it('§1 a refusal comes before the body is read', async () => {
    const w = await world();
    const res = await call('POST', `/v1/classes/${w.a.classId}/labs`, w.b.ta, { bad: true });
    await expectProblem(res, 'not-found', 404);
  });
});

describe('PA3 §7 documentation', () => {
  it('serves Swagger UI and describes every endpoint', async () => {
    const page = await fetch(`${env.baseUrl}/docs/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    const spec = (await (await fetch(`${env.baseUrl}/docs/json`)).json()) as {
      paths: Record<string, Json>;
      components: { securitySchemes: Json };
    };
    const paths = Object.keys(spec.paths);
    for (const p of [
      '/v1/auth/login',
      '/v1/me',
      '/v1/users',
      '/v1/classes',
      '/v1/classes/{classId}/members',
      '/v1/classes/{classId}/labs',
      '/v1/labs/{labId}',
      '/v1/labs/{labId}/submissions',
      '/v1/submissions/{submissionId}',
      '/v1/labs/{labId}/review-queue',
      '/v1/submissions/{submissionId}/review',
    ])
      expect(paths).toContain(p);
    expect(Object.values(spec.components.securitySchemes)).toContainEqual(
      expect.objectContaining({ type: 'http', scheme: 'bearer' }),
    );
  });
});

describe('PA3 §1 unknown fields', () => {
  const extra = { id: 1, createdAt: 'yesterday', unknown: true };

  it('§3.1 §4.1 are ignored, at every level', async () => {
    const w = await world();
    await json(
      await call('POST', '/v1/classes', w.admin, { code: randomUUID(), name: 'x', ...extra }),
      201,
    );
    const created = await json(
      await call(
        'POST',
        `/v1/classes/${w.a.classId}/labs`,
        w.a.ta,
        lab({
          ...extra,
          classId: w.b.classId,
          constraints: [{ code: 'C1', text: 'x', deduction: 1, ...extra, labId: w.b.labId }],
          tests: [{ input: '', expectedOutput: '', ...extra, position: 9 }],
        }),
      ),
      201,
    );
    expect(created).toMatchObject({ classId: w.a.classId });
  });
});

describe('PA3 §6.1 §6.2 submittedAt', () => {
  it('is the same instant in both, to the millisecond', async () => {
    const w = await world();
    const c = await constraint(w.a.labId, 'C1');
    const id = await submission(w.a.labId, w.a.student.id);
    await env.db
      .update(submissions)
      .set({ createdAt: sql`timestamptz '2026-01-01 00:00:00.123987Z'` })
      .where(eq(submissions.id, id));
    await verdict(id, c, 'violation');
    const queue = await json<{ items: Json[] }>(
      await call('GET', `/v1/labs/${w.a.labId}/review-queue`, w.a.ta),
      200,
    );
    const review = await json(await call('GET', `/v1/submissions/${id}/review`, w.a.ta), 200);
    expect(queue.items[0]!.submittedAt).toBe('2026-01-01T00:00:00.123Z');
    expect(review.submittedAt).toBe('2026-01-01T00:00:00.123Z');
  });
});

describe('PA3 §7 submitting from Swagger UI', () => {
  it('offers the Idempotency-Key header', async () => {
    const spec = (await (await fetch(`${env.baseUrl}/docs/json`)).json()) as {
      paths: Record<string, { post: { parameters: Json[] } }>;
    };
    expect(spec.paths['/v1/labs/{labId}/submissions']!.post.parameters).toContainEqual(
      expect.objectContaining({
        in: 'header',
        name: expect.stringMatching(/^idempotency-key$/i) as string,
      }),
    );
  });
});
