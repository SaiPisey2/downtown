export interface ChatRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
  model: string;
}

/** A model provider the player has a key for. `stream` yields the reply's text as it arrives. */
export interface ChatProvider {
  id: 'anthropic' | 'openai';
  stream(req: ChatRequest, key: string, signal: AbortSignal, fetchImpl?: typeof fetch): AsyncIterable<string>;
}

export type ProviderErrorKind = 'auth' | 'rate' | 'network' | 'timeout' | 'other';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  constructor(kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
  }
}

/** The failure kind for an HTTP status that is not a success. */
export function statusError(status: number): ProviderError {
  const kind = status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate' : 'other';
  return new ProviderError(kind, `the provider answered ${status}`);
}

/** What a fetch or a body read that threw means: a timeout if we aborted it, else the network. */
function thrown(err: unknown, signal: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  return signal.aborted ? new ProviderError('timeout', 'the request was stopped') : new ProviderError('network', String(err));
}

/** Posts JSON and returns the response body, or throws a ProviderError. Never sends cookies. */
export async function postForStream(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal, credentials: 'omit' });
  } catch (err) {
    throw thrown(err, signal);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw statusError(res.status);
  }
  if (!res.body) throw new ProviderError('other', 'the provider sent no body');
  return res.body;
}

export interface SseEvent {
  event: string | null;
  data: string;
}

/**
 * Server-sent events from a byte stream, parsed as they arrive: an event may be
 * cut anywhere between network pieces, even inside a character.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw thrown(err, signal);
      }
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      // a CR at the very end may be the first half of a CRLF: wait for the next piece
      const held = buf.endsWith('\r') ? '\r' : '';
      buf = buf.slice(0, buf.length - held.length).replace(/\r\n?/g, '\n');
      let end: number;
      while ((end = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, end);
        buf = buf.slice(end + 2);
        const e = parseBlock(block);
        if (e) yield e;
      }
      buf += held;
    }
    const last = parseBlock((buf + decoder.decode()).replace(/\r\n?/g, '\n'));
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => {});
  }
}

function parseBlock(block: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

/** JSON from an event's data; malformed data counts as a provider error. */
export function json(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    throw new ProviderError('other', 'the provider sent something unreadable');
  }
}
