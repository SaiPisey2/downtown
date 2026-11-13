import { describe, expect, it } from 'vitest';
import { playScript } from '../../test/bot/bot';
import { cases } from '../cases';
import type { GameEvent } from '../sim';
import { timeline } from './timeline';

const c = cases['edge-rule']!;

describe('timeline', () => {
  it('tells the run in order: fault, deploys, clues, actions taken and landed, updates, hints, recovery', () => {
    const log: GameEvent[] = [
      { tick: 240, type: 'deploy', target: 'filter', label: 'rules update 412' },
      { tick: 242, type: 'fault', target: 'edge', label: 'one rule in update 412 burns the edge CPU' },
      { tick: 250, type: 'update', id: 'investigating' },
      { tick: 300, type: 'message', from: 'boss', lineKey: 'boss_attack' },
      { tick: 301, type: 'clue', clueId: 'cpu_everywhere' },
      { tick: 310, type: 'hint', clueId: null },
      { tick: 320, type: 'update', id: 'attack' },
      { tick: 480, type: 'action', actionId: 'filter_off' },
      { tick: 481, type: 'action_rejected', actionId: 'filter_off', reason: 'already_pending' },
      { tick: 485, type: 'action_landed', actionId: 'filter_off' },
      { tick: 530, type: 'won' },
    ];
    const clue = c.clues.find((x) => x.id === 'cpu_everywhere')!;
    const off = c.actions.find((a) => a.id === 'filter_off')!;
    expect(timeline(c, log)).toEqual([
      { tick: 240, kind: 'deploy', text: 'Deploy: rules update 412' },
      { tick: 242, kind: 'fault', text: 'The fault begins: one rule in update 412 burns the edge CPU' },
      { tick: 250, kind: 'update', text: `You told the boss: ${c.updates[0]!.label}` },
      { tick: 301, kind: 'clue', text: `Clue found: ${clue.text}` },
      { tick: 310, kind: 'hint', text: 'You asked for a hint; there was nothing left to show' },
      { tick: 320, kind: 'update', text: `You told the boss: ${c.updates.find((u) => u.id === 'attack')!.label} (not the whole truth)` },
      { tick: 480, kind: 'action', text: `You started: ${off.label}` },
      { tick: 485, kind: 'landed', text: `Landed: ${off.label}` },
      { tick: 530, kind: 'won', text: 'The city recovered' },
    ]);
  });

  it('names a used hint, both kinds of loss, and survives ids the case does not have', () => {
    expect(timeline(c, [
      { tick: 5, type: 'hint', clueId: 'cpu_everywhere' },
      { tick: 6, type: 'clue', clueId: 'nope' },
      { tick: 7, type: 'action', actionId: 'nope' },
      { tick: 8, type: 'update', id: 'nope' },
      { tick: 9, type: 'lost', reason: 'clock' },
    ])).toEqual([
      { tick: 5, kind: 'hint', text: 'You used a hint (−3 points)' },
      { tick: 6, kind: 'clue', text: 'Clue found: nope' },
      { tick: 7, kind: 'action', text: 'You started: nope' },
      { tick: 8, kind: 'update', text: 'You told the boss: nope' },
      { tick: 9, kind: 'lost', text: 'The clock ran out' },
    ]);
    expect(timeline(c, [{ tick: 9, type: 'lost', reason: 'impact' }])).toEqual([
      { tick: 9, kind: 'lost', text: 'Too many customers saw errors' },
    ]);
  });

  it('a real won run starts with the fault and ends with the recovery', () => {
    const { run } = playScript(c, [
      { at: 300, do: 'observe', arg: 'graph:edge.saturation' },
      { at: 480, do: 'act', arg: 'filter_off' },
    ]);
    const t = timeline(c, run.log);
    expect(t[0]!.kind).toBe('deploy');
    expect(t.at(-1)!.kind).toBe('won');
    expect(t.map((x) => x.tick)).toEqual([...t.map((x) => x.tick)].sort((a, b) => a - b));
  });
});
