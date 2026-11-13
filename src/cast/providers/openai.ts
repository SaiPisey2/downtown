import { json, postForStream, ProviderError, readEvents } from './types';
import type { ChatProvider } from './types';

export const OPENAI_BASE = 'https://api.openai.com/v1';

interface Chunk {
  error?: unknown;
  choices?: { delta?: { content?: unknown } }[];
}

/**
 * Any OpenAI-compatible chat completions endpoint: OpenAI itself by default, or
 * a base URL the player gives (a local model server, another provider).
 */
export function openai(baseUrl: string = OPENAI_BASE): ChatProvider {
  const base = baseUrl.replace(/\/+$/, '');
  // OpenAI's own endpoint wants the newer limit field; other servers mostly know only the older one
  const limitField = base === OPENAI_BASE ? 'max_completion_tokens' : 'max_tokens';
  return {
    id: 'openai',
    async *stream(req, key, signal, fetchImpl = (...a) => fetch(...a)) {
      const body = await postForStream(
        fetchImpl,
        `${base}/chat/completions`,
        { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        {
          model: req.model,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          [limitField]: req.maxTokens,
          stream: true,
        },
        signal,
      );
      for await (const e of readEvents(body, signal)) {
        if (e.data.trim() === '[DONE]') return;
        const chunk = json(e.data) as Chunk;
        if (chunk.error !== undefined) throw new ProviderError('other', 'the provider reported an error mid-reply');
        const text = chunk.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text !== '') yield text;
      }
    },
  };
}
