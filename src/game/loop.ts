import { cases } from '../cases';
import type { Run, Snapshot } from '../sim';
import { REPLAY_SPEED } from './flow';
import { feedReplay, offerTick, useGame, view } from './store';

const HISTORY = 120;
const MAX_REAL_MS = 250;
const EPS = 1e-9;

let speed = 1;
let acc = 0; // ticks accumulated toward the next one
let accRun: Run | null = null;

/** Test-hook only: simulated ticks per real tick. */
export function setSpeed(n: number): void {
  speed = n;
}

/** Simulated ticks per real tick, for animations that keep pace with the simulation; a replay runs faster. */
export function getSpeed(): number {
  return speed * (useGame.getState().replaying ? REPLAY_SPEED : 1);
}

function pushHistory(history: Record<string, number[]>, snap: Snapshot): void {
  for (const [node, view] of Object.entries(snap.nodes)) {
    for (const [metric, v] of Object.entries(view)) {
      if (typeof v !== 'number') continue;
      const key = `${node}.${metric}`;
      const list = history[key] ?? (history[key] = []);
      list.push(v);
      if (list.length > HISTORY) list.shift();
    }
  }
}

/** Accumulates real time and steps whole ticks at ticksPerSecond x speed. */
export function advance(realDtMs: number): void {
  const s = useGame.getState();
  const run = s.run;
  if (!run || !s.caseId) return;
  if (run !== accRun) {
    accRun = run;
    acc = 0;
  }
  if (s.paused || run.snapshot.status !== 'running') return;
  const tps = tickRate(s.caseId);
  acc += (Math.min(Math.max(realDtMs, 0), MAX_REAL_MS) / 1000) * tps * speed * (s.replaying ? REPLAY_SPEED : 1);

  let whole = Math.floor(acc + EPS);
  if (whole < 1) {
    useGame.setState({ alpha: Math.min(acc, 1) });
    return;
  }
  const history = { ...s.history };
  for (const k of Object.keys(history)) history[k] = [...history[k]!];
  let prev = s.prev;
  while (whole > 0 && run.snapshot.status === 'running') {
    prev = run.snapshot;
    run.step(1);
    // a replay's inputs land at their tick, before anything else sees it
    if (s.replaying) feedReplay();
    pushHistory(history, run.snapshot);
    offerTick(run);
    whole--;
    acc -= 1;
  }
  if (run.snapshot.status !== 'running') acc = 0;
  useGame.setState({ prev, history, ...view(run), alpha: Math.min(Math.max(acc, 0), 1) });
}

function tickRate(caseId: string): number {
  const c = cases[caseId];
  if (!c) throw new Error(`unknown case "${caseId}"`);
  return c.ticksPerSecond;
}
/**
 * Hiding the tab during play pauses with reason 'hidden'; showing it again never
 * resumes. Behind a menu nothing is being played, so the city there keeps moving.
 */
export function onVisibility(hidden: boolean): void {
  const s = useGame.getState();
  if (hidden && !s.paused && s.screen === 'play') s.setPaused(true, 'hidden');
}

/**
 * requestAnimationFrame driver plus the visibility handler. Browser only.
 * While `idle()` says so (the window is too narrow to play), no time passes in the run.
 */
export function startLoop(idle: () => boolean = () => false): () => void {
  let raf = 0;
  let last: number | null = null;
  const frame = (t: number) => {
    if (last !== null && !idle()) advance(t - last);
    last = t;
    raf = requestAnimationFrame(frame);
  };
  const onChange = () => onVisibility(document.hidden);
  raf = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onChange);
  };
}
