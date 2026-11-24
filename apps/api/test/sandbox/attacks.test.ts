// One test per sandbox minimum (brief §5, rubric PA#3 criterion 2). An attack that prints what it
// saw is judged twice, against both answers: a judge that accepts or rejects everything fails.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attack, judgeOne, sandboxContainers } from './helpers.js';

async function expectOutput(name: string, harmless: string, harmful: string) {
  expect((await judgeOne(attack(name), harmless)).status).toBe('accepted');
  expect((await judgeOne(attack(name), harmful)).status).toBe('wrong_answer');
}

describe('sandbox minimums', () => {
  it('1 no network', () => expectOutput('01-network', 'blocked', 'connected'));

  it('2 CPU time limit, before the wall clock', async () => {
    const result = await judgeOne(attack('02-cpu'), '');
    expect(result.status).toBe('time_limit');
    expect(result.tests[0]?.timeMs).toBeLessThan(2500);
  });

  it('3 wall-clock limit kills the whole container', async () => {
    const started = Date.now();
    expect((await judgeOne(attack('03-sleep'), '')).status).toBe('time_limit');
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(sandboxContainers()).toEqual([]);
  });

  it('4 memory limit, swap included', async () => {
    expect((await judgeOne(attack('04-memory'), 'allocated')).status).toBe('memory_limit');
  });

  it('5 process limit', () => expectOutput('05-processes', 'limited', 'unlimited'));

  it('5 a fork bomb ends with the container', async () => {
    expect((await judgeOne(attack('05-fork-bomb'), '')).status).toBe('time_limit');
    expect(sandboxContainers()).toEqual([]);
  });

  it('6 output size limit', async () => {
    expect((await judgeOne(attack('06-output'), '')).status).toBe('runtime_error');
    expect(sandboxContainers()).toEqual([]);
  });

  it('7 non-root user', () => expectOutput('07-root', 'unprivileged', 'root'));

  it('8 no host mounts and no Docker socket', () =>
    expectOutput('08-mounts', 'nothing', 'host visible'));

  it('8 nothing outside /tmp can be written', () =>
    expectOutput('08-write', 'read-only', 'written'));
});

describe('9 no secrets', () => {
  const KEYS = ['LLM_API_KEY', 'MODEL_API_KEY'];
  let saved: (string | undefined)[];

  beforeEach(() => {
    saved = KEYS.map((key) => process.env[key]);
    for (const key of KEYS) process.env[key] = 'canary-key-0123456789';
  });
  afterEach(() => {
    KEYS.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  });

  it("9 the judge's environment and .env files are not in the sandbox", () =>
    expectOutput('09-environment', 'clean', 'leaked'));

  it('9 the compiler cannot include a file of the host', async () => {
    expect((await judgeOne(attack('09-include'), '')).status).toBe('compile_error');
  });
});

describe('compiling is sandboxed too', () => {
  it('a compilation that never ends is a compile error', async () => {
    expect((await judgeOne(attack('10-compile-forever'), '')).status).toBe('compile_error');
    expect(sandboxContainers()).toEqual([]);
  });
});
