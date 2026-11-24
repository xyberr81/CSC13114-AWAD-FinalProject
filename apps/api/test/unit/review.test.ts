import { describe, expect, it } from 'vitest';
import { unsureReason, verdictSource, verdictValue } from '../../src/db/schema.js';
import {
  review,
  UNSURE_REASONS,
  VERDICT_SOURCES,
  VERDICT_VALUES,
  type ModelClient,
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
  review({ ...input, code }, { modelOff, model: unusedModel, logCall: unusedLog });

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

  it('is unsure, with a reason, about a semantic constraint', async () => {
    expect((await run(false))[1]).toMatchObject({
      verdict: 'unsure',
      unsureReason: 'model_unsure',
    });
    expect((await run(true))[1]).toMatchObject({ verdict: 'unsure', unsureReason: 'model_off' });
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
