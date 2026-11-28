// The model called directly at Anthropic, with the official SDK. Same contract as the OpenRouter
// client: an answer that does not fit the schema is left to the schema limit, a failure throws.
import { setTimeout as sleep } from 'node:timers/promises';
import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { CostLimitError, type ModelClient, type ModelReply, type ModelRequest } from './limits.js';

const BASE_URL = 'https://api.anthropic.com';
const ATTEMPTS = 3;
const RETRIED = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
/** Thinking included; an answer that is cut off is not valid JSON, so it becomes unsure. */
const MAX_TOKENS = 4000;

/**
 * USD per million tokens. Anthropic reports tokens, not money, so the cost of a call is computed
 * here. Claude Haiku 5.5 has a second, higher price for prompts of more than 100K tokens.
 */
const PRICES: Record<string, { short: [number, number]; long: [number, number] }> = {
  'claude-haiku-5-5': { short: [0.1, 0.5], long: [0.5, 2.5] },
};
const LONG_PROMPT = 100_000;

export function costOf(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const [input, output] = inputTokens > LONG_PROMPT ? price.long : price.short;
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  retryDelayMs?: number;
}

export function createAnthropicClient({
  apiKey,
  model,
  fetch,
  retryDelayMs = 1000,
}: AnthropicOptions): ModelClient {
  // The key and the address are given, so no ANTHROPIC_* variable or profile is used. Retries are
  // done below, where a spend-limit 429 is told apart from a busy one.
  const client = new Anthropic({ apiKey, baseURL: BASE_URL, maxRetries: 0, fetch });

  const send = async ({ system, prompt, schema, signal }: ModelRequest): Promise<ModelReply> => {
    const { data, request_id } = await client.messages
      .create(
        {
          model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: prompt }],
          output_config: { format: { type: 'json_schema', schema: { ...schema } } },
        },
        { signal },
      )
      .withResponse();
    const text = data.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const { input_tokens: promptTokens, output_tokens: completionTokens } = data.usage;
    return {
      providerRequestId: request_id ?? null,
      // A refusal or an answer cut off at the token limit is never taken as an answer.
      text: data.stop_reason === 'end_turn' ? text : `[stop_reason ${data.stop_reason}] ${text}`,
      promptTokens,
      completionTokens,
      costUsd: costOf(model, promptTokens, completionTokens),
    };
  };

  return {
    name: model,
    async complete(request) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await send(request);
        } catch (error) {
          const failure = describe(error, apiKey);
          if (failure instanceof CostLimitError) throw failure;
          const final =
            attempt === ATTEMPTS ||
            request.signal.aborted ||
            error instanceof APIUserAbortError ||
            !retried(error);
          if (final) throw failure;
          await sleep(retryDelayMs * attempt, undefined, { signal: request.signal });
        }
      }
    },
  };
}

function retried(error: unknown): boolean {
  if (error instanceof APIConnectionError) return true;
  const status: unknown = error instanceof APIError ? error.status : undefined;
  return typeof status === 'number' && RETRIED.has(status);
}

/** The error to report, without the key: a provider may quote it back. */
function describe(error: unknown, apiKey: string): Error {
  if (!(error instanceof APIError) || error.status === undefined) {
    const text = error instanceof Error ? error.message : String(error);
    return new Error(`Anthropic: ${text}`.replaceAll(apiKey, '***'));
  }
  const body = error.error as
    { error?: { message?: string; details?: { error_code?: string } } } | undefined;
  const detail = (body?.error?.message ?? error.message).replaceAll(apiKey, '***');
  const spendLimit = body?.error?.details?.error_code === 'enforced_spend_limit_reached';
  if (error.status === 402 || (error.status === 429 && spendLimit))
    return new CostLimitError(detail);
  return new Error(`Anthropic ${error.status}: ${detail}`);
}
