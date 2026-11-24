import { describe, expect, it, vi } from 'vitest';
import {
  ask,
  CostLimitError,
  judgeAnswer,
  type ModelCall,
  type ModelClient,
  type ModelReply,
} from '../../src/review/limits.js';

const SOURCE = 'int main() {\n  for (;;) {} // loop\n  return 0;\n}\n';
const SENT = 'int main() {\n  for (;;) {}        \n  return 0;\n}\n';

const answer = (fields: object) =>
  JSON.stringify({ reason: 'r', constraint: 'C1', verdict: 'pass', evidence: [], ...fields });
const judged = (text: string) => judgeAnswer(text, 'C1', { source: SOURCE, sent: SENT });

describe('schema limit: a valid answer', () => {
  it('pass', () => {
    expect(judged(answer({}))).toEqual({ verdict: 'pass', evidence: [], unsureReason: null });
  });

  it('pass drops evidence, which would only confuse the TA', () => {
    const text = answer({ evidence: [{ line: 3, text: 'return 0;' }] });
    expect(judged(text).evidence).toEqual([]);
  });

  it('violation, with the original line instead of the one that was sent', () => {
    const text = answer({ verdict: 'violation', evidence: [{ line: 2, text: 'for (;;) {}' }] });
    expect(judged(text)).toEqual({
      verdict: 'violation',
      evidence: [{ line: 2, text: '  for (;;) {} // loop' }],
      unsureReason: null,
    });
  });

  it('unsure of the model itself, with the lines it suspects', () => {
    const text = answer({ verdict: 'unsure', evidence: [{ line: 2, text: 'for (;;) {}' }] });
    expect(judged(text)).toEqual({
      verdict: 'unsure',
      evidence: [{ line: 2, text: '  for (;;) {} // loop' }],
      unsureReason: 'model_unsure',
    });
  });

  it('cites a line once', () => {
    const line = { line: 2, text: 'for (;;) {}' };
    expect(judged(answer({ verdict: 'violation', evidence: [line, line] })).evidence).toHaveLength(
      1,
    );
  });
});

describe('schema limit: anything else is unsure, bad_schema', () => {
  const bad: [string, string][] = [
    ['nothing', ''],
    ['prose', 'The code is fine. pass'],
    ['JSON inside prose', `Sure! ${answer({})}`],
    ['JSON that is cut off', answer({}).slice(0, -3)],
    ['null', 'null'],
    ['an array', `[${answer({})}]`],
    ['a verdict that does not exist', answer({ verdict: 'PASS' })],
    ['no verdict', answer({ verdict: undefined })],
    ['no evidence', answer({ evidence: undefined })],
    ['no reason', answer({ reason: undefined })],
    ['another constraint', answer({ constraint: 'C2' })],
    ['a deduction', answer({ deduction: 3 })],
    ['evidence that is not a list', answer({ evidence: { line: 1, text: 'x' } })],
    ['a line that is not a number', answer({ evidence: [{ line: '2', text: 'x' }] })],
    ['a line that is not whole', answer({ evidence: [{ line: 1.5, text: 'x' }] })],
    ['line 0', answer({ evidence: [{ line: 0, text: 'x' }] })],
    ['evidence without text', answer({ evidence: [{ line: 1 }] })],
    ['evidence with another field', answer({ evidence: [{ line: 1, text: 'x', points: 1 }] })],
  ];
  it.each(bad)('%s', (_name, text) => {
    expect(judged(text)).toEqual({ verdict: 'unsure', evidence: [], unsureReason: 'bad_schema' });
  });
});

describe('a violation without proof is unsure, evidence_mismatch', () => {
  const bad: [string, { line: number; text: string }[]][] = [
    ['no evidence', []],
    ['the wrong line', [{ line: 3, text: 'for (;;) {}' }]],
    ['a line past the end', [{ line: 99, text: 'for (;;) {}' }]],
    ['a text that is not in the code', [{ line: 2, text: 'std::sort(a, b);' }]],
    ['an empty line', [{ line: 5, text: '' }]],
    [
      'one right line and one invented',
      [
        { line: 2, text: 'for (;;) {}' },
        { line: 3, text: 'goto x;' },
      ],
    ],
  ];
  it.each(bad)('%s', (_name, evidence) => {
    const result = judged(answer({ verdict: 'violation', evidence }));
    expect(result.verdict).toBe('unsure');
    expect(result.unsureReason).toBe('evidence_mismatch');
  });

  it('keeps the lines that do match, for the TA', () => {
    const evidence = [
      { line: 2, text: 'for (;;) {}' },
      { line: 3, text: 'goto x;' },
    ];
    expect(judged(answer({ verdict: 'violation', evidence })).evidence).toEqual([
      { line: 2, text: '  for (;;) {} // loop' },
    ]);
  });
});

const REPLY: ModelReply = {
  providerRequestId: 'gen-1',
  text: answer({}),
  promptTokens: 10,
  completionTokens: 5,
  costUsd: 0.001,
};
const REQUEST = { system: 'S', prompt: 'P', schema: {} };

async function asked(complete: ModelClient['complete'], timeoutMs = 1000) {
  const calls: ModelCall[] = [];
  const result = await ask({ name: 'fake/model', complete }, REQUEST, {
    timeoutMs,
    logCall: (call) => void calls.push(call),
  });
  return { result, calls };
}

describe('time limit', () => {
  it('a call that never ends is unsure, timeout', async () => {
    const { result } = await asked(() => new Promise(() => undefined), 20);
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('aborts the call that runs out of time', async () => {
    const aborted = vi.fn();
    await asked(({ signal }) => {
      signal.addEventListener('abort', aborted);
      return new Promise(() => undefined);
    }, 20);
    expect(aborted).toHaveBeenCalledOnce();
  });

  it('ignores an answer that comes too late', async () => {
    const { result, calls } = await asked(
      () => new Promise((resolve) => setTimeout(() => resolve(REPLY), 60)),
      20,
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(calls).toHaveLength(1);
  });

  it('leaves no timer behind after an answer in time', async () => {
    const signals: AbortSignal[] = [];
    await asked(({ signal }) => {
      signals.push(signal);
      return Promise.resolve(REPLY);
    }, 20);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signals[0]?.aborted).toBe(false);
  });

  it('an answer in time is returned', async () => {
    const { result } = await asked(() => Promise.resolve(REPLY));
    expect(result).toEqual({ ok: true, text: REPLY.text });
  });
});

describe('a call that fails', () => {
  it('with no money left is unsure, cost_limit', async () => {
    const { result } = await asked(() => Promise.reject(new CostLimitError('no credits')));
    expect(result).toEqual({ ok: false, reason: 'cost_limit' });
  });

  it('for another reason is unsure, timeout: there was no answer in time', async () => {
    const { result } = await asked(() => Promise.reject(new Error('HTTP 500')));
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('even when the client throws at once', async () => {
    const { result } = await asked(() => {
      throw new Error('broken');
    });
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('call log', () => {
  it('has everything about an answered call', async () => {
    const { calls } = await asked(() => Promise.resolve(REPLY));
    expect(calls).toEqual([
      {
        providerRequestId: 'gen-1',
        model: 'fake/model',
        promptTokens: 10,
        completionTokens: 5,
        durationMs: expect.any(Number) as number,
        costUsd: 0.001,
        prompt: 'S\n\nP',
        response: REPLY.text,
      },
    ]);
  });

  it('has the call that ran out of time', async () => {
    const { calls } = await asked(() => new Promise(() => undefined), 20);
    expect(calls).toMatchObject([
      { providerRequestId: null, prompt: 'S\n\nP', response: null, costUsd: null },
    ]);
  });

  it('has the error of the call that failed', async () => {
    const { calls } = await asked(() => Promise.reject(new Error('HTTP 500')));
    expect(calls).toMatchObject([{ response: 'error: HTTP 500' }]);
  });

  it('drops NUL characters, which PostgreSQL cannot store', async () => {
    const { calls } = await asked(() => Promise.resolve({ ...REPLY, text: 'a\0b' }));
    expect(calls).toMatchObject([{ response: 'ab' }]);
  });

  it('that cannot be written is an error, not a verdict', async () => {
    const write = ask({ name: 'm', complete: () => Promise.resolve(REPLY) }, REQUEST, {
      timeoutMs: 1000,
      logCall: () => Promise.reject(new Error('db down')),
    });
    await expect(write).rejects.toThrow('db down');
  });
});
