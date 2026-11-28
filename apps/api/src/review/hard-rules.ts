// Decides the ban-list constraints ("Do not use …" / "Do not call …", every banned name in
// backticks) from the syntax of the code. Nothing here knows a problem or a solution.
import { preprocess, TooComplexError, type Preprocessed, type SourceToken } from './preprocess.js';
import { pathOf, Scopes, type PathPart } from './scopes.js';
import { child, parse, walk, type Node } from './syntax.js';

export interface HardRuleResult {
  verdict: 'pass' | 'violation';
  /** 1-based lines of the original source, with their original text. */
  evidence: { line: number; text: string }[];
}

const KEYWORDS = new Set(
  (
    'alignas alignof and and_eq asm auto bitand bitor bool break case catch char char16_t char32_t ' +
    'class compl const constexpr const_cast continue decltype default delete do double ' +
    'dynamic_cast else enum explicit export extern false float for friend goto if inline int long ' +
    'mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public ' +
    'register reinterpret_cast return short signed sizeof static static_assert static_cast struct ' +
    'switch template this thread_local throw true try typedef typeid typename union unsigned ' +
    'using virtual void volatile wchar_t while xor xor_eq'
  ).split(' '),
);
const IDENTIFIER = /^[A-Za-z_]\w*$/;

/** The banned names, or null when the constraint is not a ban list. */
export function bannedNames(text: string): string[] | null {
  if (!/^\s*Do not (?:use|call)\b/.test(text)) return null;
  const names = [...text.matchAll(/`([^`]+)`/g)].map((m) => normalise(m[1]!)).filter(Boolean);
  return names.length ? names : null;
}

function normalise(name: string): string {
  const text = name.trim().replace(/\(\s*\)$/, '');
  if (text.startsWith('<')) return text.replace(/\s/g, '');
  return text
    .replace(/\s+/g, ' ')
    .replace(/^(?:::|\.|->)\s*(?=\w)/, '')
    .replace(/^([\w:]+)<.*>$/, '$1');
}

/** Null when this is not a ban list, or the code is too complex to expand. */
export async function checkBanList(text: string, code: string): Promise<HardRuleResult | null> {
  const names = bannedNames(text);
  if (!names) return null;
  let source: Preprocessed;
  try {
    source = preprocess(code);
  } catch (error) {
    if (error instanceof TooComplexError) return null;
    throw error;
  }

  const lines = new Set<number>();
  const cite = (token: SourceToken | undefined) => token?.lines.forEach((line) => lines.add(line));
  const paths: string[][] = [];
  const operators: string[] = [];
  for (const name of names) {
    if (name.startsWith('<')) {
      for (const h of source.headers) if (`<${h.name}>` === name) lines.add(h.line);
    } else if (KEYWORDS.has(name)) {
      for (const t of source.tokens) if (t.kind === 'identifier' && t.text === name) cite(t);
    } else if (name.split('::').every((part) => IDENTIFIER.test(part))) {
      paths.push(name.split('::'));
    } else {
      operators.push(name.replace(/\s/g, ''));
    }
  }

  if (paths.length || operators.length) {
    const starts = new Map<number, SourceToken>();
    let expanded = '';
    for (const token of source.tokens) {
      starts.set(expanded.length, token);
      expanded += token.text;
    }
    const root = await parse(expanded);
    const scopes = new Scopes(root);
    for (const node of walk(root)) {
      for (const use of libraryUses(node, scopes, paths)) cite(starts.get(use.start));
      if (isOperator(node, operators)) cite(starts.get(node.start));
    }
  }

  const original = code.split(/\r?\n/);
  const evidence = [...lines]
    .sort((a, b) => a - b)
    .map((line) => ({ line, text: original[line - 1] ?? '' }));
  return { verdict: evidence.length ? 'violation' : 'pass', evidence };
}

const SIMPLE = new Set(['identifier', 'type_identifier']);
/** Nodes that mention a name without using it. */
const MENTIONS = new Set(['using_declaration', 'namespace_alias_definition']);

/** The name nodes inside `node` (looked at as one name) that mean a banned library name. */
function libraryUses(node: Node, scopes: Scopes, banned: string[][]): Node[] {
  const parent = node.parent;
  if (!parent || scopes.introducing.has(node) || MENTIONS.has(parent.type)) return [];

  if (node.type === 'field_identifier') return memberUse(node, scopes, banned);
  const simple = SIMPLE.has(node.type);
  if (!simple && node.type !== 'qualified_identifier') return [];
  // Part of a longer name, which is looked at as a whole.
  if (isInQualified(node)) return [];

  const path = pathOf(node);
  return scopes.resolve(path, node).flatMap((full) => matches(full, path, banned));
}

function isInQualified(node: Node): boolean {
  let at = node;
  while (at.field === 'name' && at.parent && /^(template_|dependent_)/.test(at.parent.type)) {
    at = at.parent;
  }
  return at.parent?.type === 'qualified_identifier';
}

/** A banned name is used when it is the path or the start of it, as in `std::string::npos`. */
function matches(full: string[], path: PathPart[], banned: string[][]): Node[] {
  return banned.flatMap((ban) => {
    // A C name is the same function in the global namespace and in std.
    const paths = ban.length === 1 ? [ban, ['std', ...ban]] : [ban];
    const hit = paths.find((p) => p.every((part, i) => full[i] === part));
    if (!hit) {
      // `&std::string::rbegin` is the method a bare `rbegin` bans.
      const last = path.at(-1);
      return ban.length === 1 && full[0] === 'std' && last && last.text === ban[0]
        ? [last.node]
        : [];
    }
    const part = path[path.length - (full.length - hit.length) - 1];
    return part ? [part.node] : [];
  });
}

/** `object.rbegin()` uses the banned name `rbegin`; a `std::` name is never a method. */
function memberUse(node: Node, scopes: Scopes, banned: string[][]): Node[] {
  if (!banned.some((ban) => ban.length === 1 && ban[0] === node.text)) return [];
  let at: Node = node;
  while (at.parent && /^(template_method|dependent_name)$/.test(at.parent.type)) at = at.parent;
  if (at.parent?.type !== 'field_expression') return [];
  return scopes.isOwnMember(child(at.parent, 'argument'), node.text) ? [] : [node];
}

function isOperator(node: Node, operators: string[]): boolean {
  if (node.named) {
    return (
      (node.type === 'new_expression' &&
        operators.includes('new[]') &&
        node.children.some((c) => c.type === 'new_declarator')) ||
      (node.type === 'delete_expression' &&
        operators.includes('delete[]') &&
        node.children.some((c) => c.type === '['))
    );
  }
  return operators.includes(node.type) && (node.parent?.type.endsWith('_expression') ?? false);
}
