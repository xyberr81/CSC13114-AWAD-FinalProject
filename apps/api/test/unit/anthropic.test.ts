import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicClient, costOf } from '../../src/review/anthropic.js';
import { CostLimitError } from '../../src/review/limits.js';
import { modelFromEnv } from '../../src/review/openrouter.js';

const KEY = 'sk-ant-secret-0123456789';
const MODEL = 'claude-haiku-5-5';
const message = (fields: object = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: MODEL,
  content: [{ type: 'text', text: '{"a":1}' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1000, output_tokens: 200 },
  ...fields,
});
const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'request-id': 'req_abc' },
      }),
    );
const failure = (status: number, type: string, text: string, details?: object) =>
  json({ type: 'error', error: { type, message: text, details }, request_id: 'req_err' }, status);

function setup(...responses: (() => Promise<Response>)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockImplementationOnce(response);
  const client = createAnthropicClient({ apiKey: KEY, model: MODEL, fetch, retryDelayMs: 1 });
  const complete = (signal = new AbortController().signal) =>
    client.complete({ system: 'S', prompt: 'P', schema: { type: 'object' }, signal });
  return { fetch, client, complete };
}
const sent = (fetch: ReturnType<typeof setup>['fetch']) => {
  const [url, init] = fetch.mock.calls[0]!;
  return { url: String(url), headers: new Headers(init?.headers), body: String(init?.body) };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a request to Anthropic', () => {
  it('asks the model for the schema, with a token limit and no sampling settings', async () => {
    const { fetch, complete, client } = setup(json(message()));
    await complete();
    expect(client.name).toBe(MODEL);
    const { url, body } = sent(fetch);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      model: MODEL,
      system: 'S',
      messages: [{ role: 'user', content: 'P' }],
      max_tokens: expect.any(Number) as number,
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    });
    expect(parsed).not.toHaveProperty('temperature');
  });

  // SDK 1.x sends the key as a bearer token, not in x-api-key.
  it('has the key in the authorization header and nowhere else', async () => {
    const { fetch, complete } = setup(json(message()));
    await complete();
    const { url, headers, body } = sent(fetch);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    headers.delete('authorization');
    expect(JSON.stringify([url, [...headers.entries()], body])).not.toContain(KEY);
  });

  it('ignores the Anthropic variables of the environment: its own key and address only', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://elsewhere.example');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'other-token');
    const { fetch, complete } = setup(json(message()));
    await complete();
    const { url, headers } = sent(fetch);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify([...headers.entries()])).not.toContain('other-token');
  });
});

describe('a reply from Anthropic', () => {
  it('has the text, the request id, the tokens and the cost', async () => {
    const { complete } = setup(json(message()));
    const reply = await complete();
    expect(reply).toMatchObject({
      providerRequestId: 'req_abc',
      text: '{"a":1}',
      promptTokens: 1000,
      completionTokens: 200,
    });
    // 1000 × $0.10 + 200 × $0.50, per million tokens.
    expect(reply.costUsd).toBeCloseTo(0.0002, 10);
  });

  it('keeps only the text blocks, not the thinking', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
    const { complete } = setup(
      json(message({ content: [thinking, { type: 'text', text: '{"a":1}' }] })),
    );
    expect((await complete()).text).toBe('{"a":1}');
  });

  it.each(['refusal', 'max_tokens'])(
    'that stopped with %s is not an answer the schema limit can accept, and is still logged',
    async (stop) => {
      const { complete } = setup(json(message({ stop_reason: stop })));
      const reply = await complete();
      expect(() => JSON.parse(reply.text) as unknown).toThrow();
      expect(reply.text).toContain(stop);
      expect(reply).toMatchObject({ providerRequestId: 'req_abc', promptTokens: 1000 });
    },
  );
});

describe('the cost of a call', () => {
  it('uses the price of a prompt of more than 100K tokens when the prompt is that long', () => {
    // 200 000 × $0.50 + 1000 × $2.50, per million tokens.
    expect(costOf(MODEL, 200_000, 1000)).toBeCloseTo(0.1025, 10);
  });

  it('is unknown for a model whose price is not in the code', () => {
    expect(costOf('claude-other', 1000, 200)).toBeNull();
  });
});

describe('a failure at Anthropic', () => {
  it('for lack of credits is a CostLimitError, and is not retried', async () => {
    const { fetch, complete } = setup(failure(402, 'billing_error', 'no credits'), json(message()));
    await expect(complete()).rejects.toBeInstanceOf(CostLimitError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('at the spend limit is a CostLimitError, and is not retried', async () => {
    const capped = failure(429, 'rate_limit_error', 'limit', {
      error_code: 'enforced_spend_limit_reached',
    });
    const { fetch, complete } = setup(capped, json(message()));
    await expect(complete()).rejects.toBeInstanceOf(CostLimitError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [401, 'authentication_error'],
    [400, 'invalid_request_error'],
    [404, 'not_found_error'],
  ])('%i is not retried', async (status, type) => {
    const { fetch, complete } = setup(failure(status, type, 'no'), json(message()));
    await expect(complete()).rejects.toThrow(`Anthropic ${status}: no`);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [408, 'timeout_error'],
    [429, 'rate_limit_error'],
    [500, 'api_error'],
    [529, 'overloaded_error'],
  ])('%i is retried', async (status, type) => {
    const { fetch, complete } = setup(failure(status, type, 'busy'), json(message()));
    expect((await complete()).text).toBe('{"a":1}');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('of the network is retried', async () => {
    const { complete } = setup(
      () => Promise.reject(new TypeError('fetch failed')),
      json(message()),
    );
    expect((await complete()).text).toBe('{"a":1}');
  });

  it('stops after three attempts', async () => {
    const down = failure(529, 'overloaded_error', 'down');
    const { fetch, complete } = setup(down, down, down, json(message()));
    await expect(complete()).rejects.toThrow('Anthropic 529: down');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('is not retried after the time limit', async () => {
    const controller = new AbortController();
    const { fetch, complete } = setup(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }, json(message()));
    await expect(complete(controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('never shows the key', async () => {
    const { complete } = setup(failure(401, 'authentication_error', `key ${KEY} is disabled`));
    const error = await complete().catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Anthropic 401');
    expect((error as Error).message).not.toContain(KEY);
  });
});

describe('modelFromEnv() with Anthropic', () => {
  it('makes the Anthropic client when LLM_PROVIDER is anthropic', () => {
    const env = { LLM_PROVIDER: 'anthropic', LLM_MODEL: MODEL, LLM_API_KEY: KEY };
    expect(modelFromEnv(env).name).toBe(MODEL);
  });

  it.each(['LLM_MODEL', 'LLM_API_KEY'])('needs %s', (name) => {
    const env = { LLM_PROVIDER: 'anthropic', LLM_MODEL: MODEL, LLM_API_KEY: KEY };
    expect(() => modelFromEnv({ ...env, [name]: '' })).toThrow(name);
  });
});
