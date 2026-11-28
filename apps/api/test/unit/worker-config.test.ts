import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../../src/worker/config.js';

const DATABASE_URL = 'postgres://localhost/x';

describe('loadWorkerConfig()', () => {
  it('runs both jobs by default', () => {
    expect(loadWorkerConfig({ DATABASE_URL })).toEqual({
      databaseUrl: DATABASE_URL,
      jobs: ['judge', 'review'],
      concurrency: 2,
      modelOff: false,
      logLevel: 'info',
    });
  });

  it('runs one job when asked', () => {
    expect(loadWorkerConfig({ DATABASE_URL, WORKER_JOBS: 'judge' }).jobs).toEqual(['judge']);
    expect(loadWorkerConfig({ DATABASE_URL, WORKER_JOBS: ' review ' }).jobs).toEqual(['review']);
  });

  it('refuses unknown jobs, a bad concurrency and a missing database', () => {
    for (const WORKER_JOBS of ['judge,publish', 'nothing', ',']) {
      expect(() => loadWorkerConfig({ DATABASE_URL, WORKER_JOBS })).toThrow('WORKER_JOBS');
    }
    for (const WORKER_CONCURRENCY of ['0', '1.5', 'x', '17']) {
      expect(() => loadWorkerConfig({ DATABASE_URL, WORKER_CONCURRENCY })).toThrow('CONCURRENCY');
    }
    expect(() => loadWorkerConfig({})).toThrow('DATABASE_URL');
  });

  it('refuses the model key in a worker that only judges', () => {
    const env = { DATABASE_URL, LLM_API_KEY: 'k' };
    expect(() => loadWorkerConfig({ ...env, WORKER_JOBS: 'judge' })).toThrow('LLM_API_KEY');
    expect(loadWorkerConfig({ ...env, WORKER_JOBS: 'review' }).jobs).toEqual(['review']);
  });

  it('MODEL_OFF is on only for 1', () => {
    expect(loadWorkerConfig({ DATABASE_URL, MODEL_OFF: '1' }).modelOff).toBe(true);
    expect(loadWorkerConfig({ DATABASE_URL, MODEL_OFF: '0' }).modelOff).toBe(false);
  });
});
