// What the database itself refuses, whatever the code in front of it does.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  labConstraints,
  labs,
  labTests,
  submissionTestResults,
  verdicts,
} from '../../src/db/schema.js';
import { makeLab, startEnv, submitted, verdictsOf, type Lab, type TestEnv } from './helpers.js';

let env: TestEnv;
let lab: Lab;
beforeAll(async () => {
  env = await startEnv();
  lab = await makeLab(env);
});
afterAll(() => env.close());

/** The name of the constraint that refused the query; null when the query went through. */
async function refusedBy(query: PromiseLike<unknown>): Promise<string | null> {
  try {
    await query;
    return null;
  } catch (error) {
    return (error as { cause: { constraint: string } }).cause.constraint;
  }
}

describe('FAQ-05 limits of a lab', () => {
  const update = (values: Partial<typeof labs.$inferInsert>) =>
    refusedBy(env.db.update(labs).set(values).where(eq(labs.id, lab.labId)));

  it.each([999, 5001, 0, -1])('refuses a time limit of %i ms', async (timeLimitMs) => {
    expect(await update({ timeLimitMs })).toBe('time_limit_range');
  });
  it.each([63, 513, 0, -1])('refuses a memory limit of %i MB', async (memoryLimitMb) => {
    expect(await update({ memoryLimitMb })).toBe('memory_limit_range');
  });
  it.each([
    [1000, 64],
    [5000, 512],
  ])('takes %i ms and %i MB', async (timeLimitMs, memoryLimitMb) => {
    expect(await update({ timeLimitMs, memoryLimitMb })).toBeNull();
  });
});

describe('FAQ-06 deductions are on the scale of 10', () => {
  const insert = (code: string, deduction: number) =>
    refusedBy(
      env.db.insert(labConstraints).values({ labId: lab.labId, code, text: 'x', deduction }),
    );

  it.each([-1, 11, 100])('refuses a deduction of %i', async (deduction) => {
    expect(await insert(`bad${deduction}`, deduction)).toBe('deduction_range');
  });
  it.each([0, 10])('takes a deduction of %i', async (deduction) => {
    expect(await insert(`ok${deduction}`, deduction)).toBeNull();
  });
});

it('a lab test that has results cannot be deleted', async () => {
  const submissionId = await submitted(env, lab);
  const [test] = await env.db.select().from(labTests).where(eq(labTests.labId, lab.labId)).limit(1);
  await env.db
    .insert(submissionTestResults)
    .values({ submissionId, testId: test!.id, status: 'accepted' });

  expect(await refusedBy(env.db.delete(labTests).where(eq(labTests.id, test!.id)))).toBe(
    'submission_test_results_test_id_lab_tests_id_fk',
  );
});

it('FAQ-08, FAQ-09 a verdict can keep an explanation, or have none', async () => {
  const submissionId = await submitted(env, lab);
  const [first, second] = await env.db
    .select({ id: labConstraints.id })
    .from(labConstraints)
    .where(eq(labConstraints.labId, lab.labId));
  const base = { submissionId, verdict: 'pass', source: 'model' } as const;
  await env.db.insert(verdicts).values([
    { ...base, constraintId: first!.id, explanation: 'The loop on line 4 adds the numbers.' },
    { ...base, constraintId: second!.id },
  ]);

  const rows = await verdictsOf(env, submissionId);
  expect(new Map(rows.map((row) => [row.constraintId, row.explanation]))).toEqual(
    new Map([
      [first!.id, 'The loop on line 4 adds the numbers.'],
      [second!.id, null],
    ]),
  );
});
