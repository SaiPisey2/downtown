import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cases } from '../cases';
import { scriptedCast, setCastFactory } from '../cast';
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
});
