import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cases } from '../cases';
import { useLiveSettings } from '../cast/settings';
import { advance } from './loop';
import { MAX_LINK, decodeRun, encodeRun } from './share';
import type { SharedRun } from './share';
import { useGame } from './store';

const c = cases['edge-rule']!;
const g = () => useGame.getState();
/** base64url of UTF-8 text */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const link = (run: object) => b64(JSON.stringify(run));
const base = { v: 1, c: c.id, cv: c.version, s: c.seed };

/** Decodes, and where the link decodes, watches it and skips to the end; returns the decode result. */
function openAndSkip(fragment: string) {
  const r = decodeRun(fragment, cases);
  if (!r.ok) return r;
  g().watch(r.run);
  g().skipReplay();
  expect(g().screen).toBe('debrief');
  expect(g().snap!.status).not.toBe('running');
  expect(g().snap!.tick).toBeLessThanOrEqual(c.maxTicks);
  return r;
}

describe('hostile replay links never hang, throw or run away', () => {
  it('a single input at the last safe integer tick is refused (past the end of the case)', () => {
    const r = openAndSkip(link({ ...base, i: [[Number.MAX_SAFE_INTEGER, 'h']] }));
    expect(r).toEqual({ ok: false, reason: 'malformed' });
  }, 2_000);

  it('an input at the case\'s last tick still decodes and plays to the end', () => {
    const r = openAndSkip(link({ ...base, i: [[c.maxTicks, 'h']] }));
    expect(r.ok).toBe(true);
  }, 2_000);

  for (const s of [0, -1, 2 ** 40, 2 ** 53 - 1, -(2 ** 53 - 1)]) {
    it(`seed ${s}`, () => {
      const r = openAndSkip(link({ ...base, s, i: [] }));
      // the simulation's generator keeps 32 bits of a seed; anything wider would only alias a smaller one
      if (Math.abs(s) < 2 ** 31) expect(r.ok).toBe(true);
      else expect(r).toEqual({ ok: false, reason: 'malformed' });
    }, 2_000);
  }

  it('2,000 inputs all at tick 0', () => {
    const kinds: SharedRun['i'] = [[0, 'h'], [0, 'a', 'filter_off'], [0, 'o', 'ask:netops:volume'], [0, 'u', 'investigating'], [0, 'o', 'changes']];
    const i = Array.from({ length: 2_000 }, (_, n) => kinds[n % kinds.length]!);
    const run: SharedRun = { ...base, v: 1, i };
    // even the shortest input takes eight characters, so 2,000 of them never fit in a link
    expect(openAndSkip(link(run))).toEqual({ ok: false, reason: 'too_long' });
    // the store copes with them anyway, should a longer link ever be allowed
    g().watch(run);
    g().skipReplay();
    expect(g().screen).toBe('debrief');
    expect(g().run!.inputs.length).toBe(2_000);
    // each repeated question and update says its lines once per input at most
    expect(g().chat.length).toBeLessThanOrEqual(2 * 2_000);
    // and the largest link that does fit: as many hints at tick 0 as the limit allows
    const most = Math.floor((MAX_LINK * 3) / 4 / 8) - 10;
    const fits = link({ ...base, i: Array.from({ length: most }, () => [0, 'h']) });
    expect(fits.length).toBeLessThanOrEqual(MAX_LINK);
    expect(openAndSkip(fits).ok).toBe(true);
  }, 2_000);

  it('deeply nested JSON', () => {
    const depth = 5_000;
    const nested = '['.repeat(depth) + ']'.repeat(depth);
    for (const text of [nested, `{"v":1,"c":"edge-rule","cv":1,"s":1,"i":${'['.repeat(4_000)}${']'.repeat(4_000)}}`]) {
      const data = b64(text);
      expect(data.length).toBeLessThanOrEqual(MAX_LINK);
      expect(openAndSkip(data)).toEqual({ ok: false, reason: 'malformed' });
    }
  }, 2_000);

  it('15,999 characters of base64url junk', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let x = 12345;
    const junk = Array.from({ length: 15_999 }, () => alphabet[(x = (x * 1103515245 + 12345) & 0x7fffffff) % 64]).join('');
    expect(openAndSkip(junk).ok).toBe(false);
  }, 2_000);
});

describe('watching a replay with live characters on', () => {
  const fetchStub = vi.fn(() => Promise.reject(new Error('no network in tests')));
  beforeEach(() => {
    // the game's own cast factory (nothing in this file replaces it), with a key in and live characters on
    useLiveSettings.getState().change({ provider: 'anthropic', key: 'sk-dummy-0000', live: true });
    vi.stubGlobal('fetch', fetchStub);
    fetchStub.mockClear();
  });
  afterEach(() => {
    useLiveSettings.getState().forget();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('makes no network request from watch() to the end of the run', async () => {
    const inputs = [
      { tick: 0, kind: 'observe' as const, route: '' },
      { tick: 300, kind: 'observe' as const, route: 'ask:netops:volume' },
      { tick: 330, kind: 'hint' as const },
      { tick: 480, kind: 'act' as const, id: 'filter_off' },
      { tick: 490, kind: 'update' as const, id: 'cause_found' },
    ];
    const r = decodeRun(encodeRun(c.id, c.version, c.seed, inputs), cases);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    g().watch(r.run);
    for (let n = 0; n < 200 && g().snap!.status === 'running'; n++) advance(250);
    g().skipReplay();
    // anything the cast might still have queued
    await new Promise((done) => setTimeout(done, 20));
    for await (const _ of g().review()) void _;
    g().finish();
    expect(g().snap!.status).not.toBe('running');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('control: the same setup in a played run sends a free-text question to the stub', async () => {
    // the failed request falls back to the scripted line and warns; keep the output clean
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    g().start(c.id);
    await g().ask('netops', null, 'Is anything odd about the traffic?');
    g().finish();
    expect(fetchStub).toHaveBeenCalled();
  });
});
