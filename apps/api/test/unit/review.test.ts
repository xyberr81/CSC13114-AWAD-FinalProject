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

describe('review() (stub)', () => {
  it('returns one verdict per constraint, in order', async () => {
    const verdicts = await review(input, {
      modelOff: false,
      model: unusedModel,
      logCall: unusedLog,
    });
    expect(verdicts.map((v) => v.constraint)).toEqual(['C1', 'C2']);
  });

  it('is unsure, with a reason, about every constraint', async () => {
    const verdicts = await review(input, {
      modelOff: false,
      model: unusedModel,
      logCall: unusedLog,
    });
    expect(verdicts.map((v) => [v.verdict, v.unsureReason])).toEqual([
      ['unsure', 'model_unsure'],
      ['unsure', 'model_unsure'],
    ]);
  });

  it('gives model_off as the reason when the model is off', async () => {
    const verdicts = await review(input, {
      modelOff: true,
      model: unusedModel,
      logCall: unusedLog,
    });
    expect(verdicts.map((v) => v.unsureReason)).toEqual(['model_off', 'model_off']);
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
