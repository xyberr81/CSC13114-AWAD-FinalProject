// The part of the C++ preprocessor that a hard rule needs: it expands the student's macros, drops
// the branches a compiler would drop, and remembers the source lines behind every token.
import { tokenize, unsplice, type Token, type TokenKind } from './lexer.js';

export interface SourceToken {
  kind: TokenKind;
  text: string;
  /** Where the token is written. For a macro body: its line in the definition, then the use. */
  lines: number[];
}

export interface Preprocessed {
  tokens: SourceToken[];
  /** `#include`s that survive, e.g. `vector`. */
  headers: { name: string; line: number }[];
}

/** Code this rule cannot expand within its limits (a macro bomb, absurd nesting). */
export class TooComplexError extends Error {}

const MAX_TOKENS = 200_000;
const MAX_DEPTH = 200;

interface PPToken extends SourceToken {
  /** Macros that already produced this token, and so do not expand in it again. */
  hidden: ReadonlySet<string>;
}

interface Macro {
  /** Null for an object-like macro. */
  params: string[] | null;
  variadic: boolean;
  body: PPToken[];
}

const NONE: ReadonlySet<string> = new Set();
const isBlank = (t: { kind: TokenKind }) => t.kind === 'space' || t.kind === 'newline';
const space = (lines: number[]): PPToken => ({ kind: 'space', text: ' ', lines, hidden: NONE });

export function preprocess(code: string): Preprocessed {
  return new Preprocessor().run(code);
}

class Preprocessor {
  private readonly macros = new Map<string, Macro>();
  private readonly headers: Preprocessed['headers'] = [];
  private readonly out: SourceToken[] = [];
  private produced = 0;
  /** One entry per open `#if`: is this branch kept, and was an earlier branch of it kept? */
  private readonly branches: { active: boolean; taken: boolean; parent: boolean }[] = [];

  constructor() {
    // g++ -std=c++17, the compiler of FAQ-05.
    this.defineNumber('__cplusplus', '201703L');
    this.defineNumber('__GNUC__', '13');
  }

  run(code: string): Preprocessed {
    let pending: PPToken[] = [];
    const flush = () => {
      for (const t of this.expand(pending, 0)) this.out.push(t);
      pending = [];
    };
    for (const line of splitLines(tokenize(code))) {
      const first = line.findIndex((t) => !isBlank(t) && t.kind !== 'comment');
      if (line[first]?.text === '#') {
        flush();
        this.directive(line.slice(first + 1).filter((t) => t.kind !== 'comment' && !isNewline(t)));
        // A directive leaves an empty line behind, so that its neighbours do not merge.
        pending.push(space([line[first].line]));
      } else if (this.active) {
        pending.push(...line.map(toPPToken));
      }
    }
    flush();
    return { tokens: this.out, headers: this.headers };
  }

  private get active(): boolean {
    return this.branches.at(-1)?.active ?? true;
  }

  private defineNumber(name: string, text: string): void {
    const body: PPToken[] = [{ kind: 'number', text, lines: [], hidden: NONE }];
    this.macros.set(name, { params: null, variadic: false, body });
  }

  private directive(line: Token[]): void {
    const rest = trim(line);
    const name = rest[0]?.text ?? '';
    const args = trim(rest.slice(1));
    switch (name) {
      case 'if':
        return this.open(() => this.condition(args));
      case 'ifdef':
        return this.open(() => this.macros.has(args[0]?.text ?? ''));
      case 'ifndef':
        return this.open(() => !this.macros.has(args[0]?.text ?? ''));
      case 'elif':
        return this.next(() => this.condition(args));
      case 'else':
        return this.next(() => true);
      case 'endif':
        this.branches.pop();
        return;
    }
    if (!this.active) return;
    if (name === 'define') this.define(args);
    if (name === 'undef') this.macros.delete(unsplice(args[0]?.text ?? ''));
    if (name === 'include') {
      const header = /^[<"]([^>"]+)[>"]/.exec(args.map((t) => t.text).join(''))?.[1];
      if (header && args[0]) this.headers.push({ name: header.trim(), line: args[0].line });
    }
  }

  private open(condition: () => boolean): void {
    const parent = this.active;
    const active = parent && condition();
    this.branches.push({ active, taken: active, parent });
  }

  private next(condition: () => boolean): void {
    const branch = this.branches.at(-1);
    if (!branch) return;
    branch.active = branch.parent && !branch.taken && condition();
    branch.taken ||= branch.active;
  }

  private define(args: Token[]): void {
    const name = args[0] && unsplice(args[0].text);
    if (!name) return;
    let at = 1;
    let params: string[] | null = null;
    let variadic = false;
    // Function-like only when the parenthesis touches the name.
    if (args[1]?.text === '(') {
      const close = args.findIndex((t) => t.text === ')');
      const names = args.slice(2, close).filter((t) => !isBlank(t) && t.text !== ',');
      variadic = names.some((t) => t.text === '...');
      params = names.filter((t) => t.text !== '...').map((t) => unsplice(t.text));
      at = close + 1;
    }
    const body = trim(args.slice(at)).map(toPPToken);
    this.macros.set(name, { params, variadic, body });
  }

  private expand(input: PPToken[], depth: number): PPToken[] {
    if (depth > MAX_DEPTH) throw new TooComplexError('macros nested too deep');
    const out: PPToken[] = [];
    // A stack, next token last: an expansion is pushed back and scanned again.
    const todo = input.slice().reverse();
    for (let token = todo.pop(); token; token = todo.pop()) {
      const macro =
        token.kind === 'identifier' && !token.hidden.has(token.text)
          ? this.macros.get(token.text)
          : undefined;
      const call = macro?.params ? takeArguments(todo) : undefined;
      if (!macro || (macro.params && !call)) {
        this.count(1);
        out.push(token);
        continue;
      }
      const result = this.substitute(token, macro, call ?? [], depth);
      this.count(result.length + 1);
      todo.push(space(token.lines));
      for (let i = result.length - 1; i >= 0; i--) todo.push(result[i]!);
      todo.push(space(token.lines));
    }
    return out;
  }

  private count(tokens: number): void {
    this.produced += tokens;
    if (this.produced > MAX_TOKENS) throw new TooComplexError('macros expand too far');
  }

  private substitute(name: PPToken, macro: Macro, args: PPToken[][], depth: number): PPToken[] {
    const hidden = new Set([...name.hidden, name.text]);
    const params = macro.params ?? [];
    const values = new Map<string, PPToken[]>();
    params.forEach((p, i) => values.set(p, args[i] ?? []));
    if (macro.variadic) {
      const rest = args.slice(params.length);
      const comma: PPToken = { kind: 'punctuation', text: ',', lines: name.lines, hidden: NONE };
      values.set(
        '__VA_ARGS__',
        rest.flatMap((arg, i) => (i ? [comma, ...arg] : arg)),
      );
    }

    const body = macro.body;
    const out: PPToken[] = [];
    const neighbour = (from: number, step: number) => {
      let i = from + step;
      while (body[i] && isBlank(body[i]!)) i += step;
      return i;
    };
    for (let i = 0; i < body.length; i++) {
      const token = body[i]!;
      const value = values.get(token.text);
      if (token.text === '#' && macro.params) {
        const operand = values.get(body[neighbour(i, 1)]?.text ?? '');
        if (operand) {
          const text = JSON.stringify(operand.map((t) => t.text).join(''));
          out.push({ kind: 'literal', text, lines: name.lines, hidden });
          i = neighbour(i, 1);
          continue;
        }
      }
      if (token.text === '##') {
        const right = neighbour(i, 1);
        const operand = values.get(body[right]?.text ?? '');
        paste(out, operand ?? (body[right] ? [body[right]] : []), name.lines, hidden);
        i = right;
        continue;
      }
      if (value) {
        const raw = body[neighbour(i, 1)]?.text === '##';
        // An argument keeps its own lines: that is where the student wrote it.
        for (const t of raw ? trim(value) : this.expand(value, depth + 1)) {
          out.push({ ...t, hidden: new Set([...t.hidden, ...hidden]) });
        }
      } else {
        out.push({ ...token, lines: [...token.lines, ...name.lines.slice(-1)], hidden });
      }
      this.count(1);
    }
    return out;
  }

  private condition(args: Token[]): boolean {
    // `defined X` is read before macros expand.
    const tokens: PPToken[] = [];
    const list = args.filter((t) => !isBlank(t));
    for (let i = 0; i < list.length; i++) {
      const token = list[i]!;
      if (token.text === 'defined' || token.text === '__has_include') {
        const paren = list[i + 1]?.text === '(';
        const close = paren ? list.findIndex((t, at) => at > i && t.text === ')') : i + 1;
        const name = list[paren ? i + 2 : i + 1]?.text ?? '';
        const yes = token.text === '__has_include' || this.macros.has(name);
        tokens.push({ kind: 'number', text: yes ? '1' : '0', lines: [], hidden: NONE });
        i = close < 0 ? list.length : close;
      } else {
        tokens.push(toPPToken(token));
      }
    }
    const texts = this.expand(tokens, 0)
      .filter((t) => !isBlank(t))
      .map((t) => (t.kind === 'identifier' && t.text !== 'true' ? '0' : t.text));
    return evaluate(texts) !== 0;
  }
}

const isNewline = (t: Token) => t.kind === 'newline';

function toPPToken(token: Token): PPToken {
  const { kind, line } = token;
  if (kind === 'comment') return space([line]);
  const text = kind === 'identifier' ? unsplice(token.text) : token.text;
  return { kind, text: kind === 'space' ? ' ' : text, lines: [line], hidden: NONE };
}

function splitLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    lines.at(-1)!.push(token);
    if (isNewline(token)) lines.push([]);
  }
  return lines;
}

function trim<T extends { kind: TokenKind }>(tokens: T[]): T[] {
  let start = 0;
  let end = tokens.length;
  while (start < end && isBlank(tokens[start]!)) start++;
  while (end > start && isBlank(tokens[end - 1]!)) end--;
  return tokens.slice(start, end);
}

/** Pops `( … )` off the stack and splits it at its top-level commas; undefined if there is none. */
function takeArguments(todo: PPToken[]): PPToken[][] | undefined {
  let at = todo.length - 1;
  while (at >= 0 && isBlank(todo[at]!)) at--;
  if (todo[at]?.text !== '(') return undefined;
  const args: PPToken[][] = [[]];
  let depth = 0;
  for (; at >= 0; at--) {
    const token = todo[at]!;
    if (token.text === '(' && depth++ === 0) continue;
    if (token.text === ')' && --depth === 0) {
      todo.length = at;
      return args.map(trim);
    }
    if (token.text === ',' && depth === 1) args.push([]);
    else args.at(-1)!.push(token);
  }
  return undefined;
}

/** `##`: joins the last token of `out` with the first token of `right`. */
function paste(
  out: PPToken[],
  right: PPToken[],
  lines: number[],
  hidden: ReadonlySet<string>,
): void {
  while (out.length && isBlank(out.at(-1)!)) out.pop();
  const left = out.pop();
  const [first, ...rest] = trim(right);
  const joined = tokenize((left?.text ?? '') + (first?.text ?? ''));
  for (const t of joined) out.push({ kind: t.kind, text: t.text, lines, hidden });
  out.push(...rest);
}

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '|': 3,
  '^': 4,
  '&': 5,
  '==': 6,
  '!=': 6,
  '<': 7,
  '>': 7,
  '<=': 7,
  '>=': 7,
  '<<': 8,
  '+': 9,
  '-': 9,
  '*': 10,
  '/': 10,
  '%': 10,
};

/** The value of an `#if` expression; 0 for anything it does not understand. */
function evaluate(texts: string[]): number {
  let at = 0;
  let depth = 0;

  const primary = (): number => {
    if (++depth > MAX_DEPTH) throw new TooComplexError('#if nested too deep');
    const text = texts[at++] ?? '0';
    let value: number;
    if (text === '!') value = Number(!primary());
    else if (text === '-') value = -primary();
    else if (text === '+') value = primary();
    else if (text === '~') value = ~primary();
    else if (text === '(') {
      value = ternary();
      if (texts[at] === ')') at++;
    } else if (text === 'true') value = 1;
    else value = Number(text.replace(/'/g, '').replace(/[uUlL]+$/, '')) || 0;
    depth--;
    return value;
  };

  const binary = (min: number): number => {
    let left = primary();
    for (;;) {
      const op = texts[at] ?? '';
      const level = PRECEDENCE[op];
      if (level === undefined || level < min) return left;
      at++;
      left = apply(op, left, binary(level + 1));
    }
  };

  const ternary = (): number => {
    const test = binary(1);
    if (texts[at] !== '?') return test;
    at++;
    const yes = ternary();
    if (texts[at] === ':') at++;
    const no = ternary();
    return test ? yes : no;
  };

  return ternary();
}

function apply(op: string, a: number, b: number): number {
  switch (op) {
    case '||':
      return Number(Boolean(a) || Boolean(b));
    case '&&':
      return Number(Boolean(a) && Boolean(b));
    case '|':
      return a | b;
    case '^':
      return a ^ b;
    case '&':
      return a & b;
    case '==':
      return Number(a === b);
    case '!=':
      return Number(a !== b);
    case '<':
      return Number(a < b);
    case '>':
      return Number(a > b);
    case '<=':
      return Number(a <= b);
    case '>=':
      return Number(a >= b);
    case '<<':
      return a << b;
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b ? Math.trunc(a / b) : 0;
    default:
      return b ? a % b : 0;
  }
}
