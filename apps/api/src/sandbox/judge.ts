// Compiles and runs one submission against its lab's tests. No database, no queue: the judge job
// passes the data in and stores what comes back.

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

// Stub: the sandbox replaces this.
export const judge: Judge = (_code, tests) => {
  if (tests.length === 0) return Promise.reject(new Error('A lab without tests cannot be judged'));
  return Promise.resolve({
    status: 'accepted',
    tests: tests.map((t) => ({
      testId: t.id,
      status: 'accepted',
      timeMs: null,
      memoryKb: null,
    })),
  });
};
