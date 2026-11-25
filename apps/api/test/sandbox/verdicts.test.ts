import { describe, expect, it } from 'vitest';
import { judge } from '../../src/sandbox/judge.js';
import { judgeOne, LIMITS } from './helpers.js';

const main = (body: string) =>
  `#include <bits/stdc++.h>\nusing namespace std;\nint main() {${body}}\n`;
const SUM = main('long long a, b; cin >> a >> b; cout << a + b << "\\n";');

describe('verdicts', () => {
  it('accepted', async () => {
    const result = await judgeOne(SUM, '5\n', '2 3\n');
    expect(result.status).toBe('accepted');
    expect(result.tests[0]?.timeMs).toBeGreaterThanOrEqual(0);
  });

  it('wrong_answer', async () => {
    expect((await judgeOne(SUM, '6\n', '2 3\n')).status).toBe('wrong_answer');
  });

  it('compares token by token and ignores whitespace', async () => {
    const code = main('cout << "1  2\\n\\n 3";');
    expect((await judgeOne(code, '1 2 3\n')).status).toBe('accepted');
    expect((await judgeOne(code, '12 3\n')).status).toBe('wrong_answer');
    expect((await judgeOne(code, '1 2 3 4\n')).status).toBe('wrong_answer');
  });

  it('compile_error, with no test results', async () => {
    expect(await judgeOne('int main() { return x; }', '')).toEqual({
      status: 'compile_error',
      tests: [],
    });
  });

  it('runtime_error for a crash and for a non-zero exit', async () => {
    const crash = main('volatile int *p = nullptr; *p = 1;');
    expect((await judgeOne(crash, '')).status).toBe('runtime_error');
    expect((await judgeOne(main('cout << "5\\n"; return 3;'), '5\n')).status).toBe('runtime_error');
  });

  it('time_limit and memory_limit', async () => {
    const spin = main('volatile int n = 0; for (;;) n = n + 1;');
    expect((await judgeOne(spin, '')).status).toBe('time_limit');
    const eat = main('vector<char> v(400u << 20, 1); cout << accumulate(v.begin(), v.end(), 0LL);');
    expect((await judgeOne(eat, '')).status).toBe('memory_limit');
  });

  it('uses the memory limit of the lab', async () => {
    const eat = main('vector<char> v(100u << 20, 1); cout << accumulate(v.begin(), v.end(), 0LL);');
    expect((await judgeOne(eat, '104857600')).status).toBe('accepted');
    const small = { ...LIMITS, memoryLimitMb: 64 };
    expect((await judgeOne(eat, '104857600', '', small)).status).toBe('memory_limit');
  });

  it('runs every test and reports the first failure', async () => {
    const result = await judge(
      SUM,
      [
        { id: 11, input: '1 1', expectedOutput: '2' },
        { id: 12, input: '1 2', expectedOutput: '0' },
        { id: 13, input: '1 3', expectedOutput: '4' },
      ],
      LIMITS,
    );
    expect(result.status).toBe('wrong_answer');
    expect(result.tests.map((t) => [t.testId, t.status])).toEqual([
      [11, 'accepted'],
      [12, 'wrong_answer'],
      [13, 'accepted'],
    ]);
  });

  it('gives each test a clean container', async () => {
    const code = main(
      'ifstream old("/tmp/left"); cout << (old ? "dirty" : "clean"); ofstream("/tmp/left") << 1;',
    );
    const result = await judge(
      code,
      [
        { id: 1, input: '', expectedOutput: 'clean' },
        { id: 2, input: '', expectedOutput: 'clean' },
        { id: 3, input: '', expectedOutput: 'dirty' },
      ],
      LIMITS,
    );
    expect(result.tests.map((t) => t.status)).toEqual(['accepted', 'accepted', 'wrong_answer']);
  });

  it('passes a large input to the program untouched', async () => {
    const numbers = Array.from({ length: 100_000 }, (_, i) => i).join(' ');
    const code = main('long long s = 0, x; while (cin >> x) s += x; cout << s;');
    expect((await judgeOne(code, '4999950000', numbers)).status).toBe('accepted');
    expect((await judgeOne(code, '0', numbers)).status).toBe('wrong_answer');
  });
});
