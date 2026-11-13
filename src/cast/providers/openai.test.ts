import { describe, expect, it } from 'vitest';
import { chop, fakeFetch, hangingFetch, sse, streamOf } from './fakeFetch';
import { openai } from './openai';
import { ProviderError } from './types';
import type { ChatRequest } from './types';

const req: ChatRequest = {
  system: 'Stay in role.',
  messages: [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi.' },
    { role: 'user', content: 'Is this an attack?' },
  ],
  maxTokens: 300,
  model: 'my-model',
};

const delta = (content: string | null, extra: object = {}) => ({
  id: 'c1',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: content === null ? { role: 'assistant' } : { content }, finish_reason: null, ...extra }],
});

const CANNED = sse([
  [null, delta(null)],
  [null, delta('Volume is ')],
  [null, { id: 'c1', choices: [] }],
  [null, delta('normal.')],
  [null, delta(null, { finish_reason: 'stop' })],
  [null, '[DONE]'],
]);

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const s of it) out.push(s);
  return out;
}

async function kindOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ProviderError);
    return (e as ProviderError).kind;
  }
  throw new Error('expected a ProviderError');
}

describe('openai-compatible adapter', () => {
  it('posts to chat/completions at the default base with a bearer key and the system text first', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(streamOf([CANNED])));
    await collect(openai().stream(req, 'sk-test', new AbortController().signal, fetch));
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', authorization: 'Bearer sk-test' });
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'my-model',
      messages: [{ role: 'system', content: 'Stay in role.' }, ...req.messages],
      max_completion_tokens: 300,
      stream: true,
    });
  });

  it('uses a given base URL, without a doubled slash, and the widely supported max_tokens there', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(streamOf([CANNED])));
    await collect(openai('http://127.0.0.1:11434/v1/').stream(req, 'k', new AbortController().signal, fetch));
    expect(calls[0]!.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.max_tokens).toBe(300);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('builds the request URL from the parsed base: no query or fragment, and never a name or password', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(streamOf([CANNED])));
    await collect(openai('https://api.example.com/v1?x=1#frag').stream(req, 'k', new AbortController().signal, fetch));
    expect(calls[0]!.url).toBe('https://api.example.com/v1/chat/completions');
    const leak = fakeFetch(() => new Response(streamOf([CANNED])));
    expect(await kindOf(collect(openai('https://user:pw@evil.example/v1').stream(req, 'k', new AbortController().signal, leak.fetch)))).toBe('other');
    expect(leak.calls).toHaveLength(0);
  });

  it('yields the content deltas and stops at [DONE], whatever size the pieces are', async () => {
    for (const size of [1, 4, 33, CANNED.length]) {
      const { fetch } = fakeFetch(() => new Response(streamOf([...chop(CANNED, size), sse([[null, delta('after done')]])])));
      expect(await collect(openai().stream(req, 'k', new AbortController().signal, fetch))).toEqual(['Volume is ', 'normal.']);
    }
  });

  it('maps 401 to auth, 429 to rate, a thrown fetch to network, an abort to timeout', async () => {
    const status = (s: number) => {
      const { fetch } = fakeFetch(() => new Response('{}', { status: s }));
      return kindOf(collect(openai().stream(req, 'k', new AbortController().signal, fetch)));
    };
    expect(await status(401)).toBe('auth');
    expect(await status(429)).toBe('rate');
    expect(await status(502)).toBe('other');
    const broken = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await kindOf(collect(openai().stream(req, 'k', new AbortController().signal, broken)))).toBe('network');
    const ctrl = new AbortController();
    const p = kindOf(collect(openai().stream(req, 'k', ctrl.signal, hangingFetch())));
    ctrl.abort();
    expect(await p).toBe('timeout');
  });

  it('treats an error object in the stream as other', async () => {
    const { fetch } = fakeFetch(() => new Response(streamOf([sse([[null, { error: { message: 'bad model' } }]])])));
    expect(await kindOf(collect(openai().stream(req, 'k', new AbortController().signal, fetch)))).toBe('other');
  });
});
