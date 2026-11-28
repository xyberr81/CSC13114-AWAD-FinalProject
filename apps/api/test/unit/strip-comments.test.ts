import { describe, expect, it } from 'vitest';
import { stripComments } from '../../src/review/strip-comments.js';

describe('stripComments()', () => {
  it('blanks a line comment and keeps the code before it', () => {
    expect(stripComments('int a; // sort\nint b;')).toBe('int a;        \nint b;');
  });

  it('keeps every line break of a block comment', () => {
    expect(stripComments('a/* 23120000\r\n x */b')).toBe('a           \r\n     b');
  });

  it('follows a line comment continued with a backslash', () => {
    const out = stripComments('// one \\\nstd::sort\nint a;');
    expect(out).not.toContain('sort');
    expect(out.split('\n')).toHaveLength(3);
    expect(out.split('\n')[2]).toBe('int a;');
  });

  it('leaves comment markers inside literals alone', () => {
    for (const code of [
      'auto s = "http://x /* y */";',
      'auto s = "a\\"// b";',
      "char c = '\"'; int d = '//';",
      'auto s = R"x(// " /* )" )x"; int a;',
      'auto s = u8R"(\n// kept\n)";',
    ]) {
      expect(stripComments(code)).toBe(code);
    }
  });

  it('does not read a digit separator as a character literal', () => {
    expect(stripComments("int a = 1'000; // x'")).toBe("int a = 1'000;      ");
  });

  it('strips a comment inside a macro definition', () => {
    expect(stripComments('#define N 5 // std::sort')).toBe('#define N 5             ');
  });

  it('copes with a comment or a literal that never ends', () => {
    expect(stripComments('int a; /* x')).toBe('int a;     ');
    expect(stripComments('auto s = "x\nint a; // y')).toBe('auto s = "x\nint a;     ');
  });
});
