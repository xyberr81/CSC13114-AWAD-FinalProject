// Every attack must be able to succeed: the same program, with only the limit that stops it taken
// away, gets through. Otherwise attacks.test.ts could be green for the wrong reason.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  removeLeftoverContainers,
  runInSandbox,
  SANDBOX_IMAGE,
  SANDBOX_LABEL,
  START_MARK,
} from '../../src/sandbox/docker.js';
import { compile, runFlags, runProgram } from '../../src/sandbox/judge.js';
import { attack, LIMITS, sandboxContainers } from './helpers.js';

const exec = promisify(execFile);
const SLOW = { ...LIMITS, timeLimitMs: 5000 };

/** Runs an attack with flags taken away (by prefix) and flags added. */
async function runWithout(name: string, removed: string[], added: string[] = []) {
  const program = await compile(attack(name));
  if (program === null) throw new Error(`${name} does not compile`);
  const flags = runFlags(SLOW).filter((flag) => !removed.some((prefix) => flag.startsWith(prefix)));
  const outcome = await runProgram(program, '', SLOW, [...flags, ...added]);
  return outcome.stdout.toString('utf8').trim();
}

describe('without its limit, the attack succeeds', () => {
  it('1 network', async () => {
    expect(await runWithout('01-network', ['--network'])).toBe('connected');
  });

  it('4 memory', async () => {
    expect(await runWithout('04-memory', ['--memory'])).toBe('allocated');
  });

  it('5 processes', async () => {
    expect(await runWithout('05-processes', ['--pids-limit'])).toBe('unlimited');
  });

  it('7 root', async () => {
    expect(await runWithout('07-root', ['--user'])).toBe('root');
  });

  it('8 host mount', async () => {
    expect(await runWithout('08-mounts', [], ['--volume=/usr:/host:ro'])).toBe('host visible');
  });

  it('8 writable file system', async () => {
    expect(await runWithout('08-write', ['--read-only', '--user'])).toBe('written');
  });

  it('9 key in the environment', async () => {
    const key = '--env=LLM_API_KEY=canary-key-0123456789';
    expect(await runWithout('09-environment', [], [key])).toBe('leaked');
  });

  it('9 key in a file the compiler can read', async () => {
    const outcome = await runInSandbox({
      flags: runFlags(SLOW).filter(
        (flag) => !flag.startsWith('--read-only') && !flag.startsWith('--user'),
      ),
      script: `echo ${START_MARK} >&2
mkdir /app && echo 'LLM_API_KEY=canary-key-0123456789' > /app/.env && cat > /tmp/main.cpp
g++ -std=c++17 -o /tmp/main /tmp/main.cpp`,
      stdin: Buffer.from(attack('09-include')),
      wallMs: 10_000,
      maxOutputBytes: 1024,
    });
    expect(outcome.stderr).toContain('canary-key-0123456789');
  });
});

describe('3 killing only the client is not enough', () => {
  afterEach(() => removeLeftoverContainers());

  it('the container outlives the docker client that started it', async () => {
    const { stdout } = await exec('docker', [
      'create',
      `--label=${SANDBOX_LABEL}`,
      ...runFlags(LIMITS),
      SANDBOX_IMAGE,
      'sleep',
      '60',
    ]);
    const id = stdout.trim();
    const client = spawn('docker', ['start', '--attach', id]);
    const running = () =>
      exec('docker', ['inspect', '--format={{.State.Running}}', id]).then((r) => r.stdout.trim());
    await expect.poll(running, { timeout: 20_000 }).toBe('true');

    const closed = new Promise((resolve) => client.once('close', resolve));
    client.kill('SIGKILL');
    await closed;

    expect(await running()).toBe('true');
  });

  it('a worker that starts again removes what the last one left', async () => {
    await exec('docker', ['create', `--label=${SANDBOX_LABEL}`, SANDBOX_IMAGE, 'sleep', '60']);
    expect(sandboxContainers()).not.toEqual([]);
    expect(await removeLeftoverContainers()).toBeGreaterThan(0);
    expect(sandboxContainers()).toEqual([]);
  });
});
