import { describe, expect, it } from 'vitest';
import { emptyFlow, stepFlow, topoOrder } from './flow';
import { makeRng } from './rng';
import type { EdgeParams, FlowState, NodeParams } from './types';

const node = (over: Partial<NodeParams> = {}): NodeParams => ({
  instances: 1, rpsPerInstance: 1000, costMul: 1, capacityMul: 1,
  enabled: true, queueMax: 200, baseLatencyMs: 10, ...over,
});
const edge = (from: string, to: string, over: Partial<EdgeParams> = {}): EdgeParams => ({
  from, to, fanout: 1, timeoutMs: 1000, retries: 2, ...over,
});
const run = (
  ids: string[], params: Record<string, NodeParams>, edges: EdgeParams[], rps: number, steps: number,
): FlowState => {
  const order = topoOrder(ids, edges);
  let s = emptyFlow(ids, edges);
  for (let i = 0; i < steps; i++) s = stepFlow(s, params, edges, order, ids[0]!, rps);
  return s;
};

describe('topoOrder', () => {
  it('puts a parent before its child', () => {
    const order = topoOrder(['c', 'b', 'a'], [edge('a', 'b'), edge('b', 'c')]);
    expect(order).toEqual(['a', 'b', 'c']);
  });
  it('throws on a cycle', () => {
    expect(() => topoOrder(['a', 'b'], [edge('a', 'b'), edge('b', 'a')])).toThrow(/cycle/);
  });
});

describe('stepFlow', () => {
  it('serves a node under capacity', () => {
    const v = run(['a'], { a: node() }, [], 600, 1).nodes.a!;
    expect(v.served).toBe(600);
    expect(v.queue).toBe(0);
    expect(v.errorRate).toBe(0);
    expect(v.saturation).toBeCloseTo(0.6);
  });
  it('queues, then drops, when over capacity', () => {
    const v = run(['a'], { a: node() }, [], 1500, 3).nodes.a!;
    expect(v.queue).toBe(200);
    expect(v.dropped).toBeGreaterThan(0);
    expect(v.errorRate).toBeGreaterThan(0.2);
  });
  it('a disabled node serves nothing and stays finite', () => {
    const v = run(['a'], { a: node({ enabled: false }) }, [], 600, 2).nodes.a!;
    expect(v.served).toBe(0);
    expect(v.saturation).toBe(1);
    expect(Number.isFinite(v.latencyMs)).toBe(true);
  });
  it('propagates a failing child to its parent as errors and retries', () => {
    const edges = [edge('a', 'b')];
    const s = run(['a', 'b'], { a: node(), b: node({ rpsPerInstance: 100 }) }, edges, 500, 3);
    expect(s.nodes.a!.errorRate).toBeGreaterThan(0);
    expect(s.edges['a>b']!.retryRate).toBeGreaterThan(0);
  });
  it('keeps every output finite and non-negative', () => {
    const edges = [edge('a', 'b', { fanout: 3 })];
    const s = run(['a', 'b'], { a: node(), b: node({ enabled: false }) }, edges, 5000, 10);
    for (const v of [...Object.values(s.nodes), ...Object.values(s.edges)])
      for (const x of Object.values(v)) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
      }
  });
});

describe('makeRng', () => {
  const five = (seed: number) => { const r = makeRng(seed); return Array.from({ length: 5 }, () => r.next()); };
  it('is deterministic per seed and differs across seeds', () => {
    expect(five(7)).toEqual(five(7));
    expect(five(7)).not.toEqual(five(8));
  });
  it('stays within range', () => {
    const r = makeRng(1);
    for (let i = 0; i < 200; i++) {
      const f = r.next(); const n = r.int(5);
      expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1);
      expect(Number.isInteger(n) && n >= 0 && n < 5).toBe(true);
    }
  });
});
