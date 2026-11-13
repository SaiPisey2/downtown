import { describe, expect, it } from 'vitest';
import { playScript } from '../../test/bot/bot';
import type { ScriptStep } from '../../test/bot/bot';
import { cases } from '../cases';
import { replay, score } from '../sim';
import type { PlayerInput } from '../sim';
import { MAX_INPUTS, MAX_LINK, decodeRun, encodeRun, sharedInputs } from './share';

const c = cases['edge-rule']!;

const INPUTS: PlayerInput[] = [
  { tick: 0, kind: 'observe', route: '' },
  { tick: 250, kind: 'update', id: 'investigating' },
  { tick: 300, kind: 'observe', route: 'graph:edge.saturation' },
  { tick: 300, kind: 'hint' },
  { tick: 360, kind: 'observe', route: 'changes' },
  { tick: 480, kind: 'act', id: 'filter_off' },
  { tick: 481, kind: 'act', id: 'filter_off' },
  { tick: 482, kind: 'act', id: 'no_such_action' },
];

/** base64url of UTF-8 text, as the encoder makes it */
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

describe('encodeRun / decodeRun', () => {
  it('round-trips, keeping rejected acts and empty observes exactly as recorded', () => {
    const data = encodeRun('edge-rule', 1, 1907, INPUTS);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    const r = decodeRun(data, cases);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.run).toEqual({
      v: 1,
      c: 'edge-rule',
      cv: 1,
      s: 1907,
      i: [
        [0, 'o', ''],
        [250, 'u', 'investigating'],
        [300, 'o', 'graph:edge.saturation'],
        [300, 'h'],
        [360, 'o', 'changes'],
        [480, 'a', 'filter_off'],
        [481, 'a', 'filter_off'],
        [482, 'a', 'no_such_action'],
      ],
    });
    expect(sharedInputs(r.run)).toEqual(INPUTS);
  });

  it('turns bad data into reasons and never throws', () => {
    const cases_: [string, string][] = [
      ['garbage text', 'not base64 at all!'],
      ['base64 of non-JSON', b64('hello, this is not json')],
      ['JSON with an extra field', b64(JSON.stringify({ v: 1, c: 'edge-rule', cv: 1, s: 1, i: [], extra: true }))],
      ['JSON with a wrong-typed field', b64(JSON.stringify({ v: 1, c: 'edge-rule', cv: '1', s: 1, i: [] }))],
    ];
    for (const [, data] of cases_) expect(decodeRun(data, cases)).toEqual({ ok: false, reason: 'malformed' });
    expect(decodeRun('A'.repeat(20_000), cases)).toEqual({ ok: false, reason: 'too_long' });
    expect(decodeRun(encodeRun('no-such-case', 1, 1, []), cases)).toEqual({ ok: false, reason: 'unknown_case' });
    const newer = { ...cases, 'edge-rule': { ...c, version: 2 } };
    expect(decodeRun(encodeRun('edge-rule', 1, 1, []), newer)).toEqual({ ok: false, reason: 'old_version' });
  });

  it('rejects inputs that are out of order, negative, fractional, too long, too many, or of the wrong shape', () => {
    const bad = (i: unknown[]) => decodeRun(b64(JSON.stringify({ v: 1, c: 'edge-rule', cv: 1, s: 1, i })), cases);
    const malformed = { ok: false, reason: 'malformed' };
    expect(bad([[5, 'h'], [4, 'h']])).toEqual(malformed);
    expect(bad([[-1, 'h']])).toEqual(malformed);
    expect(bad([[1.5, 'h']])).toEqual(malformed);
    expect(bad([[1, 'a', 'x'.repeat(81)]])).toEqual(malformed);
    expect(bad([[1, 'q', 'x']])).toEqual(malformed);
    expect(bad([[1, 'a']])).toEqual(malformed);
    expect(bad([[1, 'h', 'x']])).toEqual(malformed);
    // 2,001 inputs never fit in a link anyway; whichever check sees it first, it is refused
    expect(bad(Array.from({ length: MAX_INPUTS + 1 }, () => [1, 'h'])).ok).toBe(false);
    expect(bad([[1, 'a', 'x'.repeat(80)]]).ok).toBe(true);
    expect(decodeRun(b64('null'), cases)).toEqual(malformed);
    expect(decodeRun(b64(JSON.stringify({ v: 2, c: 'edge-rule', cv: 1, s: 1, i: [] })), cases)).toEqual(malformed);
    expect(decodeRun('', cases)).toEqual(malformed);
    expect(decodeRun('%%%', cases)).toEqual(malformed);
  });

  it('unknown ids inside inputs are harmless: the sim rejects or ignores them', () => {
    const r = decodeRun(encodeRun('edge-rule', 1, 1907, [
      { tick: 1, kind: 'act', id: 'nope' },
      { tick: 2, kind: 'update', id: 'nope' },
      { tick: 3, kind: 'observe', route: 'ask:nobody:nothing' },
    ]), cases);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(() => replay(c, r.run.s, sharedInputs(r.run))).not.toThrow();
  });

  it('a replay of a decoded bot run reproduces the bot score', () => {
    const script: ScriptStep[] = [
      { at: 250, do: 'update', arg: 'investigating' },
      { at: 300, do: 'observe', arg: 'graph:edge.saturation' },
      { at: 360, do: 'observe', arg: 'changes' },
      { at: 480, do: 'act', arg: 'filter_off' },
      { at: 490, do: 'update', arg: 'cause_found' },
    ];
    const bot = playScript(c, script);
    expect(bot.score.outcome).toBe('won');
    const data = encodeRun(c.id, c.version, c.seed, bot.run.inputs);
    expect(data.length).toBeLessThan(MAX_LINK);
    const r = decodeRun(data, cases);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const again = replay(cases[r.run.c]!, r.run.s, sharedInputs(r.run));
    expect(score(c, again.log, again.snapshot)).toEqual(bot.score);
  });
});
