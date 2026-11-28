import { modelFromEnv } from '../review/openrouter.js';
import type { ModelClient } from '../review/review.js';
import type { WorkerConfig } from './config.js';

const noModel: ModelClient = {
  name: 'none',
  complete: () => Promise.reject(new Error('No model is configured')),
};

/** Without its settings a worker that reviews does not start, instead of being unsure every time. */
export function workerModel(
  { jobs, modelOff }: Pick<WorkerConfig, 'jobs' | 'modelOff'>,
  env: NodeJS.ProcessEnv = process.env,
): ModelClient {
  return jobs.includes('review') && !modelOff ? modelFromEnv(env) : noModel;
}
