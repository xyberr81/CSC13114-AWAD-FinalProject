// Contract: docs/contract/post-lab-submissions.md. Test names cite the section they check.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueToken } from '../../src/auth.js';
import { submissions, users } from '../../src/db/schema.js';
import {
  enrol,
  enrolledStudent,
  expectProblem,
  makeClass,
  makeLab,
  makeUser,
  setDeadline,
  startEnv,
  type TestEnv,
} from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env.close();
});

const CODE = '#include <iostream>\nint main() { std::cout << 42; }\n';
const VALID = { language: 'cpp', code: CODE };

interface Call {
  labId: number | string;
  token?: string | null;
  key?: string | null;
  body?: unknown;
  rawBody?: string;
  contentType?: string | null;
}

function submit({ labId, token, key = randomUUID(), body = VALID, rawBody, contentType }: Call) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (key !== null) headers['idempotency-key'] = key;
  if (contentType !== null) headers['content-type'] = contentType ?? 'application/json';
  return fetch(`${env.baseUrl}/v1/labs/${labId}/submissions`, {
    method: 'POST',
    headers,
    body: rawBody ?? JSON.stringify(body),
  });
}

async function countSubmissions(studentId: number) {
  const rows = await env.db
    .select({ id: submissions.id })
    .from(submissions)
    .where(eq(submissions.studentId, studentId));
  return rows.length;
}

describe('§4.1 success', () => {
  it('§4.1 an enrolled student gets 201 with a queued Submission (§3)', async () => {
    const { labId, student } = await enrolledStudent(env);
    const before = Date.now();
    const res = await submit({ labId, token: student.token });

    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(res.headers.get('idempotent-replayed')).toBeNull();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ labId, language: 'cpp', status: 'queued' });
    expect(Number.isInteger(body.id) && (body.id as number) > 0).toBe(true);
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(body.createdAt as string)).toBeGreaterThanOrEqual(before - 5000);
    expect(body).not.toHaveProperty('code');
    expect(await countSubmissions(student.id)).toBe(1);
  });

  it('§4.1 a charset parameter on application/json is accepted', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({
      labId,
      token: student.token,
      contentType: 'application/json; charset=utf-8',
    });
    expect(res.status).toBe(201);
  });

  it('§1 unknown request fields are ignored', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({ labId, token: student.token, body: { ...VALID, extra: 1 } });
    expect(res.status).toBe(201);
  });

  it('§4.1 each new Idempotency-Key creates a new submission', async () => {
    const { labId, student } = await enrolledStudent(env);
    const a = await submit({ labId, token: student.token });
    const b = await submit({ labId, token: student.token });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    const [ba, bb] = (await Promise.all([a.json(), b.json()])) as { id: number }[];
    expect(ba!.id).not.toBe(bb!.id);
    expect(await countSubmissions(student.id)).toBe(2);
  });
});

describe('§4.1 who may call it — 401 unauthenticated', () => {
  it('§2 no Authorization header is 401 unauthenticated', async () => {
    const { labId } = await enrolledStudent(env);
    await expectProblem(await submit({ labId, token: null }), 'unauthenticated', 401);
  });

  it('§2 an Authorization header that is not Bearer is 401', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await fetch(`${env.baseUrl}/v1/labs/${labId}/submissions`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${student.token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
      },
      body: JSON.stringify(VALID),
    });
    await expectProblem(res, 'unauthenticated', 401);
  });

  it('§2 a token signed with another secret is 401', async () => {
    const { labId, student } = await enrolledStudent(env);
    const forged = await issueToken(student.id, 'x'.repeat(40));
    await expectProblem(await submit({ labId, token: forged }), 'unauthenticated', 401);
  });

  it('§2 an expired token is 401', async () => {
    const { labId, student } = await enrolledStudent(env);
    const expired = await issueToken(student.id, env.secret, new Date(Date.now() - 60_000));
    await expectProblem(await submit({ labId, token: expired }), 'unauthenticated', 401);
  });

  it('§2 a token whose sub is not an existing user is 401', async () => {
    const { labId } = await enrolledStudent(env);
    const ghost = await issueToken(2_000_000_000, env.secret);
    await expectProblem(await submit({ labId, token: ghost }), 'unauthenticated', 401);
  });

  it('§4.1 check 1 comes first: no token and a bad body is still 401', async () => {
    await expectProblem(
      await submit({ labId: 'abc', token: null, key: null, rawBody: '{' }),
      'unauthenticated',
      401,
    );
  });
});

describe('§4.1 who may call it — role and ownership', () => {
  it('§4.1 a TA of the lab’s class is 403 forbidden', async () => {
    const classId = await makeClass(env);
    const labId = await makeLab(env, classId);
    const ta = await makeUser(env, 'ta');
    await enrol(env, classId, ta.id, 'ta');
    await expectProblem(await submit({ labId, token: ta.token }), 'forbidden', 403);
  });

  it('§4.1 an admin is 403 forbidden', async () => {
    const { labId } = await enrolledStudent(env);
    const admin = await makeUser(env, 'admin');
    await expectProblem(await submit({ labId, token: admin.token }), 'forbidden', 403);
  });

  it('§4.1 the 403 is decided before the lab is looked up (a missing lab is still 403)', async () => {
    const ta = await makeUser(env, 'ta');
    await expectProblem(await submit({ labId: 2_000_000_000, token: ta.token }), 'forbidden', 403);
  });

  it('§4.1 the role comes from the stored user, not the token', async () => {
    const { labId, student } = await enrolledStudent(env);
    await env.db.update(users).set({ role: 'ta' }).where(eq(users.id, student.id));
    await expectProblem(await submit({ labId, token: student.token }), 'forbidden', 403);
  });

  it('§4.1 ownership: a student not enrolled in the lab’s class is 404 not-found', async () => {
    const { labId } = await enrolledStudent(env);
    const outsider = await enrolledStudent(env); // enrolled, but in another class
    await expectProblem(await submit({ labId, token: outsider.student.token }), 'not-found', 404);
    expect(await countSubmissions(outsider.student.id)).toBe(0);
  });

  it('§4.1 ownership: a student only enrolled as a TA of the class is 404', async () => {
    const classId = await makeClass(env);
    const labId = await makeLab(env, classId);
    const student = await makeUser(env, 'student');
    await enrol(env, classId, student.id, 'ta');
    await expectProblem(await submit({ labId, token: student.token }), 'not-found', 404);
  });

  it('§4.1 ownership: the 404 for another class’s lab equals the 404 for a missing lab', async () => {
    const { labId } = await enrolledStudent(env);
    const outsider = await enrolledStudent(env);
    const other = await submit({ labId, token: outsider.student.token });
    const missing = await submit({ labId: 2_000_000_000, token: outsider.student.token });
    const a = await expectProblem(other, 'not-found', 404);
    const b = await expectProblem(missing, 'not-found', 404);
    expect(a).toEqual(b);
  });

  it('§2 a labId that is not a positive integer is 404 not-found', async () => {
    const { student } = await enrolledStudent(env);
    for (const labId of ['abc', '0', '-1', '1.5', '99999999999']) {
      await expectProblem(await submit({ labId, token: student.token }), 'not-found', 404);
    }
  });
});

describe('§4.1 the body', () => {
  it('§2 a body not sent as application/json is 415 unsupported-media-type', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({
      labId,
      token: student.token,
      rawBody: CODE,
      contentType: 'text/plain',
    });
    await expectProblem(res, 'unsupported-media-type', 415);
  });

  it('§2 a body over 512 KiB is 413 payload-too-large', async () => {
    const { labId, student } = await enrolledStudent(env);
    const body = { language: 'cpp', code: 'x'.repeat(530_000) };
    await expectProblem(
      await submit({ labId, token: student.token, body }),
      'payload-too-large',
      413,
    );
  });

  it('§2 a body that is not valid JSON is 400 invalid-json', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({ labId, token: student.token, rawBody: '{"language": "cpp",' });
    await expectProblem(res, 'invalid-json', 400);
  });

  it('§4.1 check 6 before 7: invalid JSON without an Idempotency-Key is invalid-json', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({ labId, token: student.token, key: null, rawBody: '{' });
    await expectProblem(res, 'invalid-json', 400);
  });
});

describe('§4.1 Idempotency-Key header — 400 idempotency-key-missing', () => {
  const bad: [string, string | null][] = [
    ['missing', null],
    ['empty', ''],
    ['longer than 255 characters', 'k'.repeat(256)],
    ['containing a space', 'two words'],
    ['containing a tab', 'key\twith-tab'],
  ];
  for (const [name, key] of bad) {
    it(`§2 an Idempotency-Key ${name} is 400 idempotency-key-missing`, async () => {
      const { labId, student } = await enrolledStudent(env);
      const res = await submit({ labId, token: student.token, key });
      await expectProblem(res, 'idempotency-key-missing', 400);
    });
  }

  it('§2 a key of exactly 255 visible characters is accepted', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({ labId, token: student.token, key: 'k'.repeat(255) });
    expect(res.status).toBe(201);
  });

  it('§4.1 check 7 before 8: a bad key and a bad body is idempotency-key-missing', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({ labId, token: student.token, key: null, body: {} });
    await expectProblem(res, 'idempotency-key-missing', 400);
  });
});

describe('§4.1 field rules — 400 validation', () => {
  async function pointers(body: unknown, rawBody?: string) {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({ labId, token: student.token, body, rawBody });
    const problem = await expectProblem(res, 'validation', 400);
    const errors = problem.errors as { pointer: string; detail: string }[];
    expect(Array.isArray(errors) && errors.length > 0).toBe(true);
    for (const e of errors) expect(typeof e.detail).toBe('string');
    expect(await countSubmissions(student.id)).toBe(0);
    return errors.map((e) => e.pointer);
  }

  it('§2 every problem is listed: missing language and code give both pointers', async () => {
    const p = await pointers({});
    expect(p).toContain('/language');
    expect(p).toContain('/code');
  });

  it('§4.1 language other than "cpp" is a validation problem at /language', async () => {
    expect(await pointers({ language: 'python', code: CODE })).toEqual(['/language']);
  });

  it('§4.1 empty code is a validation problem at /code', async () => {
    const p = await pointers({ language: 'cpp', code: '' });
    expect(new Set(p)).toEqual(new Set(['/code']));
  });

  it('§4.1 whitespace-only code is a validation problem at /code', async () => {
    expect(await pointers({ language: 'cpp', code: ' \n\t ' })).toEqual(['/code']);
  });

  it('§4.1 code longer than 65 536 characters is a validation problem at /code', async () => {
    expect(await pointers({ language: 'cpp', code: 'x'.repeat(65_537) })).toEqual(['/code']);
  });

  it('§4.1 code of exactly 65 536 characters is accepted', async () => {
    const { labId, student } = await enrolledStudent(env);
    const res = await submit({
      labId,
      token: student.token,
      body: { language: 'cpp', code: 'x'.repeat(65_536) },
    });
    expect(res.status).toBe(201);
  });

  it('§4.1 code is never coerced: a number is a validation problem at /code', async () => {
    expect(await pointers({ language: 'cpp', code: 12345 })).toEqual(['/code']);
  });

  it('§4.1 a body that is not an object has pointer ""', async () => {
    expect(await pointers(['cpp', CODE])).toEqual(['']);
  });

  it('§4.1 a missing body has pointer ""', async () => {
    expect(await pointers(undefined, '')).toEqual(['']);
  });
});

describe('§4.1 idempotency', () => {
  it('§4.1 the same key and body returns the first 201 again, marked Idempotent-Replayed', async () => {
    const { labId, student } = await enrolledStudent(env);
    const key = randomUUID();
    const first = await submit({ labId, token: student.token, key });
    const again = await submit({ labId, token: student.token, key });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await again.json()).toEqual(await first.json());
    expect(await countSubmissions(student.id)).toBe(1);
  });

  it('§4.1 key order, whitespace and unknown fields do not make a body different', async () => {
    const { labId, student } = await enrolledStudent(env);
    const key = randomUUID();
    const first = await submit({ labId, token: student.token, key });
    const rawBody = `{ "code" : ${JSON.stringify(CODE)},\n "language":"cpp", "note": "retry" }`;
    const again = await submit({ labId, token: student.token, key, rawBody });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(await first.json());
    expect(await countSubmissions(student.id)).toBe(1);
  });

  it('§4.1 the same key with a different body is 422 idempotency-key-reused', async () => {
    const { labId, student } = await enrolledStudent(env);
    const key = randomUUID();
    expect((await submit({ labId, token: student.token, key })).status).toBe(201);
    const res = await submit({
      labId,
      token: student.token,
      key,
      body: { language: 'cpp', code: 'int main(){}' },
    });
    await expectProblem(res, 'idempotency-key-reused', 422);
    expect(await countSubmissions(student.id)).toBe(1);
  });

  it('§4.1 the same key on a different lab is 422 idempotency-key-reused', async () => {
    const { classId, labId, student } = await enrolledStudent(env);
    const otherLab = await makeLab(env, classId);
    const key = randomUUID();
    expect((await submit({ labId, token: student.token, key })).status).toBe(201);
    const res = await submit({ labId: otherLab, token: student.token, key });
    await expectProblem(res, 'idempotency-key-reused', 422);
  });

  it('§4.1 keys are scoped per student: two students may use the same key', async () => {
    const { classId, labId, student } = await enrolledStudent(env);
    const other = await makeUser(env, 'student');
    await enrol(env, classId, other.id, 'student');
    const key = randomUUID();
    const a = await submit({ labId, token: student.token, key });
    const b = await submit({ labId, token: other.token, key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get('idempotent-replayed')).toBeNull();
    const [ba, bb] = (await Promise.all([a.json(), b.json()])) as { id: number }[];
    expect(ba!.id).not.toBe(bb!.id);
  });

  it('§4.1 requests with the same key at the same time create exactly one submission', async () => {
    const { labId, student } = await enrolledStudent(env);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => submit({ labId, token: student.token, key })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const ids = new Set(
      (await Promise.all(results.map((r) => r.json() as Promise<{ id: number }>))).map((b) => b.id),
    );
    expect(ids.size).toBe(1);
    expect(await countSubmissions(student.id)).toBe(1);
  });

  it('§4.1 a replay still returns 201 after the deadline has passed (D1)', async () => {
    const { labId, student } = await enrolledStudent(env);
    const key = randomUUID();
    const first = await submit({ labId, token: student.token, key });
    expect(first.status).toBe(201);
    await setDeadline(env, labId, new Date(Date.now() - 60_000));
    const again = await submit({ labId, token: student.token, key });
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(await again.json()).toEqual(await first.json());
  });

  it('§4.1 a failed request does not use up its key', async () => {
    const { labId, student } = await enrolledStudent(env);
    const key = randomUUID();
    await setDeadline(env, labId, new Date(Date.now() - 60_000));
    await expectProblem(await submit({ labId, token: student.token, key }), 'lab-closed', 409);
    await setDeadline(env, labId, new Date(Date.now() + 60 * 60_000));
    const res = await submit({ labId, token: student.token, key });
    expect(res.status).toBe(201);
    expect(res.headers.get('idempotent-replayed')).toBeNull();
  });
});

describe('§4.1 deadline — 409 lab-closed', () => {
  it('§2 a submission after the deadline is 409 lab-closed and creates nothing', async () => {
    const classId = await makeClass(env);
    const labId = await makeLab(env, classId, new Date(Date.now() - 1000));
    const student = await makeUser(env, 'student');
    await enrol(env, classId, student.id, 'student');
    await expectProblem(await submit({ labId, token: student.token }), 'lab-closed', 409);
    expect(await countSubmissions(student.id)).toBe(0);
  });

  it('§4.1 check 8 before 10: a bad body after the deadline is validation, not lab-closed', async () => {
    const classId = await makeClass(env);
    const labId = await makeLab(env, classId, new Date(Date.now() - 1000));
    const student = await makeUser(env, 'student');
    await enrol(env, classId, student.id, 'student');
    await expectProblem(await submit({ labId, token: student.token, body: {} }), 'validation', 400);
  });
});
