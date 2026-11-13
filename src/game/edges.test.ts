import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cases } from '../cases';
import { TUTORIAL_CASE, tutorialDone } from './flow';
import { decodeRun, encodeRun } from './share';
import { initialReducedMotion, useGame } from './store';

/** A tab's sessionStorage, in memory. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('finish()', () => {
  it('does not mark the tutorial done when the viewer only watched a replay of it', () => {
    const c = cases[TUTORIAL_CASE]!;
    const r = decodeRun(encodeRun(c.id, c.version, c.seed, []), cases);
    if (!r.ok) throw new Error(r.reason);
    useGame.getState().watch(r.run);
    const run = useGame.getState().run!;
    while (run.snapshot.status === 'running') run.step(1);
    useGame.setState({ snap: run.snapshot });
    useGame.getState().finish();
    expect(useGame.getState().screen).toBe('debrief');
    expect(tutorialDone()).toBe(false);
  });

  it('marks it done after a played tutorial', () => {
    useGame.getState().start(TUTORIAL_CASE);
    useGame.getState().finish();
    expect(tutorialDone()).toBe(true);
  });
});

describe('reduce motion', () => {
  const media = (reduce: boolean) =>
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }));

  it('defaults to the system preference', () => {
    media(true);
    expect(initialReducedMotion()).toBe(true);
    media(false);
    expect(initialReducedMotion()).toBe(false);
  });

  it("remembers the player's choice for the tab, over the system preference", () => {
    media(true);
    useGame.getState().setReducedMotion(false);
    expect(useGame.getState().reducedMotion).toBe(false);
    expect(initialReducedMotion()).toBe(false);
    media(false);
    useGame.getState().setReducedMotion(true);
    expect(initialReducedMotion()).toBe(true);
  });

  it('works when storage is refused', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    });
    media(true);
    expect(initialReducedMotion()).toBe(true);
    expect(() => useGame.getState().setReducedMotion(false)).not.toThrow();
    expect(useGame.getState().reducedMotion).toBe(false);
  });
});
