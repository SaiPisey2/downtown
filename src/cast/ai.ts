import type { CaseFile } from '../cases';
import { score } from '../sim';
import { castPrompt, reviewPrompt } from './prompt';
import { anthropic } from './providers/anthropic';
import { openai } from './providers/openai';
import { ProviderError } from './providers/types';
import type { ChatProvider, ChatRequest, ProviderErrorKind } from './providers/types';
import { cleanText } from './sanitize';
import type { Cast, CastContext, CastHooks, ChatLine } from './types';

export interface AISettings {
  provider: 'anthropic' | 'openai';
  key: string;
  baseUrl?: string;
  chatModel: string;
  reviewModel: string;
}

export const DEFAULT_ANTHROPIC_MODELS = { chatModel: 'claude-haiku-5-5', reviewModel: 'claude-opus-5-5' } as const;

/** The system notice for each failure, followed by " — using scripted lines." */
export const FAILURE_WORDS: Record<ProviderErrorKind, string> = {
  auth: 'Your key was rejected',
  rate: 'The provider is rate limiting you',
  network: 'Could not reach the provider',
  timeout: 'The provider took too long',
  other: 'The provider returned an error',
};

const FIRST_TOKEN_MS = 10_000;
const TOTAL_MS = 30_000;
/** The reviewer writes more, once, after the run, and may think first: it gets longer. */
const REVIEW_FIRST_TOKEN_MS = 30_000;
const REVIEW_TOTAL_MS = 90_000;
/** Longest reply shown, in characters. */
const MAX_REPLY = 600;
/** Longest review shown, in characters: the reviewer writes two judgements, not a chat line. */
export const MAX_REVIEW = 1_500;
const REVIEW_KEY = '#review';

/** Thrown inside the stream when a request was stopped on purpose (a newer question, the run ended). */
class Cancelled extends Error {}

export function providerFor(s: AISettings): ChatProvider {
  return s.provider === 'anthropic' ? anthropic : openai(s.baseUrl || undefined);
}

/**
 * Teammates who answer free-text questions through the player's own model.
 * Questions by id, unsolicited lines and the stakeholder stay with `fallback`,
 * so clues and scoring are the same in both modes. Any failure falls back to
 * the teammate's busy line and posts one notice saying what went wrong.
 */
export function aiCast(
  c: CaseFile,
  settings: AISettings,
  fallback: Cast,
  provider: ChatProvider = providerFor(settings),
  hooks?: CastHooks,
): Cast {
  /** requests in flight: one per character, plus the review */
  const inflight = new Map<string, AbortController>();

  /** Streams one request under the two timeouts, yielding cleaned text as it grows. */
  async function* timed(slot: string, req: ChatRequest, firstMs: number, totalMs: number, maxLen = MAX_REPLY): AsyncGenerator<string> {
    inflight.get(slot)?.abort();
    const ctrl = new AbortController();
    inflight.set(slot, ctrl);
    let timedOut = false;
    const expire = () => {
      timedOut = true;
      ctrl.abort();
    };
    const first = setTimeout(expire, firstMs);
    const total = setTimeout(expire, totalMs);
    let raw = '';
    let shown = 0;
    try {
      try {
        for await (const chunk of provider.stream(req, settings.key, ctrl.signal)) {
          if (ctrl.signal.aborted) break;
          clearTimeout(first);
          raw += chunk;
          const clean = cleanText(raw, maxLen);
          if (clean.length > shown) {
            yield clean.slice(shown);
            shown = clean.length;
          }
          if (clean.length >= maxLen) break;
        }
      } catch (err) {
        if (!ctrl.signal.aborted) throw err;
      }
      if (timedOut) throw new ProviderError('timeout', 'no answer in time');
      if (ctrl.signal.aborted) throw new Cancelled();
    } finally {
      clearTimeout(first);
      clearTimeout(total);
      ctrl.abort();
      if (inflight.get(slot) === ctrl) inflight.delete(slot);
    }
  }

  /** The thread as the character sees it, ending with the question just asked. */
  function withQuestion(ctx: CastContext, castId: string, text: string): ChatLine[] {
    const mine = ctx.chat.filter((l) => l.from === castId || (l.from === 'you' && l.to === castId));
    const last = mine.at(-1);
    if (last?.from === 'you' && cleanText(last.text) === text) return ctx.chat;
    return [...ctx.chat, { id: -1, tick: ctx.snap.tick, from: 'you', to: castId, text }];
  }

  return {
    onEvent: (e, snap) => fallback.onEvent(e, snap),
    onTick: (snap) => fallback.onTick?.(snap) ?? Promise.resolve([]),

    async *ask(castId, questionId, freeText, ctx) {
      const member = c.cast.find((m) => m.id === castId);
      const text = freeText === null ? '' : cleanText(freeText).trim();
      if (questionId !== null || text === '' || member?.role !== 'teammate') {
        yield* fallback.ask(castId, questionId, freeText, ctx);
        return;
      }
      const req = { ...castPrompt(c, castId, { ...ctx, chat: withQuestion(ctx, castId, text) }), model: settings.chatModel };
      let said = false;
      let failed: ProviderErrorKind | null = null;
      try {
        for await (const s of timed(castId, req, FIRST_TOKEN_MS, TOTAL_MS)) {
          said = true;
          yield s;
        }
        if (!said) failed = 'other';
      } catch (err) {
        if (err instanceof Cancelled) return;
        failed = err instanceof ProviderError ? err.kind : 'other';
      }
      if (failed === null) return;
      hooks?.notice(castId, `${FAILURE_WORDS[failed]} — using scripted lines.`);
      if (!said) yield c.lines[`busy_${castId}`] ?? '';
    },

    async *review(ctx) {
      const s = score(c, ctx.log, ctx.final);
      const req = { ...reviewPrompt(c, ctx.log, s, ctx.chat), model: settings.reviewModel };
      try {
        yield* timed(REVIEW_KEY, req, REVIEW_FIRST_TOKEN_MS, REVIEW_TOTAL_MS, MAX_REVIEW);
      } catch (err) {
        if (!(err instanceof Cancelled)) throw err;
      }
    },

    stop() {
      for (const ctrl of inflight.values()) ctrl.abort();
      inflight.clear();
      fallback.stop?.();
    },
  };
}
