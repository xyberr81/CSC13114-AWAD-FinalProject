import { setTimeout as sleep } from 'node:timers/promises';
import { CostLimitError, type ModelClient, type ModelReply, type ModelRequest } from './limits.js';

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const ATTEMPTS = 3;
const RETRIED = new Set([408, 429, 500, 502, 503]);
/** Reasoning included; an answer that is cut off does not fit the schema, so it becomes unsure. */
const MAX_TOKENS = 4000;

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
  retryDelayMs?: number;
}

/** The fields this client reads; the body is not trusted to have any of them. */
interface Body {
  id?: string;
  error?: ApiError;
  choices?: { message?: { content?: string | null }; error?: ApiError }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

interface ApiError {
  code?: number | string;
  message?: string;
}

class OpenRouterError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`OpenRouter ${status}: ${detail}`);
  }
}

export function createOpenRouterClient({
  apiKey,
  model,
  fetch = globalThis.fetch,
  retryDelayMs = 1000,
}: OpenRouterOptions): ModelClient {
  const send = async ({ system, prompt, schema, signal }: ModelRequest): Promise<ModelReply> => {
    const response = await fetch(URL, {
      method: 'POST',
      signal,
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        max_tokens: MAX_TOKENS,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'verdict', strict: true, schema },
        },
        // Only providers that enforce the schema.
        provider: { require_parameters: true },
      }),
    });
    const body = (await response.json().catch(() => null)) as Body | null;
    const choice = body?.choices?.[0];
    // A failure can also arrive as a 200 with an error inside.
    const error = body?.error ?? choice?.error;
    if (error || !response.ok || !body) {
      const status = Number(error?.code) || response.status;
      // A provider may quote the key back; it must not reach the call log.
      const detail = (error?.message ?? 'no usable answer').replaceAll(apiKey, '***');
      throw status === 402 ? new CostLimitError(detail) : new OpenRouterError(status, detail);
    }
    return {
      providerRequestId: body.id ?? null,
      text: choice?.message?.content ?? '',
      promptTokens: body.usage?.prompt_tokens ?? null,
      completionTokens: body.usage?.completion_tokens ?? null,
      costUsd: body.usage?.cost ?? null,
    };
  };

  return {
    name: model,
    async complete(request) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await send(request);
        } catch (error) {
          const final =
            attempt === ATTEMPTS ||
            request.signal.aborted ||
            error instanceof CostLimitError ||
            (error instanceof OpenRouterError && !RETRIED.has(error.status));
          if (final) throw error;
          await sleep(retryDelayMs * attempt, undefined, { signal: request.signal });
        }
      }
    },
  };
}

/** For the review worker and the checker; throws when a variable is missing. */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (env.LLM_PROVIDER !== 'openrouter') throw new Error('LLM_PROVIDER must be openrouter');
  if (!env.LLM_MODEL) throw new Error('LLM_MODEL is required');
  if (!env.LLM_API_KEY) throw new Error('LLM_API_KEY is required');
  return createOpenRouterClient({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
}
