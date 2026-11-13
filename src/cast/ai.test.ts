import { afterEach, describe, expect, it, vi } from 'vitest';
import { cases } from '../cases';
import { createRun, score } from '../sim';
import { aiCast, FAILURE_WORDS, MAX_REVIEW } from './ai';
import type { AISettings } from './ai';
import { ProviderError } from './providers/types';
import type { ChatProvider, ChatRequest } from './providers/types';
import { scriptedCast } from './scripted';
import type { CastContext } from './types';

const c = cases['edge-rule']!;
const settings: AISettings = { provider: 'anthropic', key: 'sk-test', chatModel: 'chat-model', reviewModel: 'review-model' };
const KINDS = ['auth', 'rate', 'network', 'timeout', 'other'] as const;

function ctxAt(tick: number): CastContext {
  const run = createRun(c);
  run.step(tick);
  return { c, snap: run.snapshot, found: [], chat: [] };
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const s of it) out.push(s);
  return out;
}

/** A provider that records requests and answers with the given behaviour. */
function provider(
  behave: (req: ChatRequest, signal: AbortSignal) => AsyncIterable<string>,
): ChatProvider & { reqs: ChatRequest[]; signals: AbortSignal[]; keys: string[] } {
  const reqs: ChatRequest[] = [];
  const signals: AbortSignal[] = [];
  const keys: string[] = [];
  return {
    id: 'anthropic',
    reqs,
    signals,
    keys,
    stream(req, key, signal) {
      reqs.push(req);
      signals.push(signal);
      keys.push(key);
      return behave(req, signal);
    },
  };
}

const says = (...chunks: string[]) =>
  provider(async function* () {
    for (const s of chunks) yield s;
  });
const fails = (kind: ProviderError['kind']) =>
  provider(async function* () {
    throw new ProviderError(kind, 'test');
  });
/** Answers `first` (if any), then waits until aborted, as a stalled network would. */
const stalls = (...first: string[]) =>
  provider(async function* (_req, signal) {
    for (const s of first) yield s;
    await new Promise<void>((_r, reject) => {
      const fail = () => reject(new ProviderError('timeout', 'aborted'));
      if (signal.aborted) fail();
      signal.addEventListener('abort', fail);
    });
  });

function notices() {
  const got: { castId: string; text: string }[] = [];
  return { got, hooks: { notice: (castId: string, text: string) => got.push({ castId, text }) } };
}

afterEach(() => vi.useRealTimers());

describe('aiCast', () => {
  it('a question by id is answered exactly as the scripted cast answers it, without the provider', async () => {
    const p = says('never');
    const fallback = scriptedCast(c);
    const ctx = ctxAt(300);
    const live = await collect(aiCast(c, settings, fallback, p).ask('netops', 'volume', null, ctx));
    expect(live).toEqual(await collect(scriptedCast(c).ask('netops', 'volume', null, ctx)));
    expect(p.reqs).toEqual([]);
  });

  it('unsolicited lines come from the fallback', async () => {
    const fallback = scriptedCast(c);
    const cast = aiCast(c, settings, fallback, says('x'));
    const run = createRun(c);
    run.step(300);
    const msg = run.log.find((e) => e.type === 'message')!;
    expect(await cast.onEvent(msg, run.snapshot)).toEqual(await scriptedCast(c).onEvent(msg, run.snapshot));
    expect(cast.onTick).toBeDefined();
  });

  it('free text streams from the provider with the chat model, the key and the cleaned question', async () => {
    const p = says('Volume ', 'is‮ normal.', ' <b>bold</b>');
    const ctx = ctxAt(300);
    const chunks = await collect(aiCast(c, settings, scriptedCast(c), p).ask('netops', null, 'Is it\u0007 an attack?', ctx));
    expect(chunks.join('')).toBe('Volume is normal. <b>bold</b>');
    expect(chunks.length).toBeGreaterThan(1);
    expect(p.keys).toEqual(['sk-test']);
    expect(p.reqs[0]!.model).toBe('chat-model');
    expect(p.reqs[0]!.messages.at(-1)).toEqual({ role: 'user', content: 'Is it an attack?' });
  });

  it('does not repeat the question when the context already ends with it', async () => {
    const p = says('Yes.');
    const ctx = ctxAt(300);
    ctx.chat = [{ id: 1, tick: 300, from: 'you', to: 'netops', text: 'Is it an attack?' }];
    await collect(aiCast(c, settings, scriptedCast(c), p).ask('netops', null, 'Is it an attack?', ctx));
    expect(p.reqs[0]!.messages.filter((m) => m.content === 'Is it an attack?')).toHaveLength(1);
  });

  it('the stakeholder stays scripted, even for free text', async () => {
    const p = says('x');
    const ctx = ctxAt(300);
    const out = await collect(aiCast(c, settings, scriptedCast(c), p).ask('boss', null, 'hello', ctx));
    expect(out.join('')).toBe(await collect(scriptedCast(c).ask('boss', null, 'hello', ctx)).then((x) => x.join('')));
    expect(p.reqs).toEqual([]);
  });

  for (const kind of KINDS) {
    it(`a provider failing with ${kind} yields the busy line and posts one notice naming it`, async () => {
      const { got, hooks } = notices();
      const out = await collect(aiCast(c, settings, scriptedCast(c), fails(kind), hooks).ask('netops', null, 'hi', ctxAt(300)));
      expect(out.join('')).toBe(c.lines.busy_netops);
      expect(got).toEqual([{ castId: 'netops', text: `${FAILURE_WORDS[kind]} — using scripted lines.` }]);
    });
  }

  it('the notice words are plain', () => {
    expect(FAILURE_WORDS).toEqual({
      auth: 'Your key was rejected',
      rate: 'The provider is rate limiting you',
      network: 'Could not reach the provider',
      timeout: 'The provider took too long',
      other: 'The provider returned an error',
    });
  });

  it('an error that is not a ProviderError counts as other', async () => {
    const { got, hooks } = notices();
    const p = provider(async function* () {
      throw new Error('boom');
    });
    const out = await collect(aiCast(c, settings, scriptedCast(c), p, hooks).ask('devlead', null, 'hi', ctxAt(300)));
    expect(out.join('')).toBe(c.lines.busy_devlead);
    expect(got.map((n) => n.text)).toEqual([`${FAILURE_WORDS.other} — using scripted lines.`]);
  });

  it('falls back after 10 seconds without a first token', async () => {
    vi.useFakeTimers();
    const { got, hooks } = notices();
    const p = stalls();
    const pending = collect(aiCast(c, settings, scriptedCast(c), p, hooks).ask('netops', null, 'hi', ctxAt(300)));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(p.signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).join('')).toBe(c.lines.busy_netops);
    expect(p.signals[0]!.aborted).toBe(true);
    expect(got.map((n) => n.text)).toEqual([`${FAILURE_WORDS.timeout} — using scripted lines.`]);
  });

  it('stops at 30 seconds in all; text already shown stays, with the notice and no busy line after it', async () => {
    vi.useFakeTimers();
    const { got, hooks } = notices();
    const p = stalls('Volume is');
    const pending = collect(aiCast(c, settings, scriptedCast(c), p, hooks).ask('netops', null, 'hi', ctxAt(300)));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(p.signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(['Volume is']);
    expect(got).toHaveLength(1);
  });

  it('a second question to the same character aborts the first, which ends quietly', async () => {
    const { got, hooks } = notices();
    const p = stalls('First ');
    const cast = aiCast(c, settings, scriptedCast(c), p, hooks);
    const first = collect(cast.ask('netops', null, 'one', ctxAt(300)));
    await vi.waitFor(() => expect(p.signals).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0)); // let the first piece arrive
    const second = collect(cast.ask('netops', null, 'two', ctxAt(300)));
    expect(await first).toEqual(['First ']);
    expect(p.signals[0]!.aborted).toBe(true);
    // a question to someone else is left alone
    const other = collect(cast.ask('devlead', null, 'three', ctxAt(300)));
    await vi.waitFor(() => expect(p.signals).toHaveLength(3));
    expect(p.signals[2]!.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    cast.stop!();
    expect(await second).toEqual(['First ']);
    expect(await other).toEqual(['First ']);
    expect(got).toEqual([]);
  });

  it('stop() aborts everything in flight without notices or busy lines', async () => {
    const { got, hooks } = notices();
    const p = stalls();
    const cast = aiCast(c, settings, scriptedCast(c), p, hooks);
    const pending = collect(cast.ask('netops', null, 'hi', ctxAt(300)));
    await vi.waitFor(() => expect(p.signals).toHaveLength(1));
    cast.stop!();
    expect(await pending).toEqual([]);
    expect(got).toEqual([]);
  });

  it('review streams from the review model and fails loudly, with no scripted stand-in', async () => {
    const run = createRun(c);
    run.step(250);
    run.act('rollback_rules');
    run.step(900);
    const ctx = { c, final: run.snapshot, log: run.log, chat: [] };
    const p = says('Communication: clear.', ' Root cause: named.');
    const cast = aiCast(c, settings, scriptedCast(c), p);
    expect((await collect(cast.review!(ctx))).join('')).toBe('Communication: clear. Root cause: named.');
    expect(p.reqs[0]!.model).toBe('review-model');
    expect(JSON.stringify(p.reqs[0])).toContain(String(score(c, run.log, run.snapshot).total));
    await expect(collect(aiCast(c, settings, scriptedCast(c), fails('rate')).review!(ctx))).rejects.toBeInstanceOf(ProviderError);
  });

  it('the review has its own cap of 1,500 characters; a chat reply stays at 600', async () => {
    const run = createRun(c);
    run.step(250);
    run.act('rollback_rules');
    run.step(900);
    const ctx = { c, final: run.snapshot, log: run.log, chat: [] };
    const long = 'word '.repeat(500);
    const review = (await collect(aiCast(c, settings, scriptedCast(c), says(long)).review!(ctx))).join('');
    expect(review).toHaveLength(MAX_REVIEW);
    expect(MAX_REVIEW).toBe(1_500);
    const reply = (await collect(aiCast(c, settings, scriptedCast(c), says(long)).ask('netops', null, 'hi', ctxAt(300)))).join('');
    expect(reply).toHaveLength(600);
  });
});
