import { create } from 'zustand';
import { cases } from '../cases';
import { makeCast } from '../cast';
import type { Cast, ChatLine } from '../cast';
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
  /** bumped by goHome(); the camera eases back to the home view */
  homeSeq: number;
  /** calmer board: no smoke or pulsing, slower dots (the OS setting applies as well) */
  reducedMotion: boolean;
  /** last 120 values per `${node}.${metric}`, one per simulated tick */
  history: Record<string, number[]>;
  log: readonly GameEvent[];
  /** ids of clues found so far */
  found: string[];
  lastAction: { id: string; ok: boolean; reason?: string } | null;
  lastHint: { clueId: string | null; text: string | null } | null;
  /** every line said this run, all characters, oldest first */
  chat: ChatLine[];
  start(caseId: string, seed?: number): void;
  act(id: string): void;
  observe(route: string): void;
  update(id: string): void;
  hint(): void;
  /** asks a character one of their questions; resolves once the answer has arrived in full */
  ask(castId: string, questionId: string): Promise<void>;
  /** a line from the player, to a character when `to` is given */
  say(text: string, to?: string): void;
  setPaused(p: boolean, reason?: 'user' | 'hidden'): void;
  select(id: NodeId | null): void;
  goHome(): void;
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

/** The cast of the current run, made by start(); module state so it can be swapped by the cast factory. */
let cast: Cast | null = null;
/** how many log events the cast has been offered */
let offered = 0;
/** cast replies, kept in event order even when a reply takes time */
let replies: Promise<void> = Promise.resolve();
let nextLineId = 1;

function addLine(line: Omit<ChatLine, 'id'>): number {
  const id = nextLineId++;
  useGame.setState((s) => ({ chat: [...s.chat, { ...line, id }] }));
  return id;
}

function patchLine(id: number, patch: Partial<ChatLine>): void {
  useGame.setState((s) => ({ chat: s.chat.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
}

/**
 * Called by the loop after every simulated tick: offers the cast each log event
 * since the last offer, in order, then the tick itself, and appends what it says.
 * The only place events reach the cast.
 */
export function offerTick(run: Run): void {
  const me = cast;
  if (!me || run !== useGame.getState().run) return;
  const events = run.log.slice(offered);
  offered = run.log.length;
  const snap = run.snapshot;
  replies = replies
    .then(async () => {
      const out: ChatLine[] = [];
      for (const e of events) out.push(...(await me.onEvent(e, snap)));
      if (me.onTick) out.push(...(await me.onTick(snap)));
      if (cast !== me) return;
      for (const l of out) addLine({ tick: l.tick, from: l.from, to: l.to, text: l.text });
    })
    .catch((err: unknown) => console.error('the cast failed to reply', err));
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
  homeSeq: 0,
  reducedMotion: false,
  history: {},
  log: [],
  found: [],
  lastAction: null,
  lastHint: null,
  chat: [],

  start(caseId, seed) {
    const c = cases[caseId];
    if (!c) throw new Error(`unknown case "${caseId}"`);
    const run = createRun(c, seed ?? c.seed);
    cast = makeCast(c);
    offered = 0;
    replies = Promise.resolve();
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
      chat: [],
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
    const s = get();
    const run = s.run;
    const c = s.caseId ? cases[s.caseId] : undefined;
    const u = c?.updates.find((x) => x.id === id);
    if (!run || !c || !u || run.snapshot.status !== 'running') return;
    s.say(u.label, c.cast.find((m) => m.role === 'stakeholder')?.id);
    run.update(id);
    set(view(run));
  },
  hint() {
    const run = get().run;
    if (!run) return;
    const c = run.hint();
    set({ lastHint: { clueId: c?.id ?? null, text: c?.text ?? null }, ...view(run) });
  },
  async ask(castId, questionId) {
    const s = get();
    const run = s.run;
    const me = cast;
    const c = s.caseId ? cases[s.caseId] : undefined;
    const q = c?.cast.find((m) => m.id === castId)?.questions.find((x) => x.id === questionId);
    if (!run || !me || !c || !q || run.snapshot.status !== 'running') return;
    if (s.chat.some((l) => l.live && l.from === castId)) return; // one answer at a time
    const tick = run.snapshot.tick;
    s.say(q.label, castId);
    const ctx = { c, snap: run.snapshot, found: [...s.found], chat: get().chat };
    const id = addLine({ tick, from: castId, text: '', live: true });
    let text = '';
    try {
      for await (const chunk of me.ask(castId, questionId, null, ctx)) {
        if (cast !== me) return;
        text += chunk;
        patchLine(id, { text });
      }
    } finally {
      if (cast === me) patchLine(id, { live: false });
    }
    if (q.reveals && !get().found.includes(q.reveals)) get().observe(`ask:${castId}:${questionId}`);
  },
  say(text, to) {
    const tick = get().snap?.tick ?? 0;
    addLine(to === undefined ? { tick, from: 'you', text } : { tick, from: 'you', to, text });
  },
  setPaused(p, reason = 'user') {
    set(p ? { paused: true, pauseReason: reason } : { paused: false, pauseReason: null });
  },
  select(id) {
    set((s) => ({ selected: id, selectSeq: s.selectSeq + 1 }));
  },
  goHome() {
    set((s) => ({ homeSeq: s.homeSeq + 1 }));
  },
  setReducedMotion(on) {
    set({ reducedMotion: on });
  },
  finish() {
    set({ screen: 'debrief' });
  },
}));
