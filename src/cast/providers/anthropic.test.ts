import { describe, expect, it } from 'vitest';
import { anthropic } from './anthropic';
import { chop, fakeFetch, hangingFetch, sse, streamOf } from './fakeFetch';
import { ProviderError } from './types';
import type { ChatRequest } from './types';

const req: ChatRequest = {
  system: 'Stay in role.',
  messages: [{ role: 'user', content: 'Is this an attack?' }],
  maxTokens: 300,
  model: 'claude-haiku-5-5',
};

const CANNED = sse([
  ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hidden' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
  ['ping', { type: 'ping' }],
  ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Volume is ' } }],
  ['something_new', { type: 'something_new', whatever: 1 }],
  ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'normal. Ünïcode ✓' } }],
  ['content_block_stop', { type: 'content_block_stop', index: 1 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } }],
  ['message_stop', { type: 'message_stop' }],
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

describe('anthropic adapter', () => {
  it('posts to the messages endpoint with the key, version and browser headers and a streaming body', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(streamOf([CANNED]), { status: 200 }));
    await collect(anthropic.stream(req, 'sk-test', new AbortController().signal, fetch));
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'sk-test',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 300,
      system: 'Stay in role.',
      messages: [{ role: 'user', content: 'Is this an attack?' }],
      stream: true,
    });
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('yields only the text deltas, whatever size the network pieces are', async () => {
    for (const size of [1, 3, 7, 50, CANNED.length]) {
      const { fetch } = fakeFetch(() => new Response(streamOf(chop(CANNED, size))));
      const chunks = await collect(anthropic.stream(req, 'k', new AbortController().signal, fetch));
      expect(chunks).toEqual(['Volume is ', 'normal. Ünïcode ✓']);
    }
  });

  it('copes with CRLF line endings and a multi-byte character split across pieces', async () => {
    const bytes = new TextEncoder().encode(CANNED.replaceAll('\n', '\r\n'));
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (let i = 0; i < bytes.length; i += 5) ctrl.enqueue(bytes.slice(i, i + 5));
        ctrl.close();
      },
    });
    const { fetch } = fakeFetch(() => new Response(body));
    expect((await collect(anthropic.stream(req, 'k', new AbortController().signal, fetch))).join('')).toBe('Volume is normal. Ünïcode ✓');
  });

  it('maps 401 and 403 to auth, 429 to rate, other statuses to other', async () => {
    const run = (status: number) => {
      const { fetch } = fakeFetch(() => new Response('{"type":"error"}', { status }));
      return kindOf(collect(anthropic.stream(req, 'k', new AbortController().signal, fetch)));
    };
    expect(await run(401)).toBe('auth');
    expect(await run(403)).toBe('auth');
    expect(await run(429)).toBe('rate');
    expect(await run(500)).toBe('other');
    expect(await run(529)).toBe('other');
  });

  it('maps a thrown fetch to network and an aborted one to timeout', async () => {
    const broken = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await kindOf(collect(anthropic.stream(req, 'k', new AbortController().signal, broken)))).toBe('network');

    const ctrl = new AbortController();
    const p = kindOf(collect(anthropic.stream(req, 'k', ctrl.signal, hangingFetch())));
    ctrl.abort();
    expect(await p).toBe('timeout');
  });

  it('maps an abort while the body streams to timeout', async () => {
    const ctrl = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse([[null, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }]])));
        ctrl.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      },
    });
    const { fetch } = fakeFetch(() => new Response(body));
    const got: string[] = [];
    const p = kindOf(
      (async () => {
        for await (const s of anthropic.stream(req, 'k', ctrl.signal, fetch)) {
          got.push(s);
          ctrl.abort();
        }
      })(),
    );
    expect(await p).toBe('timeout');
    expect(got).toEqual(['Hi']);
  });

  it('treats an error event in the stream as other', async () => {
    const body = sse([
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Part' } }],
      ['error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }],
    ]);
    const { fetch } = fakeFetch(() => new Response(streamOf([body])));
    const got: string[] = [];
    const p = kindOf(
      (async () => {
        for await (const s of anthropic.stream(req, 'k', new AbortController().signal, fetch)) got.push(s);
      })(),
    );
    expect(await p).toBe('other');
    expect(got).toEqual(['Part']);
  });
});
