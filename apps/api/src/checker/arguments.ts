import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

export class UsageError extends Error {}

export const USAGE = `usage: checker <dataset-dir> [--out <predictions.jsonl>] [--calls <calls.jsonl>]
               [--limit <solutions>] [--concurrency <n>]

Without --out the predictions go to standard output.
MODEL_OFF=1: hard rules only, "unsure" for every semantic constraint, no network connection.
Otherwise LLM_PROVIDER, LLM_MODEL and LLM_API_KEY name the model, and --calls keeps the call log.`;

export interface Arguments {
  dataset: string;
  out: string | null;
  calls: string | null;
  limit: number | null;
  concurrency: number;
}

export function parseArguments(argv: string[], cwd: string): Arguments {
  const { values, positionals } = parse(argv);
  const [dataset, ...more] = positionals;
  if (!dataset || more.length > 0) throw new UsageError('name one dataset folder');
  return {
    dataset: resolve(cwd, dataset),
    out: values.out ? resolve(cwd, values.out) : null,
    calls: values.calls ? resolve(cwd, values.calls) : null,
    limit: values.limit === undefined ? null : count('--limit', values.limit),
    concurrency: count('--concurrency', values.concurrency),
  };
}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        calls: { type: 'string' },
        limit: { type: 'string' },
        concurrency: { type: 'string', default: '4' },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function count(name: string, text: string): number {
  if (!/^[1-9]\d{0,4}$/.test(text)) throw new UsageError(`${name} needs a number from 1`);
  return Number(text);
}
