// The C++ syntax tree, copied out of tree-sitter into plain objects.
import { createRequire } from 'node:module';
import { Language, Parser } from 'web-tree-sitter';

export interface Node {
  type: string;
  /** The grammar's name for this child's role, e.g. `declarator`. */
  field: string | null;
  named: boolean;
  text: string;
  start: number;
  parent: Node | null;
  children: Node[];
}

let language: Promise<Language> | undefined;

function loadLanguage(): Promise<Language> {
  language ??= (async () => {
    await Parser.init();
    const require = createRequire(import.meta.url);
    return Language.load(require.resolve('tree-sitter-cpp/tree-sitter-cpp.wasm'));
  })();
  return language;
}

export async function parse(code: string): Promise<Node> {
  const cpp = await loadLanguage();
  const parser = new Parser();
  try {
    parser.setLanguage(cpp);
    const tree = parser.parse(code);
    if (!tree) throw new Error('tree-sitter returned no tree');
    try {
      const cursor = tree.walk();
      // Iterative: the nesting depth is the student's choice.
      const read = (parent: Node | null): Node => ({
        type: cursor.nodeType,
        field: cursor.currentFieldName,
        named: cursor.nodeIsNamed,
        text: code.slice(cursor.startIndex, cursor.endIndex),
        start: cursor.startIndex,
        parent,
        children: [],
      });
      const root = read(null);
      let current: Node | null = root;
      let down = true;
      while (current) {
        if (down && cursor.gotoFirstChild()) {
          const child = read(current);
          current.children.push(child);
          current = child;
        } else if (current.parent && cursor.gotoNextSibling()) {
          const sibling = read(current.parent);
          current.parent.children.push(sibling);
          current = sibling;
          down = true;
        } else {
          cursor.gotoParent();
          current = current.parent;
          down = false;
        }
      }
      cursor.delete();
      return root;
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}

export function* walk(root: Node): Generator<Node> {
  const todo = [root];
  for (let node = todo.pop(); node; node = todo.pop()) {
    yield node;
    for (let i = node.children.length - 1; i >= 0; i--) todo.push(node.children[i]!);
  }
}

export function child(node: Node, field: string): Node | undefined {
  return node.children.find((c) => c.field === field);
}

export function ancestor(node: Node, types: ReadonlySet<string>): Node | null {
  let at = node.parent;
  while (at && !types.has(at.type)) at = at.parent;
  return at;
}
