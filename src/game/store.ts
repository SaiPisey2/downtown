import { create } from 'zustand';
import { answerFor, cases } from '../cases';
import { cleanText, makeCast, scriptedCast } from '../cast';
import type { Cast, CastHooks, ChatLine } from '../cast';
import { createRun } from '../sim';
import type { GameEvent, NodeId, PlayerInput, Run, Snapshot } from '../sim';
import { MAIN_CASE, TUTORIAL_CASE, markTutorialDone } from './flow';
import { sharedInputs } from './share';
import type { SharedRun } from './share';

/** A plain-words message on the title screen, after a replay link could not be used. */
export interface TitleNotice {
  text: string;
  /** offered as "Play it fresh" when the link was for an older version of a case we have */
  fresh?: string;
}

export interface GameState {
  screen: 'title' | 'briefing' | 'play' | 'debrief';
  caseId: string | null;
  /** the run on screen is a shared run being rebuilt; every player control is off */
  replaying: boolean;
  notice: TitleNotice | null;
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
  /** the reviewer's comments on the finished run, as they arrive; never part of the score */
  reviewText: string;
  reviewState: 'idle' | 'streaming' | 'done' | 'failed';
  /** The title screen, with the main case running healthy behind it. */
  showTitle(notice?: TitleNotice): void;
  /** The briefing for a case, with that case running healthy behind it. */
  brief(caseId: string): void;
  start(caseId: string, seed?: number): void;
  /** Rebuilds a shared run on the play screen at replay speed, with scripted lines only. */
  watch(run: SharedRun): void;
  /** Runs a replay to its end at once and opens its debrief. */
  skipReplay(): void;
  act(id: string): void;
  observe(route: string): void;
  update(id: string): void;
  hint(): void;
  /**
   * Asks a character one of their questions, or (with `questionId` null) says
   * something of the player's own to them. Resolves once the answer has arrived
   * in full; never rejects.
   */
  ask(castId: string, questionId: string | null, freeText?: string): Promise<void>;
  /** the reviewer's comments once the run is over, streamed; also kept in reviewText. Never throws. */
  review(): AsyncIterable<string>;
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
/** the line now being written by each character; an older answer still arriving stops when it is replaced */
const writing = new Map<string, number>();

/** Inputs of the replay still to be fed, oldest first. */
let replayQueue: PlayerInput[] = [];

/** Ticks of healthy running shown behind the title and the briefing, always before the first trouble. */
const PREVIEW_TICKS = 20;

/** A run of the case a few ticks in, before anything goes wrong: the city as it looks on a quiet day. */
function healthy(caseId: string): Snapshot {
  const c = cases[caseId];
  if (!c) throw new Error(`unknown case "${caseId}"`);
  const firstTrouble = Math.min(...c.timeline.filter((e) => e.kind !== 'message').map((e) => e.at), c.maxTicks);
  const run = createRun(c, c.seed);
  run.step(Math.max(1, Math.min(PREVIEW_TICKS, firstTrouble - 2)));
  return run.snapshot;
}

/** Everything a run leaves in the store, cleared. */
const NO_RUN = {
  run: null,
  prev: null,
  alpha: 0,
  paused: false,
  pauseReason: null,
  selected: null,
  history: {},
  log: [],
  found: [],
  lastAction: null,
  lastHint: null,
  chat: [],
  reviewText: '',
  reviewState: 'idle',
  replaying: false,
} satisfies Partial<GameState>;

function dropCast(): void {
  cast?.stop?.();
  cast = null;
  replayQueue = [];
}

/**
 * Applies the replay's inputs that are due at the run's current tick, as
 * replay() does: an input is applied once the run has reached its tick, and
 * inputs after the end of the run are dropped. Called by the loop after every
 * tick of a replay. Each input goes straight to the run, so nothing the viewer
 * does can add to it; the player's own lines are shown as they were said.
 */
export function feedReplay(): void {
  const s = useGame.getState();
  const run = s.run;
  const c = s.caseId ? cases[s.caseId] : undefined;
  if (!s.replaying || !run || !c) return;
  let fed = false;
  while (replayQueue.length > 0 && replayQueue[0]!.tick <= run.snapshot.tick) {
    const input = replayQueue.shift()!;
    fed = true;
    const tick = run.snapshot.tick;
    switch (input.kind) {
      case 'act': run.act(input.id); break;
      case 'hint': run.hint(); break;
      case 'update': {
        const u = c.updates.find((x) => x.id === input.id);
        const boss = c.cast.find((m) => m.role === 'stakeholder');
        if (u && run.snapshot.status === 'running') addLine({ tick, from: 'you', ...(boss ? { to: boss.id } : {}), text: u.label });
        run.update(input.id);
        break;
      }
      case 'observe': {
        // a question asked in the chat: show it and its written answer
        const [ask, castId = '', qId = ''] = input.route.split(':');
        const member = ask === 'ask' ? c.cast.find((m) => m.id === castId) : undefined;
        const q = member?.questions.find((x) => x.id === qId);
        if (member && q && run.snapshot.status === 'running') {
          addLine({ tick, from: 'you', to: member.id, text: q.label });
          addLine({ tick, from: member.id, text: answerFor(c, member.id, q.id, run.snapshot) });
        }
        run.observe(input.route);
        break;
      }
    }
  }
  if (run.snapshot.status !== 'running') replayQueue = [];
  if (fed) useGame.setState(view(run));
}

/** Longest free-text line the player can send. */
export const MAX_SAY = 300;

function addLine(line: Omit<ChatLine, 'id'>): number {
  const id = nextLineId++;
  useGame.setState((s) => ({ chat: [...s.chat, { ...line, id }] }));
  return id;
}

function patchLine(id: number, patch: Partial<ChatLine>): void {
  useGame.setState((s) => ({ chat: s.chat.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
}

function dropLine(id: number): void {
  useGame.setState((s) => ({ chat: s.chat.filter((l) => l.id !== id) }));
}

/** What the store lets a cast do besides answering: notices land in the thread, for the run that made them only. */
function hooksFor(me: () => Cast | null): CastHooks {
  return {
    notice(castId, text) {
      if (cast !== me()) return;
      addLine({ tick: useGame.getState().snap?.tick ?? 0, from: 'system', to: castId, text: cleanText(text) });
    },
  };
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
  // the run is over: nothing still being asked is worth waiting for
  if (events.some((e) => e.type === 'won' || e.type === 'lost')) me.stop?.();
}

export const useGame = create<GameState>()((set, get) => ({
  screen: 'title',
  caseId: null,
  replaying: false,
  notice: null,
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
  reviewText: '',
  reviewState: 'idle',

  showTitle(notice) {
    dropCast();
    const snap = healthy(MAIN_CASE);
    set({ ...NO_RUN, screen: 'title', caseId: MAIN_CASE, snap, notice: notice ?? null });
  },
  brief(caseId) {
    dropCast();
    const snap = healthy(caseId);
    set({ ...NO_RUN, screen: 'briefing', caseId, snap, notice: null });
  },
  watch(shared) {
    const c = cases[shared.c];
    if (!c) throw new Error(`unknown case "${shared.c}"`);
    dropCast();
    const run = createRun(c, shared.s);
    // scripted lines only: a replay never reaches the live cast or any provider
    cast = scriptedCast(c);
    offered = 0;
    replies = Promise.resolve();
    writing.clear();
    set({ ...NO_RUN, screen: 'play', caseId: c.id, run, notice: null, replaying: true, ...view(run) });
    replayQueue = sharedInputs(shared);
    feedReplay();
  },
  skipReplay() {
    const s = get();
    const run = s.run;
    if (!s.replaying || !run) return;
    feedReplay();
    while (run.snapshot.status === 'running') {
      run.step(1);
      feedReplay();
    }
    set({ ...view(run), prev: null, screen: 'debrief' });
  },
  start(caseId, seed) {
    const c = cases[caseId];
    if (!c) throw new Error(`unknown case "${caseId}"`);
    const run = createRun(c, seed ?? c.seed);
    cast?.stop?.();
    replayQueue = [];
    let made: Cast | null = null;
    made = makeCast(c, hooksFor(() => made));
    cast = made;
    offered = 0;
    replies = Promise.resolve();
    writing.clear();
    set({
      screen: 'play',
      caseId,
      replaying: false,
      notice: null,
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
      reviewText: '',
      reviewState: 'idle',
      ...view(run),
    });
  },
  act(id) {
    const run = get().run;
    if (!run || get().replaying) return;
    const r = run.act(id);
    set({ lastAction: r.ok ? { id, ok: true } : { id, ok: false, reason: r.reason }, ...view(run) });
  },
  observe(route) {
    const run = get().run;
    if (!run || get().replaying) return;
    run.observe(route);
    set(view(run));
  },
  update(id) {
    const s = get();
    const run = s.run;
    const c = s.caseId ? cases[s.caseId] : undefined;
    const u = c?.updates.find((x) => x.id === id);
    if (!run || !c || !u || run.snapshot.status !== 'running' || s.replaying) return;
    s.say(u.label, c.cast.find((m) => m.role === 'stakeholder')?.id);
    run.update(id);
    set(view(run));
  },
  hint() {
    const run = get().run;
    if (!run || get().replaying) return;
    const c = run.hint();
    set({ lastHint: { clueId: c?.id ?? null, text: c?.text ?? null }, ...view(run) });
  },
  async ask(castId, questionId, freeText) {
    const s = get();
    const run = s.run;
    const me = cast;
    const c = s.caseId ? cases[s.caseId] : undefined;
    const member = c?.cast.find((m) => m.id === castId);
    if (!run || !me || !c || !member || run.snapshot.status !== 'running' || s.replaying) return;
    const q = questionId === null ? undefined : member.questions.find((x) => x.id === questionId);
    if (questionId !== null && !q) return;
    const said = q ? q.label : cleanText((freeText ?? '').trim(), MAX_SAY).trim();
    if (!said) return;
    // a question waits for the answer before it; free text takes over from it
    if (q && s.chat.some((l) => l.live && l.from === castId)) return;

    // the answer and the clue are both decided now, against this one snapshot
    const snap = run.snapshot;
    const tick = snap.tick;
    const fallback = q ? answerFor(c, castId, q.id, snap) : (c.lines[`busy_${castId}`] ?? '');
    s.say(said, castId);
    if (q?.reveals && !get().found.includes(q.reveals)) get().observe(`ask:${castId}:${q.id}`);

    const ctx = { c, snap, found: [...get().found], chat: get().chat };
    const id = addLine({ tick, from: castId, text: '', live: true });
    writing.set(castId, id);
    const current = () => cast === me && writing.get(castId) === id;
    let text = '';
    let failed = false;
    try {
      for await (const chunk of me.ask(castId, q ? q.id : null, q ? null : said, ctx)) {
        if (!current()) break;
        text += chunk;
        patchLine(id, { text });
      }
    } catch (err) {
      failed = true;
      if (current()) console.warn('the cast failed to answer; using the scripted line', err);
    }
    if (cast !== me) return;
    const replaced = writing.get(castId) !== id;
    if (!replaced) writing.delete(castId);
    // never an empty line left behind: a failed or silent answer becomes the scripted line
    const final = replaced ? text : failed || text === '' ? fallback || text : text;
    if (final === '') dropLine(id);
    else patchLine(id, { text: final, live: false });
  },
  review() {
    const me = cast;
    const s = get();
    const run = s.run;
    const c = s.caseId ? cases[s.caseId] : undefined;
    const review = me?.review;
    if (!me || !review || !run || !c || s.replaying || run.snapshot.status === 'running' || s.reviewState !== 'idle') {
      return (async function* () {})();
    }
    const ctx = { c, final: run.snapshot, log: [...run.log], chat: s.chat };
    return (async function* () {
      // the state changes only once someone reads: a review asked for and never read stays idle
      if (cast !== me || get().reviewState !== 'idle') return;
      set({ reviewState: 'streaming', reviewText: '' });
      let text = '';
      let failed = false;
      try {
        for await (const chunk of review(ctx)) {
          if (cast !== me) return;
          text += chunk;
          set({ reviewText: text });
          yield chunk;
        }
      } catch {
        failed = true;
      } finally {
        // also when the reader stops early: the state never stays 'streaming'
        if (cast === me) set({ reviewState: failed || !text.trim() ? 'failed' : 'done' });
      }
    })();
  },
  say(text, to) {
    if (get().replaying) return;
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
    if (get().caseId === TUTORIAL_CASE) markTutorialDone();
    set({ screen: 'debrief' });
  },
}));
