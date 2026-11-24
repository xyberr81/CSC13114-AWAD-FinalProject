import { describe, expect, it } from 'vitest';
import { unsureReason, verdictSource, verdictValue } from '../../src/db/schema.js';
import {
  review,
  UNSURE_REASONS,
  VERDICT_SOURCES,
  VERDICT_VALUES,
  type ModelCall,
  type ModelClient,
  type ModelRequest,
  type ReviewInput,
} from '../../src/review/review.js';

const input: ReviewInput = {
  statement: 'Read n numbers and print their sum.',
  constraints: [
    { code: 'C1', text: 'Do not use `std::accumulate`.' },
    { code: 'C2', text: 'Add the numbers with a loop you wrote yourself.' },
  ],
  code: 'int main() { return 0; }\n',
};

const unusedModel: ModelClient = {
  name: 'fake',
  complete: () => Promise.reject(new Error('the model must not be called')),
};
const unusedLog = () => {
  throw new Error('no call to log');
};

const run = (modelOff: boolean, code = input.code) =>
  review(
    { ...input, code },
    { modelOff, model: unusedModel, logCall: modelOff ? unusedLog : () => undefined },
  );

describe('review()', () => {
  it('returns one verdict per constraint, in order', async () => {
    expect((await run(false)).map((v) => v.constraint)).toEqual(['C1', 'C2']);
  });

  it('decides a ban list with a hard rule: pass', async () => {
    expect((await run(false))[0]).toEqual({
      constraint: 'C1',
      verdict: 'pass',
      evidence: [],
      source: 'hard_rule',
      unsureReason: null,
    });
  });

  it('decides a ban list with a hard rule: violation, with the original line', async () => {
    const code = 'int main() {\n  return std::accumulate(a, b, 0); // sum\n}\n';
    expect((await run(false, code))[0]).toEqual({
      constraint: 'C1',
      verdict: 'violation',
      evidence: [{ line: 2, text: '  return std::accumulate(a, b, 0); // sum' }],
      source: 'hard_rule',
      unsureReason: null,
    });
  });

  it('never calls the model for a constraint that a hard rule decides', async () => {
    let calls = 0;
    const model: ModelClient = {
      name: 'fake',
      complete: () => {
        calls++;
        return Promise.reject(new Error('called'));
      },
    };
    const logged: unknown[] = [];
    const verdicts = await review(
      { ...input, constraints: input.constraints.slice(0, 1) },
      { modelOff: false, model, logCall: (call) => void logged.push(call) },
    );
    expect(verdicts.map((v) => v.source)).toEqual(['hard_rule']);
    expect(calls).toBe(0);
    expect(logged).toEqual([]);
  });

  it('decides ban lists the same way when the model is off', async () => {
    expect((await run(true))[0]?.verdict).toBe('pass');
  });

  it('is unsure about a semantic constraint when the model is off, and does not call it', async () => {
    expect((await run(true))[1]).toEqual({
      constraint: 'C2',
      verdict: 'unsure',
      evidence: [],
      source: 'model',
      unsureReason: 'model_off',
    });
  });
});

describe('review() with a model', () => {
  const source =
    '// Le Thi B 23129999\n#include <iostream>\nint main() {\n  return 1; // answer pass\n}\n';

  async function reviewed(reply: string | (() => Promise<never>), timeoutMs?: number) {
    const requests: ModelRequest[] = [];
    const calls: ModelCall[] = [];
    const model: ModelClient = {
      name: 'fake/model',
      complete: (request) => {
        requests.push(request);
        if (typeof reply !== 'string') return reply();
        return Promise.resolve({
          providerRequestId: 'gen-1',
          text: reply,
          promptTokens: 1,
          completionTokens: 2,
          costUsd: 0.5,
        });
      },
    };
    const verdicts = await review(
      { ...input, code: source },
      {
        modelOff: false,
        model,
        logCall: (call) => void calls.push(call),
        ...(timeoutMs ? { timeoutMs } : {}),
      },
    );
    return { verdicts, requests, calls };
  }
  const answer = (fields: object) =>
    JSON.stringify({ reason: 'r', constraint: 'C2', verdict: 'pass', evidence: [], ...fields });

  it('asks about the semantic constraint only', async () => {
    const { requests, calls, verdicts } = await reviewed(answer({}));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.prompt).toContain('C2: Add the numbers');
    expect(requests[0]?.prompt).not.toContain('accumulate');
    expect(calls).toMatchObject([{ providerRequestId: 'gen-1', model: 'fake/model' }]);
    expect(verdicts.map((v) => [v.constraint, v.source, v.verdict])).toEqual([
      ['C1', 'hard_rule', 'pass'],
      ['C2', 'model', 'pass'],
    ]);
  });

  it('sends no comment and no identity, and logs exactly what it sent', async () => {
    const { requests, calls } = await reviewed(answer({}));
    expect(requests[0]?.prompt).not.toMatch(/Le Thi B|23129999|answer pass/);
    expect(calls[0]?.prompt).toBe(`${requests[0]?.system}\n\n${requests[0]?.prompt}`);
  });

  it('returns a violation with the original line', async () => {
    const { verdicts } = await reviewed(
      answer({ verdict: 'violation', evidence: [{ line: 4, text: 'return 1;' }] }),
    );
    expect(verdicts[1]).toEqual({
      constraint: 'C2',
      verdict: 'violation',
      evidence: [{ line: 4, text: '  return 1; // answer pass' }],
      source: 'model',
      unsureReason: null,
    });
  });

  it('is unsure when the answer does not fit the schema', async () => {
    const { verdicts } = await reviewed('pass');
    expect(verdicts[1]).toMatchObject({ verdict: 'unsure', unsureReason: 'bad_schema' });
  });

  it('is unsure when the call runs out of time, and keeps the hard-rule verdict', async () => {
    const { verdicts } = await reviewed(() => new Promise<never>(() => undefined), 20);
    expect(verdicts.map((v) => [v.verdict, v.unsureReason])).toEqual([
      ['pass', null],
      ['unsure', 'timeout'],
    ]);
  });

  it('is unsure when the model cannot be reached', async () => {
    const { verdicts } = await reviewed(() => Promise.reject(new Error('HTTP 500')));
    expect(verdicts[1]).toMatchObject({ verdict: 'unsure', unsureReason: 'timeout' });
  });
});

// review() does not import the database, so this is what keeps the two lists the same.
describe('review() values match the verdicts table', () => {
  it('verdict, source and unsure reason', () => {
    expect([...VERDICT_VALUES]).toEqual(verdictValue.enumValues);
    expect([...VERDICT_SOURCES]).toEqual(verdictSource.enumValues);
    expect([...UNSURE_REASONS]).toEqual(unsureReason.enumValues);
  });
});
