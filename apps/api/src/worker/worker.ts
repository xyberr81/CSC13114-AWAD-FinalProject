import type { JobName, Queue, SubmissionJob } from '../queue/queue.js';
import { handleJudge, type JudgeDeps } from './judge-job.js';
import { handleReview, type ReviewDeps } from './review-job.js';

export interface WorkerDeps extends JudgeDeps, ReviewDeps {
  queue: Queue;
  jobs: JobName[];
  /** Jobs of each kind at the same time; a judge job runs one container at a time. */
  concurrency?: number;
  pollingSeconds?: number;
  onFailure?: (job: JobName, submissionId: number, error: unknown) => void;
}

export interface Worker {
  /** Waits for the jobs that are running. */
  stop: () => Promise<void>;
}

export async function startWorker(deps: WorkerDeps): Promise<Worker> {
  const { queue, jobs, concurrency = 1, pollingSeconds = 1, onFailure } = deps;
  const handlers: Record<JobName, (submissionId: number) => Promise<void>> = {
    judge: (id) => handleJudge(deps, id),
    review: (id) => handleReview(deps, id),
  };

  for (const name of jobs) {
    await queue.boss.work<SubmissionJob>(
      name,
      { batchSize: 1, localConcurrency: concurrency, pollingIntervalSeconds: pollingSeconds },
      async (batch) => {
        for (const { data } of batch) {
          try {
            await handlers[name](data.submissionId);
          } catch (error) {
            onFailure?.(name, data.submissionId, error);
            // pg-boss delivers the job again.
            throw error;
          }
        }
      },
    );
  }

  return {
    stop: async () => {
      for (const name of jobs) await queue.boss.offWork(name, { wait: true });
    },
  };
}
