import { tokenize } from './lexer.js';

/** Replaces every comment with blanks, so that the rest keeps its line and column. */
export function stripComments(code: string): string {
  return tokenize(code)
    .map(({ kind, text }) => (kind === 'comment' ? text.replace(/[^\r\n]/g, ' ') : text))
    .join('');
}
