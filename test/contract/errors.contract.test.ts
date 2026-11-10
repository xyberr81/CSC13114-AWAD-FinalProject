// Error model shared by every endpoint contract in docs/contract/ (section "Errors").
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROBLEM_TYPE_BASE, startServer } from './helpers.js';

let baseUrl: string;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ baseUrl, close } = await startServer());
});
afterAll(async () => {
  await close();
});

describe('error model', () => {
  it('§Errors a /v1 path that does not exist is 404 not-found as problem+json', async () => {
    const res = await fetch(`${baseUrl}/v1/no-such-thing?x=1`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: `${PROBLEM_TYPE_BASE}not-found`,
      title: 'Not found',
      status: 404,
    });
    expect(typeof body.detail).toBe('string');
  });
});

describe('GET /v1/health', () => {
  it('is 200 with status ok', async () => {
    const res = await fetch(`${baseUrl}/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
