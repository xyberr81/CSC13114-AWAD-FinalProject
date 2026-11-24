// Splits C++ source into tokens, so that comments and literals are told apart from code the way a
// compiler does it. Joining the texts of all the tokens gives the source back.

export type TokenKind =
  | 'space' // blanks and backslash-newlines
  | 'newline'
  | 'comment'
  | 'literal' // string, raw string or character
  | 'number'
  | 'identifier'
  | 'punctuation';

export interface Token {
  kind: TokenKind;
  text: string;
  /** 1-based line the token starts on. */
  line: number;
}

const SPLICE = String.raw`\\\r?\n`;

// Order matters: a raw string before an identifier (`R`), a comment before `/`.
const RULES: [TokenKind, RegExp][] = [
  ['newline', /\r?\n/y],
  ['space', new RegExp(String.raw`(?:[^\S\n]|${SPLICE})+`, 'y')],
  ['comment', new RegExp(String.raw`//(?:${SPLICE}|[^\n])*`, 'y')],
  ['comment', /\/\*[^]*?(?:\*\/|$)/y],
  ['literal', /(?:u8|[uUL])?R"([^\s()\\]{0,16})\([^]*?(?:\)\1"|$)/y],
  ['literal', /(?:u8|[uUL])?"(?:\\\r?\n|\\.|[^"\\\n])*"?/y],
  ['literal', /(?:u8|[uUL])?'(?:\\\r?\n|\\.|[^'\\\n])*'?/y],
  ['number', /\.?\d(?:'?[\w.]|(?<=[eEpP])[+-])*/y],
  ['identifier', new RegExp(String.raw`[A-Za-z_$](?:(?:${SPLICE})*[\w$])*`, 'y')],
  ['punctuation', /<<=|>>=|\.\.\.|->\*|::|->|##|\+\+|--|<<|[-+*/%&|^=!<>]=|&&|\|\||[^]/y],
];

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  let line = 1;
  while (at < code.length) {
    const [kind, text] = next(code, at);
    tokens.push({ kind, text, line });
    at += text.length;
    for (const c of text) if (c === '\n') line++;
  }
  return tokens;
}

function next(code: string, at: number): [TokenKind, string] {
  for (const [kind, rule] of RULES) {
    rule.lastIndex = at;
    const text = rule.exec(code)?.[0];
    if (text) return [kind, text];
  }
  // The last rule matches any character; this only satisfies the type checker.
  return ['punctuation', code.charAt(at)];
}

/** An identifier without the backslash-newlines that may split it. */
export function unsplice(text: string): string {
  return text.replace(/\\\r?\n/g, '');
}
