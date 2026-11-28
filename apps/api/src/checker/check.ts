// Runs the same review() as the product over every (solution, constraint) pair of a dataset.
import {
  review,
  type Evidence,
  type ModelCall,
  type ModelClient,
  type VerdictValue,
} from '../review/review.js';
import type { Solution } from './dataset.js';

/** One line of the prediction file. */
export interface Prediction {
  solution: string;
  constraint: string;
  verdict: VerdictValue;
  evidence: Evidence[];
}

export interface LoggedCall extends ModelCall {
  solution: string;
  constraint: string;
}

export interface CheckOptions {
  model: ModelClient;
  modelOff: boolean;
  /** How many pairs are reviewed at once. */
  concurrency: number;
  /** Called as soon as a call ends, so that a run that breaks off loses no paid call. */
  onCall: (call: LoggedCall) => void;
  onError?: (pair: string, error: unknown) => void;
}

export interface Summary {
  pairs: number;
  hardRule: number;
  modelCalls: number;
  unsure: number;
  /** Pairs that broke; they are predicted unsure. */
  failed: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export async function check(
  solutions: Solution[],
  { model, modelOff, concurrency, onCall, onError }: CheckOptions,
): Promise<{ predictions: Prediction[]; summary: Summary }> {
  const pairs = solutions.flatMap((solution) =>
    solution.constraints.map((constraint) => ({ solution, constraint })),
  );
  const predictions: Prediction[] = [];
  const summary: Summary = {
    pairs: pairs.length,
    hardRule: 0,
    modelCalls: 0,
    unsure: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
  };

  const checkPair = async (index: number) => {
    const { solution, constraint } = pairs[index]!;
    const pair = { solution: solution.id, constraint: constraint.code };
    let prediction: Prediction = { ...pair, verdict: 'unsure', evidence: [] };
    try {
      const [verdict] = await review(
        { statement: solution.statement, constraints: [constraint], code: solution.code },
        {
          model,
          modelOff,
          logCall: (call) => {
            summary.modelCalls++;
            summary.promptTokens += call.promptTokens ?? 0;
            summary.completionTokens += call.completionTokens ?? 0;
            summary.costUsd += call.costUsd ?? 0;
            onCall({ ...pair, ...call });
          },
        },
      );
      if (!verdict) throw new Error('no verdict');
      prediction = { ...pair, verdict: verdict.verdict, evidence: verdict.evidence };
      if (verdict.source === 'hard_rule') summary.hardRule++;
    } catch (error) {
      summary.failed++;
      onError?.(`${pair.solution} ${pair.constraint}`, error);
    }
    if (prediction.verdict === 'unsure') summary.unsure++;
    predictions[index] = prediction;
  };

  let next = 0;
  const lane = async () => {
    while (next < pairs.length) await checkPair(next++);
  };
  await Promise.all(Array.from({ length: concurrency }, lane));
  return { predictions, summary };
}
