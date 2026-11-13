import { beforeEach, describe, expect, it } from 'vitest';
import { cases } from '../cases';
import { advance, onVisibility, setSpeed } from './loop';
import { useGame } from './store';

// Two derived cases: one at 4 ticks per second, one whose rollback lands after 20 ticks.
const base = cases.tutorial!;
cases.slow4 = { ...base, id: 'slow4', ticksPerSecond: 4 };
cases.delay20 = {
  ...base,
  id: 'delay20',
  ticksPerSecond: 4,
  maxTicks: 100_000,
  lose: { maxFailedRequests: 1e12 },
  actions: base.actions.map((a) => (a.id === 'rollback' ? { ...a, delayTicks: 20 } : a)),
};

const tick = () => useGame.getState().snap!.tick;
const hours = (h: number) => {
  for (let ms = 0; ms < h * 3_600_000; ms += 250) advance(250);
};

beforeEach(() => {
  setSpeed(1);
  useGame.getState().start('slow4');
});

describe('advance', () => {
  it('steps exactly 4 ticks over 1,000 ms at 4 ticks per second', () => {
    for (let i = 0; i < 10; i++) advance(100);
    expect(tick()).toBe(4);
    expect(useGame.getState().alpha).toBeCloseTo(0, 6);
  });

  it('leaves alpha at 0.5 after 125 ms and moves no tick', () => {
    const before = useGame.getState().snap;
    advance(125);
    expect(tick()).toBe(0);
    expect(useGame.getState().snap).toBe(before);
    expect(useGame.getState().alpha).toBeCloseTo(0.5, 6);
  });

  it('caps one call at 250 ms: 5,000 ms is one tick at 4 ticks per second', () => {
    advance(5000);
    expect(tick()).toBe(1);
  });

  it('does not step while paused, and resumes where it left off', () => {
    useGame.getState().setPaused(true, 'user');
    advance(250);
    advance(250);
    expect(tick()).toBe(0);
    useGame.getState().setPaused(false);
    expect(useGame.getState().pauseReason).toBeNull();
    advance(250);
    expect(tick()).toBe(1);
  });

  it('keeps prev as the snapshot before the latest tick', () => {
    advance(250);
    advance(250);
    const s = useGame.getState();
    expect(s.prev!.tick).toBe(1);
    expect(s.snap!.tick).toBe(2);
  });

  it('scales with the speed multiplier', () => {
    setSpeed(4);
    advance(250);
    expect(tick()).toBe(4);
  });

  it('keeps the last 120 values per node metric, one per tick', () => {
    useGame.getState().start('delay20');
    for (let i = 0; i < 200; i++) advance(250);
    const h = useGame.getState().history;
    expect(h['shop.latencyMs']).toHaveLength(120);
    expect(h['gate.arrivals']).toHaveLength(120);
  });

  it('stops stepping once the run ends', () => {
    useGame.getState().start('slow4');
    for (let i = 0; i < 5000; i++) advance(250);
    const s = useGame.getState();
    expect(s.snap!.status).not.toBe('running');
    const t = s.snap!.tick;
    advance(250);
    expect(tick()).toBe(t);
    expect(s.screen).toBe('play');
  });
});

describe('pause', () => {
  it('a hidden pause survives the tab becoming visible', () => {
    onVisibility(true);
    expect(useGame.getState().paused).toBe(true);
    expect(useGame.getState().pauseReason).toBe('hidden');
    onVisibility(false);
    expect(useGame.getState().paused).toBe(true);
    advance(250);
    expect(tick()).toBe(0);
  });

  it('hiding does not overwrite a user pause', () => {
    useGame.getState().setPaused(true, 'user');
    onVisibility(true);
    expect(useGame.getState().pauseReason).toBe('user');
  });

  it('review focus 1: a pause of an hour does not shift when an action lands', () => {
    useGame.getState().start('delay20');
    for (let i = 0; i < 100; i++) advance(250);
    expect(tick()).toBe(100);
    useGame.getState().act('rollback');
    expect(useGame.getState().lastAction).toEqual({ id: 'rollback', ok: true });
    expect(useGame.getState().snap!.pending).toHaveLength(1);
    useGame.getState().setPaused(true, 'user');
    hours(1);
    expect(tick()).toBe(100);
    useGame.getState().setPaused(false);
    for (let i = 0; i < 20; i++) advance(250);
    const landed = useGame.getState().log.find((e) => e.type === 'action_landed');
    expect(landed?.tick).toBe(120);
  });
});

describe('store', () => {
  it('throws on an unknown case and resets state on start', () => {
    expect(() => useGame.getState().start('nope')).toThrow();
    advance(250);
    useGame.getState().select('shop');
    useGame.getState().start('slow4');
    const s = useGame.getState();
    expect(s.screen).toBe('play');
    expect(s.caseId).toBe('slow4');
    expect(s.snap!.tick).toBe(0);
    expect(s.selected).toBeNull();
    expect(s.paused).toBe(false);
    expect(s.history).toEqual({});
    expect(s.log).toEqual([]);
  });

  it('records rejected actions and refreshes snap and log at once', () => {
    useGame.getState().act('rollback');
    useGame.getState().act('rollback');
    const s = useGame.getState();
    expect(s.lastAction).toEqual({ id: 'rollback', ok: false, reason: 'already_pending' });
    expect(s.log.some((e) => e.type === 'action_rejected')).toBe(true);
  });

  it('observe adds found clue ids; hint records its result; finish goes to debrief', () => {
    for (let i = 0; i < 40; i++) advance(250);
    const clue = cases.slow4!.clues[0]!;
    useGame.getState().observe(clue.route);
    useGame.getState().hint();
    const s = useGame.getState();
    expect(s.lastHint).not.toBeNull();
    for (const e of s.log) if (e.type === 'clue') expect(s.found).toContain(e.clueId);
    s.finish();
    expect(useGame.getState().screen).toBe('debrief');
  });
});
