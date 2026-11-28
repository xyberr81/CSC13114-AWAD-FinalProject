import Anthropic from '@anthropic-ai/sdk';
import { CostLimitError, type ModelClient } from './limits.js';

/** Thinking included; an answer that is cut off does not fit the schema, so it becomes unsure. */
const MAX_TOKENS = 4000;

/** USD per million tokens (platform.claude.com, 2026-11-28). A model not listed has no cost. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  fetch?: typeof globalThis.fetch;
}

export function createAnthropicClient({ apiKey, model, fetch }: AnthropicOptions): ModelClient {
  // The SDK retries 408, 409, 429, 5xx and network failures twice, and not once the signal aborts.
  const client = new Anthropic({ apiKey, fetch, maxRetries: 2 });
  const price = PRICES[model];
  return {
    name: model,
    async complete({ system, prompt, schema, signal }) {
      const message = await client.messages
        .create(
          {
            model,
            max_tokens: MAX_TOKENS,
            system,
            messages: [{ role: 'user', content: prompt }],
            output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
          },
          { signal },
        )
        .catch((error: unknown) => {
          throw failure(error, apiKey);
        });
      const { input_tokens: input, output_tokens: output } = message.usage;
      return {
        providerRequestId: message.id,
        // A refusal has no text, and a cut-off answer is not JSON: the schema check makes both unsure.
        text: message.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
        promptTokens: input,
        completionTokens: output,
        costUsd: price ? (input * price.input + output * price.output) / 1e6 : null,
      };
    },
  };
}

/** The spending cap becomes a CostLimitError; the key never reaches the call log. */
function failure(error: unknown, apiKey: string): unknown {
  if (!(error instanceof Error)) return error;
  const detail = error.message.replaceAll(apiKey, '***');
  if (error instanceof Anthropic.APIError && error.status === 402) {
    return new CostLimitError(detail);
  }
  return detail === error.message ? error : new Error(detail);
}

/** For the review worker and the checker; throws when a variable is missing. */
export function modelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  if (env.LLM_PROVIDER !== 'anthropic') throw new Error('LLM_PROVIDER must be anthropic');
  if (!env.LLM_MODEL) throw new Error('LLM_MODEL is required');
  if (!env.LLM_API_KEY) throw new Error('LLM_API_KEY is required');
  return createAnthropicClient({ apiKey: env.LLM_API_KEY, model: env.LLM_MODEL });
}
