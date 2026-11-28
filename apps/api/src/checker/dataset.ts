// Reads a dataset folder: the statement, the constraints and the solutions of each problem, and
// nothing else. Labels and tests are not for the checker.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Solution {
  /** `<problem>/<name>`, as in the labels. */
  id: string;
  code: string;
  statement: string;
  constraints: { code: string; text: string }[];
}

export function readDataset(root: string): Solution[] {
  const problems = join(root, 'problems');
  if (!existsSync(problems)) throw new Error(`${root} is not a dataset: it has no problems/`);
  return readdirSync(problems, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((problem) => readProblem(root, problem));
}

function readProblem(root: string, problem: string): Solution[] {
  const statement = readFileSync(join(root, 'problems', problem, 'statement.md'), 'utf8');
  const constraints = readConstraints(join(root, 'problems', problem, 'constraints.json'));
  const folder = join(root, 'solutions', problem);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file) => file.endsWith('.cpp'))
    .sort()
    .map((file) => ({
      id: `${problem}/${file.slice(0, -'.cpp'.length)}`,
      code: readFileSync(join(folder, file), 'utf8'),
      statement,
      constraints,
    }));
}

function readConstraints(path: string): Solution['constraints'] {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error(`${path}: not a list`);
  return value.map((item: unknown) => {
    const { id, text } = (item ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || typeof text !== 'string') {
      throw new Error(`${path}: a constraint needs an id and a text`);
    }
    return { code: id, text };
  });
}
