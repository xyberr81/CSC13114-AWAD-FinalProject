import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../../src/worker/config.js';
import { workerModel } from '../../src/worker/model.js';

const DATABASE_URL = 'postgres://localhost/x';
const LLM = { LLM_PROVIDER: 'openrouter', LLM_MODEL: 'fake/model', LLM_API_KEY: 'k' };
const modelFor = (env: NodeJS.ProcessEnv) =>
  workerModel(loadWorkerConfig({ DATABASE_URL, ...env }), env);
const request = { system: 's', prompt: 'p', schema: {}, signal: new AbortController().signal };

describe('workerModel()', () => {
  it('is the configured model in a worker that reviews', () => {
    expect(modelFor({ ...LLM, WORKER_JOBS: 'review' }).name).toBe('fake/model');
    expect(modelFor(LLM).name).toBe('fake/model');
  });

  it.each(['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY'])(
    'stops a worker that reviews without %s',
    (name) => {
      expect(() => modelFor({ ...LLM, WORKER_JOBS: 'review', [name]: '' })).toThrow(name);
    },
  );

  it('needs no model settings when the model is off, and cannot be called', async () => {
    const model = modelFor({ WORKER_JOBS: 'review', MODEL_OFF: '1' });
    expect(model.name).toBe('none');
    await expect(model.complete(request)).rejects.toThrow('No model');
  });

  it('is off even with a key when the model is off', () => {
    expect(modelFor({ ...LLM, MODEL_OFF: '1' }).name).toBe('none');
  });

  it('needs no model settings in a worker that only judges', () => {
    expect(modelFor({ WORKER_JOBS: 'judge' }).name).toBe('none');
  });
});
