import { describe, expect, it } from 'vitest';
import { submissionStatus, testStatus } from '../../src/db/schema.js';
import { judge, TEST_STATUSES, type JudgeLimits } from '../../src/sandbox/judge.js';

const limits: JudgeLimits = { timeLimitMs: 1000, memoryLimitMb: 256 };

describe('judge() (stub)', () => {
  it('returns one result per test, in order', async () => {
    const result = await judge(
      'int main() {}',
      [
        { id: 7, input: '1', expectedOutput: '1' },
        { id: 3, input: '2', expectedOutput: '2' },
      ],
      limits,
    );
    expect(result.status).toBe('accepted');
    expect(result.tests.map((t) => t.testId)).toEqual([7, 3]);
  });

  it('refuses a lab without tests instead of accepting everything', async () => {
    await expect(judge('int main() {}', [], limits)).rejects.toThrow('without tests');
  });
});

// judge() does not import the database, so this is what keeps the two lists the same.
describe('judge() statuses match the schema', () => {
  it('test statuses', () => {
    expect([...TEST_STATUSES]).toEqual(testStatus.enumValues);
  });

  it('every judge status is a submission status', () => {
    for (const status of [...TEST_STATUSES, 'compile_error']) {
      expect(submissionStatus.enumValues).toContain(status);
    }
  });
});
