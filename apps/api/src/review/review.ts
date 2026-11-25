// Reviews one Accepted submission against its lab's constraints. No database, no queue: the
// review job and the checker CLI pass the data in and store what comes back.

// Same values, in the same order, as the enums in db/schema.ts (a unit test compares them).
export const VERDICT_VALUES = ['pass', 'violation', 'unsure'] as const;
export const VERDICT_SOURCES = ['hard_rule', 'model'] as const;
export const UNSURE_REASONS = [
  'model_unsure',
  'bad_schema',
  'evidence_mismatch',
  'timeout',
  'cost_limit',
  'model_off',
] as const;

export type VerdictValue = (typeof VERDICT_VALUES)[number];
export type VerdictSource = (typeof VERDICT_SOURCES)[number];
export type UnsureReason = (typeof UNSURE_REASONS)[number];

/** What a review may see: no student identity, and no deduction (the TA decides marks). */
export interface ReviewInput {
  statement: string;
  constraints: { code: string; text: string }[];
  code: string;
}

/** `line` is 1-based and `text` is that line of the original, uncut source. */
export interface Evidence {
  line: number;
  text: string;
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

export interface ModelRequest {
  prompt: string;
  /** Aborted when the call runs out of time. */
  signal: AbortSignal;
}

export interface ModelReply {
  providerRequestId: string | null;
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
}

export interface ModelClient {
  name: string;
  complete: (request: ModelRequest) => Promise<ModelReply>;
}

/** One call-log entry per model request, including those that fail or time out. */
export interface ModelCall {
  providerRequestId: string | null;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number;
  costUsd: number | null;
  prompt: string;
  response: string | null;
}

export interface ReviewOptions {
  /** MODEL_OFF=1: hard rules only, and no network connection. */
  modelOff: boolean;
  model: ModelClient;
  /** The review job writes the entry to `model_calls`; the checker CLI writes it to a file. */
  logCall: (call: ModelCall) => void | Promise<void>;
}

/** Stub: unsure about every constraint. The hard rules and the model call replace it. */
export function review(input: ReviewInput, options: ReviewOptions): Promise<Verdict[]> {
  return Promise.resolve(
    input.constraints.map(({ code }) => ({
      constraint: code,
      verdict: 'unsure',
      evidence: [],
      source: 'model',
      unsureReason: options.modelOff ? 'model_off' : 'model_unsure',
    })),
  );
}
