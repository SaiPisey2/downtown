import { json, postForStream, ProviderError, readEvents } from './types';
import type { ChatProvider } from './types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

interface StreamEvent {
  type?: string;
  delta?: { type?: string; text?: string };
}

/** Anthropic's Messages API, called straight from the browser with the player's key. */
export const anthropic: ChatProvider = {
  id: 'anthropic',
  async *stream(req, key, signal, fetchImpl = (...a) => fetch(...a)) {
    const body = await postForStream(
      fetchImpl,
      ENDPOINT,
      {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      { model: req.model, max_tokens: req.maxTokens, system: req.system, messages: req.messages, stream: true },
      signal,
    );
    for await (const e of readEvents(body, signal)) {
      const ev = json(e.data) as StreamEvent;
      const type = ev.type ?? e.event;
      if (type === 'error') throw new ProviderError('other', 'the provider reported an error mid-reply');
      if (type === 'message_stop') return;
      // text only: thinking deltas and any event type added later are skipped
      if (type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
        yield ev.delta.text;
      }
    }
  },
};
