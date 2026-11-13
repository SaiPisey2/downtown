import { create } from 'zustand';
import { cases } from '../cases';
import { createRun } from '../sim';
import type { GameEvent, NodeId, Run, Snapshot } from '../sim';

export interface GameState {
  screen: 'title' | 'briefing' | 'play' | 'debrief';
  caseId: string | null;
  run: Run | null;
  prev: Snapshot | null;
  snap: Snapshot | null;
  /** fraction (0..1) of the next tick already accumulated */
  alpha: number;
  paused: boolean;
  pauseReason: 'user' | 'hidden' | null;
  selected: NodeId | null;
  /** bumped by every select(), so selecting the selected building again still re-centres the camera */
  selectSeq: number;
  /** calmer board: no smoke or pulsing, slower dots (the OS setting applies as well) */
  reducedMotion: boolean;
  /** last 120 values per `${node}.${metric}`, one per simulated tick */
  history: Record<string, number[]>;
  log: readonly GameEvent[];
  /** ids of clues found so far */
  found: string[];
  lastAction: { id: string; ok: boolean; reason?: string } | null;
  lastHint: { clueId: string | null; text: string | null } | null;
  start(caseId: string, seed?: number): void;
  act(id: string): void;
  observe(route: string): void;
  update(id: string): void;
  hint(): void;
  setPaused(p: boolean, reason?: 'user' | 'hidden'): void;
  select(id: NodeId | null): void;
  setReducedMotion(on: boolean): void;
  finish(): void;
}

type RunView = Pick<GameState, 'snap' | 'log' | 'found'>;

/** What components read from a run: the current snapshot, the log, and the clues found. */
function view(run: Run): RunView {
  const log = [...run.log];
  const found = log.flatMap((e) => (e.type === 'clue' ? [e.clueId] : []));
  return { snap: run.snapshot, log, found };
}

export const useGame = create<GameState>()((set, get) => ({
  screen: 'title',
  caseId: null,
  run: null,
  prev: null,
  snap: null,
  alpha: 0,
  paused: false,
  pauseReason: null,
  selected: null,
  selectSeq: 0,
  reducedMotion: false,
  history: {},
  log: [],
  found: [],
  lastAction: null,
  lastHint: null,

  start(caseId, seed) {
    const c = cases[caseId];
    if (!c) throw new Error(`unknown case "${caseId}"`);
    const run = createRun(c, seed ?? c.seed);
    set({
      screen: 'play',
      caseId,
      run,
      prev: null,
      alpha: 0,
      paused: false,
      pauseReason: null,
      selected: null,
      history: {},
      lastAction: null,
      lastHint: null,
      ...view(run),
    });
  },
  act(id) {
    const run = get().run;
    if (!run) return;
    const r = run.act(id);
    set({ lastAction: r.ok ? { id, ok: true } : { id, ok: false, reason: r.reason }, ...view(run) });
  },
  observe(route) {
    const run = get().run;
    if (!run) return;
    run.observe(route);
    set(view(run));
  },
  update(id) {
    const run = get().run;
    if (!run) return;
    run.update(id);
    set(view(run));
  },
  hint() {
    const run = get().run;
    if (!run) return;
    const c = run.hint();
    set({ lastHint: { clueId: c?.id ?? null, text: c?.text ?? null }, ...view(run) });
  },
  setPaused(p, reason = 'user') {
    set(p ? { paused: true, pauseReason: reason } : { paused: false, pauseReason: null });
  },
  select(id) {
    set((s) => ({ selected: id, selectSeq: s.selectSeq + 1 }));
  },
  setReducedMotion(on) {
    set({ reducedMotion: on });
  },
  finish() {
    set({ screen: 'debrief' });
  },
}));
