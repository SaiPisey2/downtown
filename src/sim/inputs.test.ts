import { describe, expect, it } from 'vitest';
import { createRun, replay } from './index';
import { testModel } from './testmodel';

describe('observe', () => {
  it('finds a conditional clue only once the condition holds, and only once', () => {
    const r = createRun(testModel());
    r.step(5);
    expect(r.observe('graph:edge.saturation')).toEqual([]);
    r.step(10);
    const found = r.observe('graph:edge.saturation');
    expect(found.map((c) => c.id)).toEqual(['sat']);
    expect(r.observe('graph:edge.saturation')).toEqual([]);
    expect(r.log.filter((e) => e.type === 'clue')).toEqual([{ tick: 15, type: 'clue', clueId: 'sat' }]);
  });

  it('returns every matching clue for a route', () => {
    const r = createRun(testModel());
    r.step(12);
    expect(r.observe('changes').map((c) => c.id)).toEqual(['chg', 'old']);
  });

  it('records observes that find nothing, but not after the run ends', () => {
    const r = createRun(testModel());
    r.observe('nowhere');
    expect(r.inputs).toEqual([{ tick: 0, kind: 'observe', route: 'nowhere' }]);
    r.step(1000);
    expect(r.observe('log:edge')).toEqual([]);
    expect(r.inputs).toHaveLength(1);
  });
});

describe('hint', () => {
  it('returns the heaviest eligible undiscovered clue, logs it, then null when none remain', () => {
    const r = createRun(testModel());
    r.step(12);
    expect(r.hint()?.id).toBe('chg');
    r.observe('changes');
    expect(r.hint()?.id).toBe('sat');
    expect(r.hint()?.id).toBe('log');
    expect(r.hint()).toBeNull();
    expect(r.log.filter((e) => e.type === 'hint').map((e) => (e as { clueId: string | null }).clueId))
      .toEqual(['chg', 'sat', 'log', null]);
    expect(r.inputs.filter((i) => i.kind === 'hint')).toHaveLength(4);
  });

  it('skips clues whose condition does not hold yet', () => {
    const r = createRun(testModel());
    r.step(3);
    expect(r.hint()?.id).toBe('log');
  });

  it('does nothing after the run ends', () => {
    const r = createRun(testModel());
    r.step(1000);
    expect(r.hint()).toBeNull();
    expect(r.log.some((e) => e.type === 'hint')).toBe(false);
    expect(r.inputs).toEqual([]);
  });
});

describe('update', () => {
  it('logs known updates, ignores unknown ids and ended runs', () => {
    const r = createRun(testModel());
    r.step(4);
    r.update('honest');
    r.update('nope');
    expect(r.log.filter((e) => e.type === 'update')).toEqual([{ tick: 4, type: 'update', id: 'honest' }]);
    expect(r.inputs).toEqual([{ tick: 4, kind: 'update', id: 'honest' }]);
    r.step(1000);
    r.update('honest');
    expect(r.inputs).toHaveLength(1);
  });
});

describe('inputs and seed', () => {
  it('records acts, including rejected ones, with their tick', () => {
    const r = createRun(testModel());
    r.act('nope');
    r.step(11);
    r.act('rollback_rules');
    expect(r.inputs).toEqual([
      { tick: 0, kind: 'act', id: 'nope' },
      { tick: 11, kind: 'act', id: 'rollback_rules' },
    ]);
  });

  it('exposes the seed it was created with', () => {
    expect(createRun(testModel({ seed: 7 })).seed).toBe(7);
    expect(createRun(testModel({ seed: 7 }), 9).seed).toBe(9);
  });
});

describe('replay', () => {
  const play = () => {
    const r = createRun(testModel());
    r.act('ghost');
    r.step(11);
    r.observe('graph:edge.saturation');
    r.update('honest');
    r.hint();
    r.act('rollback_rules');
    r.act('rollback_rules');
    r.step(5);
    r.act('restart_db');
    r.observe('log:edge');
    r.step(1000);
    r.act('restart_db');
    return r;
  };

  it('reproduces a finished run exactly', () => {
    const a = play();
    const b = replay(testModel(), 1, [...a.inputs]);
    expect(b.log).toEqual(a.log);
    expect(b.snapshot).toEqual(a.snapshot);
    expect(b.inputs).toEqual(a.inputs);
    expect(b.snapshot.status).not.toBe('running');
  });

  it('continues to the end after the last input and ignores inputs past the end', () => {
    const b = replay(testModel(), 1, [{ tick: 11, kind: 'act', id: 'rollback_rules' }, { tick: 9999, kind: 'hint' }]);
    expect(b.snapshot.status).toBe('won');
    expect(b.inputs).toHaveLength(1);
  });
});
