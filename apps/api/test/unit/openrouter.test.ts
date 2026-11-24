import { describe, expect, it, vi } from 'vitest';
import { CostLimitError } from '../../src/review/limits.js';
import { createOpenRouterClient, modelFromEnv } from '../../src/review/openrouter.js';

const KEY = 'sk-or-secret-0123456789';
const OK = {
  id: 'gen-abc',
  choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }],
  usage: { prompt_tokens: 12, completion_tokens: 34, cost: 0.00056 },
};
const json =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

function setup(...responses: (() => Promise<Response>)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockImplementationOnce(response);
  const client = createOpenRouterClient({ apiKey: KEY, model: 'a/b', fetch, retryDelayMs: 1 });
  const complete = (signal = new AbortController().signal) =>
    client.complete({ system: 'S', prompt: 'P', schema: { type: 'object' }, signal });
  return { fetch, client, complete };
}

describe('a request', () => {
  it('asks the model for the schema, and has a token limit', async () => {
    const { fetch, complete, client } = setup(json(OK));
    await complete();
    expect(client.name).toBe('a/b');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'a/b',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'P' },
      ],
      max_tokens: expect.any(Number) as number,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'verdict', strict: true, schema: { type: 'object' } },
      },
    });
  });

  it('has the key in the authorization header and nowhere else', async () => {
    const { fetch, complete } = setup(json(OK));
    await complete();
    const [url, init] = fetch.mock.calls[0]!;
    const headers = { ...(init?.headers as Record<string, string>) };
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    delete headers.authorization;
    expect(JSON.stringify([url, headers, init?.body])).not.toContain(KEY);
  });

  it('is aborted with its signal', async () => {
    const { fetch, complete } = setup(json(OK));
    const { signal } = new AbortController();
    await complete(signal);
    expect(fetch.mock.calls[0]![1]?.signal).toBe(signal);
  });
});

describe('a reply', () => {
  it('has the text, the request id, the tokens and the cost', async () => {
    const { complete } = setup(json(OK));
    expect(await complete()).toEqual({
      providerRequestId: 'gen-abc',
      text: '{"a":1}',
      promptTokens: 12,
      completionTokens: 34,
      costUsd: 0.00056,
    });
  });

  it('without content or usage is an empty text, which the schema limit rejects', async () => {
    const { complete } = setup(json({ id: 'gen-x', choices: [{ message: { content: null } }] }));
    expect(await complete()).toEqual({
      providerRequestId: 'gen-x',
      text: '',
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
    });
  });
});

describe('a failure', () => {
  it('for lack of credits is a CostLimitError, and is not retried', async () => {
    const { fetch, complete } = setup(json({ error: { code: 402, message: 'no credits' } }, 402));
    await expect(complete()).rejects.toBeInstanceOf(CostLimitError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('of the key is not retried', async () => {
    const { fetch, complete } = setup(json({ error: { code: 401, message: 'bad key' } }, 401));
    await expect(complete()).rejects.toThrow('OpenRouter 401: bad key');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([408, 429, 500, 502, 503])('%i is retried', async (code) => {
    const { fetch, complete } = setup(json({ error: { code, message: 'busy' } }, code), json(OK));
    expect((await complete()).text).toBe('{"a":1}');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('inside a 200 is a failure too', async () => {
    const { fetch, complete } = setup(json({ error: { code: 502, message: 'down' } }), json(OK));
    expect((await complete()).text).toBe('{"a":1}');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('inside a choice is a failure too', async () => {
    const choice = { error: { code: 402, message: 'cap' }, message: { content: '{"a"' } };
    const { complete } = setup(json({ id: 'gen-y', choices: [choice] }));
    await expect(complete()).rejects.toBeInstanceOf(CostLimitError);
  });

  it('of the network is retried', async () => {
    const { complete } = setup(() => Promise.reject(new TypeError('fetch failed')), json(OK));
    expect((await complete()).text).toBe('{"a":1}');
  });

  it('that is not JSON is reported with its status', async () => {
    const { complete } = setup(() => Promise.resolve(new Response('<html>', { status: 404 })));
    await expect(complete()).rejects.toThrow('OpenRouter 404');
  });

  it('stops after three attempts', async () => {
    const down = json({ error: { code: 503, message: 'down' } }, 503);
    const { fetch, complete } = setup(down, down, down, json(OK));
    await expect(complete()).rejects.toThrow('OpenRouter 503: down');
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
    const message = `key ${KEY} is disabled`;
    const { complete } = setup(json({ error: { code: 401, message } }, 401));
    const error = await complete().catch((e: unknown) => e as Error);
    expect((error as Error).message).not.toContain(KEY);
  });
});

describe('modelFromEnv()', () => {
  const env = { LLM_PROVIDER: 'openrouter', LLM_MODEL: 'a/b', LLM_API_KEY: KEY };

  it('makes the client that the variables name', () => {
    expect(modelFromEnv(env).name).toBe('a/b');
  });

  it.each(['LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY'])('needs %s', (name) => {
    expect(() => modelFromEnv({ ...env, [name]: '' })).toThrow(name);
  });

  it('knows no other provider', () => {
    expect(() => modelFromEnv({ ...env, LLM_PROVIDER: 'other' })).toThrow('LLM_PROVIDER');
  });
});
