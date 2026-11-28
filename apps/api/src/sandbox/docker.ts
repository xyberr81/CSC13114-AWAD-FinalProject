// Runs one script in a one-shot hardened container: the only place student code is compiled or run.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** gcc:14-bookworm, pinned: the same compiler on every machine. */
export const SANDBOX_IMAGE =
  'gcc@sha256:5e927c284bf55a7dc796262e311a0703344f62f41f5621eb56843111b1d37e15';

/** On every container the sandbox starts, so that leftovers can be found. */
export const SANDBOX_LABEL = 'leetkob.sandbox';

export interface ContainerLimits {
  memoryMb: number;
  tmpMb: number;
  cpuSeconds: number;
}

/** FAQ-05: 16 processes, threads included. */
const PROCESS_LIMIT = 16;

/** Never add a mount, an environment variable or a privilege here (brief §5). */
export function sandboxFlags({ memoryMb, tmpMb, cpuSeconds }: ContainerLimits): string[] {
  return [
    '--network=none',
    '--user=65534:65534',
    '--read-only',
    `--tmpfs=/tmp:rw,exec,nosuid,size=${tmpMb}m`,
    `--memory=${memoryMb}m`,
    `--memory-swap=${memoryMb}m`,
    `--pids-limit=${PROCESS_LIMIT}`,
    '--cpus=1',
    // The soft limit sends SIGXCPU; the hard one ends a program that ignores it.
    `--ulimit=cpu=${cpuSeconds}:${cpuSeconds + 1}`,
    '--ulimit=core=0',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
  ];
}

export interface SandboxRun {
  flags: string[];
  /** Prints START_MARK as its first line on stderr: the wall clock starts there. The docker client
   * may print warnings of its own before it. */
  script: string;
  args?: string[];
  stdin: Buffer;
  wallMs: number;
  maxOutputBytes: number;
}

export interface SandboxOutcome {
  exitCode: number;
  outOfMemory: boolean;
  timedOut: boolean;
  outputExceeded: boolean;
  stdout: Buffer;
  stderr: string;
  wallMs: number;
}

/** Starting a container must not count as the student's time. */
export const START_MARK = 'leetkob-start';
const START_LINE = new RegExp(`^${START_MARK}\\r?\\n`, 'm');
const START_TIMEOUT_MS = 30_000;
const DOCKER_TIMEOUT_MS = 30_000;
const MAX_STDERR_BYTES = 64 * 1024;

const ENV_FOR_DOCKER = [
  'PATH',
  'HOME',
  'XDG_RUNTIME_DIR',
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  // Docker Desktop
  'USERPROFILE',
  'SystemRoot',
  'ProgramData',
  'ProgramFiles',
];

/** The docker client gets no secret of ours, so it cannot pass one on. */
export function dockerEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(ENV_FOR_DOCKER.map((name) => name.toLowerCase()));
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => allowed.has(name.toLowerCase())),
  );
}

async function docker(args: string[]): Promise<string> {
  const { stdout } = await exec('docker', args, {
    env: dockerEnv(),
    timeout: DOCKER_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout.trim();
}

/** Removes what a worker that died left behind. Only one judge worker may run per Docker host. */
export async function removeLeftoverContainers(): Promise<number> {
  const ids = (await docker(['ps', '-aq', `--filter=label=${SANDBOX_LABEL}`]))
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length > 0) await docker(['rm', '-f', ...ids]);
  return ids.length;
}

/** Rejects when Docker itself fails; whatever the program does is an outcome. */
export async function runInSandbox(run: SandboxRun): Promise<SandboxOutcome> {
  const id = await docker([
    'create',
    '--interactive',
    '--pull=never',
    '--log-driver=none',
    `--label=${SANDBOX_LABEL}`,
    ...run.flags,
    SANDBOX_IMAGE,
    'sh',
    '-c',
    run.script,
    'sh',
    ...(run.args ?? []),
  ]);
  try {
    const attached = await attach(id, run);
    const state = await docker([
      'inspect',
      '--format={{.State.OOMKilled}} {{.State.ExitCode}} {{.State.Error}}',
      id,
    ]);
    const [oom, code, ...error] = state.split(' ');
    const reason = error.join(' ').trim();
    if (reason) throw new Error(`The sandbox container did not start: ${reason}`);
    return { ...attached, outOfMemory: oom === 'true', exitCode: Number(code) };
  } finally {
    await docker(['rm', '-f', id]);
  }
}

type Attached = Omit<SandboxOutcome, 'exitCode' | 'outOfMemory'>;

function attach(id: string, run: SandboxRun): Promise<Attached> {
  return new Promise((resolve, reject) => {
    const client = spawn('docker', ['start', '--attach', '--interactive', id], {
      env: dockerEnv(),
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let startedAt: number | null = null;
    let timedOut = false;
    let outputExceeded = false;
    let failure: Error | null = null;

    // Kills the container, not the client: killing the client leaves the program running.
    let killing = false;
    const killContainer = () => {
      if (killing) return;
      killing = true;
      docker(['kill', id])
        .catch((error: unknown) => {
          // Already gone is what we wanted; anything else shows up when it is removed.
          if (!/is not running/.test(String(error))) failure ??= error as Error;
        })
        .finally(() => client.kill());
    };

    let timer = setTimeout(() => {
      failure = new Error('The sandbox container did not start in time');
      killContainer();
    }, START_TIMEOUT_MS);

    const onStart = () => {
      startedAt = performance.now();
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        killContainer();
      }, run.wallMs);
    };

    client.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > run.maxOutputBytes) {
        outputExceeded = true;
        killContainer();
        return;
      }
      stdout.push(chunk);
    });
    client.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.toString('utf8');
      if (startedAt === null && START_LINE.test(stderr)) onStart();
    });
    client.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    client.on('close', () => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (startedAt === null) reject(new Error(`The sandbox did not start: ${stderr.trim()}`));
      else {
        resolve({
          timedOut,
          outputExceeded,
          stdout: Buffer.concat(stdout),
          stderr: stderr.slice(stderr.search(START_LINE) + START_MARK.length).trimStart(),
          wallMs: Math.round(performance.now() - startedAt),
        });
      }
    });

    // A program may end without reading its input.
    client.stdin.on('error', () => undefined);
    client.stdin.end(run.stdin);
  });
}
