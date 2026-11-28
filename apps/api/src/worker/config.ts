import { JOB_NAMES, type JobName } from '../queue/queue.js';

export interface WorkerConfig {
  databaseUrl: string;
  jobs: JobName[];
  concurrency: number;
  modelOff: boolean;
  logLevel: string;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const names = (env.WORKER_JOBS || JOB_NAMES.join(',')).split(',').map((name) => name.trim());
  const jobs = JOB_NAMES.filter((name) => names.includes(name));
  if (jobs.length === 0 || jobs.length !== names.length) {
    throw new Error(`WORKER_JOBS must list judge, review or both, got "${env.WORKER_JOBS}"`);
  }
  // The process that may use Docker must not hold the model key (.env.example).
  if (!jobs.includes('review') && env.LLM_API_KEY) {
    throw new Error('A worker that only judges must not be given LLM_API_KEY');
  }

  const concurrency = env.WORKER_CONCURRENCY ? Number(env.WORKER_CONCURRENCY) : 2;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error(`WORKER_CONCURRENCY must be 1 to 16, got "${env.WORKER_CONCURRENCY}"`);
  }

  return {
    databaseUrl: env.DATABASE_URL,
    jobs,
    concurrency,
    modelOff: env.MODEL_OFF === '1',
    logLevel: env.LOG_LEVEL || 'info',
  };
}
