import type { CaseFile } from '../cases';
import { evalCond, makeRng } from '../sim';
import type { NodeId, Snapshot } from '../sim';

const MAX_LINES = 8;
/** Ticks that share one pick of lines, so the log does not reshuffle every second. */
const BUCKET = 4;

/** Simulated time as mm:ss, one tick being one simulated second. */
export function clock(ticks: number): string {
  const t = Math.max(0, Math.floor(ticks));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/** FNV-1a over a string, for a seed that depends on the run, the building and the time. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

/**
 * Up to eight log lines for a building, oldest first, drawn from the rules
 * whose `when` holds now. The pick depends on the run seed, the building and
 * a bucket of ticks; the timestamps count back from the current tick, so the
 * same snapshot always reads the same.
 */
export function logLines(c: CaseFile, node: NodeId, snap: Snapshot, seed: number): string[] {
  const pool = (c.signals.logs[node] ?? []).filter((r) => evalCond(r.when, snap)).flatMap((r) => r.lines);
  if (pool.length === 0) return [];
  const rng = makeRng(hash(`${seed}|${node}|${Math.floor(snap.tick / BUCKET)}`));
  const count = Math.min(MAX_LINES, Math.max(1, snap.tick + 1), 5 + rng.int(MAX_LINES - 4));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = snap.tick - (count - 1 - i);
    out.push(`${clock(at)} ${pool[rng.int(pool.length)]!}`);
  }
  return out;
}
