/** Test helpers: a fetch that records what it was asked and answers with canned bytes. Not used by the game. */

export interface Call {
  url: string;
  init: RequestInit;
}

/** A response body that arrives in exactly these pieces, so parsers meet events cut at awkward places. */
export function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const p of pieces) ctrl.enqueue(enc.encode(p));
      ctrl.close();
    },
  });
}

/** Cuts text into pieces of `size` characters. */
export function chop(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export function fakeFetch(answer: (call: Call) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** A fetch that never answers until its signal aborts, then rejects as a real fetch does. */
export function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const fail = () => reject(signal?.reason instanceof Error ? signal.reason : new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) fail();
      signal?.addEventListener('abort', fail);
    })) as typeof fetch;
}

/** Server-sent events text from (event, data) pairs. */
export function sse(events: [string | null, unknown][]): string {
  return events
    .map(([name, data]) => `${name ? `event: ${name}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`)
    .join('');
}
