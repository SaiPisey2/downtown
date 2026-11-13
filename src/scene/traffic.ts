import type { CaseFile } from '../cases';
import { topoOrder } from '../sim';
import type { EdgeId, EdgeView, NodeId, NodeView, Snapshot } from '../sim';

/**
 * Pure rules for the moving parts of the board: traffic dots, queues at the
 * door, glow, dimmed windows, the crane and dot thinning. No three.js here.
 */

export type DotKind = 'ok' | 'retry' | 'failed';

export interface Dot {
  edge: EdgeId;
  /** 0..1 along the road, from the sender to the receiver */
  t: number;
  kind: DotKind;
  /** 0 while travelling; a failed dot falls from 0 to 1 and is then gone */
  fall: number;
  /** 0..1 across the road, fixed for the dot's trip */
  lane: number;
}

export type DotCounts = { ok: number; retry: number; failed: number };
export type DotBudget = Record<EdgeId, DotCounts>;

/** Road fraction a dot travels per simulated tick, on average. */
export const DOT_SPEED = 0.1;

/**
 * Each trip's own pace, 0.85..1.15 of DOT_SPEED, from its lane. Without it a
 * gap or clump left by a change of budget would circle the road for ever.
 */
export function dotPace(lane: number): number {
  return 0.85 + 0.3 * ((lane * 13.37) % 1);
}
/** Where along the road a failed dot is turned away and falls. */
export const FAIL_AT = 0.74;
/** Dots each road with traffic gets before the rest is shared by rate. */
const ROAD_FLOOR = 6;
/** Most dots stacked at a building's door. */
export const QUEUE_STACK = 12;

const fin = (x: number): number => (Number.isFinite(x) && x > 0 ? x : 0);
const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * Dots per road and kind. Density follows each edge's rate (fresh plus
 * retried requests); every road with traffic first gets a small floor so the
 * busiest road never starves the others. Retried requests are amber, the
 * share that fails is `failRate / (rate + retryRate)`. Never more than maxDots.
 */
export function dotBudget(edges: Record<EdgeId, EdgeView>, maxDots: number): DotBudget {
  const cap = Math.floor(fin(maxDots));
  let sum = 0;
  let active = 0;
  for (const id in edges) {
    const e = edges[id]!;
    const w = fin(e.rate) + fin(e.retryRate);
    if (w > 0) {
      sum += w;
      active++;
    }
  }
  const floor = active > 0 ? Math.min(ROAD_FLOOR, Math.floor(cap / (2 * active))) : 0;
  const spare = cap - floor * active;
  const out: DotBudget = {};
  for (const id in edges) {
    const e = edges[id]!;
    const w = fin(e.rate) + fin(e.retryRate);
    if (w <= 0) {
      out[id] = { ok: 0, retry: 0, failed: 0 };
      continue;
    }
    const n = floor + Math.floor((spare * w) / sum);
    const failed = Math.round(n * clamp01(fin(e.failRate) / w));
    const retry = Math.min(n - failed, Math.round(n * clamp01(fin(e.retryRate) / w)));
    out[id] = { ok: n - failed - retry, retry, failed };
  }
  return out;
}

interface Tally extends DotCounts {
  total: number;
}

/** Reused between calls so stepping allocates nothing per dot. */
const tallies = new Map<EdgeId, Tally>();

function neediest(b: DotCounts, c: Tally): DotKind {
  const ok = b.ok - c.ok;
  const retry = b.retry - c.retry;
  const failed = b.failed - c.failed;
  if (failed >= retry && failed >= ok && failed > 0) return 'failed';
  return retry > ok ? 'retry' : 'ok';
}

const budgetTotal = (b: DotCounts) => b.ok + b.retry + b.failed;

/**
 * Moves every dot `dtTicks` along its road. A failed dot stops at FAIL_AT and
 * falls over `fallTicks`. A dot that arrives, or has fallen, starts again at
 * the beginning of its road as whichever kind its road is shortest of, or
 * leaves if the road already has its share. Then each road is topped up to its
 * budget. Works in place on `dots` and returns it, so a frame allocates
 * nothing per dot; only new dots are new objects.
 */
export function stepDots(dots: Dot[], budget: DotBudget, dtTicks: number, rng: () => number, fallTicks = 2): Dot[] {
  const dt = fin(dtTicks);
  const fallStep = dt / Math.max(fallTicks, 1e-6);
  for (const t of tallies.values()) t.ok = t.retry = t.failed = t.total = 0;
  for (const id in budget) if (!tallies.has(id)) tallies.set(id, { ok: 0, retry: 0, failed: 0, total: 0 });

  // move, and count the dots still on their way
  for (const d of dots) {
    if (d.kind === 'failed' && d.t >= FAIL_AT) d.fall += fallStep;
    else {
      d.t += dt * DOT_SPEED * dotPace(d.lane);
      if (d.kind === 'failed' && d.t > FAIL_AT) d.t = FAIL_AT;
    }
    if (d.t < 1 && d.fall < 1 && budget[d.edge]) {
      const c = tallies.get(d.edge)!;
      c[d.kind]++;
      c.total++;
    }
  }

  // recycle arrivals into what their road is short of; drop the rest
  let w = 0;
  for (const d of dots) {
    const b = budget[d.edge];
    if (!b) {
      if (d.t < 1 && d.fall < 1) dots[w++] = d;
      continue;
    }
    if (d.t >= 1 || d.fall >= 1) {
      const c = tallies.get(d.edge)!;
      if (c.total >= budgetTotal(b)) continue;
      // a fallen dot comes back somewhere along the road, so the fallen do not return as one clump
      d.t = d.fall >= 1 ? rng() : d.t - Math.floor(d.t);
      d.fall = 0;
      d.kind = neediest(b, c);
      if (d.kind === 'failed' && d.t > FAIL_AT) d.t *= FAIL_AT;
      d.lane = rng();
      c[d.kind]++;
      c.total++;
    }
    dots[w++] = d;
  }
  dots.length = w;

  // top up
  for (const id in budget) {
    const b = budget[id]!;
    const c = tallies.get(id)!;
    const want = budgetTotal(b);
    while (c.total < want) {
      const kind = neediest(b, c);
      const t = rng();
      dots.push({ edge: id, t: kind === 'failed' ? t * FAIL_AT : t, kind, fall: 0, lane: rng() });
      c[kind]++;
      c.total++;
    }
  }
  return dots;
}

/** Dots stacked at a building's door, 0..12: one as soon as anything waits, all twelve at queueMax. */
export function queueStack(queue: number, queueMax: number): number {
  const q = fin(queue);
  const max = fin(queueMax);
  if (max <= 0 || q < 0.5) return 0;
  return Math.min(QUEUE_STACK, Math.max(1, Math.round((QUEUE_STACK * q) / max)));
}

/**
 * Requests per tick each building receives when nothing is wrong: baseRps at
 * the entry, carried down every edge by its fan-out.
 */
export function healthyInflow(c: Pick<CaseFile, 'entry' | 'baseRps' | 'nodes' | 'edges'>): Record<NodeId, number> {
  const ids = Object.keys(c.nodes);
  const out: Record<NodeId, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  out[c.entry] = fin(c.baseRps);
  for (const id of topoOrder(ids, c.edges)) {
    for (const e of c.edges) if (e.from === id && e.to in out) out[e.to]! += out[id]! * fin(e.fanout);
  }
  return out;
}

/**
 * Window brightness, 0.08..1, from arrivals against the healthy inflow. Full
 * at the healthy level; a building that gets 85% or less of its usual traffic
 * is at its dimmest, so a starved district reads as gone quiet. Steep on
 * purpose: the simulation is noiseless, so any drop is real.
 */
export function windowLevel(arrivals: number, healthy: number): number {
  if (!(healthy > 0)) return 1;
  const ratio = fin(arrivals) / healthy;
  if (ratio >= 1) return 1;
  return 0.08 + 0.92 * clamp01((ratio - 0.85) / 0.15);
}

/**
 * Emissive glow, 0..1: grows with saturation above 0.8, and most of it needs
 * the building to be falling behind (queueing or turning work away), so a
 * building that is busy but keeping up only warms a little.
 */
export function glowLevel(v: Pick<NodeView, 'saturation' | 'queue' | 'dropped' | 'arrivals'>): number {
  const s = clamp01((v.saturation - 0.8) / 0.2);
  // a switched-off building reads as saturated, but with nothing to do it is not straining
  if (s <= 0 || fin(v.arrivals) + fin(v.queue) <= 0) return 0;
  const behind = clamp01(((fin(v.queue) + fin(v.dropped)) / Math.max(fin(v.arrivals), 1)) * 4);
  return s * (0.2 + 0.8 * behind);
}

/** Ticks a crane stands on a building after a change to it. */
export const CRANE_TICKS = 120;

/** True for CRANE_TICKS after any change (deploy or player action) to the building. */
export function craneOn(changes: Snapshot['changes'], nodeId: NodeId, tick: number): boolean {
  for (const ch of changes) {
    const age = tick - ch.tick;
    if (ch.target === nodeId && age >= 0 && age < CRANE_TICKS) return true;
  }
  return false;
}

export const THIN = { fps: 30, seconds: 3, floor: 250 } as const;

/** Halves maxDots once the frame rate has stayed under 30 for 3 seconds (never below 250). In place. */
export function stepThinning(s: { maxDots: number; slow: number }, fps: number, dt: number): void {
  if (fps >= THIN.fps) {
    s.slow = 0;
    return;
  }
  s.slow += dt;
  if (s.slow >= THIN.seconds - 1e-9) {
    s.maxDots = Math.max(THIN.floor, Math.floor(s.maxDots / 2));
    s.slow = 0;
  }
}

/** Small seeded generator (mulberry32) for visuals only, never the simulation's. */
export function visualRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
