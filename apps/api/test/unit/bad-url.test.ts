// Contract §2: a URL the router itself refuses still gets problem+json.
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Db } from '../../src/db/client.js';
import { PROBLEM_TYPE_BASE } from '../../src/problem.js';

const SECRET = 'unit-test-secret-unit-test-secret';
const unusedDb = {} as Db;

async function get(url: string) {
  const app = buildApp({ db: unusedDb, jwtSecret: SECRET });
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
}

describe('§2 URLs the router refuses', () => {
  it.each(['/v1/%zz', '/v1/labs/%zz'])('§2 %s is 404 not-found as problem+json', async (url) => {
    const res = await get(url);
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json()).toMatchObject({ type: `${PROBLEM_TYPE_BASE}not-found`, status: 404 });
  });

  it('§1 a very long id still gets the token check first', async () => {
    const res = await get(`/v1/labs/${'1'.repeat(300)}`);
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json()).toMatchObject({ type: `${PROBLEM_TYPE_BASE}unauthenticated`, status: 401 });
  });
});
