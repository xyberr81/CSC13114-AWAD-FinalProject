// The submit route only puts a judge job on the queue, in the same transaction as the submission.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { submissions } from '../../src/db/schema.js';
import { makeLab, startEnv, statusOf, submit, submitted, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.close());

describe('POST /v1/labs/{labId}/submissions', () => {
  it('enqueues one judge job and judges nothing itself', async () => {
    const id = await submitted(env, await makeLab(env));
    expect(await env.jobs('judge', id)).toMatchObject([{ state: 'created' }]);
    expect(await env.jobs('review', id)).toEqual([]);
    expect(await statusOf(env, id)).toBe('queued');
  });

  it('does not enqueue a replayed request again', async () => {
    const lab = await makeLab(env);
    const key = randomUUID();
    const first = await submit(env, lab, key);
    const second = await submit(env, lab, key);
    expect(second.headers['idempotent-replayed']).toBe('true');
    const { id } = first.json<{ id: number }>();
    expect(second.json<{ id: number }>().id).toBe(id);
    expect(await env.jobs('judge', id)).toHaveLength(1);
  });

  it('§4.1 a replay after judging has the body of the first response', async () => {
    const lab = await makeLab(env);
    const key = randomUUID();
    const first = await submit(env, lab, key);
    const { id } = first.json<{ id: number }>();
    for (const status of ['judging', 'accepted', 'wrong_answer'] as const) {
      await env.db.update(submissions).set({ status }).where(eq(submissions.id, id));
      const replay = await submit(env, lab, key);
      expect(replay.statusCode).toBe(201);
      expect(replay.json()).toEqual(first.json());
    }
  });

  it('eight concurrent requests with one key enqueue one job', async () => {
    const lab = await makeLab(env);
    const key = randomUUID();
    const all = await Promise.all(Array.from({ length: 8 }, () => submit(env, lab, key)));
    expect(all.map((r) => r.statusCode)).toEqual(Array<number>(8).fill(201));
    expect(await env.jobs('judge', all[0]!.json<{ id: number }>().id)).toHaveLength(1);
  });

  it('a refused submission leaves no job', async () => {
    const before = await env.countJobs();
    const lab = await makeLab(env, new Date(Date.now() - 1000));
    expect((await submit(env, lab)).statusCode).toBe(409);
    expect(await env.countJobs()).toBe(before);
  });

  it('no submission is stored when its job cannot be', async () => {
    const lab = await makeLab(env);
    const { sendJudge } = env.queue;
    env.queue.sendJudge = () => Promise.reject(new Error('the queue is down'));
    try {
      expect((await submit(env, lab)).statusCode).toBe(500);
    } finally {
      env.queue.sendJudge = sendJudge;
    }
    expect(await env.db.select().from(submissions).where(eq(submissions.labId, lab.labId))).toEqual(
      [],
    );
  });
});
