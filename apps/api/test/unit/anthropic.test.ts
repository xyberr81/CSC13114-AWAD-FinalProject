import { describe, expect, it, vi } from 'vitest';
import { createAnthropicClient, modelFromEnv } from '../../src/review/anthropic.js';
import { CostLimitError } from '../../src/review/limits.js';

const KEY = 'sk-ant-secret-0123456789';
const MODEL = 'claude-opus-5-5';
const OK = {
  id: 'msg_abc',
  type: 'message',
  role: 'assistant',
  model: MODEL,
  stop_reason: 'end_turn',
  content: [
    { type: 'thinking', thinking: '', signature: 's' },
    { type: 'text', text: '{"a":1}' },
  ],
  usage: { input_tokens: 1000, output_tokens: 500 },
};
// The SDK waits this long before a retry, instead of its own back-off.
const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
      }),
    );
const apiError = (status: number, type: string, message: string) =>
  json({ type: 'error', error: { type, message } }, status);

function setup(...responses: (() => Promise<Response>)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockImplementationOnce(response);
  const client = createAnthropicClient({ apiKey: KEY, model: MODEL, fetch });
  const complete = (signal = new AbortController().signal) =>
    client.complete({ system: 'S', prompt: 'P', schema: { type: 'object' }, signal });
  return { fetch, client, complete };
}

const sent = (fetch: ReturnType<typeof setup>['fetch']) => {
  const [url, init] = fetch.mock.calls[0]!;
  return { url: url as string, headers: new Headers(init?.headers), body: init?.body as string };
};

describe('a request', () => {
  it('asks the model for the schema, and has a token limit', async () => {
    const { fetch, complete, client } = setup(json(OK));
    await complete();
    expect(client.name).toBe(MODEL);
    const { url, body } = sent(fetch);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(JSON.parse(body)).toMatchObject({
      model: MODEL,
      system: 'S',
      messages: [{ role: 'user', content: 'P' }],
      max_tokens: expect.any(Number) as number,
      output_config: { format: { type: 'json_schema', schema: { type: 'object' } } },
    });
  });

  it('has the key in the authorization header and nowhere else', async () => {
    const { fetch, complete } = setup(json(OK));
    await complete();
    const { url, headers, body } = sent(fetch);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    headers.delete('authorization');
    expect(JSON.stringify([url, [...headers], body])).not.toContain(KEY);
  });
});

describe('a reply', () => {
  it('has the text, the request id, the tokens and the cost', async () => {
    const { complete } = setup(json(OK));
    expect(await complete()).toEqual({
      providerRequestId: 'msg_abc',
      text: '{"a":1}',
      promptTokens: 1000,
      completionTokens: 500,
      // 1000 × $4 + 500 × $20 per million tokens.
      costUsd: 0.014,
    });
  });

  it('of a model without a price has no cost', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(json(OK));
    const client = createAnthropicClient({ apiKey: KEY, model: 'claude-new', fetch });
    const reply = await client.complete({
      system: 'S',
      prompt: 'P',
      schema: {},
      signal: new AbortController().signal,
    });
    expect(reply.costUsd).toBeNull();
  });

  it('that is a refusal is an empty text, which the schema limit rejects', async () => {
    const { complete } = setup(json({ ...OK, stop_reason: 'refusal', content: [] }));
    expect((await complete()).text).toBe('');
  });
});

describe('a failure', () => {
  it('for lack of credits is a CostLimitError, and is not retried', async () => {
    const { fetch, complete } = setup(apiError(402, 'billing_error', 'no credits'));
    await expect(complete()).rejects.toBeInstanceOf(CostLimitError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('of the key is not retried', async () => {
    const { fetch, complete } = setup(apiError(401, 'authentication_error', 'bad key'));
    await expect(complete()).rejects.toThrow('bad key');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([408, 429, 500, 529])('%i is retried', async (status) => {
    const { fetch, complete } = setup(apiError(status, 'overloaded_error', 'busy'), json(OK));
    expect((await complete()).text).toBe('{"a":1}');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('of the network is retried', async () => {
    const { complete } = setup(() => Promise.reject(new TypeError('fetch failed')), json(OK));
    expect((await complete()).text).toBe('{"a":1}');
  });

  it('stops after three attempts', async () => {
    const down = apiError(503, 'api_error', 'down');
    const { fetch, complete } = setup(down, down, down, json(OK));
    await expect(complete()).rejects.toThrow('down');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('is not retried after the time limit', async () => {
    const controller = new AbortController();
    const { fetch, complete } = setup(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    }, json(OK));
    await expect(complete(controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('never shows the key', async () => {
    const { complete } = setup(apiError(401, 'authentication_error', `key ${KEY} is disabled`));
    const error = (await complete().catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('is disabled');
    expect(error.message).not.toContain(KEY);
  });
});

describe('modelFromEnv()', () => {
  const env = { LLM_PROVIDER: 'anthropic', LLM_MODEL: MODEL, LLM_API_KEY: KEY };

  it('makes the client that the variables name', () => {
    expect(modelFromEnv(env).name).toBe(MODEL);
  });

  it.each(['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY'])('needs %s', (name) => {
    expect(() => modelFromEnv({ ...env, [name]: '' })).toThrow(name);
  });

  it('knows no other provider', () => {
    expect(() => modelFromEnv({ ...env, LLM_PROVIDER: 'openrouter' })).toThrow('LLM_PROVIDER');
  });
});
