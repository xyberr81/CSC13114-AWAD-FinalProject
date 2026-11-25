import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { labConstraints, labs, modelCalls, submissions, verdicts } from '../db/schema.js';
import type { review, ReviewOptions } from '../review/review.js';

export interface ReviewDeps {
  db: Db;
  review: typeof review;
  model: ReviewOptions['model'];
  modelOff: boolean;
}

/**
 * Safe to run any number of times: only constraints without a verdict are reviewed, and one that
 * gets a verdict meanwhile keeps its first.
 */
export async function handleReview(
  { db, review, model, modelOff }: ReviewDeps,
  submissionId: number,
): Promise<void> {
  const [submission] = await db
    .select({
      labId: submissions.labId,
      code: submissions.code,
      status: submissions.status,
      statement: labs.statement,
    })
    .from(submissions)
    .innerJoin(labs, eq(labs.id, submissions.labId))
    .where(eq(submissions.id, submissionId));
  if (submission?.status !== 'accepted') return;

  const constraints = await db
    .select({ id: labConstraints.id, code: labConstraints.code, text: labConstraints.text })
    .from(labConstraints)
    .leftJoin(
      verdicts,
      and(eq(verdicts.constraintId, labConstraints.id), eq(verdicts.submissionId, submissionId)),
    )
    .where(and(eq(labConstraints.labId, submission.labId), isNull(verdicts.id)))
    .orderBy(asc(labConstraints.code));
  if (constraints.length === 0) return;

  const reviewed = await review(
    {
      statement: submission.statement,
      constraints: constraints.map(({ code, text }) => ({ code, text })),
      code: submission.code,
    },
    {
      model,
      modelOff,
      logCall: async ({ costUsd, ...call }) => {
        await db.insert(modelCalls).values({
          submissionId,
          ...call,
          costUsd: costUsd === null ? null : costUsd.toFixed(6),
        });
      },
    },
  );

  const byCode = new Map(reviewed.map((verdict) => [verdict.constraint, verdict]));
  const missing: string[] = [];
  for (const { id, code } of constraints) {
    const verdict = byCode.get(code);
    if (!verdict) {
      missing.push(code);
      continue;
    }
    await db
      .insert(verdicts)
      .values({
        submissionId,
        constraintId: id,
        verdict: verdict.verdict,
        evidence: verdict.evidence,
        source: verdict.source,
        unsureReason: verdict.unsureReason,
        explanation: verdict.explanation,
      })
      .onConflictDoNothing();
  }
  if (missing.length > 0) {
    throw new Error(`Submission ${submissionId} got no verdict for ${missing.join(', ')}`);
  }
}
