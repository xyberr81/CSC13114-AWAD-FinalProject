import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { judge, type JudgeLimits, type JudgeResult } from '../../src/sandbox/judge.js';

/** FAQ-05 defaults. */
export const LIMITS: JudgeLimits = { timeLimitMs: 1000, memoryLimitMb: 256 };

export const attack = (name: string): string =>
  readFileSync(new URL(`./attacks/${name}.cpp`, import.meta.url), 'utf8');

/** Judges code against one test. */
export const judgeOne = (
  code: string,
  expectedOutput: string,
  input = '',
  limits: JudgeLimits = LIMITS,
): Promise<JudgeResult> => judge(code, [{ id: 1, input, expectedOutput }], limits);

/** Every container the sandbox starts carries this label. */
export function sandboxContainers(): string[] {
  const out = execFileSync('docker', ['ps', '-aq', '--filter', 'label=leetkob.sandbox'], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  return out.split('\n').filter(Boolean);
}
