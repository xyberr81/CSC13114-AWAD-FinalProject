import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bannedNames, checkBanList } from '../../src/review/hard-rules.js';

/** Wraps names into the text of a ban-list constraint. */
const ban = (...names: string[]) => `Do not use ${names.map((n) => `\`${n}\``).join(', ')}.`;

/** Lines that the rule cites; an empty list means `pass`. */
async function cited(names: string[], code: string): Promise<number[]> {
  const result = await checkBanList(ban(...names), code);
  expect(result?.verdict).toBe(result?.evidence.length ? 'violation' : 'pass');
  return result?.evidence.map((e) => e.line) ?? [];
}

describe('bannedNames()', () => {
  it('reads every backticked name of a "Do not use" or "Do not call" constraint', () => {
    expect(bannedNames('Do not use `for`, `do`-`while`, or `goto`. Recurse.')).toEqual([
      'for',
      'do',
      'while',
      'goto',
    ]);
    expect(bannedNames('Do not call a library sort: `std::sort`, `qsort()`.')).toEqual([
      'std::sort',
      'qsort',
    ]);
  });

  it('is null for a semantic constraint, even one that names things in backticks', () => {
    expect(bannedNames('Free the memory with `delete[]`.')).toBeNull();
    expect(bannedNames('You must write it yourself. Do not use `std::sort`.')).toBeNull();
  });

  it('is null for a ban list that names nothing, which no rule can decide', () => {
    expect(bannedNames('Do not use recursion.')).toBeNull();
  });
});

describe('checkBanList()', () => {
  it('is null for a semantic constraint', async () => {
    expect(await checkBanList('Sort by merging.', 'int main() {}')).toBeNull();
  });

  it('cites the original line, comment included', async () => {
    const code = 'int main() {\n  std::sort(a, b); // quick\n}\n';
    expect(await checkBanList(ban('std::sort'), code)).toEqual({
      verdict: 'violation',
      evidence: [{ line: 2, text: '  std::sort(a, b); // quick' }],
    });
  });

  it('cites a line once, and lines in order', async () => {
    const code = 'int main() {\nstd::sort(a, b); std::sort(b, c);\nfor (;;) {}\n}';
    expect(await cited(['for', 'std::sort'], code)).toEqual([2, 3]);
  });

  it('cites the original line of a file with CRLF line ends', async () => {
    const result = await checkBanList(ban('goto'), 'int main() {\r\nx:\r\n  goto x;\r\n}\r\n');
    expect(result?.evidence).toEqual([{ line: 3, text: '  goto x;' }]);
  });
});

describe('traps: compliant code', () => {
  const traps: [string, string[], string][] = [
    [
      "the student's own function in a namespace",
      ['std::sort'],
      'namespace mine { void sort(int* a, int n) {} }\nint main() { int a[3]; mine::sort(a, 3); }',
    ],
    [
      'the own function called through a using-directive',
      ['std::sort'],
      'using namespace std;\nnamespace mine { void sort(int* a, int n) {} }\nusing namespace mine;\nint main() { int a[3]; sort(a, 3); }',
    ],
    [
      'the own function called through a using-declaration',
      ['std::sort'],
      'namespace mine { void sort(int* a, int n) {} }\nusing mine::sort;\nint main() { int a[3]; sort(a, 3); }',
    ],
    [
      'the own function called inside its namespace',
      ['std::sort'],
      'namespace mine { void sort(int* a, int n) { sort(a, n - 1); } }',
    ],
    [
      'an own global function beside using namespace std',
      ['std::sort'],
      'using namespace std;\nvoid sort(vector<int>& a, int l, int r) { sort(a, l, r - 1); }\nint main() { vector<int> a; sort(a, 0, 3); }',
    ],
    [
      'an own template that is declared first and defined later',
      ['std::find'],
      'using namespace std;\ntemplate <class T> T find(T* a, T x, int n = 0);\nint main() { int a[2]; find(a, 1); }\ntemplate <class T> T find(T* a, T x, int n) { return x; }',
    ],
    [
      'an own C-library name',
      ['__gcd', 'qsort'],
      'int __gcd(int a, int b) { return b ? __gcd(b, a % b) : a; }\nint main() { __gcd(4, 6); }',
    ],
    [
      'a lambda, also one held in a std::function',
      ['std::gcd', 'std::lcm'],
      'using namespace std;\nint main() {\n  auto gcd = [](int a, int b) { return a; };\n  function<int(int, int)> lcm = [&](int a, int b) { return lcm(a, b); };\n  gcd(1, 2); lcm(1, 2);\n}',
    ],
    [
      'variables, parameters, members and labels with a banned name',
      ['std::array', 'std::list', 'std::find', 'std::stack', 'std::queue'],
      'using namespace std;\nstruct S { int stack[9]; int top() { return stack[0]; } };\nint f(int list, bool find) { return find ? list : 0; }\nint main() { int array[3]; array[0] = 1; queue: return array[0]; }',
    ],
    [
      'an own class with a banned name',
      ['std::vector', 'std::stack'],
      'struct vector { int* p; vector() {} void push(int x) {} };\ntemplate <class T> class stack { T* p; };\nint main() { vector v; v.push(1); stack<int> s; }',
    ],
    [
      'a method of an own class, called with and without an object',
      ['std::sort', 'rbegin'],
      'struct S { void sort(int l, int r) { sort(l, r - 1); } int rbegin() { return 1; } void go(); };\nvoid S::go() { sort(1, 2); this->sort(1, 2); rbegin(); }\nint main() { S s; s.sort(0, 1); s.rbegin(); }',
    ],
    [
      'a library method that shares the name of a banned function',
      ['std::find', 'std::sort', 'std::reverse'],
      'int main() { std::string s; s.find("x"); std::list<int> l; l.sort(); l.reverse(); }',
    ],
    [
      'another function whose name only starts the same',
      ['std::find', 'std::reverse', 'std::copy'],
      'int main() { std::find_if(a, b, f); std::reverse_copy(a, b, c); std::copy_n(a, 1, b); }',
    ],
    [
      'a banned name in a comment',
      ['std::sort', 'for'],
      '// std::sort(a, b) for\n/* for (;;) std::sort(a, b); */\nint main() {} // for',
    ],
    [
      'a banned name in a string, a raw string or a character',
      ['std::sort', 'for', 'goto'],
      'int main() { puts("std::sort(a); for (;;)"); puts(R"(goto x; // std::sort(a))"); }',
    ],
    [
      'a header included for something else',
      ['std::sort', 'algorithm', 'std::vector'],
      '#include <algorithm>\n#include <vector>\nint main() { int a = 1, b = 2; std::swap(a, b); }',
    ],
    [
      'code that the preprocessor removes',
      ['std::sort', 'for'],
      '#if 0\nint f() { for (;;) std::sort(a, b); }\n#endif\n#ifdef NOT_DEFINED\nvoid g() { for (;;) {} }\n#else\nint h;\n#endif\nint main() {}',
    ],
    [
      'a macro that is never used',
      ['for', 'std::sort'],
      '#define FOR(i, n) for (int i = 0; i < (n); i++)\n#define SORT std::sort\nint main() {}',
    ],
    [
      'a macro whose argument only looks like the banned name',
      ['std::sort'],
      '#define STR(x) #x\nint main() { puts(STR(std::sort)); }',
    ],
    [
      'a using-declaration that nothing uses',
      ['std::sort'],
      '#include <algorithm>\nusing std::sort;\nint main() {}',
    ],
    [
      'an own friend function defined inside its class',
      ['std::swap'],
      'using namespace std;\nstruct S { friend void swap(S& a, S& b) {} };\nint main() { S a, b; swap(a, b); }',
    ],
    ['a longer identifier', ['for', 'do', 'goto'], 'int main() { int fork = 1, done = fork; }'],
    [
      'another namespace with the same member',
      ['std::gcd'],
      'namespace m { struct T { static int gcd(int a) { return a; } }; }\nint main() { m::T::gcd(1); }',
    ],
  ];

  it.each(traps)('%s', async (_name, names, code) => {
    expect(await cited(names, code)).toEqual([]);
  });
});

describe('violations', () => {
  const violations: [string, string[], string, number[]][] = [
    ['a qualified call', ['std::sort'], 'int main() {\nstd::sort(a, b);\n}', [2]],
    [
      'an unqualified call after using namespace std',
      ['std::sort'],
      'using namespace std;\nint main() {\nsort(a, b);\n}',
      [3],
    ],
    [
      'an unqualified call after a using-declaration',
      ['std::sort'],
      'using std::sort;\nint main() {\nsort(a, b);\n}',
      [3],
    ],
    [
      'an unqualified call found through its arguments',
      ['std::sort'],
      'int main() {\nsort(v.begin(), v.end());\n}',
      [2],
    ],
    [
      'a leading ::',
      ['std::sort', 'qsort'],
      'int main() {\n::std::sort(a, b);\n::qsort(a);\n}',
      [2, 3],
    ],
    ['a C function through std::', ['qsort'], 'int main() {\nstd::qsort(a, 1, 2, f);\n}', [2]],
    [
      'a qualified name split over lines',
      ['std::sort'],
      'int main() {\nstd ::\n  sort(a, b);\n}',
      [3],
    ],
    [
      'an identifier split by a backslash-newline',
      ['std::sort'],
      'int main() {\nstd::so\\\nrt(a, b);\n}',
      [2],
    ],
    ['explicit template arguments', ['std::sort'], 'int main() {\nstd::sort<int*>(a, b);\n}', [2]],
    [
      'a function pointer',
      ['std::sort'],
      'int main() {\nauto f = &std::sort<int*>;\nf(a, b);\n}',
      [2],
    ],
    [
      'a namespace alias',
      ['std::sort', 'std::ranges::sort'],
      'namespace s = std;\nnamespace r = s::ranges;\nint main() {\ns::sort(a, b);\nr::sort(v);\n}',
      [4, 5],
    ],
    [
      'a nested namespace, with and without using namespace std',
      ['std::ranges::sort'],
      'using namespace std;\nint main() {\nstd::ranges::sort(v);\nranges::sort(v);\n}',
      [3, 4],
    ],
    [
      'an own namespace that re-exports std',
      ['std::sort', 'std::find'],
      'namespace a { using namespace std; }\nnamespace b { using std::find; }\nint main() {\na::sort(x, y);\nb::find(x, y, z);\n}',
      [4, 5],
    ],
    [
      'the library function beside an own overload with other parameters',
      ['std::sort'],
      'using namespace std;\nvoid sort(vector<int>& a) {\n  sort(a.begin(), a.end());\n}\nint main() { vector<int> a; sort(a); }',
      [3],
    ],
    [
      'the library function beside an own overload with as many parameters',
      ['std::sort'],
      'using namespace std;\nvoid sort(vector<int>& a, int n) {\n  sort(a.begin(), a.end());\n}',
      [3],
    ],
    [
      'a wrapper with another name',
      ['std::sort'],
      'using namespace std;\nvoid mergeSort(vector<int>& a) {\n  sort(a.begin(), a.end());\n}',
      [3],
    ],
    [
      'a name that is only local to another function',
      ['std::gcd'],
      'using namespace std;\nint f() { auto gcd = [](int a) { return a; }; return gcd(1); }\nint main() {\nreturn gcd(4, 6);\n}',
      [4],
    ],
    [
      'a type: variable, parameter, member, alias and base class',
      ['std::vector', 'std::string', 'std::stack'],
      'using namespace std;\nvoid f(const vector<int>& v);\nstruct S { string s; };\nusing V = std::vector<int>;\nstruct T : stack<int> {};',
      [2, 3, 4, 5],
    ],
    [
      'a typedef',
      ['std::basic_string'],
      'typedef std::basic_string<int> Buffer;\nint main() { Buffer b; }',
      [1],
    ],
    [
      'a type nested in another type',
      ['std::vector'],
      'int main() {\nstd::map<int, std::vector<int>> m;\n}',
      [2],
    ],
    [
      'a method, also on a temporary and through a pointer',
      ['rbegin'],
      'int main() {\nv.rbegin();\np->rbegin();\nf().rbegin();\nstd::rbegin(v);\n}',
      [2, 3, 4, 5],
    ],
    ['a pointer to a method', ['rbegin'], 'int main() {\nauto f = &std::string::rbegin;\n}', [2]],
    [
      'every kind of loop, and goto',
      ['for', 'while', 'do', 'goto'],
      'int main() {\nfor (;;) {}\nfor (int x : v) {}\nwhile (1) {}\ndo {} while (0);\nx: goto x;\n}',
      [2, 3, 4, 5, 6],
    ],
    [
      'operators',
      ['%', 'new[]', 'delete[]'],
      'int f(int a) {\nreturn a % 2;\nint* p = new int[3];\ndelete[] p;\nint* q = new int;\ndelete q;\n}',
      [2, 3, 4],
    ],
    ['a header', ['<vector>'], '#include <vector>\nint main() {}', [1]],
    [
      'an object-like macro: its definition and its use',
      ['std::sort'],
      '#define SORT std::sort\nint main() {\nSORT(a, b);\n}',
      [1, 3],
    ],
    [
      'a function-like macro that expands to a loop',
      ['for'],
      '#define FOR(i, n) for (int i = 0; i < (n); i++)\nint main() {\nFOR(i, 3) { f(i); }\n}',
      [1, 3],
    ],
    [
      'macros that use macros',
      ['std::sort'],
      '#define ALL(v) v.begin(), v.end()\n#define S std::sort\n#define SORT(v) S(ALL(v))\nint main() {\nSORT(a);\n}',
      [2, 5],
    ],
    [
      'a name pasted from two halves',
      ['std::sort'],
      '#define CAT(a, b) a##b\nint main() {\nstd::CAT(so, rt)(a, b);\n}',
      [3],
    ],
    [
      'a macro named like something harmless',
      ['std::sort'],
      '#define mergeSort std::sort\nint main() {\nmergeSort(a, b);\n}',
      [1, 3],
    ],
    [
      'a macro continued over lines',
      ['for'],
      '#define F(n) \\\n  for (int i = 0; i < n; i++)\nint main() {\nF(3) {}\n}',
      [2, 4],
    ],
    [
      'the branch that the preprocessor keeps',
      ['goto'],
      '#define ON\n#if defined(ON) && __cplusplus >= 201703L\nint main() { x:\ngoto x; }\n#else\nint main() {}\n#endif',
      [4],
    ],
    [
      'a call hidden behind a comment',
      ['std::sort'],
      'int main() {\nstd::/* not */sort/**/(a, b);\n}',
      [2],
    ],
  ];

  it.each(violations)('%s', async (_name, names, code, lines) => {
    expect(await cited(names, code)).toEqual(lines);
  });
});

describe('hostile code', () => {
  it('is null for macros that expand without end in sight', async () => {
    const bomb = Array.from({ length: 40 }, (_, i) => `#define a${i + 1} a${i} a${i}`).join('\n');
    expect(await checkBanList(ban('std::sort'), `${bomb}\nint main() { a40; }`)).toBeNull();
  });

  it('is null for an #if nested too deep', async () => {
    expect(await checkBanList(ban('goto'), `#if ${'('.repeat(60_000)}1\n#endif`)).toBeNull();
  });

  it('survives code nested very deep', async () => {
    const deep = `int main() { return ${'('.repeat(30_000)}1${')'.repeat(30_000)}; }`;
    expect((await checkBanList(ban('std::sort'), deep))?.verdict).toBe('pass');
  });
});

// The published dev set: a ban-list verdict must equal the label, with one labelled line cited.
describe('the dev set', () => {
  const root = new URL('../../../../eval/leetkob-eval/', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
  const labels = read('labels.jsonl')
    .trim()
    .split('\n')
    .map(
      (line) =>
        JSON.parse(line) as {
          solution: string;
          constraint: string;
          label: string;
          evidence: number[];
        },
    );
  const constraints = new Map(
    readdirSync(new URL('problems/', root)).flatMap((problem) =>
      (
        JSON.parse(read(`problems/${problem}/constraints.json`)) as { id: string; text: string }[]
      ).map((c) => [`${problem} ${c.id}`, c.text] as const),
    ),
  );
  const pairs = labels.flatMap((label) => {
    const text = constraints.get(`${label.solution.split('/')[0]} ${label.constraint}`) ?? '';
    return bannedNames(text) ? [{ ...label, text }] : [];
  });

  it('has the ban-list pairs', () => {
    expect(pairs).toHaveLength(55);
  });

  it.each(pairs)('$solution $constraint: $label', async ({ solution, text, label, evidence }) => {
    const result = await checkBanList(text, read(`solutions/${solution}.cpp`));
    expect(result?.verdict).toBe(label);
    const lines = result?.evidence.map((e) => e.line) ?? [];
    expect(lines.some((line) => evidence.includes(line))).toBe(label === 'violation');
  });
});
