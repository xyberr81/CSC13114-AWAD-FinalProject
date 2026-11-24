// Rubric PA#3, criterion 2: stop the worker, submit, start it again, and the submission is judged
// exactly once, which means one set of verdicts, even if the judging itself ran twice.
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { modelCalls, submissions, submissionTestResults } from '../../src/db/schema.js';
import { review, type ReviewOptions } from '../../src/review/review.js';
import type { Judge, TestStatus } from '../../src/sandbox/judge.js';
import { handleJudge } from '../../src/worker/judge-job.js';
import { handleReview } from '../../src/worker/review-job.js';
import { startWorker, type Worker } from '../../src/worker/worker.js';
import { makeLab, startEnv, statusOf, submitted, verdictsOf, type TestEnv } from './helpers.js';

const noModel: ReviewOptions['model'] = {
  name: 'none',
  complete: () => Promise.reject(new Error('no model in this test')),
};
const answer =
  (status: TestStatus): Judge =>
  (_code, tests) =>
    Promise.resolve({
      status,
      tests: tests.map((t) => ({ testId: t.id, status, timeMs: 5, memoryKb: null })),
    });

let env: TestEnv;
let worker: Worker | undefined;
const judge = vi.fn<Judge>();
const reviewSpy = vi.fn<typeof review>();

beforeAll(async () => {
  env = await startEnv();
});
afterAll(() => env.close());
beforeEach(() => {
  judge.mockReset().mockImplementation(answer('accepted'));
  reviewSpy.mockReset().mockImplementation(review);
});
afterEach(async () => {
  await worker?.stop();
  worker = undefined;
});

const deps = () => ({
  db: env.db,
  queue: env.queue,
  judge,
  review: reviewSpy,
  model: noModel,
  modelOff: true,
});
const start = async (jobs: ('judge' | 'review')[] = ['judge', 'review']) => {
  worker = await startWorker({ ...deps(), jobs, pollingSeconds: 0.5 });
};
const stop = async () => {
  await worker?.stop();
  worker = undefined;
};
const results = (id: number) =>
  env.db.select().from(submissionTestResults).where(eq(submissionTestResults.submissionId, id));
const verdictCount = (id: number) => async () => (await verdictsOf(env, id)).length;
const WAIT = { timeout: 20_000, interval: 100 };

async function expectOneSet(id: number) {
  expect(await statusOf(env, id)).toBe('accepted');
  expect(await results(id)).toHaveLength(2);
  expect((await verdictsOf(env, id)).map((v) => v.verdict)).toEqual(['unsure', 'unsure']);
  expect(await env.jobs('review', id)).toHaveLength(1);
}

describe('judged exactly once', () => {
  it('worker stopped, submit, worker started: one set of verdicts', async () => {
    await start();
    await stop();
    const id = await submitted(env, await makeLab(env));
    expect(await statusOf(env, id)).toBe('queued');
    expect(judge).not.toHaveBeenCalled();

    await start();
    await expect.poll(verdictCount(id), WAIT).toBe(2);
    await expectOneSet(id);

    await stop();
    await start();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expectOneSet(id);
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it('the judge job delivered twice, one after the other', async () => {
    const id = await submitted(env, await makeLab(env));
    await handleJudge(deps(), id);
    await handleJudge(deps(), id);
    expect(judge).toHaveBeenCalledTimes(1);
    await handleReview(deps(), id);
    await expectOneSet(id);
  });

  it('the judge job delivered twice at once, with different answers', async () => {
    const id = await submitted(env, await makeLab(env));
    judge.mockImplementationOnce(answer('accepted')).mockImplementationOnce(answer('wrong_answer'));
    await Promise.all([handleJudge(deps(), id), handleJudge(deps(), id)]);
    expect(judge).toHaveBeenCalledTimes(2);

    const status = await statusOf(env, id);
    const stored = await results(id);
    expect(stored).toHaveLength(2);
    expect(stored.map((r) => r.status)).toEqual([status, status]);
    expect(await env.jobs('review', id)).toHaveLength(status === 'accepted' ? 1 : 0);
  });

  it('the review job delivered twice, at once and later', async () => {
    const id = await submitted(env, await makeLab(env));
    await handleJudge(deps(), id);
    await Promise.all([handleReview(deps(), id), handleReview(deps(), id)]);
    const calls = reviewSpy.mock.calls.length;
    await handleReview(deps(), id);
    expect(reviewSpy).toHaveBeenCalledTimes(calls);
    await expectOneSet(id);
  });

  it('a worker that died while judging: the next delivery finishes the job', async () => {
    const id = await submitted(env, await makeLab(env));
    await env.db.update(submissions).set({ status: 'judging' }).where(eq(submissions.id, id));
    await handleJudge(deps(), id);
    await handleReview(deps(), id);
    await expectOneSet(id);
  });
});

describe('the judge job', () => {
  it('gives judge() the code, the tests in order and the limits of the lab', async () => {
    const id = await submitted(env, await makeLab(env));
    await handleJudge(deps(), id);
    const [code, tests, limits] = judge.mock.calls[0]!;
    expect(code).toBe('int main() {}');
    expect(tests.map((t) => [t.input, t.expectedOutput])).toEqual([
      ['1 2', '3'],
      ['3 4', '7'],
    ]);
    expect(limits).toEqual({ timeLimitMs: 2000, memoryLimitMb: 128 });
  });

  it('a submission that is not accepted is not reviewed', async () => {
    const id = await submitted(env, await makeLab(env));
    judge.mockImplementation(answer('wrong_answer'));
    await handleJudge(deps(), id);
    expect(await statusOf(env, id)).toBe('wrong_answer');
    expect(await env.jobs('review', id)).toEqual([]);
    await handleReview(deps(), id);
    expect(await verdictsOf(env, id)).toEqual([]);
    expect(reviewSpy).not.toHaveBeenCalled();
  });

  it('compile_error has no test results', async () => {
    const id = await submitted(env, await makeLab(env));
    judge.mockResolvedValue({ status: 'compile_error', tests: [] });
    await handleJudge(deps(), id);
    expect(await statusOf(env, id)).toBe('compile_error');
    expect(await results(id)).toEqual([]);
  });

  it('a sandbox that fails is retried and never becomes the result of the student', async () => {
    const id = await submitted(env, await makeLab(env));
    judge.mockRejectedValueOnce(new Error('Docker is down'));
    await start();
    await expect.poll(() => statusOf(env, id), WAIT).toBe('accepted');
    expect(judge).toHaveBeenCalledTimes(2);
    expect(await results(id)).toHaveLength(2);
  });
});

describe('the review job', () => {
  it('sends no identity and no deduction, and stores what review() returned', async () => {
    const id = await submitted(env, await makeLab(env));
    reviewSpy.mockResolvedValue([
      {
        constraint: 'C2',
        verdict: 'violation',
        evidence: [{ line: 1, text: 'int main() {}' }],
        source: 'model',
        unsureReason: null,
      },
      { constraint: 'C1', verdict: 'pass', evidence: [], source: 'hard_rule', unsureReason: null },
    ]);
    await handleJudge(deps(), id);
    await handleReview(deps(), id);

    expect(reviewSpy.mock.calls[0]![0]).toEqual({
      statement: 'Print the sum.',
      constraints: [
        { code: 'C1', text: 'Do not use `std::accumulate`.' },
        { code: 'C2', text: 'Add the numbers yourself.' },
      ],
      code: 'int main() {}',
    });
    const stored = (await verdictsOf(env, id)).sort((a, b) => a.constraintId - b.constraintId);
    expect(stored).toMatchObject([
      { verdict: 'pass', source: 'hard_rule', evidence: [], unsureReason: null },
      { verdict: 'violation', source: 'model', evidence: [{ line: 1, text: 'int main() {}' }] },
    ]);
  });

  it('asks only about constraints that have no verdict yet', async () => {
    const id = await submitted(env, await makeLab(env));
    await handleJudge(deps(), id);
    reviewSpy.mockResolvedValueOnce([
      { constraint: 'C1', verdict: 'pass', evidence: [], source: 'hard_rule', unsureReason: null },
    ]);
    await expect(handleReview(deps(), id)).rejects.toThrow('C2');
    await handleReview(deps(), id);
    expect(reviewSpy.mock.calls[1]![0].constraints.map((c) => c.code)).toEqual(['C2']);
    expect(await verdictsOf(env, id)).toHaveLength(2);
  });

  it('stores every model call in model_calls', async () => {
    const id = await submitted(env, await makeLab(env));
    reviewSpy.mockImplementation(async (input, options) => {
      await options.logCall({
        providerRequestId: 'gen-1',
        model: 'fake/model',
        promptTokens: 10,
        completionTokens: 2,
        durationMs: 30,
        costUsd: 0.000123,
        prompt: 'prompt',
        response: '{}',
      });
      return review(input, options);
    });
    await handleJudge(deps(), id);
    await handleReview(deps(), id);
    const calls = await env.db.select().from(modelCalls).where(eq(modelCalls.submissionId, id));
    expect(calls).toMatchObject([
      { providerRequestId: 'gen-1', model: 'fake/model', costUsd: '0.000123', response: '{}' },
    ]);
  });
});

describe('two processes', () => {
  it('a worker that only judges leaves the review to the other one', async () => {
    const id = await submitted(env, await makeLab(env));
    await start(['judge']);
    await expect.poll(() => statusOf(env, id), WAIT).toBe('accepted');
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await verdictsOf(env, id)).toEqual([]);
    expect(reviewSpy).not.toHaveBeenCalled();

    await stop();
    await start(['review']);
    await expect.poll(verdictCount(id), WAIT).toBe(2);
    expect(judge).toHaveBeenCalledTimes(1);
  });
});
