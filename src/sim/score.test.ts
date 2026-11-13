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

  describe('a fast fix against the clean one', () => {
    const scoring = {
      detectParTicks: 20, recoverParTicks: 60, updateEveryTicks: 20,
      cleanFixAction: 'rollback_rules', shortcutActions: ['quick_fix'], shortcutPenalty: 8,
    };
    const m = testModel({ scoring });
    const play = (moves: (r: Run) => void, model = m): Score => {
      const r = createRun(model);
      r.step(11);
      r.observe('graph:edge.saturation');
      r.update('honest');
      moves(r);
      r.step(1000);
      return score(model, r.log, r.snapshot);
    };
    const sum = (s: Score) => s.detect + s.recover + s.traffic + s.harm + s.updates;

    it('a won run fixed only the fast way loses the shortcut penalty, shown as its own part', () => {
      const s = play((r) => r.act('quick_fix'));
      expect(s.outcome).toBe('won');
      expect(s.shortcut).toBe(-8);
      expect(s.total).toBe(sum(s) - 8);
      const plain = play((r) => r.act('quick_fix'), testModel());
      expect(plain.shortcut).toBe(0);
      expect(plain.total).toBe(s.total + 8);
    });

    it('no penalty when the clean fix also landed, or with no shortcut taken', () => {
      // held long enough for the clean fix to land before the win
      const both = play((r) => {
        r.act('rollback_rules');
        r.act('quick_fix');
      }, testModel({ scoring, win: { ...testModel().win, holdTicks: 20 } }));
      expect(both.outcome).toBe('won');
      expect(both.shortcut).toBe(0);
      expect(play((r) => r.act('rollback_rules')).shortcut).toBe(0);
    });

    it('no penalty on a lost run', () => {
      const lost = testModel({ scoring, maxTicks: 30, win: { ...testModel().win, holdTicks: 100 } });
      const s = play((r) => r.act('quick_fix'), lost);
      expect(s.outcome).toBe('lost');
      expect(s.shortcut).toBe(0);
    });

    it("the clean fix's own delay is added to the recovery par, so it is not punished for it", () => {
      const tight = { ...scoring, recoverParTicks: 20 };
      const late = (r: Run) => {
        r.step(29);
        r.act('rollback_rules');
      };
      const without = play(late, testModel({ scoring: { ...tight, cleanFixAction: undefined } }));
      const withClean = play(late, testModel({ scoring: tight }));
      expect(without.outcome).toBe('won');
      // won about 46 ticks after the fault: 35 x (2 - 46/20) is 0; with the par at 20 + 10, 35 x (2 - 46/30) is 16
      expect(without.recover).toBe(0);
      expect(withClean.recover).toBeGreaterThan(10);
      expect(withClean.recover).toBe(Math.round(35 * Math.min(1, Math.max(0, 2 - (withClean.ticks - 10) / 30))));
    });

    it('the total stays an integer from 0 to 100, the penalty floored at 0', () => {
      const harsh = testModel({ scoring: { ...scoring, shortcutPenalty: 1000 } });
      const s = play((r) => r.act('quick_fix'), harsh);
      expect(s.total).toBe(0);
      expect(s.shortcut).toBe(-1000);
      for (const x of [s, play((r) => r.act('quick_fix')), play((r) => r.act('rollback_rules'))]) {
        expect(Number.isInteger(x.total) && Number.isInteger(x.shortcut)).toBe(true);
        expect(x.total).toBeGreaterThanOrEqual(0);
        expect(x.total).toBeLessThanOrEqual(100);
      }
    });
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
