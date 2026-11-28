// The checker command: a dataset folder in, a prediction file out.
import { appendFileSync, writeFileSync } from 'node:fs';
import { modelFromEnv } from '../review/anthropic.js';
import type { ModelClient } from '../review/review.js';
import { parseArguments, USAGE, UsageError } from './arguments.js';
import { check } from './check.js';
import { readDataset } from './dataset.js';

const noModel: ModelClient = {
  name: 'none',
  complete: () => Promise.reject(new Error('the model is off')),
};

async function main(): Promise<number> {
  // npm runs a workspace script inside the workspace; INIT_CWD is where the user is.
  const args = parseArguments(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd());
  const modelOff = process.env.MODEL_OFF === '1';
  const model = modelOff ? noModel : modelFromEnv();
  const solutions = readDataset(args.dataset).slice(0, args.limit ?? undefined);

  // Both files are opened before the first call is paid for; a call log is never overwritten.
  const { calls, out } = args;
  if (calls) writeFileSync(calls, '', { flag: 'wx' });
  if (out) writeFileSync(out, '');
  const { predictions, summary } = await check(solutions, {
    model,
    modelOff,
    concurrency: args.concurrency,
    onCall: (call) => {
      if (calls) appendFileSync(calls, `${JSON.stringify(call)}\n`);
    },
    onError: (pair, error) => console.error(`${pair}: ${String(error)}`),
  });

  const text = predictions.map((p) => `${JSON.stringify(p)}\n`).join('');
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
  // Standard error, so that the summary never ends up in the prediction file.
  console.error(JSON.stringify({ model: model.name, modelOff, ...summary }, null, 2));
  return summary.failed > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  if (error instanceof UsageError) console.error(USAGE);
  process.exitCode = 2;
}
