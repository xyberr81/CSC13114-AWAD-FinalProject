import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { buildApp } from '../../src/app.js';
import { issueToken } from '../../src/auth.js';
import { createDb } from '../../src/db/client.js';
import {
  classes,
  classMembers,
  labConstraints,
  labs,
  labTests,
  submissions,
  users,
  verdicts,
} from '../../src/db/schema.js';
import { createQueue } from '../../src/queue/queue.js';

const SECRET = 'queue-test-secret-queue-test-secret';
const HOUR = 60 * 60 * 1000;

/** The database, the queue in a schema of its own, and the API. No worker, no Docker, no model. */
export async function startEnv() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Queue tests need DATABASE_URL (see .env.example)');
  const schema = `pgboss_test_${randomUUID().slice(0, 8)}`;
  const { db, pool } = createDb(url);
  const queue = createQueue(url, { schema });
  await queue.start();
  const app = buildApp({ db, jwtSecret: SECRET, queue }, { logger: false });

  return {
    db,
    queue,
    app,
    close: async () => {
      await app.close();
      await queue.stop();
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
      await pool.end();
    },

    /** Jobs of one queue for one submission, whatever their state. */
    async jobs(name: 'judge' | 'review', submissionId: number) {
      const { rows } = await db.execute<{ state: string; retry_count: number }>(
        sql`SELECT state, retry_count FROM ${sql.raw(schema)}.job
            WHERE name = ${name} AND (data->>'submissionId')::int = ${submissionId}`,
      );
      return rows;
    },

    async countJobs() {
      const { rows } = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.raw(schema)}.job WHERE name IN ('judge', 'review')`,
      );
      return rows[0]!.n;
    },
  };
}

export type TestEnv = Awaited<ReturnType<typeof startEnv>>;

/** An open lab with two tests and two constraints, and a student of its class. */
export async function makeLab(env: TestEnv, deadline = new Date(Date.now() + HOUR)) {
  const unique = randomUUID().slice(0, 8);
  const [cls] = await env.db
    .insert(classes)
    .values({ code: `Q-${unique}`, name: 'Queue tests' })
    .returning();
  const [student] = await env.db
    .insert(users)
    .values({ email: `q-${unique}@test.local`, passwordHash: 'x', role: 'student' })
    .returning();
  await env.db
    .insert(classMembers)
    .values({ classId: cls!.id, userId: student!.id, role: 'student' });
  const [lab] = await env.db
    .insert(labs)
    .values({
      classId: cls!.id,
      title: 'Sum',
      statement: 'Print the sum.',
      deadline,
      timeLimitMs: 2000,
      memoryLimitMb: 128,
    })
    .returning();
  // Inserted out of order: the judge must follow `position`, not the id.
  await env.db.insert(labTests).values([
    { labId: lab!.id, position: 2, input: '3 4', expectedOutput: '7' },
    { labId: lab!.id, position: 1, input: '1 2', expectedOutput: '3' },
  ]);
  await env.db.insert(labConstraints).values([
    { labId: lab!.id, code: 'C1', text: 'Do not use `std::accumulate`.', deduction: 3 },
    { labId: lab!.id, code: 'C2', text: 'Add the numbers yourself.', deduction: 4 },
  ]);
  return { labId: lab!.id, studentId: student!.id, token: await issueToken(student!.id, SECRET) };
}

export type Lab = Awaited<ReturnType<typeof makeLab>>;

export function submit(env: TestEnv, lab: Lab, key: string = randomUUID()) {
  const request: InjectOptions = {
    method: 'POST',
    url: `/v1/labs/${lab.labId}/submissions`,
    headers: { authorization: `Bearer ${lab.token}`, 'idempotency-key': key },
    payload: { language: 'cpp', code: 'int main() {}' },
  };
  return env.app.inject(request);
}

export async function submitted(env: TestEnv, lab: Lab): Promise<number> {
  const res = await submit(env, lab);
  if (res.statusCode !== 201) throw new Error(`${res.statusCode} ${res.body}`);
  return res.json<{ id: number }>().id;
}

export async function statusOf(env: TestEnv, submissionId: number) {
  const [row] = await env.db
    .select({ status: submissions.status })
    .from(submissions)
    .where(eq(submissions.id, submissionId));
  return row?.status;
}

export const verdictsOf = (env: TestEnv, submissionId: number) =>
  env.db.select().from(verdicts).where(eq(verdicts.submissionId, submissionId));
