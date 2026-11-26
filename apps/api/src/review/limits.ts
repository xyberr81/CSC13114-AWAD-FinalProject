// The two limits around the model. An answer that does not fit the schema, or that does not come
// in time, becomes `unsure`; it never becomes a pass or a violation.
import type { Evidence, UnsureReason, VerdictValue } from './verdict.js';
import { VERDICT_VALUES } from './verdict.js';

export interface ModelRequest {
  system: string;
  prompt: string;
  /** The JSON schema of the answer, for providers that can enforce it. It is checked here anyway. */
  schema: object;
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

/** One call-log entry per call, including those that fail or time out. */
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

/** Thrown by a client when the spending cap is reached. */
export class CostLimitError extends Error {}

export interface AskOptions {
  timeoutMs: number;
  logCall: (call: ModelCall) => void | Promise<void>;
}

export type AskResult = { ok: true; text: string } | { ok: false; reason: UnsureReason };

const TIMED_OUT = Symbol('timed out');

/** Asks the model within the time limit, and logs the call whatever becomes of it. */
export async function ask(
  model: ModelClient,
  request: Omit<ModelRequest, 'signal'>,
  { timeoutMs, logCall }: AskOptions,
): Promise<AskResult> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  // A race, so that a client that ignores the signal is still cut off.
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
      controller.abort();
    }, timeoutMs);
  });

  let reply: ModelReply | null = null;
  let response: string | null;
  let reason: UnsureReason = 'timeout';
  try {
    const answer = (async () => model.complete({ ...request, signal: controller.signal }))();
    const first = await Promise.race([answer, timeout]);
    if (first === TIMED_OUT) answer.catch(() => undefined);
    else reply = first;
    response = reply?.text ?? null;
  } catch (error) {
    if (error instanceof CostLimitError) reason = 'cost_limit';
    response = `error: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }

  await logCall({
    providerRequestId: reply?.providerRequestId ?? null,
    model: model.name,
    promptTokens: reply?.promptTokens ?? null,
    completionTokens: reply?.completionTokens ?? null,
    durationMs: Date.now() - started,
    costUsd: reply?.costUsd ?? null,
    prompt: `${request.system}\n\n${request.prompt}`,
    // PostgreSQL cannot store a NUL character.
    response: response?.replaceAll('\0', '') ?? null,
  });
  return reply ? { ok: true, text: reply.text } : { ok: false, reason };
}

/** No field for a deduction: the TA sets those. */
export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reason', 'constraint', 'verdict', 'evidence'],
  properties: {
    reason: { type: 'string' },
    constraint: { type: 'string' },
    verdict: { type: 'string', enum: [...VERDICT_VALUES] },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['line', 'text'],
        properties: { line: { type: 'integer' }, text: { type: 'string' } },
      },
    },
  },
};

interface Answer {
  verdict: VerdictValue;
  evidence: Evidence[];
  reason: string;
}

export type JudgedAnswer = { evidence: Evidence[]; explanation?: string } & (
  | { verdict: 'pass' | 'violation'; unsureReason: null }
  | { verdict: 'unsure'; unsureReason: UnsureReason }
);

/** `sent` is what the model saw; it has the same lines as the original `source`. */
export function judgeAnswer(
  text: string,
  constraint: string,
  { source, sent }: { source: string; sent: string },
): JudgedAnswer {
  const answer = parseAnswer(text, constraint);
  if (!answer) return { verdict: 'unsure', evidence: [], unsureReason: 'bad_schema' };
  // PostgreSQL cannot store a NUL character.
  const words = answer.reason.replaceAll('\0', '').trim();
  const explained = words ? { explanation: words } : {};
  if (answer.verdict === 'pass') {
    return { verdict: 'pass', evidence: [], unsureReason: null, ...explained };
  }

  const original = source.split(/\r?\n/);
  const shown = sent.split(/\r?\n/);
  const matching = answer.evidence.filter(({ line, text }) => {
    const cited = squeeze(text);
    return cited !== '' && cited === squeeze(shown[line - 1] ?? '');
  });
  const evidence = [...new Set(matching.map((e) => e.line))].map((line) => ({
    line,
    text: original[line - 1] ?? '',
  }));

  if (answer.verdict === 'unsure') {
    return { verdict: 'unsure', evidence, unsureReason: 'model_unsure', ...explained };
  }
  // Without proof there is no violation, and an invented line makes the rest doubtful too.
  if (evidence.length === 0 || matching.length < answer.evidence.length) {
    return { verdict: 'unsure', evidence, unsureReason: 'evidence_mismatch', ...explained };
  }
  return { verdict: 'violation', evidence, unsureReason: null, ...explained };
}

const squeeze = (text: string) => text.replace(/\s+/g, '');

function parseAnswer(text: string, constraint: string): Answer | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!hasExactly(value, ['reason', 'constraint', 'verdict', 'evidence'])) return null;
  const { reason, verdict, evidence } = value;
  if (typeof reason !== 'string' || value.constraint !== constraint) return null;
  if (!VERDICT_VALUES.includes(verdict as VerdictValue) || !Array.isArray(evidence)) return null;
  if (!evidence.every(isEvidence)) return null;
  return { verdict: verdict as VerdictValue, evidence, reason };
}

function isEvidence(value: unknown): value is Evidence {
  return (
    hasExactly(value, ['line', 'text']) &&
    Number.isInteger(value.line) &&
    (value.line as number) >= 1 &&
    typeof value.text === 'string'
  );
}

function hasExactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}
