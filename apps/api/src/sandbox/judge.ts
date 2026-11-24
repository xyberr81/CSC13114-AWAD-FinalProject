// Compiles and runs one submission against its lab's tests. No database, no queue: the judge job
// passes the data in and stores what comes back.
import { runInSandbox, sandboxFlags, START_MARK, type SandboxOutcome } from './docker.js';

// Same values as the enums in db/schema.ts (a unit test compares them).
export const TEST_STATUSES = [
  'accepted',
  'wrong_answer',
  'time_limit',
  'memory_limit',
  'runtime_error',
] as const;

export type TestStatus = (typeof TEST_STATUSES)[number];
export type JudgeStatus = TestStatus | 'compile_error';

export interface JudgeTest {
  id: number;
  input: string;
  expectedOutput: string;
}

/** Per test. FAQ-05: CPU time 1–5 s, memory 64–512 MB including swap; wall time is 3× CPU time. */
export interface JudgeLimits {
  timeLimitMs: number;
  memoryLimitMb: number;
}

export interface JudgeTestResult {
  testId: number;
  status: TestStatus;
  timeMs: number | null;
  memoryKb: number | null;
}

export interface JudgeResult {
  /** The status of the first test, in order, that is not accepted. */
  status: JudgeStatus;
  /** One result per test, in order; empty when the code does not compile. */
  tests: JudgeTestResult[];
}

/**
 * Rejects when the sandbox itself cannot run, so the job is retried: a broken judge must never
 * be recorded as the student's error.
 */
export type Judge = (code: string, tests: JudgeTest[], limits: JudgeLimits) => Promise<JudgeResult>;

const COMPILE_WALL_MS = 10_000;
// Not a limit on the submission: compiling <bits/stdc++.h> alone peaks at about 290 MB.
const COMPILE_MEMORY_MB = 512;
const COMPILE_TMP_MB = 64;
const MAX_BINARY_BYTES = 8 * 1024 * 1024;
const RUN_TMP_MB = 16;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const COMPILE_SCRIPT = `echo ${START_MARK} >&2
cat > /tmp/main.cpp && g++ -std=c++17 -O2 -o /tmp/main /tmp/main.cpp && cat /tmp/main`;

const OOM_MARK = 'leetkob-oom';

// stdin is the program, then its input. `exec` is left out on purpose: as PID 1 the program would
// not get SIGXCPU. Its stderr is dropped, so it cannot fill ours. The kernel's own count of OOM kills
// is read at the end, because Docker's OOMKilled flag can come late; shell builtins only, since the
// program may have used up every process.
const RUN_SCRIPT = `head -c "$1" > /tmp/main && chmod +x /tmp/main && echo ${START_MARK} >&2
/tmp/main 2> /dev/null
code=$?
while read -r event count; do
  [ "$event" = oom_kill ] && [ "$count" != 0 ] && echo ${OOM_MARK} >&2
done < /sys/fs/cgroup/memory.events
exit $code`;

const SIGXCPU_EXIT = 128 + 24;
const SIGKILL_EXIT = 128 + 9;

/** The compiled program, or null when the code does not compile. */
export async function compile(code: string): Promise<Buffer | null> {
  const outcome = await runInSandbox({
    flags: sandboxFlags({
      memoryMb: COMPILE_MEMORY_MB,
      tmpMb: COMPILE_TMP_MB,
      cpuSeconds: COMPILE_WALL_MS / 1000,
    }),
    script: COMPILE_SCRIPT,
    stdin: Buffer.from(code, 'utf8'),
    wallMs: COMPILE_WALL_MS,
    maxOutputBytes: MAX_BINARY_BYTES,
  });
  const ok = outcome.exitCode === 0 && !outcome.timedOut && !outcome.outputExceeded;
  return ok ? outcome.stdout : null;
}

const cpuSecondsOf = (limits: JudgeLimits) => Math.ceil(limits.timeLimitMs / 1000);

export const runFlags = (limits: JudgeLimits): string[] =>
  sandboxFlags({
    memoryMb: limits.memoryLimitMb,
    tmpMb: RUN_TMP_MB,
    cpuSeconds: cpuSecondsOf(limits),
  });

export async function runProgram(
  program: Buffer,
  input: string,
  limits: JudgeLimits,
  flags: string[] = runFlags(limits),
): Promise<SandboxOutcome> {
  const outcome = await runInSandbox({
    flags,
    script: RUN_SCRIPT,
    args: [String(program.length)],
    stdin: Buffer.concat([program, Buffer.from(input, 'utf8')]),
    wallMs: limits.timeLimitMs * 3,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });
  return { ...outcome, outOfMemory: outcome.outOfMemory || outcome.stderr.includes(OOM_MARK) };
}

/** Token by token, whitespace ignored (leetkob-eval/README.md). */
export function sameTokens(actual: string, expected: string): boolean {
  const tokens = (text: string) => text.split(/\s+/).filter(Boolean);
  const a = tokens(actual);
  const b = tokens(expected);
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

export function statusOf(
  outcome: SandboxOutcome,
  expectedOutput: string,
  limits: JudgeLimits,
): TestStatus {
  if (outcome.outputExceeded) return 'runtime_error';
  if (outcome.outOfMemory) return 'memory_limit';
  const cpuMs = cpuSecondsOf(limits) * 1000;
  // SIGXCPU, or the hard limit's SIGKILL on a program that ignored SIGXCPU.
  const cpuExceeded =
    outcome.exitCode === SIGXCPU_EXIT ||
    (outcome.exitCode === SIGKILL_EXIT && outcome.wallMs >= cpuMs);
  if (outcome.timedOut || cpuExceeded) return 'time_limit';
  if (outcome.exitCode !== 0) return 'runtime_error';
  return sameTokens(outcome.stdout.toString('utf8'), expectedOutput) ? 'accepted' : 'wrong_answer';
}

export const judge: Judge = async (code, tests, limits) => {
  if (tests.length === 0) throw new Error('A lab without tests cannot be judged');

  const program = await compile(code);
  if (program === null) return { status: 'compile_error', tests: [] };

  const results: JudgeTestResult[] = [];
  for (const test of tests) {
    const outcome = await runProgram(program, test.input, limits);
    results.push({
      testId: test.id,
      status: statusOf(outcome, test.expectedOutput, limits),
      timeMs: outcome.wallMs,
      memoryKb: null,
    });
  }
  return {
    status: results.find((r) => r.status !== 'accepted')?.status ?? 'accepted',
    tests: results,
  };
};
