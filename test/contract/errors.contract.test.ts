// The error model shared by every contract in docs/contract/ (section 2).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem, startEnv, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env.close();
});

describe('error model', () => {
  it('§2 a /v1 path that does not exist is 404 not-found as problem+json', async () => {
    const res = await fetch(`${env.baseUrl}/v1/no-such-thing?x=1`);
    const body = await expectProblem(res, 'not-found', 404);
    expect(body.title).toBe('Not found');
  });
});

describe('GET /v1/health', () => {
  it('is 200 with status ok', async () => {
    const res = await fetch(`${env.baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
