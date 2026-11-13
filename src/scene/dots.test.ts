import { describe, expect, it } from 'vitest';
import { cases } from '../cases';
import { createRun } from '../sim';
import type { EdgeView } from '../sim';
import {
  FAIL_AT,
  craneOn,
  dotBudget,
  glowLevel,
  healthyInflow,
  queueStack,
  stepDots,
  stepThinning,
  visualRng,
  windowLevel,
} from './dots';
import type { Dot } from './dots';

const ev = (rate: number, retryRate = 0, failRate = 0): EdgeView => ({ rate, retryRate, failRate });
const total = (b: ReturnType<typeof dotBudget>) =>
  Object.values(b).reduce((s, k) => s + k.ok + k.retry + k.failed, 0);

/** The edge-rule city at tick 320: a retry storm into the edge, everything after it thinner. */
const failing: Record<string, EdgeView> = {
  'gate>edge': ev(2000, 4319, 1440),
  'edge>web': ev(1062),
  'edge>api': ev(708),
  'web>cache': ev(1062),
  'web>accounts': ev(212),
  'api>accounts': ev(212),
  'api>orders': ev(354),
  'cache>db': ev(106),
  'accounts>db': ev(425),
  'orders>db': ev(354),
};

describe('dotBudget', () => {
  it('never hands out more than maxDots', () => {
    for (const max of [0, 1, 7, 250, 1000, 2000]) {
      expect(total(dotBudget(failing, max))).toBeLessThanOrEqual(max);
    }
    const rnd = visualRng(3);
    for (let i = 0; i < 200; i++) {
      const edges: Record<string, EdgeView> = {};
      for (let e = 0; e < 1 + Math.floor(rnd() * 12); e++) edges[`n${e}>m`] = ev(rnd() * 5000, rnd() * 3000, rnd() * 2000);
      const max = Math.floor(rnd() * 2500);
      expect(total(dotBudget(edges, max))).toBeLessThanOrEqual(max);
    }
  });
  it('uses most of the budget when there is traffic', () => {
    expect(total(dotBudget(failing, 2000))).toBeGreaterThan(1950);
  });
  it('gives an edge with rate 0 no dots', () => {
    const b = dotBudget({ 'a>b': ev(0), 'b>c': ev(500) }, 1000);
    expect(b['a>b']).toEqual({ ok: 0, retry: 0, failed: 0 });
  });
  it('makes about half the dots failed when failRate is half of rate', () => {
    const b = dotBudget({ 'a>b': ev(1000, 0, 500) }, 1000)['a>b']!;
    expect(b.failed / (b.ok + b.retry + b.failed)).toBeCloseTo(0.5, 2);
  });
  it('makes the retry share amber', () => {
    const b = dotBudget({ 'a>b': ev(1000, 3000, 0) }, 1000)['a>b']!;
    expect(b.retry / (b.ok + b.retry + b.failed)).toBeCloseTo(0.75, 2);
  });
  it('is proportional to rate', () => {
    const b = dotBudget({ 'a>b': ev(1000), 'b>c': ev(500) }, 1500);
    const n = (k: string) => b[k]!.ok + b[k]!.retry + b[k]!.failed;
    expect(n('a>b') / n('b>c')).toBeCloseTo(2, 1);
  });
  it('never lets the busiest road starve the others', () => {
    const b = dotBudget({ 'a>b': ev(1_000_000), 'b>c': ev(1) }, 250);
    expect(b['b>c']!.ok).toBeGreaterThan(0);
  });
  it('treats NaN and negative rates as no traffic', () => {
    const b = dotBudget({ 'a>b': ev(Number.NaN, -5, Number.NaN), 'b>c': ev(10) }, 100);
    expect(b['a>b']).toEqual({ ok: 0, retry: 0, failed: 0 });
    expect(total(dotBudget({ x: ev(10) }, Number.NaN))).toBe(0);
  });
});

const count = (dots: Dot[], edge: string, kind?: Dot['kind']) =>
  dots.filter((d) => d.edge === edge && (!kind || d.kind === kind)).length;

describe('stepDots', () => {
  it('fills each edge up to its budget, kind by kind', () => {
    const budget = dotBudget(failing, 1000);
    const dots = stepDots([], budget, 0, visualRng(1));
    for (const [edge, b] of Object.entries(budget)) {
      expect(count(dots, edge, 'ok')).toBe(b.ok);
      expect(count(dots, edge, 'retry')).toBe(b.retry);
      expect(count(dots, edge, 'failed')).toBe(b.failed);
    }
  });
  it('never returns t outside [0, 1] for live dots, and never returns a fallen dot', () => {
    const rng = visualRng(2);
    const budget = dotBudget(failing, 800);
    let dots: Dot[] = [];
    // one assertion at the end: an expect per dot per step made this test slow enough to time out under load
    const bad: string[] = [];
    for (let i = 0; i < 400; i++) {
      dots = stepDots(dots, budget, rng() * 3, rng);
      for (const d of dots) {
        if (!(d.t >= 0 && d.t <= 1 && d.fall >= 0 && d.fall < 1) || (d.fall > 0 && d.kind !== 'failed')) {
          bad.push(`step ${i}: ${JSON.stringify(d)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
  it('stops a failed dot where it fails and lets it fall', () => {
    const budget = { 'a>b': { ok: 0, retry: 0, failed: 1 } };
    const dots: Dot[] = [{ edge: 'a>b', t: FAIL_AT - 0.01, kind: 'failed', fall: 0, lane: 0.5 }];
    stepDots(dots, budget, 1, visualRng(1), 2);
    expect(dots[0]!.t).toBe(FAIL_AT);
    stepDots(dots, budget, 1, visualRng(1), 2);
    expect(dots[0]!.t).toBe(FAIL_AT);
    expect(dots[0]!.fall).toBeCloseTo(0.5, 9);
  });
  it('removes fallen dots once the edge no longer fails', () => {
    const dots: Dot[] = [
      { edge: 'a>b', t: FAIL_AT, kind: 'failed', fall: 0.9, lane: 0.5 },
      { edge: 'a>b', t: 0.1, kind: 'ok', fall: 0, lane: 0.5 },
    ];
    const out = stepDots(dots, { 'a>b': { ok: 1, retry: 0, failed: 0 } }, 1, visualRng(1), 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('ok');
  });
  it('drops dots of edges that left the budget when they arrive', () => {
    const dots: Dot[] = [{ edge: 'gone>x', t: 0.95, kind: 'ok', fall: 0, lane: 0.5 }];
    expect(stepDots(dots, {}, 1, visualRng(1))).toHaveLength(0);
  });
  it('follows a shrinking budget as dots reach the end of the road', () => {
    const rng = visualRng(4);
    let dots = stepDots([], { 'a>b': { ok: 100, retry: 0, failed: 0 } }, 0, rng);
    const small = { 'a>b': { ok: 20, retry: 0, failed: 0 } };
    dots = stepDots(dots, small, 0.5, rng);
    expect(dots.length).toBeGreaterThan(20);
    for (let i = 0; i < 40; i++) dots = stepDots(dots, small, 0.5, rng);
    expect(dots).toHaveLength(20);
  });
  it('turns the mix over to a new budget', () => {
    const rng = visualRng(5);
    let dots = stepDots([], { 'a>b': { ok: 50, retry: 0, failed: 0 } }, 0, rng);
    const storm = { 'a>b': { ok: 10, retry: 30, failed: 10 } };
    for (let i = 0; i < 60; i++) dots = stepDots(dots, storm, 0.5, rng);
    expect(count(dots, 'a>b', 'retry')).toBe(30);
    expect(count(dots, 'a>b', 'ok')).toBe(10);
  });
  it('evens out a gap in the traffic within a few trips', () => {
    const rng = visualRng(6);
    const budget = { 'a>b': { ok: 200, retry: 0, failed: 0 } };
    // all the dots in the first half of the road
    let dots: Dot[] = Array.from({ length: 200 }, (_, i) => ({ edge: 'a>b', t: i / 400, kind: 'ok' as const, fall: 0, lane: rng() }));
    for (let i = 0; i < 400; i++) dots = stepDots(dots, budget, 0.4, rng);
    const back = dots.filter((d) => d.t >= 0.5).length;
    expect(back).toBeGreaterThan(70);
    expect(back).toBeLessThan(130);
  });
  it('moves nothing when no time passes', () => {
    const dots: Dot[] = [{ edge: 'a>b', t: 0.3, kind: 'ok', fall: 0, lane: 0.5 }];
    stepDots(dots, { 'a>b': { ok: 1, retry: 0, failed: 0 } }, 0, visualRng(1));
    expect(dots[0]!.t).toBe(0.3);
  });
});

describe('queueStack', () => {
  it('is empty with no queue and full at queueMax', () => {
    expect(queueStack(0, 200)).toBe(0);
    expect(queueStack(200, 200)).toBe(12);
  });
  it('shows at least one dot for a small queue and grows with it', () => {
    expect(queueStack(2, 200)).toBe(1);
    expect(queueStack(100, 200)).toBe(6);
    expect(queueStack(5000, 200)).toBe(12);
  });
  it('is empty when the building cannot queue or the input is junk', () => {
    expect(queueStack(50, 0)).toBe(0);
    expect(queueStack(Number.NaN, 200)).toBe(0);
  });
});

describe('healthyInflow', () => {
  it('matches what each edge-rule building receives on a quiet afternoon', () => {
    const c = cases['edge-rule']!;
    const run = createRun(c, c.seed);
    run.step(200);
    const want = healthyInflow(c);
    for (const [id, v] of Object.entries(run.snapshot.nodes)) expect(want[id]).toBeCloseTo(v.arrivals, 6);
  });
});

describe('windowLevel', () => {
  it('is fully lit at or above the healthy inflow', () => {
    expect(windowLevel(1000, 1000)).toBe(1);
    expect(windowLevel(3000, 1000)).toBe(1);
  });
  it('dims as a building is starved', () => {
    expect(windowLevel(880, 1000)).toBeLessThan(0.8);
    expect(windowLevel(100, 1000)).toBeLessThan(windowLevel(880, 1000));
    expect(windowLevel(0, 1000)).toBeGreaterThan(0);
  });
  it('leaves buildings with no expected traffic alone', () => {
    expect(windowLevel(0, 0)).toBe(1);
  });
});

describe('glowLevel', () => {
  const view = { saturation: 0, queue: 0, dropped: 0, arrivals: 1000 };
  it('is dark below 80% saturation', () => {
    expect(glowLevel({ ...view, saturation: 0.8, queue: 500 })).toBe(0);
  });
  it('is faint for a building that is busy but keeping up', () => {
    const g = glowLevel({ ...view, saturation: 0.99 });
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(0.3);
  });
  it('is dark for a switched-off building with nothing to do', () => {
    expect(glowLevel({ saturation: 1, queue: 0, dropped: 0, arrivals: 0 })).toBe(0);
  });
  it('is strong for a saturated building turning work away', () => {
    expect(glowLevel({ saturation: 1, queue: 400, dropped: 4500, arrivals: 6300 })).toBeGreaterThan(0.8);
  });
});

describe('craneOn', () => {
  const changes = [{ tick: 240, target: 'filter', label: 'rules', byPlayer: false }];
  it('stands for 120 ticks after a change to the building', () => {
    expect(craneOn(changes, 'filter', 239)).toBe(false);
    expect(craneOn(changes, 'filter', 240)).toBe(true);
    expect(craneOn(changes, 'filter', 359)).toBe(true);
    expect(craneOn(changes, 'filter', 360)).toBe(false);
    expect(craneOn(changes, 'edge', 300)).toBe(false);
  });
});

describe('stepThinning', () => {
  it('halves the dots after 3 seconds under 30 fps, never below 250', () => {
    const s = { maxDots: 2000, slow: 0 };
    for (let i = 0; i < 29; i++) stepThinning(s, 20, 0.1);
    expect(s.maxDots).toBe(2000);
    stepThinning(s, 20, 0.1);
    expect(s.maxDots).toBe(1000);
    for (let i = 0; i < 1000; i++) stepThinning(s, 5, 0.1);
    expect(s.maxDots).toBe(250);
  });
  it('starts counting again whenever the frame rate recovers', () => {
    const s = { maxDots: 2000, slow: 0 };
    for (let i = 0; i < 100; i++) {
      stepThinning(s, 20, 0.1);
      if (i % 20 === 0) stepThinning(s, 60, 0.016);
    }
    expect(s.maxDots).toBe(2000);
  });
});

describe('visualRng', () => {
  it('is repeatable and stays in [0, 1)', () => {
    const a = visualRng(9);
    const b = visualRng(9);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
