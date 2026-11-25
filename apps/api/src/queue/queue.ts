// The job queue: pg-boss in the application's own PostgreSQL. Jobs are sent inside the caller's
// transaction, so a submission and its job are stored together or not at all.
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import type { Db } from '../db/client.js';

export type JobName = 'judge' | 'review';
export const JOB_NAMES: JobName[] = ['judge', 'review'];

export interface SubmissionJob {
  submissionId: number;
}

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What the API and the job handlers need to know about the queue. */
export interface JobQueue {
  sendJudge: (tx: Tx, submissionId: number) => Promise<void>;
  sendReview: (tx: Tx, submissionId: number) => Promise<void>;
}

export interface Queue extends JobQueue {
  boss: PgBoss;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface QueueSettings {
  /** The PostgreSQL schema that holds the jobs. */
  schema?: string;
  /** The worker looks after retries and expired jobs; the API only sends. */
  supervise?: boolean;
  onError?: (error: Error) => void;
}

// Delivery is at least once: a worker that dies stops sending heartbeats and its job is delivered
// again. The handlers make that harmless. A sandbox or a database that is down for a while must
// not lose a submission, so there are many retries, up to a minute apart.
const QUEUE_OPTIONS = {
  retryLimit: 50,
  retryDelay: 1,
  retryBackoff: true,
  retryDelayMax: 60,
  heartbeatSeconds: 30,
};

export function createQueue(databaseUrl: string, settings: QueueSettings = {}): Queue {
  const { schema = 'pgboss', supervise = false, onError = () => undefined } = settings;
  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema,
    supervise,
    schedule: false,
    monitorIntervalSeconds: 30,
    application_name: 'leetkob-queue',
  });
  // Without a listener an error of a background connection would end the process.
  boss.on('error', onError);

  const send = async (name: JobName, tx: Tx, submissionId: number) => {
    const id = await boss.send(name, { submissionId } satisfies SubmissionJob, {
      db: fromDrizzle(tx, sql),
    });
    if (id === null)
      throw new Error(`The ${name} job of submission ${submissionId} was not stored`);
  };

  return {
    boss,
    start: async () => {
      await boss.start();
      for (const name of JOB_NAMES) await boss.createQueue(name, QUEUE_OPTIONS);
    },
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
    sendJudge: (tx, submissionId) => send('judge', tx, submissionId),
    sendReview: (tx, submissionId) => send('review', tx, submissionId),
  };
}
