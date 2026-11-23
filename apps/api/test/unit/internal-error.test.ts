// Contract §2, problem type `internal`: the one type the HTTP contract tests cannot provoke,
// because a real database does not fail on demand. Here the database is a stub that throws.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { issueToken } from '../../src/auth.js';
import type { Db } from '../../src/db/client.js';
import { INTERNAL_DETAIL, PROBLEM_TYPE_BASE } from '../../src/problem.js';

const SECRET = 'unit-test-secret-unit-test-secret';
const LEAK = 'relation "users" does not exist at /srv/leetkob/src/db/schema.ts';

const brokenDb = new Proxy(
  {},
  {
    get() {
      throw new Error(LEAK);
    },
  },
) as Db;

describe('§2 internal', () => {
  it('§2 an unexpected error is 500 internal as problem+json, with the fixed detail', async () => {
    const app = buildApp({ db: brokenDb, jwtSecret: SECRET });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/labs/1/submissions',
      headers: {
        authorization: `Bearer ${await issueToken(1, SECRET)}`,
        'content-type': 'application/json',
        'idempotency-key': 'k-1',
      },
      payload: { language: 'cpp', code: 'int main() {}' },
    });
    await app.close();

    expect(res.statusCode).toBe(500);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json()).toEqual({
      type: `${PROBLEM_TYPE_BASE}internal`,
      title: 'Internal error',
      status: 500,
      detail: INTERNAL_DETAIL,
    });
    expect(res.body).not.toContain('relation');
    expect(res.body).not.toContain('schema.ts');
  });
});
