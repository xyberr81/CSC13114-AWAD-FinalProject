// FAQ-05: the limit is CPU time of the whole submission, to the millisecond.
import { describe, expect, it } from 'vitest';
import { judgeOne, LIMITS } from './helpers.js';

const HALF = { ...LIMITS, timeLimitMs: 1500 };

const program = (body: string) => `#include <bits/stdc++.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>
using namespace std;
void burn(int ms) { auto t = clock(); while ((clock() - t) * 1000 / CLOCKS_PER_SEC < ms); }
int main() { ${body} }
`;
const children = (ms: number) =>
  program(
    `for (int i = 0; i < 3; i++) { if (!fork()) { burn(${ms}); _exit(0); } wait(0); } cout << "ok";`,
  );

describe('CPU time', () => {
  it('follows a limit that is not a whole second', async () => {
    const over = program('burn(1750); cout << "ok";');
    expect((await judgeOne(over, 'ok', '', HALF)).status).toBe('time_limit');
    const under = program('burn(1200); cout << "ok";');
    expect((await judgeOne(under, 'ok', '', HALF)).status).toBe('accepted');
  });

  it('counts the processes of a submission together', async () => {
    expect((await judgeOne(children(600), 'ok')).status).toBe('time_limit');
    expect((await judgeOne(children(200), 'ok')).status).toBe('accepted');
  });
});

// The program has the same uid as PID 1, which compares its CPU time with the limit.
describe('a submission over the limit that attacks PID 1', () => {
  const attackWith = (body: string) => program(`${body} burn(1750); cout << "ok";`);

  it('is not accepted when PID 1 can open no file', async () => {
    const closed = attackWith(
      'rlimit none{0, 0}; if (prlimit(1, RLIMIT_NOFILE, &none, nullptr)) return 9;',
    );
    expect((await judgeOne(closed, 'ok', '', HALF)).status).toBe('runtime_error');
    const harmless = program(
      'rlimit now; cout << (prlimit(1, RLIMIT_NOFILE, nullptr, &now) ? "denied" : "reached");',
    );
    expect((await judgeOne(harmless, 'reached')).status).toBe('accepted');
  });

  it('cannot stop it with a signal', async () => {
    const signals = attackWith('for (int s : {SIGKILL, SIGSTOP, SIGTERM}) kill(1, s);');
    expect((await judgeOne(signals, 'ok', '', HALF)).status).toBe('time_limit');
  });

  it('gains nothing from the descriptors of PID 1', async () => {
    const forged = attackWith(
      String.raw`for (int i = 2; i < 64; i++) {
        int fd = open(("/proc/1/fd/" + to_string(i)).c_str(), O_WRONLY | O_NONBLOCK);
        if (fd >= 0) { string s = "\n152\nleetkob-start\n" + string(200000, 120); write(fd, s.data(), s.size()); }
      }`,
    );
    expect((await judgeOne(forged, 'ok', '', HALF)).status).toBe('time_limit');
  });
});
