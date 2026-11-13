import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { createRun } from '../sim';
import { CaseError, cases, parseCase } from './index';

const text = readFileSync(new URL('./tutorial.yaml', import.meta.url), 'utf8');
const PATH = 'tutorial.yaml';

type Doc = Record<string, any>;
const mutate = (fn: (d: Doc) => void): string => {
  const d = parse(text) as Doc;
  fn(d);
  return stringify(d);
};
const failure = (yamlText: string): CaseError => {
  try {
    parseCase(yamlText, PATH);
  } catch (e) {
    expect(e).toBeInstanceOf(CaseError);
    return e as CaseError;
  }
  throw new Error('expected parseCase to throw');
};
const expectFail = (fn: (d: Doc) => void, ...needles: string[]): CaseError => {
  const err = failure(mutate(fn));
  expect(err.path).toBe(PATH);
  expect(err.message).toContain(PATH);
  for (const n of needles) expect(err.message).toContain(n);
  return err;
};

describe('tutorial case', () => {
  it('parses and is exported by id', () => {
    const c = parseCase(text, PATH);
    expect(c.id).toBe('tutorial');
    expect(Object.keys(c.nodes)).toEqual(['gate', 'shop', 'ledger']);
    expect(c.source).toBeUndefined();
    expect(cases.tutorial?.title).toBe(c.title);
  });

  it('is lost if the player does nothing', () => {
    const run = createRun(cases.tutorial!);
    run.step(600);
    expect(run.snapshot.status).toBe('lost');
  });

  it('is won by rolling back the shop after the fault', () => {
    const run = createRun(cases.tutorial!);
    run.step(22);
    expect(run.act('rollback')).toEqual({ ok: true });
    run.step(200);
    expect(run.snapshot.status).toBe('won');
  });

  it('finds the changes clue when observed after the deploy, not before', () => {
    const early = createRun(cases.tutorial!);
    early.step(10);
    expect(early.observe('changes')).toEqual([]);
    const run = createRun(cases.tutorial!);
    run.step(22);
    expect(run.observe('changes').map((c) => c.id)).toEqual(['new_build']);
  });

  it('restarting the ledger does not fix it', () => {
    const run = createRun(cases.tutorial!);
    run.step(22);
    run.act('restart');
    run.step(100);
    expect(run.snapshot.status).not.toBe('won');
  });
});

describe('reference checks', () => {
  it('fails on a missing scripted line', () => {
    expectFail((d) => delete d.lines.priya_ping, 'priya_ping');
    expectFail((d) => delete d.lines.restart_bad, 'restart_bad');
  });
  it('fails on an action aimed at a missing node', () => {
    expectFail((d) => (d.actions[0].target = 'harbour'), 'harbour', 'rollback');
  });
  it('fails on a cycle', () => {
    expectFail((d) => d.edges.push({ from: 'ledger', to: 'shop', fanout: 1, timeoutMs: 1000, retries: 0 }), 'cycle', 'shop');
  });
  it('fails with no resolving action', () => {
    expectFail((d) => d.actions.forEach((a: Doc) => (a.resolves = false)), 'resolves');
  });
  it('fails when a graph route names a metric not graphed for the node', () => {
    expectFail((d) => {
      d.clues.push({ id: 'q', route: 'graph:shop.latencyMs', weight: 1, text: 'x' });
    }, 'clue "q"', 'latencyMs');
    expectFail((d) => {
      d.clues.push({ id: 'q2', route: 'graph:shop.dropped', weight: 1, text: 'x' });
      d.signals.graphs.shop = ['queue'];
    }, 'q2', 'dropped');
  });
  it('accepts a graph route that is graphed', () => {
    const doc = mutate((d) => d.clues.push({ id: 'q', route: 'graph:shop.queue', weight: 1, text: 'x' }));
    expect(parseCase(doc, PATH).clues).toHaveLength(2);
  });
  it('fails a log route for a node without log rules', () => {
    expectFail((d) => d.clues.push({ id: 'lg', route: 'log:gate', weight: 1, text: 'x' }), 'lg', 'gate');
  });
  it('checks ask routes against questions and reveals', () => {
    expectFail((d) => d.clues.push({ id: 'a1', route: 'ask:priya:nope', weight: 1, text: 'x' }), 'a1', 'nope');
    expectFail((d) => d.clues.push({ id: 'a2', route: 'ask:priya:ledger', weight: 1, text: 'x' }), 'a2', 'reveal');
    const ok = mutate((d) => {
      d.clues.push({ id: 'a3', route: 'ask:priya:ledger', weight: 1, text: 'x' });
      d.cast[0].questions[1].reveals = 'a3';
    });
    expect(parseCase(ok, PATH).clues).toHaveLength(2);
  });
  it('fails on unknown reveals, knows, and cleanFixBonusAction', () => {
    expectFail((d) => (d.cast[0].questions[0].reveals = 'ghost'), 'ghost');
    expectFail((d) => (d.cast[0].knows = ['phantom']), 'phantom');
    expectFail((d) => (d.scoring.cleanFixBonusAction = 'nothing'), 'nothing');
  });
  it('fails on unknown nodes in conds, modifiers, layout and signals', () => {
    expectFail((d) => (d.win.cond.all[0].metric = 'moat.errorRate'), 'moat');
    expectFail((d) => (d.clues[0].when = { not: { any: [{ metric: 'pier.queue', op: '>', value: 1 }] } }), 'pier');
    expectFail((d) => (d.timeline[1].modifier.target = 'dock'), 'dock');
    expectFail((d) => (d.actions[1].effects[0].target = 'quay'), 'quay');
    expectFail((d) => (d.layout.park = { ...d.layout.shop }), 'park');
    expectFail((d) => delete d.layout.ledger, 'ledger', 'layout');
    expectFail((d) => (d.signals.graphs.lake = ['queue']), 'lake');
    expectFail((d) => (d.entry = 'tower'), 'tower');
  });
  it('fails on duplicate ids and edges', () => {
    expectFail((d) => d.edges.push({ ...d.edges[0] }), 'duplicate edge', 'gate>shop');
    expectFail((d) => d.actions.push({ ...d.actions[0] }), 'duplicate action id', 'rollback');
    expectFail((d) => d.clues.push({ ...d.clues[0] }), 'duplicate clue id', 'new_build');
    expectFail((d) => d.updates.push({ ...d.updates[0] }), 'duplicate update id', 'investigating');
    expectFail((d) => d.cast.push({ ...d.cast[0] }), 'duplicate cast id', 'priya');
    expectFail((d) => d.cast[0].questions.push({ ...d.cast[0].questions[0] }), 'duplicate question id', 'changed');
  });
});

describe('timeline and numbers', () => {
  it('rejects bad timeline events', () => {
    expectFail((d) => (d.timeline[0].at = 0), 'timeline.0.at');
    expectFail((d) => (d.timeline[0].at = 2.5), 'timeline.0.at');
    expectFail((d) => delete d.timeline[0].target, 'timeline[0]', 'target');
    expectFail((d) => delete d.timeline[1].modifier, 'timeline[1]', 'modifier');
    expectFail((d) => delete d.timeline[2].from, 'timeline[2]', 'from');
    expectFail((d) => (d.timeline[2].from = 'stranger'), 'stranger');
    expectFail((d) => delete d.timeline[2].lineKey, 'timeline[2]', 'lineKey');
  });
  it('rejects non-positive and non-finite values', () => {
    expectFail((d) => (d.win.holdTicks = 0), 'win.holdTicks');
    expectFail((d) => (d.scoring.detectParTicks = 0), 'detectParTicks');
    expectFail((d) => (d.scoring.recoverParTicks = -1), 'recoverParTicks');
    expectFail((d) => (d.scoring.updateEveryTicks = 0), 'updateEveryTicks');
    expectFail((d) => (d.lose.maxFailedRequests = 0), 'maxFailedRequests');
    expectFail((d) => (d.maxTicks = 0), 'maxTicks');
    expectFail((d) => (d.ticksPerSecond = 0), 'ticksPerSecond');
    expectFail((d) => (d.baseRps = 0), 'baseRps');
    expectFail((d) => (d.nodes.shop.instances = -1), 'nodes.shop.instances');
    expectFail((d) => (d.nodes.shop.rpsPerInstance = -1), 'rpsPerInstance');
    expectFail((d) => (d.nodes.shop.queueMax = -1), 'queueMax');
    expectFail((d) => (d.nodes.shop.baseLatencyMs = -1), 'baseLatencyMs');
    expectFail((d) => (d.nodes.shop.costMul = 0), 'costMul');
    expectFail((d) => (d.nodes.shop.capacityMul = 0), 'capacityMul');
  });
  it('rejects non-finite numbers written in YAML', () => {
    const bad = text.replace('baseRps: 400', 'baseRps: .inf');
    expect(failure(bad).message).toContain('baseRps');
    const nan = text.replace('queueMax: 200, baseLatencyMs: 20', 'queueMax: .nan, baseLatencyMs: 20');
    expect(failure(nan).message).toContain('queueMax');
  });
  it('rejects unknown keys', () => {
    expectFail((d) => (d.nodes.shop.instnaces = 3), 'instnaces');
    expectFail((d) => (d.titel = 'x'), 'titel');
  });
  it('reports invalid YAML as a CaseError', () => {
    const err = failure('id: [unclosed');
    expect(err.path).toBe(PATH);
    expect(err.issues[0]).toContain('YAML');
  });
});
