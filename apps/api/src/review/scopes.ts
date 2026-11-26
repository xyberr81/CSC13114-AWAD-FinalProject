// Which declaration does a name mean? Enough of C++ name lookup to tell the student's own `sort`
// from the library's. Every solution compiles, so a name the student did not declare is a library
// name; when the two cannot be told apart, the student's own one is assumed.
import { ancestor, child, walk, type Node } from './syntax.js';

export interface PathPart {
  text: string;
  node: Node;
}

interface Declaration {
  scope: Node;
  node: Node;
  /** The parameters, for a function. */
  params: Node | null;
  /** The type node of a variable, parameter or member. */
  type: Node | null;
}

interface Using {
  scope: Node;
  start: number;
  path: string[];
  directive: boolean;
}

const CLASSES = new Set(['class_specifier', 'struct_specifier', 'union_specifier']);
const NAMESPACES = new Set(['namespace_definition', 'translation_unit']);
const BLOCKS = new Set([
  'compound_statement',
  'function_definition',
  'lambda_expression',
  'for_statement',
  'for_range_loop',
  'if_statement',
  'while_statement',
  'switch_statement',
  'catch_clause',
]);
const SCOPES = new Set([...CLASSES, ...NAMESPACES, ...BLOCKS]);
const DECLARING = new Set([
  'declaration',
  'field_declaration',
  'function_definition',
  'parameter_declaration',
  'optional_parameter_declaration',
  'variadic_parameter_declaration',
  'for_range_loop',
  'type_definition',
  'condition_declaration',
]);
const NAMES = new Set(['identifier', 'field_identifier', 'type_identifier']);
/** Methods that return an iterator, so never an index, a container or (by name) a pointer. */
const ITERATORS = /^c?r?(?:begin|end)$/;

/** `std::vector<int>::iterator` as its parts, without template arguments. */
export function pathOf(node: Node): PathPart[] {
  if (node.type === 'qualified_identifier') {
    const scope = child(node, 'scope');
    const name = child(node, 'name');
    return [...(scope ? pathOf(scope) : []), ...(name ? pathOf(name) : [])];
  }
  const name = child(node, 'name');
  if (name) return pathOf(name);
  const last = node.children.findLast((c) => c.named);
  return last ? pathOf(last) : [{ text: node.text, node }];
}

export class Scopes {
  /** The nodes that introduce a name, which are not uses of it. */
  readonly introducing = new Set<Node>();
  private readonly declarations = new Map<string, Declaration[]>();
  private readonly usings: Using[] = [];
  private readonly aliases = new Map<string, string[]>();
  private readonly namespaces = new Set<string>();
  private readonly classes = new Map<string, Node[]>();

  constructor(root: Node) {
    for (const node of walk(root)) this.visit(node);
  }

  /**
   * The library names that a use may mean, as full paths. Empty when it means something the
   * student declared.
   */
  resolve(path: PathPart[], use: Node): string[][] {
    const texts = this.expandAlias(path.map((p) => p.text));
    const [first] = texts;
    if (first === undefined) return [];
    if (first === 'std') return [texts];

    if (path.length > 1 && this.isOwnScope(first)) return this.reExported(texts, use);
    const found = this.lookup(first, use);
    if (found === 'own') return [];
    return [texts, ['std', ...texts], ...found.map((prefix) => [...prefix, ...texts.slice(1)])];
  }

  /** Does `object.name` reach a member that the student wrote? */
  isOwnMember(object: Node | undefined, name: string): boolean {
    const owners = (this.declarations.get(name) ?? []).filter((d) => CLASSES.has(d.scope.type));
    if (!owners.length) return false;
    if (object?.type !== 'identifier') return true;
    const declared = this.declarations.get(object.text)?.filter((d) => d.type) ?? [];
    const types = declared.map((d) => pathOf(d.type!).at(-1)!.text);
    // A type that is neither a class of the student's nor anything known may be either.
    if (!types.length || types.some((t) => t === 'auto' || this.classes.has(t))) return true;
    return types.some((t) => this.declarations.has(t));
  }

  private visit(node: Node): void {
    if (DECLARING.has(node.type)) {
      for (const c of node.children) if (c.field === 'declarator') this.declare(node, c);
    } else if (CLASSES.has(node.type) || node.type === 'enum_specifier') {
      const name = child(node, 'name');
      if (name?.type === 'type_identifier') {
        this.add(name, this.scopeOf(node), null, null);
        if (CLASSES.has(node.type) && child(node, 'body')) {
          this.classes.set(name.text, [...(this.classes.get(name.text) ?? []), node]);
        }
      }
    } else if (node.type === 'alias_declaration' || node.type === 'enumerator') {
      const name = child(node, 'name');
      if (name) this.add(name, this.scopeOf(node), null, null);
    } else if (/^(optional_|variadic_)?type_parameter_declaration$/.test(node.type)) {
      const name = node.children.find((c) => c.type === 'type_identifier');
      const template = ancestor(node, new Set(['template_declaration', 'lambda_expression']));
      if (name && template) this.add(name, template, null, null);
    } else if (node.type === 'lambda_capture_initializer') {
      const name = node.children.find((c) => c.type === 'identifier');
      if (name) this.add(name, this.scopeOf(node), null, null);
    } else if (node.type === 'namespace_definition') {
      this.namespaces.add(namespaceKey(node));
    } else if (node.type === 'namespace_alias_definition') {
      const [name, target] = node.children.filter((c) => c.named);
      if (name && target) {
        const path = target.text.split('::').map((t) => t.trim());
        this.aliases.set(name.text, path.filter(Boolean));
      }
    } else if (node.type === 'using_declaration') {
      const target = node.children.findLast((c) => c.named);
      if (target) {
        this.usings.push({
          scope: this.scopeOf(node),
          start: node.start,
          path: pathOf(target).map((p) => p.text),
          directive: node.children.some((c) => c.type === 'namespace'),
        });
      }
    }
  }

  private declare(owner: Node, declarator: Node): void {
    let params: Node | null = null;
    let at: Node | undefined = declarator;
    while (at && !NAMES.has(at.type)) {
      if (at.type === 'structured_binding_declarator') {
        for (const c of at.children) if (c.named) this.add(c, this.scopeOf(owner), null, null);
        return;
      }
      if (at.type === 'function_declarator') params = child(at, 'parameters') ?? null;
      // `void S::go()` defines something declared elsewhere.
      if (at.type === 'qualified_identifier' || at.type === 'abstract_function_declarator') return;
      at = child(at, 'declarator') ?? at.children.find((c) => c.named && !isQualifier(c));
    }
    if (at) this.add(at, this.declaringScope(owner), params, child(owner, 'type') ?? null);
  }

  private add(node: Node, scope: Node, params: Node | null, type: Node | null): void {
    this.introducing.add(node);
    const list = this.declarations.get(node.text) ?? [];
    list.push({ scope, node, params, type });
    this.declarations.set(node.text, list);
  }

  private declaringScope(owner: Node): Node {
    if (owner.type === 'for_range_loop') return owner;
    if (owner.parent?.type === 'friend_declaration') {
      // A friend function belongs to the namespace around the class.
      return ancestor(owner, NAMESPACES) ?? rootOf(owner);
    }
    if (owner.parent?.type !== 'parameter_list') return this.scopeOf(owner);
    // Parameters belong to their function's body, or to nothing but the prototype itself.
    let at: Node = owner.parent;
    while (at.parent?.type.endsWith('declarator')) at = at.parent;
    const holder = at.parent;
    return holder && BLOCKS.has(holder.type) ? holder : at;
  }

  /** The scope a node is in. An anonymous namespace adds its names to the one around it. */
  private scopeOf(node: Node): Node {
    let scope = ancestor(node, SCOPES);
    while (scope?.type === 'namespace_definition' && !child(scope, 'name')) {
      scope = ancestor(scope, SCOPES);
    }
    return scope ?? rootOf(node);
  }

  private expandAlias(path: string[]): string[] {
    let out = path;
    for (let i = 0; i < 10 && out.length > 1; i++) {
      const target = this.aliases.get(out[0]!);
      if (!target) break;
      out = [...target, ...out.slice(1)];
    }
    return out.filter((part) => part !== '__cxx11');
  }

  private isOwnScope(name: string): boolean {
    if (this.classes.has(name) || this.declarations.has(name)) return true;
    return [...this.namespaces].some((key) => key.split('::').includes(name));
  }

  /** `mine::sort`, where the namespace may only pass on what it takes from std. */
  private reExported(path: string[], use: Node): string[][] {
    const name = path.at(-1)!;
    const scope = path.slice(0, -1).join('::');
    const inside = (key: string) => key === scope || key.endsWith(`::${scope}`);
    if (![...this.namespaces].some(inside)) return [];
    const own = this.declarations
      .get(name)
      ?.some((d) => d.scope.type === 'namespace_definition' && inside(namespaceKey(d.scope)));
    if (own) return [];
    return this.usings
      .filter((u) => u.scope.type === 'namespace_definition' && inside(namespaceKey(u.scope)))
      .filter((u) => u.start < use.start)
      .flatMap((u) => {
        const target =
          u.path[0] === undefined ? [] : this.expandAlias([...u.path, '']).slice(0, -1);
        if (u.directive) return [[...target, name]];
        return target.at(-1) === name ? [target] : [];
      });
  }

  /** `'own'`, or the paths that using-declarations and using-directives give the name. */
  private lookup(name: string, use: Node): 'own' | string[][] {
    const declared = this.declarations.get(name) ?? [];
    const paths: string[][] = [];
    for (let scope = use.parent; scope; scope = scope.parent) {
      const here = declared.filter((d) => sameScope(d.scope, scope));

      if (CLASSES.has(scope.type)) {
        if (here.length || this.inherits(scope, name)) return 'own';
      } else if (NAMESPACES.has(scope.type)) {
        const visible = here.filter((d) => d.node.start <= use.start);
        if (this.choose(visible, use)) return 'own';
      } else if (here.some((d) => d.node.start <= use.start)) {
        return 'own';
      }
      if (scope.type === 'function_definition' && this.isMemberBody(scope, name)) return 'own';

      for (const using of this.usings) {
        if (!sameScope(using.scope, scope) || using.start > use.start) continue;
        const target = this.expandAlias([...using.path, '']).slice(0, -1);
        if (using.directive) {
          if (this.choose(this.declaredIn(target, name, use), use)) return 'own';
          paths.push([...target, name]);
        } else if (target.at(-1) === name) {
          if (target[0] === 'std') {
            paths.push(target);
            // A using-declaration in a block hides the student's functions outside it.
            if (BLOCKS.has(scope.type)) return paths;
          } else if (this.choose(this.declaredIn(target.slice(0, -1), name, use), use)) {
            return 'own';
          }
        }
      }
    }
    return paths;
  }

  private declaredIn(namespace: string[], name: string, use: Node): Declaration[] {
    const key = namespace.join('::');
    return (this.declarations.get(name) ?? []).filter((d) => {
      if (d.scope.type !== 'namespace_definition' || d.node.start > use.start) return false;
      const own = namespaceKey(d.scope);
      return own === key || own.endsWith(`::${key}`);
    });
  }

  /** Is one of these what the use means? Overloads compete with the library by parameters. */
  private choose(candidates: Declaration[], use: Node): boolean {
    if (candidates.some((d) => !d.params)) return true;
    const call = callOf(use);
    return candidates.some((d) => !call || accepts(d.params!, call));
  }

  private inherits(scope: Node, name: string, seen = new Set<string>()): boolean {
    const bases = scope.children.find((c) => c.type === 'base_class_clause');
    return (bases?.children ?? []).some((base) => {
      if (!base.named || base.type === 'access_specifier') return false;
      const text = pathOf(base).at(-1)!.text;
      if (seen.has(text)) return false;
      seen.add(text);
      return (this.classes.get(text) ?? []).some(
        (c) =>
          (this.declarations.get(name) ?? []).some((d) => d.scope === c) ||
          this.inherits(c, name, seen),
      );
    });
  }

  /** The body of `void S::go()` sees the members of S, and that of `void ns::go()` the names of ns. */
  private isMemberBody(definition: Node, name: string): boolean {
    let at = child(definition, 'declarator');
    while (at && at.type !== 'qualified_identifier') at = child(at, 'declarator');
    if (!at) return false;
    const owner = pathOf(at).at(-2)?.text;
    if (owner === undefined) return false;
    if (this.namespaces.has(owner)) return this.declaredIn([owner], name, definition).length > 0;
    return (this.classes.get(owner) ?? []).some(
      (c) =>
        (this.declarations.get(name) ?? []).some((d) => d.scope === c) || this.inherits(c, name),
    );
  }
}

function isQualifier(node: Node): boolean {
  return /qualifier|specifier|modifier|attribute/.test(node.type);
}

function rootOf(node: Node): Node {
  let at = node;
  while (at.parent) at = at.parent;
  return at;
}

function namespaceKey(node: Node): string {
  const parts: string[] = [];
  for (let at: Node | null = node; at; at = at.parent) {
    const name = at.type === 'namespace_definition' ? child(at, 'name') : undefined;
    if (name) parts.unshift(name.text.replace(/\s/g, ''));
  }
  return parts.join('::');
}

/** A namespace may be opened more than once. */
function sameScope(a: Node, b: Node): boolean {
  if (a === b) return true;
  if (a.type !== 'namespace_definition' || b.type !== a.type) return false;
  return namespaceKey(a) === namespaceKey(b);
}

/** The arguments, when the name is what a call calls. */
function callOf(use: Node): Node[] | null {
  let at = use;
  while (
    at.parent &&
    (at.parent.type === 'template_function' || at.parent.type === 'qualified_identifier')
  ) {
    at = at.parent;
  }
  if (at.parent?.type !== 'call_expression' || at.field !== 'function') return null;
  return child(at.parent, 'arguments')?.children.filter((c) => c.named) ?? [];
}

function accepts(params: Node, args: Node[]): boolean {
  const list = params.children.filter((p) => p.named && p.text !== 'void');
  const open = params.children.some(
    (p) => p.type === '...' || p.type.startsWith('variadic_parameter'),
  );
  const required = list.filter((p) => p.type === 'parameter_declaration').length;
  if (args.length < required || (!open && args.length > list.length)) return false;
  return list.every((param, i) => fits(param, args[i], args[0]));
}

/** False only when the argument cannot be meant for the parameter. */
function fits(param: Node, arg: Node | undefined, first: Node | undefined): boolean {
  if (!arg) return true;
  const type = child(param, 'type');
  const declarator = child(param, 'declarator');
  if (!type) return true;
  const pointer = /^(abstract_)?(pointer|array)_declarator$/.test(declarator?.type ?? '');
  const number = type.type === 'primitive_type' || type.type === 'sized_type_specifier';
  const container = /^(std::)?(vector|deque|list|array|string|basic_string)\b(?!.*::)/.test(
    type.text.replace(/\s/g, ''),
  );

  const callee = arg.type === 'call_expression' ? child(arg, 'function') : undefined;
  const method = callee?.type === 'field_expression' ? child(callee, 'field')?.text : undefined;
  if (method && ITERATORS.test(method)) return !number && !container && !pointer;
  if (callee && ITERATORS.test(pathOf(callee).at(-1)!.text))
    return pointer || (!number && !container);
  // `sort(a, a + n)`: the second argument is a position in the first, not a number.
  if (arg !== first && first && arg.type === 'binary_expression') {
    const left = child(arg, 'left');
    if (
      left?.text === first.text &&
      /^[A-Za-z_]\w*$/.test(first.text) &&
      first.type === 'identifier'
    ) {
      return pointer || !number || !isPointerParam(param.parent);
    }
  }
  return true;
}

function isPointerParam(params: Node | null): boolean {
  const first = params?.children.find((c) => c.named);
  const declarator = first && child(first, 'declarator');
  return /^(abstract_)?(pointer|array)_declarator$/.test(declarator?.type ?? '');
}
