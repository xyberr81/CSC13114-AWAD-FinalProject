// `npm run worker`: a process of its own that judges and reviews what the API puts on the queue.
import { createDb } from '../db/client.js';
import { createQueue } from '../queue/queue.js';
import { review, type ModelClient } from '../review/review.js';
import { removeLeftoverContainers } from '../sandbox/docker.js';
import { judge } from '../sandbox/judge.js';
import { loadWorkerConfig } from './config.js';
import { startWorker } from './worker.js';

const log = (level: 'info' | 'error', msg: string, extra: object = {}) =>
  console[level](JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }));
const describe = (error: unknown) => ({
  error: error instanceof Error ? error.message : String(error),
});

// Replaced by the OpenRouter client once review() calls a model.
const model: ModelClient = {
  name: 'none',
  complete: () => Promise.reject(new Error('No model client is configured')),
};

const config = loadWorkerConfig();
const { db, pool } = createDb(config.databaseUrl);
const queue = createQueue(config.databaseUrl, {
  supervise: true,
  onError: (error) => log('error', 'queue error', describe(error)),
});

if (config.jobs.includes('judge')) {
  const removed = await removeLeftoverContainers();
  if (removed > 0) log('info', 'removed containers of an earlier worker', { removed });
}
await queue.start();
const worker = await startWorker({
  db,
  queue,
  judge,
  review,
  model,
  modelOff: config.modelOff,
  jobs: config.jobs,
  concurrency: config.concurrency,
  onFailure: (job, submissionId, error) =>
    log('error', 'job failed, will be retried', { job, submissionId, ...describe(error) }),
});
log('info', 'worker started', { jobs: config.jobs, concurrency: config.concurrency });

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  log('info', 'worker stopping');
  await worker.stop();
  await queue.stop();
  await pool.end();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop());
