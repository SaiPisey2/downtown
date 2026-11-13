import { describe, expect, it } from 'vitest';
import { createRun, score } from './index';
import type { Run, Score } from './index';
import { testModel } from './testmodel';

const finish = (r: Run): Score => {
  r.step(1000);
  return score(testModel(), r.log, r.snapshot);
};

const perfect = (extra?: (r: Run) => void): Run => {
  const r = createRun(testModel());
  r.step(11);
  r.observe('graph:edge.saturation');
  r.act('rollback_rules');
  r.step(1);
  r.update('honest');
  extra?.(r);
  return r;
};

describe('score', () => {
  it('rewards perfect scripted play', () => {
    const s = finish(perfect());
    expect(s.outcome).toBe('won');
    expect(s.total).toBeGreaterThanOrEqual(90);
    expect(s.detect).toBe(15);
    expect(s.harm).toBe(15);
    expect(s.updates).toBe(10);
    expect(s.hints).toBe(0);
  });

  it('scores doing nothing as a loss with no recovery', () => {
    const r = createRun(testModel());
    const s = finish(r);
    expect(s.outcome).toBe('lost');
    expect(s.recover).toBe(0);
    expect(s.detect).toBe(0);
    expect(s.traffic).toBe(0);
    expect(s.updates).toBe(0);
    expect(s.total).toBeLessThan(30);
  });

  it('takes exactly 5 per landed harmful action', () => {
    const base = finish(perfect());
    const harmed = finish(perfect((r) => r.act('restart_db')));
    expect(harmed.harm).toBe(base.harm - 5);
    expect(harmed.total).toBe(base.total - 5);
  });

  it('takes exactly 3 per hint that returned a clue, nothing for an empty hint', () => {
    const base = finish(perfect());
    const hinted = finish(perfect((r) => r.hint()));
    expect(hinted.hints).toBe(1);
    expect(hinted.total).toBe(base.total - 3);
    const empty = finish(perfect((r) => { for (let i = 0; i < 6; i++) r.hint(); }));
    expect(empty.hints).toBe(3); // chg, log, old; the rest returned null
    expect(empty.total).toBe(base.total - 9);
  });

  it('keeps every field an integer within range', () => {
    for (const r of [perfect(), createRun(testModel()), perfect((x) => { x.act('restart_db'); x.hint(); })]) {
      const s = finish(r);
      const max = { total: 100, detect: 15, recover: 35, traffic: 25, harm: 15, updates: 10 };
      for (const [k, hi] of Object.entries(max)) {
        const v = s[k as keyof typeof max];
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(hi);
      }
    }
  });

  it('gives full updates credit when no window has completed', () => {
    const m = testModel({ maxTicks: 25 });
    const r = createRun(m);
    r.step(1000);
    expect(score(m, r.log, r.snapshot).updates).toBe(10);
  });

  it('gives no updates credit for dishonest updates', () => {
    const m = testModel({ maxTicks: 100, lose: { maxFailedRequests: 1e9 } });
    const r = createRun(m);
    r.step(12);
    r.update('spin');
    r.step(1000);
    expect(score(m, r.log, r.snapshot).updates).toBe(0);
    const h = createRun(m);
    h.step(12);
    h.update('honest');
    h.step(1000);
    expect(score(m, h.log, h.snapshot).updates).toBe(3); // 1 of 4 windows = 2.5, rounded
  });
});
