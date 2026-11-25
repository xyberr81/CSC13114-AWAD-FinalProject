import { describe, expect, it } from 'vitest';
import { submissionStatus, testStatus } from '../../src/db/schema.js';
import { dockerEnv, SANDBOX_IMAGE, type SandboxOutcome } from '../../src/sandbox/docker.js';
import {
  judge,
  runFlags,
  sameTokens,
  statusOf,
  TEST_STATUSES,
  type JudgeLimits,
} from '../../src/sandbox/judge.js';

const limits: JudgeLimits = { timeLimitMs: 1000, memoryLimitMb: 256 };

describe('judge()', () => {
  it('refuses a lab without tests instead of accepting everything', async () => {
    await expect(judge('int main() {}', [], limits)).rejects.toThrow('without tests');
  });
});

// judge() does not import the database, so this is what keeps the two lists the same.
describe('judge() statuses match the schema', () => {
  it('test statuses', () => {
    expect([...TEST_STATUSES]).toEqual(testStatus.enumValues);
  });

  it('every judge status is a submission status', () => {
    for (const status of [...TEST_STATUSES, 'compile_error']) {
      expect(submissionStatus.enumValues).toContain(status);
    }
  });
});

describe('the sandbox command', () => {
  it('sets every limit of the brief and FAQ-05', () => {
    expect(runFlags(limits)).toEqual(
      expect.arrayContaining([
        '--network=none',
        '--user=65534:65534',
        '--read-only',
        '--memory=256m',
        '--memory-swap=256m',
        '--pids-limit=16',
        '--ulimit=cpu=1:2',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
      ]),
    );
  });

  it('follows the limits of the lab', () => {
    const flags = runFlags({ timeLimitMs: 4500, memoryLimitMb: 64 });
    expect(flags).toContain('--memory=64m');
    expect(flags).toContain('--memory-swap=64m');
    expect(flags).toContain('--ulimit=cpu=5:6');
  });

  it('mounts nothing, passes no environment and adds no privilege', () => {
    const forbidden =
      /^(-v|-e|--volume|--mount|--env|--env-file|--privileged|--cap-add|--pid=|--ipc)/;
    expect(runFlags(limits).filter((flag) => forbidden.test(flag))).toEqual([]);
    expect(runFlags(limits).join(' ')).not.toContain('docker.sock');
  });

  it('pins the image by digest', () => {
    expect(SANDBOX_IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('gives the docker client only what it needs', () => {
    expect(
      dockerEnv({
        PATH: '/bin',
        HOME: '/home/x',
        LLM_API_KEY: 'k',
        JWT_SECRET: 's',
        DATABASE_URL: 'd',
      }),
    ).toEqual({ PATH: '/bin', HOME: '/home/x' });
  });
});

describe('sameTokens()', () => {
  it('ignores whitespace between and around tokens', () => {
    expect(sameTokens(' 1\t2\r\n3 ', '1 2 3\n')).toBe(true);
    expect(sameTokens('', ' \n')).toBe(true);
  });

  it('compares every token', () => {
    expect(sameTokens('1 2', '1 2 3')).toBe(false);
    expect(sameTokens('1 2 3', '1 2')).toBe(false);
    expect(sameTokens('12', '1 2')).toBe(false);
    expect(sameTokens('1.0', '1')).toBe(false);
  });
});

describe('statusOf()', () => {
  const outcome = (over: Partial<SandboxOutcome>): SandboxOutcome => ({
    exitCode: 0,
    outOfMemory: false,
    timedOut: false,
    outputExceeded: false,
    stdout: Buffer.from('5\n'),
    stderr: '',
    wallMs: 10,
    ...over,
  });
  const status = (over: Partial<SandboxOutcome>) => statusOf(outcome(over), '5', limits);

  it.each([
    ['accepted', {}],
    ['wrong_answer', { stdout: Buffer.from('6') }],
    ['runtime_error', { exitCode: 139 }],
    ['runtime_error', { outputExceeded: true, exitCode: 137 }],
    ['memory_limit', { outOfMemory: true, exitCode: 137 }],
    ['time_limit', { timedOut: true, exitCode: 137 }],
    ['time_limit', { exitCode: 152 }],
    ['time_limit', { exitCode: 137, wallMs: 2010 }],
    ['runtime_error', { exitCode: 137, wallMs: 20 }],
  ])('%s', (expected, over) => {
    expect(status(over)).toBe(expected);
  });

  it('does not accept the right output of a program that failed', () => {
    expect(status({ exitCode: 1 })).toBe('runtime_error');
    expect(status({ timedOut: true })).toBe('time_limit');
  });
});
