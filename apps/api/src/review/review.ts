// Reviews one Accepted submission against its lab's constraints. No database, no queue: the
// review job and the checker CLI pass the data in and store what comes back.
import { checkBanList } from './hard-rules.js';
import type { ModelCall, ModelClient } from './limits.js';
import type { Evidence, UnsureReason, VerdictSource } from './verdict.js';

export * from './verdict.js';
export type { ModelCall, ModelClient, ModelReply, ModelRequest } from './limits.js';

/** What a review may see: no student identity, and no deduction (the TA decides marks). */
export interface ReviewInput {
  statement: string;
  constraints: { code: string; text: string }[];
  code: string;
}

interface VerdictBase {
  /** The constraint's code, e.g. `C1`. */
  constraint: string;
  evidence: Evidence[];
  source: VerdictSource;
}

/** An unsure verdict always has a reason (FAQ-09); the others never do. */
export type Verdict = VerdictBase &
  (
    | { verdict: 'pass' | 'violation'; unsureReason: null }
    | { verdict: 'unsure'; unsureReason: UnsureReason }
  );

export interface ReviewOptions {
  /** MODEL_OFF=1: hard rules only, and no network connection. */
  modelOff: boolean;
  model: ModelClient;
  /** The review job writes the entry to `model_calls`; the checker CLI writes it to a file. */
  logCall: (call: ModelCall) => void | Promise<void>;
}

/** Hard rules first; only what they cannot decide is left to the model. */
export async function review(input: ReviewInput, options: ReviewOptions): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const { code: constraint, text } of input.constraints) {
    const decided = await checkBanList(text, input.code);
    if (decided) {
      verdicts.push({ constraint, ...decided, source: 'hard_rule', unsureReason: null });
    } else {
      // Stub: the model call replaces this.
      verdicts.push({
        constraint,
        verdict: 'unsure',
        evidence: [],
        source: 'model',
        unsureReason: options.modelOff ? 'model_off' : 'model_unsure',
      });
    }
  }
  return verdicts;
}
