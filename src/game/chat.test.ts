import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerFor, cases } from '../cases';
import { scriptedCast, setCastFactory } from '../cast';
import type { Cast, CastHooks } from '../cast';
import { advance, setSpeed } from './loop';
import { useGame } from './store';

const c = cases['edge-rule']!;
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const g = () => useGame.getState();

/** Steps `n` ticks in one call, as the test hook's jump does (edge-rule runs 4 ticks per second). */
function jump(n: number): void {
  setSpeed(n);
  advance(250);
  setSpeed(1);
}

beforeEach(() => {
  setCastFactory((k) => scriptedCast(k));
  g().start('edge-rule');
});
afterEach(() => setSpeed(1));

describe('chat in the store', () => {
  it('offers every event of a many-tick jump to the cast, in order', async () => {
    jump(c.scoring.updateEveryTicks + 250);
    await settle();
    const chat = g().chat;
    const attack = chat.find((l) => l.text === c.lines.boss_attack);
    const nudge = chat.find((l) => l.text === c.lines.nudge);
    expect(attack).toMatchObject({ from: 'boss', tick: 300 });
    expect(nudge).toMatchObject({ from: 'boss', tick: 242 + c.scoring.updateEveryTicks });
    expect(chat.indexOf(attack!)).toBeLessThan(chat.indexOf(nudge!));
    // ids are the store's own, unique and rising
    const ids = chat.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });

  it('does not offer anything while paused, and catches up afterwards', async () => {
    jump(299);
    g().setPaused(true, 'user');
    advance(250);
    await settle();
    expect(g().chat).toEqual([]);
    g().setPaused(false);
    jump(1);
    await settle();
    expect(g().chat.map((l) => l.text)).toEqual([c.lines.boss_attack]);
  });

  it('ask: the question, then the streamed answer, then the clue it reveals', async () => {
    jump(300);
    await settle();
    await g().ask('netops', 'volume');
    const thread = g().chat.filter((l) => l.from === 'netops' || l.to === 'netops');
    const q = c.cast[0]!.questions[0]!;
    expect(thread.map((l) => [l.from, l.text, !!l.live])).toEqual([
      ['you', q.label, false],
      ['netops', q.answer, false],
    ]);
    expect(g().found).toContain('volume_normal');
    expect(g().run!.inputs.filter((i) => i.kind === 'observe' && i.route === 'ask:netops:volume')).toHaveLength(1);
    // asking again does not observe again: the clue is already in the notebook
    await g().ask('netops', 'volume');
    expect(g().run!.inputs.filter((i) => i.kind === 'observe' && i.route === 'ask:netops:volume')).toHaveLength(1);
  });

  it('marks the answer live while it streams', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setCastFactory((k) => ({
      ...scriptedCast(k),
      async *ask() {
        yield 'Volume ';
        await gate;
        yield 'is normal.';
      },
    }));
    g().start('edge-rule');
    const done = g().ask('netops', 'volume');
    await settle();
    expect(g().chat.at(-1)).toMatchObject({ from: 'netops', text: 'Volume ', live: true });
    release();
    await done;
    expect(g().chat.at(-1)).toMatchObject({ from: 'netops', text: 'Volume is normal.', live: false });
  });

  it('an update puts the player line in the stakeholder thread, and the stakeholder answers on the next tick', async () => {
    jump(250);
    await settle();
    g().update('investigating');
    expect(g().chat.at(-1)).toMatchObject({ from: 'you', to: 'boss', text: c.updates[0]!.label });
    jump(1);
    await settle();
    expect(g().chat.at(-1)).toMatchObject({ from: 'boss', text: c.lines.update_ack_honest });
  });

  it('start() clears the chat and drops lines from the old run', async () => {
    jump(300);
    g().start('edge-rule');
    await settle();
    expect(g().chat).toEqual([]);
  });

  it('a cast that throws mid-answer leaves the scripted answer, decided when asked, and no live line', async () => {
    jump(300);
    setCastFactory((k) => ({
      ...scriptedCast(k),
      async *ask() {
        yield 'Volume ';
        throw new Error('the cast broke');
      },
    }));
    g().start('edge-rule');
    jump(300);
    const snap = g().snap!;
    await expect(g().ask('netops', 'volume')).resolves.toBeUndefined();
    const last = g().chat.at(-1)!;
    expect(last).toMatchObject({ from: 'netops', text: answerFor(c, 'netops', 'volume', snap), live: false });
    expect(g().chat.filter((l) => l.text === '')).toEqual([]);
  });

  it('a cast that rejects before saying anything leaves the scripted answer', async () => {
    setCastFactory((k) => ({
      ...scriptedCast(k),
      ask() {
        return {
          [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('no')) }),
        };
      },
    }));
    g().start('edge-rule');
    jump(300);
    await g().ask('netops', 'cpu');
    expect(g().chat.at(-1)).toMatchObject({ from: 'netops', text: answerFor(c, 'netops', 'cpu', g().snap!), live: false });
  });

  it('the answer and the clue are decided against the same snapshot, the one at ask time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setCastFactory((k) => {
      const s = scriptedCast(k);
      return {
        ...s,
        async *ask(...a: Parameters<Cast['ask']>) {
          await gate;
          yield* s.ask(...a);
        },
      };
    });
    g().start('edge-rule');
    jump(241); // volume_normal holds from tick 242
    const done = g().ask('netops', 'volume');
    jump(20); // the answer is still arriving when the clue would have become true
    release();
    await done;
    const q = c.cast[0]!.questions[0]!;
    expect(g().chat.at(-1)!.text).toBe(q.answerBefore);
    expect(g().found).not.toContain('volume_normal');

    // asked once it holds: both agree the other way, and the clue is noted when asked
    setCastFactory((k) => scriptedCast(k));
    g().start('edge-rule');
    jump(300);
    const p = g().ask('netops', 'volume');
    expect(g().found).toContain('volume_normal');
    await p;
    expect(g().chat.at(-1)!.text).toBe(q.answer);
  });

  it('free text: cleaned, trimmed and cut to 300 characters, answered, and never a clue', async () => {
    const seen: (string | null)[] = [];
    setCastFactory((k) => ({
      ...scriptedCast(k),
      async *ask(_id, questionId, freeText) {
        seen.push(questionId, freeText);
        yield 'Traffic looks normal.';
      },
    }));
    g().start('edge-rule');
    jump(300);
    const found = g().found.length;
    await g().ask('netops', null, `  is it\u202E an attack?${'x'.repeat(400)}  `);
    const thread = g().chat.filter((l) => l.from === 'netops' || l.to === 'netops');
    expect(thread[0]!.text).toBe(`is it an attack?${'x'.repeat(284)}`);
    expect(thread[0]!.text).toHaveLength(300);
    expect(thread[1]).toMatchObject({ from: 'netops', text: 'Traffic looks normal.', live: false });
    expect(seen).toEqual([null, thread[0]!.text]);
    expect(g().found).toHaveLength(found);
    // blank text is not sent
    await g().ask('netops', null, ' \u200B ');
    expect(g().chat).toHaveLength(thread.length);
  });

  it('free text that fails with nothing said leaves the busy line', async () => {
    setCastFactory((k) => ({
      ...scriptedCast(k),
      async *ask() {
        throw new Error('down');
      },
    }));
    g().start('edge-rule');
    jump(300);
    await g().ask('devlead', null, 'what shipped?');
    expect(g().chat.at(-1)).toMatchObject({ from: 'devlead', text: c.lines.busy_devlead, live: false });
  });

  it('a second free-text question to the same character takes over from the first', async () => {
    let n = 0;
    const gates: (() => void)[] = [];
    setCastFactory((k) => ({
      ...scriptedCast(k),
      async *ask() {
        const me = ++n;
        yield `answer ${me}`;
        await new Promise<void>((r) => gates.push(r));
        yield ' more';
      },
    }));
    g().start('edge-rule');
    jump(300);
    const first = g().ask('netops', null, 'one');
    await settle();
    const second = g().ask('netops', null, 'two');
    await settle();
    gates.forEach((r) => r());
    await Promise.all([first, second]);
    await settle();
    gates.forEach((r) => r());
    const thread = g().chat.filter((l) => l.from === 'netops' || l.to === 'netops');
    expect(thread.map((l) => [l.from, l.text, !!l.live])).toEqual([
      ['you', 'one', false],
      ['netops', 'answer 1', false],
      ['you', 'two', false],
      ['netops', 'answer 2 more', false],
    ]);
  });

  it('a notice from the cast is a system line in that character thread', async () => {
    let hooks!: CastHooks;
    setCastFactory((k, h) => {
      hooks = h;
      return scriptedCast(k);
    });
    g().start('edge-rule');
    jump(300);
    hooks.notice('netops', 'Your key was rejected — using scripted lines.');
    expect(g().chat.at(-1)).toMatchObject({ from: 'system', to: 'netops', tick: 300, text: 'Your key was rejected — using scripted lines.' });
    // a notice from the cast of an old run is dropped
    const old = hooks;
    g().start('edge-rule');
    old.notice('netops', 'stale');
    expect(g().chat).toEqual([]);
  });

  it('start() and the end of the run stop the cast', async () => {
    const stop = vi.fn();
    setCastFactory((k) => ({ ...scriptedCast(k), stop }));
    g().start('edge-rule');
    g().start('edge-rule');
    expect(stop).toHaveBeenCalledTimes(1);
    setSpeed(20_000);
    advance(250);
    setSpeed(1);
    expect(g().snap!.status).not.toBe('running');
    await settle();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

describe('review', () => {
  const reviewing = (review: Cast['review']) => {
    setCastFactory((k) => ({ ...scriptedCast(k), review }));
    g().start('edge-rule');
    setSpeed(20_000);
    advance(250);
    setSpeed(1);
  };
  const drain = async (it: AsyncIterable<string>) => {
    const out: string[] = [];
    for await (const s of it) out.push(s);
    return out;
  };

  it('streams into reviewText and ends done', async () => {
    reviewing(async function* () {
      yield 'Communication: ';
      yield 'clear.';
    });
    expect(g().reviewState).toBe('idle');
    const it = g().review();
    expect(await drain(it)).toEqual(['Communication: ', 'clear.']);
    expect(g().reviewText).toBe('Communication: clear.');
    expect(g().reviewState).toBe('done');
  });

  it('a failing reviewer ends failed and never throws at the caller; the score is untouched', async () => {
    reviewing(async function* () {
      yield 'Half';
      throw new Error('rate limited');
    });
    const before = g().log;
    await expect(drain(g().review())).resolves.toEqual(['Half']);
    expect(g().reviewState).toBe('failed');
    expect(g().log).toBe(before);
  });

  it('does nothing without a reviewer, or before the run ends, and start() resets it', async () => {
    setCastFactory((k) => scriptedCast(k));
    g().start('edge-rule');
    expect(await drain(g().review())).toEqual([]);
    expect(g().reviewState).toBe('idle');
    reviewing(async function* () {
      yield 'x';
    });
    await drain(g().review());
    g().start('edge-rule');
    expect([g().reviewState, g().reviewText]).toEqual(['idle', '']);
  });
});

