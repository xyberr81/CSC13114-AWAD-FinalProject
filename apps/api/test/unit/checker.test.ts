import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArguments, UsageError } from '../../src/checker/arguments.js';
import { check, type CheckOptions, type LoggedCall } from '../../src/checker/check.js';
import { readDataset } from '../../src/checker/dataset.js';
import type { ModelClient } from '../../src/review/review.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'checker-'));
});
afterEach(() => {
  rmSync(root, { recursive: true });
});

function write(path: string, text: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** No labels and no tests: the checker must do without them. */
function writeDataset() {
  write('problems/beta/statement.md', 'Print the sum.');
  write(
    'problems/beta/constraints.json',
    JSON.stringify([
      { id: 'C1', text: 'Do not use `goto`.', deduction: 2 },
      { id: 'C2', text: 'Add the numbers yourself.', deduction: 7 },
    ]),
  );
  write('solutions/beta/s02.cpp', 'int main() {\n  x: goto x; // again\n}\n');
  write('solutions/beta/s01.cpp', 'int main() {}\n');
  write('solutions/beta/notes.txt', 'not a solution');
  write('problems/alpha/statement.md', 'Print 1.');
  write('problems/alpha/constraints.json', '[{"id":"C1","text":"Use recursion.","deduction":1}]');
  write('solutions/alpha/s01.cpp', 'int main() {}\n');
}

const reply = (constraint: string, fields: object = {}) => ({
  providerRequestId: 'gen-1',
  text: JSON.stringify({ reason: '', constraint, verdict: 'pass', evidence: [], ...fields }),
  promptTokens: 100,
  completionTokens: 10,
  costUsd: 0.25,
});
const passing: ModelClient = {
  name: 'fake/model',
  complete: ({ prompt }) => Promise.resolve(reply(/# Constraint\n\n(C\d)/.exec(prompt)?.[1] ?? '')),
};

async function run(options: Partial<CheckOptions> = {}) {
  const calls: LoggedCall[] = [];
  const result = await check(readDataset(root), {
    model: passing,
    modelOff: false,
    concurrency: 2,
    onCall: (call) => void calls.push(call),
    ...options,
  });
  return { ...result, calls };
}

describe('readDataset()', () => {
  it('finds every solution, in order, from the statement and the constraints alone', () => {
    writeDataset();
    expect(readDataset(root).map((s) => s.id)).toEqual(['alpha/s01', 'beta/s01', 'beta/s02']);
  });

  it('does not read the deductions', () => {
    writeDataset();
    expect(JSON.stringify(readDataset(root))).not.toContain('deduction');
  });

  it('says which file is wrong', () => {
    writeDataset();
    write('problems/beta/constraints.json', '[{"id":"C1"}]');
    expect(() => readDataset(root)).toThrow('beta/constraints.json');
  });

  it('refuses a folder that is not a dataset', () => {
    expect(() => readDataset(join(root, 'nowhere'))).toThrow('nowhere');
  });
});

describe('check()', () => {
  it('predicts every (solution, constraint) pair, in order', async () => {
    writeDataset();
    const { predictions } = await run();
    expect(predictions).toEqual([
      { solution: 'alpha/s01', constraint: 'C1', verdict: 'pass', evidence: [] },
      { solution: 'beta/s01', constraint: 'C1', verdict: 'pass', evidence: [] },
      { solution: 'beta/s01', constraint: 'C2', verdict: 'pass', evidence: [] },
      {
        solution: 'beta/s02',
        constraint: 'C1',
        verdict: 'violation',
        evidence: [{ line: 2, text: '  x: goto x; // again' }],
      },
      { solution: 'beta/s02', constraint: 'C2', verdict: 'pass', evidence: [] },
    ]);
  });

  it('logs each model call with its pair, and none for a hard rule', async () => {
    writeDataset();
    const { calls, summary } = await run();
    expect(calls.map((c) => `${c.solution} ${c.constraint}`).sort()).toEqual([
      'alpha/s01 C1',
      'beta/s01 C2',
      'beta/s02 C2',
    ]);
    expect(calls[0]).toMatchObject({ providerRequestId: 'gen-1', model: 'fake/model' });
    expect(summary).toMatchObject({
      pairs: 5,
      hardRule: 2,
      modelCalls: 3,
      promptTokens: 300,
      completionTokens: 30,
      costUsd: 0.75,
      unsure: 0,
      failed: 0,
    });
  });

  it('never has more calls in flight than it may', async () => {
    writeDataset();
    let now = 0;
    let most = 0;
    const model: ModelClient = {
      name: 'm',
      complete: async (request) => {
        most = Math.max(most, ++now);
        await new Promise((resolve) => setTimeout(resolve, 10));
        now--;
        return passing.complete(request);
      },
    };
    await run({ model, concurrency: 2 });
    expect(most).toBe(2);
  });

  it('with the model off: hard rules, unsure for the rest, and no call at all', async () => {
    writeDataset();
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const complete = vi.fn<ModelClient['complete']>();
    const { predictions, calls } = await run({ modelOff: true, model: { name: 'm', complete } });
    expect(predictions.map((p) => p.verdict)).toEqual([
      'unsure',
      'pass',
      'unsure',
      'violation',
      'unsure',
    ]);
    expect(calls).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('is unsure about a pair that breaks, and goes on', async () => {
    writeDataset();
    const onCall = (call: LoggedCall) => {
      if (call.solution === 'alpha/s01') throw new Error('disk full');
    };
    const { predictions, summary } = await run({ onCall });
    expect(predictions[0]).toEqual({
      solution: 'alpha/s01',
      constraint: 'C1',
      verdict: 'unsure',
      evidence: [],
    });
    expect(predictions).toHaveLength(5);
    expect(summary.failed).toBe(1);
  });
});

describe('parseArguments()', () => {
  it('reads the dataset and the options', () => {
    expect(
      parseArguments(['data', '--out', 'p.jsonl', '--calls', 'c.jsonl', '--limit', '3'], '/w'),
    ).toEqual({
      dataset: '/w/data',
      out: '/w/p.jsonl',
      calls: '/w/c.jsonl',
      limit: 3,
      concurrency: 4,
    });
  });

  it('writes to standard output when no file is named', () => {
    expect(parseArguments(['/data'], '/w')).toMatchObject({ dataset: '/data', out: null });
  });

  it.each([
    [[]],
    [['a', 'b']],
    [['a', '--nope']],
    [['a', '--limit', '0']],
    [['a', '--limit', 'x']],
  ])('refuses %j', (argv) => {
    expect(() => parseArguments(argv, '/w')).toThrow(UsageError);
  });
});

describe('the dev set with the model off', () => {
  it('is a valid file for eval.mjs, without a wrongful deduction', async () => {
    const devSet = fileURLToPath(new URL('../../../../eval/leetkob-eval/', import.meta.url));
    const { predictions } = await check(readDataset(devSet), {
      model: passing,
      modelOff: true,
      concurrency: 4,
      onCall: () => undefined,
    });
    expect(predictions).toHaveLength(102);
    expect(predictions.filter((p) => p.verdict !== 'unsure')).toHaveLength(55);

    write('p.jsonl', predictions.map((p) => JSON.stringify(p)).join('\n'));
    const { status, stdout } = spawnSync(
      process.execPath,
      [join(devSet, 'eval.mjs'), '--data', devSet, '--predictions', join(root, 'p.jsonl')],
      { encoding: 'utf8' },
    );
    expect([0, 1]).toContain(status);
    expect(stdout).toMatch(/wrongful deductions\s+0\s+ok/);
  });
});
