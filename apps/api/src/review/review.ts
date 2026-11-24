// Reviews one Accepted submission against its lab's constraints. No database, no queue: the
// review job and the checker CLI pass the data in and store what comes back.
import { checkBanList } from './hard-rules.js';
import {
  ANSWER_SCHEMA,
  ask,
  judgeAnswer,
  type JudgedAnswer,
  type ModelCall,
  type ModelClient,
} from './limits.js';
import { buildPrompt, redact, SYSTEM_PROMPT } from './prompt.js';
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
  /** Per model call; MODEL_TIMEOUT_MS when left out. */
  timeoutMs?: number;
}

/** How long one model call may take. */
export const MODEL_TIMEOUT_MS = 60_000;

/** Hard rules first; only what they cannot decide is left to the model. */
export async function review(input: ReviewInput, options: ReviewOptions): Promise<Verdict[]> {
  const verdicts: Verdict[] = [];
  for (const constraint of input.constraints) {
    const decided = await checkBanList(constraint.text, input.code);
    verdicts.push(
      decided
        ? { constraint: constraint.code, ...decided, source: 'hard_rule', unsureReason: null }
        : {
            constraint: constraint.code,
            ...(await askAbout(constraint, input, options)),
            source: 'model',
          },
    );
  }
  return verdicts;
}

async function askAbout(
  constraint: ReviewInput['constraints'][number],
  { statement, code }: ReviewInput,
  { modelOff, model, logCall, timeoutMs = MODEL_TIMEOUT_MS }: ReviewOptions,
): Promise<JudgedAnswer> {
  if (modelOff) return { verdict: 'unsure', evidence: [], unsureReason: 'model_off' };
  const request = {
    system: SYSTEM_PROMPT,
    prompt: buildPrompt({ statement, constraint, code }),
    schema: ANSWER_SCHEMA,
  };
  const result = await ask(model, request, { timeoutMs, logCall });
  if (!result.ok) return { verdict: 'unsure', evidence: [], unsureReason: result.reason };
  return judgeAnswer(result.text, constraint.code, { source: code, sent: redact(code) });
}
