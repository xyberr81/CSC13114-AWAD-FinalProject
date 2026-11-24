import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { judgeOne } from './helpers.js';

describe('a docker client that prints a warning first', () => {
  let dir: string;
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leetkob-docker-'));
    writeFileSync(join(dir, 'config.json'), 'not json');
    saved = process.env.DOCKER_CONFIG;
    process.env.DOCKER_CONFIG = dir;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.DOCKER_CONFIG;
    else process.env.DOCKER_CONFIG = saved;
    rmSync(dir, { recursive: true });
  });

  it('still judges', async () => {
    const code = '#include <cstdio>\nint main() { std::puts("5"); }\n';
    expect((await judgeOne(code, '5')).status).toBe('accepted');
    expect((await judgeOne(code, '6')).status).toBe('wrong_answer');
  });
});
