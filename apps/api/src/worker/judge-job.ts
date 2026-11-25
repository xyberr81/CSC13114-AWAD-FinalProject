import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { labs, labTests, submissions, submissionTestResults } from '../db/schema.js';
import type { JobQueue } from '../queue/queue.js';
import type { Judge } from '../sandbox/judge.js';

export interface JudgeDeps {
  db: Db;
  queue: JobQueue;
  judge: Judge;
}

const OPEN = ['queued', 'judging'] as const;

/** Safe to run any number of times, also at once: the first run to finish is the one stored. */
export async function handleJudge(
  { db, queue, judge }: JudgeDeps,
  submissionId: number,
): Promise<void> {
  const open = and(eq(submissions.id, submissionId), inArray(submissions.status, [...OPEN]));

  // A submission left in `judging` by a worker that died is picked up again here.
  const [submission] = await db
    .update(submissions)
    .set({ status: 'judging' })
    .where(open)
    .returning({ labId: submissions.labId, code: submissions.code });
  if (!submission) return;

  const [lab] = await db
    .select({ timeLimitMs: labs.timeLimitMs, memoryLimitMb: labs.memoryLimitMb })
    .from(labs)
    .where(eq(labs.id, submission.labId));
  if (!lab) throw new Error(`Submission ${submissionId} has no lab`);
  const tests = await db
    .select({
      id: labTests.id,
      input: labTests.input,
      expectedOutput: labTests.expectedOutput,
    })
    .from(labTests)
    .where(eq(labTests.labId, submission.labId))
    .orderBy(asc(labTests.position));

  const result = await judge(submission.code, tests, lab);

  await db.transaction(async (tx) => {
    const stored = await tx
      .update(submissions)
      .set({ status: result.status })
      .where(open)
      .returning({ id: submissions.id });
    if (stored.length === 0) return;
    if (result.tests.length > 0) {
      await tx
        .insert(submissionTestResults)
        .values(result.tests.map((test) => ({ submissionId, ...test })));
    }
    if (result.status === 'accepted') await queue.sendReview(tx, submissionId);
  });
}
