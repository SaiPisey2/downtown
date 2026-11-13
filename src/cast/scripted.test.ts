import { describe, expect, it, vi } from 'vitest';
import { answerFor, cases } from '../cases';
import type { CaseFile } from '../cases';
import { createRun } from '../sim';
import type { GameEvent, Run } from '../sim';
import { scriptedCast } from './scripted';
import type { Cast, ChatLine } from './types';

const c = cases['edge-rule']!;
const W = c.scoring.updateEveryTicks;

/** Steps the run one tick at a time and offers the cast what the store would: new events in order, then the tick. */
async function drive(cast: Cast, run: Run, ticks: number, state = { offered: run.log.length }): Promise<ChatLine[]> {
  const out: ChatLine[] = [];
  for (let i = 0; i < ticks && run.snapshot.status === 'running'; i++) {
    run.step(1);
    const fresh = run.log.slice(state.offered);
    state.offered = run.log.length;
    for (const e of fresh) out.push(...(await cast.onEvent(e, run.snapshot)));
    if (cast.onTick) out.push(...(await cast.onTick(run.snapshot)));
  }
  return out;
}

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const s of it) chunks.push(s);
  return chunks;
}

const firstFault = (log: readonly GameEvent[]) => log.find((e) => e.type === 'fault')!.tick;
const nudges = (lines: ChatLine[], k: CaseFile = c) => lines.filter((l) => l.text === k.lines.nudge);

describe('scripted cast', () => {
  it('posts the case line for a timeline message, from the character who sends it', async () => {
    const run = createRun(c);
    const lines = await drive(scriptedCast(c), run, 300);
    const msg = lines.find((l) => l.text === c.lines.boss_attack);
    expect(msg).toMatchObject({ from: 'boss', tick: 300 });
    expect(msg?.to).toBeUndefined();
  });

  it('posts the consequence line from the first teammate after a harmful action lands', async () => {
    const run = createRun(c);
    const cast = scriptedCast(c);
    const state = { offered: 0 };
    await drive(cast, run, 250, state);
    expect(run.act('restart_edge').ok).toBe(true);
    const lines = await drive(cast, run, 60, state);
    const landed = run.log.find((e) => e.type === 'action_landed' && e.actionId === 'restart_edge')!;
    const line = lines.find((l) => l.text === c.lines.restart_edge_bad);
    expect(line).toMatchObject({ from: 'netops', tick: landed.tick });
  });

  it('nudges once from the stakeholder when a whole window passes without an update', async () => {
    const run = createRun(c);
    const cast = scriptedCast(c);
    const state = { offered: 0 };
    // no nudge before the fault, nor while the first window is still open
    const early = await drive(cast, run, firstFaultTick(c) + W - 1, state);
    const f = firstFault(run.log);
    expect(f).toBe(firstFaultTick(c));
    expect(nudges(early)).toEqual([]);

    const out = await drive(cast, run, 6, state);
    const n = nudges(out);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ from: 'boss', tick: f + W });
    // a second missed window brings one more, not one per tick
    const more = await drive(cast, run, W);
    expect(nudges(more)).toHaveLength(1);
    expect(nudges(more)[0]!.tick).toBe(f + 2 * W);
  });

  it('does not nudge when an update was given in that window', async () => {
    const run = createRun(c);
    const cast = scriptedCast(c);
    const state = { offered: 0 };
    const before = await drive(cast, run, 280, state);
    run.update('investigating');
    const after = await drive(cast, run, W + 20, state);
    const f = firstFault(run.log);
    expect(nudges([...before, ...after])).toEqual([]);
    expect(run.snapshot.tick).toBeGreaterThan(f + W);
  });

  it('acknowledges an update in the stakeholder voice, with a different line for an untrue one', async () => {
    const run = createRun(c);
    const cast = scriptedCast(c);
    const state = { offered: 0 };
    await drive(cast, run, 280, state);
    run.update('investigating');
    const honest = await drive(cast, run, 1, state);
    run.update('attack');
    const spun = await drive(cast, run, 1, state);
    expect(honest).toEqual([expect.objectContaining({ from: 'boss', text: c.lines.update_ack_honest })]);
    expect(spun).toEqual([expect.objectContaining({ from: 'boss', text: c.lines.update_ack_spin })]);
    expect(c.lines.update_ack_honest).not.toBe(c.lines.update_ack_spin);
  });

  it('closes with the stakeholder stating the outcome', async () => {
    const run = createRun(c);
    const lines = await drive(scriptedCast(c), run, c.maxTicks + 1);
    expect(run.snapshot.status).toBe('lost');
    expect(lines.at(-1)).toMatchObject({ from: 'boss', text: c.lines.outcome_lost });

    const won = createRun(c);
    const cast = scriptedCast(c);
    const state = { offered: 0 };
    await drive(cast, won, 250, state);
    won.act('rollback_rules');
    const rest = await drive(cast, won, 1000, state);
    expect(won.snapshot.status).toBe('won');
    expect(rest.at(-1)).toMatchObject({ from: 'boss', text: c.lines.outcome_won });
  });

  it('asking netops about volume yields the stored answer, in more than one chunk', async () => {
    const run = createRun(c);
    run.step(300);
    const ctx = { c, snap: run.snapshot, found: [], chat: [] };
    const chunks = await collect(scriptedCast(c).ask('netops', 'volume', null, ctx));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(c.cast.find((m) => m.id === 'netops')!.questions.find((q) => q.id === 'volume')!.answer);
    expect(chunks.join('')).toBe(answerFor(c, 'netops', 'volume', run.snapshot));
  });

  it('gives the before-answer while the clue is not yet true', async () => {
    const run = createRun(c);
    run.step(10);
    const ctx = { c, snap: run.snapshot, found: [], chat: [] };
    const text = (await collect(scriptedCast(c).ask('netops', 'volume', null, ctx))).join('');
    expect(text).toBe(answerFor(c, 'netops', 'volume', run.snapshot));
    expect(text).not.toBe(c.cast[0]!.questions[0]!.answer);
  });

  it('waits between chunks only when given a delay', async () => {
    vi.useFakeTimers();
    try {
      const run = createRun(c);
      const ctx = { c, snap: run.snapshot, found: [], chat: [] };
      // no delay: done without any timer running
      expect((await collect(scriptedCast(c).ask('netops', 'volume', null, ctx))).length).toBeGreaterThan(1);
      let done = false;
      const slow = collect(scriptedCast(c, { delayMs: 30 }).ask('netops', 'volume', null, ctx)).then(() => (done = true));
      // the first piece alone waits half the delay
      await vi.advanceTimersByTimeAsync(14);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(30);
      await slow;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the tutorial stakeholder speaks too', async () => {
    const t = cases.tutorial!;
    const run = createRun(t);
    const lines = await drive(scriptedCast(t), run, firstFaultTick(t) + t.scoring.updateEveryTicks + 1);
    const boss = t.cast.find((m) => m.role === 'stakeholder')!;
    expect(nudges(lines, t)).toEqual([expect.objectContaining({ from: boss.id })]);
  });
});

function firstFaultTick(k: CaseFile): number {
  return Math.min(...k.timeline.filter((e) => e.kind === 'modify').map((e) => e.at));
}
