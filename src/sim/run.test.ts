import { describe, expect, it } from 'vitest';
import { evalCond } from './cond';
import { createRun } from './index';
import type { CaseModel, NodeParams, Snapshot } from './index';

const node = (over: Partial<NodeParams> = {}): NodeParams => ({
  instances: 1, rpsPerInstance: 1000, costMul: 1, capacityMul: 1,
  enabled: true, queueMax: 200, baseLatencyMs: 10, ...over,
});

const model = (over: Partial<CaseModel> = {}): CaseModel => ({
  id: 't', version: 1, title: 't', seed: 1, maxTicks: 400, ticksPerSecond: 10,
  entry: 'edge', baseRps: 500,
  nodes: { edge: node(), app: node(), db: node() },
  edges: [
    { from: 'edge', to: 'app', fanout: 1, timeoutMs: 1000, retries: 0 },
    { from: 'app', to: 'db', fanout: 1, timeoutMs: 1000, retries: 0 },
  ],
  timeline: [
    { at: 10, kind: 'deploy', target: 'edge', label: 'rules v2', modifier: { target: 'edge', flags: { rules: 'v2' } } },
    {
      at: 10, kind: 'modify', target: 'edge', label: 'rules blow up',
      modifier: { target: 'edge', mul: { costMul: 40 }, while: { metric: 'edge.flag:rules', op: '==', value: 'v2' } },
    },
  ],
  actions: [{
    id: 'rollback_rules', target: 'edge', label: 'Roll back rules', verb: 'rollback',
    delayTicks: 30, effects: [], clears: ['rules'], resolves: true, harmful: false,
  }],
  win: {
    cond: { all: [{ metric: 'city.errorRate', op: '<', value: 0.01 }, { metric: 'city.tick', op: '>=', value: 15 }] },
    holdTicks: 5,
  },
  lose: { maxFailedRequests: 1_000_000 },
  clues: [],
  updates: [],
  scoring: { detectParTicks: 20, recoverParTicks: 60, updateEveryTicks: 20 },
  ...over,
});

describe('run', () => {
  it('is healthy before the fault and broken after it', () => {
    const r = createRun(model());
    r.step(9);
    expect(r.snapshot.impact.errorRate).toBeLessThan(0.01);
    r.step(11);
    expect(r.snapshot.tick).toBe(20);
    expect(r.snapshot.impact.errorRate).toBeGreaterThan(0.5);
  });

  it('recovers after the rollback lands and wins once held', () => {
    const r = createRun(model());
    r.step(20);
    expect(r.act('rollback_rules')).toEqual({ ok: true });
    expect(r.snapshot.pending).toEqual([{ actionId: 'rollback_rules', landsAt: 50 }]);
    r.step(20);
    expect(r.snapshot.tick).toBe(40);
    expect(r.snapshot.impact.errorRate).toBeGreaterThan(0.5);
    r.step(30);
    expect(r.snapshot.impact.errorRate).toBeLessThan(0.01);
    expect(r.snapshot.status).toBe('won');
    expect(r.snapshot.flags.edge).toEqual({});
    expect(r.log.map((e) => e.type)).toEqual(
      expect.arrayContaining(['deploy', 'fault', 'action', 'action_landed', 'won']),
    );
    expect(r.snapshot.changes.map((c) => [c.label, c.byPlayer])).toEqual([
      ['rules v2', false], ['Roll back rules', true],
    ]);
  });

  it('loses when nothing is done, then stops advancing', () => {
    const r = createRun(model());
    r.step(1000);
    expect(r.snapshot.status).toBe('lost');
    const lost = r.log.find((e) => e.type === 'lost');
    expect(['clock', 'impact']).toContain((lost as { reason: string }).reason);
    const t = r.snapshot.tick;
    r.step(5);
    expect(r.snapshot.tick).toBe(t);
  });

  it('loses by impact when failed requests pass the limit', () => {
    const r = createRun(model({ lose: { maxFailedRequests: 100 } }));
    r.step(1000);
    expect(r.snapshot.status).toBe('lost');
    expect(r.log.at(-1)).toMatchObject({ type: 'lost', reason: 'impact' });
    expect(r.snapshot.tick).toBeLessThan(400);
  });

  it('loses by clock when impact never trips', () => {
    const r = createRun(model({ maxTicks: 50 }));
    r.step(100);
    expect(r.snapshot.tick).toBe(50);
    expect(r.log.at(-1)).toMatchObject({ type: 'lost', reason: 'clock' });
  });

  it('rejects a second act in the same tick as already_pending', () => {
    const r = createRun(model());
    r.step(20);
    expect(r.act('rollback_rules')).toEqual({ ok: true });
    expect(r.act('rollback_rules')).toEqual({ ok: false, reason: 'already_pending' });
    expect(r.log.filter((e) => e.type === 'action')).toHaveLength(1);
    expect(r.log.filter((e) => e.type === 'action_rejected')).toHaveLength(1);
  });

  it('rejects unknown actions and any act after the run ends', () => {
    const r = createRun(model());
    expect(r.act('nope')).toEqual({ ok: false, reason: 'unknown' });
    r.step(1000);
    expect(r.act('rollback_rules')).toEqual({ ok: false, reason: 'not_running' });
  });

  it('honours once, and allows repeats otherwise', () => {
    const once = createRun(model({ actions: [{ ...model().actions[0]!, once: true, delayTicks: 1 }] }));
    once.step(12);
    once.act('rollback_rules');
    once.step(2);
    expect(once.act('rollback_rules')).toEqual({ ok: false, reason: 'already_done' });
    const rep = createRun(model({ actions: [{ ...model().actions[0]!, delayTicks: 1 }] }));
    rep.step(12);
    rep.act('rollback_rules');
    rep.step(2);
    expect(rep.act('rollback_rules')).toEqual({ ok: true });
  });

  it('rejects acts as too_early until the first deploy or fault, and still records them', () => {
    const r = createRun(model());
    r.step(9);
    expect(r.act('rollback_rules')).toEqual({ ok: false, reason: 'too_early' });
    expect(r.act('nope')).toEqual({ ok: false, reason: 'unknown' });
    expect(r.snapshot.pending).toEqual([]);
    expect(r.inputs.filter((i) => i.kind === 'act')).toHaveLength(2);
    expect(r.log.filter((e) => e.type === 'action_rejected')).toEqual([
      { tick: 9, type: 'action_rejected', actionId: 'rollback_rules', reason: 'too_early' },
      { tick: 9, type: 'action_rejected', actionId: 'nope', reason: 'unknown' },
    ]);
    r.step(1);
    expect(r.act('rollback_rules')).toEqual({ ok: true });
    // a fault with no deploy before it opens the way as well
    const faultOnly = createRun(model({ timeline: model().timeline.filter((e) => e.kind === 'modify') }));
    faultOnly.step(9);
    expect(faultOnly.act('rollback_rules')).toEqual({ ok: false, reason: 'too_early' });
    faultOnly.step(1);
    expect(faultOnly.act('rollback_rules')).toEqual({ ok: true });
  });

  it('returns a new snapshot each tick and never mutates old ones', () => {
    const r = createRun(model());
    r.step(10);
    const a = r.step(1);
    const frozen = JSON.stringify(a);
    const b = r.step(1);
    r.act('rollback_rules');
    expect(b).not.toBe(a);
    expect(JSON.stringify(a)).toBe(frozen);
    expect(b.pending).toEqual([]);
    expect(r.snapshot.pending).toHaveLength(1);
  });

  it('expires forTicks modifiers', () => {
    const m = model({
      timeline: [{ at: 5, kind: 'modify', target: 'edge', modifier: { target: 'edge', set: { enabled: false }, forTicks: 3 } }],
    });
    const r = createRun(m);
    r.step(5);
    expect(r.snapshot.params.edge!.enabled).toBe(false);
    r.step(3);
    expect(r.snapshot.params.edge!.enabled).toBe(true);
  });
});

describe('evalCond', () => {
  const snap = (): Snapshot => {
    const r = createRun(model());
    return r.step(12);
  };
  it('reads node metrics, flags, enabled and city metrics', () => {
    const s = snap();
    expect(evalCond({ metric: 'edge.saturation', op: '>', value: 0 }, s)).toBe(true);
    expect(evalCond({ metric: 'edge.enabled', op: '==', value: true }, s)).toBe(true);
    expect(evalCond({ metric: 'edge.flag:rules', op: '==', value: 'v2' }, s)).toBe(true);
    expect(evalCond({ metric: 'edge.flag:gone', op: '==', value: 'v2' }, s)).toBe(false);
    expect(evalCond({ metric: 'edge.flag:gone', op: '!=', value: 'v2' }, s)).toBe(true);
    expect(evalCond({ metric: 'app.flag:rules', op: '!=', value: 'v2' }, s)).toBe(true);
    expect(evalCond({ metric: 'city.tick', op: '==', value: 12 }, s)).toBe(true);
    expect(evalCond({ all: [{ metric: 'city.tick', op: '>=', value: 1 }, { not: { metric: 'city.tick', op: '>', value: 99 } }] }, s)).toBe(true);
    expect(evalCond({ any: [] }, s)).toBe(false);
  });
  it('is false, never a throw, for unknown or mismatched metrics', () => {
    const s = snap();
    for (const metric of ['', '.', 'nope', 'nope.errorRate', 'edge.nope', 'edge.', 'city.nope', 'edge.toString', '__proto__.x', 'edge.flag:']) {
      expect(evalCond({ metric, op: '==', value: 1 }, s)).toBe(false);
    }
    expect(evalCond({ metric: 'edge.errorRate', op: '==', value: 'x' }, s)).toBe(false);
    expect(evalCond({ metric: 'edge.enabled', op: '<', value: true }, s)).toBe(false);
  });
});
