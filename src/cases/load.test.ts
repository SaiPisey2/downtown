import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { createRun } from '../sim';
import { CaseError, STAKEHOLDER_LINES, answerFor, buildCases, cases, parseCase } from './index';

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

  it('shows the fault within a few seconds but gives a first-time player two minutes', () => {
    const c = cases.tutorial!;
    expect(c.ticksPerSecond).toBe(4);
    const run = createRun(c);
    // the fault is on the city's error rate within five seconds of play
    run.step(5 * c.ticksPerSecond);
    expect(run.snapshot.impact.errorRate).toBeGreaterThan(0.1);
    run.step(480 - run.snapshot.tick);
    expect(run.snapshot.status).toBe('running');
  });

  it('is won by rolling back the shop after the fault', () => {
    const run = createRun(cases.tutorial!);
    run.step(5);
    expect(run.act('rollback')).toEqual({ ok: false, reason: 'too_early' });
    run.step(17);
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
  it('a case with a stakeholder needs every stakeholder line, and has only one stakeholder', () => {
    for (const k of STAKEHOLDER_LINES) expectFail((d) => delete d.lines[k], `stakeholder "dana"`, `missing line "${k}"`);
    expectFail((d) => d.cast.push({ ...d.cast[1], id: 'dana2' }), 'at most one stakeholder', 'dana, dana2');
    // without a stakeholder the lines are not needed
    const c = parseCase(
      mutate((d) => {
        d.cast = d.cast.filter((m: Doc) => m.role !== 'stakeholder');
        for (const k of STAKEHOLDER_LINES) delete d.lines[k];
      }),
      PATH,
    );
    expect(c.cast.every((m) => m.role === 'teammate')).toBe(true);
  });
  it('every teammate needs a busy line, said when a live answer cannot be had', () => {
    expectFail((d) => delete d.lines.busy_priya, `teammate "priya"`, 'missing line "busy_priya"');
    for (const k of Object.values(cases)) {
      for (const m of k.cast.filter((x) => x.role === 'teammate')) expect(k.lines[`busy_${m.id}`]).toBeTruthy();
    }
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
  it('fails on unknown reveals, knows, and scoring actions', () => {
    expectFail((d) => (d.cast[0].questions[0].reveals = 'ghost'), 'ghost');
    expectFail((d) => (d.cast[0].knows = ['phantom']), 'phantom');
    expectFail((d) => (d.scoring.cleanFixAction = 'nothing'), 'scoring.cleanFixAction', 'nothing');
    expectFail((d) => (d.scoring.shortcutActions = ['rollback', 'zilch']), 'scoring.shortcutActions', 'zilch');
    expectFail((d) => (d.scoring.shortcutPenalty = -1), 'shortcutPenalty');
    expectFail((d) => (d.scoring.cleanFixBonusAction = 'rollback'), 'cleanFixBonusAction');
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
    // a message carries no target or modifier, and only a message has a when
    expectFail((d) => (d.timeline[2].target = 'shop'), 'timeline[2]', 'target');
    expectFail((d) => (d.timeline[2].modifier = { ...d.timeline[1].modifier }), 'timeline[2]', 'modifier');
    expectFail((d) => (d.timeline[0].when = { metric: 'shop.queue', op: '>', value: 1 }), 'timeline[0]', 'when');
  });
  it('checks the nodes named in a message when, and accepts a good one', () => {
    expectFail((d) => (d.timeline[2].when = { metric: 'moat.errorRate', op: '>', value: 0 }), 'timeline[2] when', 'moat');
    expectFail((d) => (d.timeline[2].when = { metric: 'shop.nope', op: '>', value: 0 }), 'timeline[2] when', 'nope');
    const ok = mutate((d) => (d.timeline[2].when = { metric: 'city.errorRate', op: '>', value: 0.05 }));
    expect(parseCase(ok, PATH).timeline[2]!.when).toEqual({ metric: 'city.errorRate', op: '>', value: 0.05 });
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

describe('review follow-ups', () => {
  it('names the bad key or value in a malformed condition', () => {
    const typo = expectFail((d) => (d.win.cond.all[0] = { metric: 'city.errorRate', opp: '<', value: 0.02 }), 'win.cond', 'opp');
    expect(typo.message).not.toContain('Invalid input');
    const badOp = expectFail((d) => (d.win.cond.all[0].op = '=~'), 'win.cond', '=~');
    expect(badOp.message).not.toContain('Invalid input');
    expectFail((d) => (d.clues[0].when = { not: { all: [{ metric: 'shop.queue', op: '>' }] } }), 'clues.0.when', 'value');
    expectFail((d) => (d.clues[0].when = { nay: [] }), 'clues.0.when', 'nay');
  });
  it('names the whole route when a graph route has no dot', () => {
    const err = expectFail((d) => d.clues.push({ id: 'g', route: 'graph:shop', weight: 1, text: 'x' }), 'graph:shop', '<node>.<metric>');
    expect(err.message).not.toContain('unknown node "sho"');
  });
  it('rejects non-positive mul values and fractional or zero forTicks', () => {
    expectFail((d) => (d.timeline[1].modifier.mul.capacityMul = 0), 'timeline.1.modifier.mul.capacityMul');
    expectFail((d) => (d.timeline[1].modifier.mul.capacityMul = -2), 'capacityMul');
    expectFail((d) => (d.actions[1].effects[0].forTicks = 2.5), 'actions.1.effects.0.forTicks');
    expectFail((d) => (d.actions[1].effects[0].forTicks = 0), 'forTicks');
  });
});

describe('action risk notes', () => {
  it('accepts a risk line and rejects an empty or non-string one', () => {
    expect(parseCase(text, PATH).actions[0]!.risk).toMatch(/\w/);
    expectFail((d) => (d.actions[0].risk = ''), 'actions.0.risk');
    expectFail((d) => (d.actions[0].risk = 3), 'actions.0.risk');
  });
  it('every action in every case says its risk', () => {
    for (const c of Object.values(cases)) for (const a of c.actions) expect(a.risk, `${c.id}/${a.id}`).toMatch(/\w/);
  });
});

describe('case registry', () => {
  it('throws on two case files with the same id', () => {
    expect(() => buildCases({ 'a.yaml': text, 'b.yaml': text })).toThrow(/duplicate case id "tutorial".*a\.yaml.*b\.yaml/);
  });
});

describe('answers that depend on time', () => {
  const withBefore = (d: Doc) => {
    d.cast[0].questions[0].reveals = 'new_build';
    d.cast[0].questions[0].answerBefore = 'Nothing has shipped yet.';
  };
  it('accepts answerBefore on a question whose clue has a when', () => {
    const c = parseCase(mutate(withBefore), PATH);
    expect(c.cast[0]!.questions[0]!.answerBefore).toBe('Nothing has shipped yet.');
  });
  it('rejects answerBefore that could never be shown', () => {
    expectFail((d) => (d.cast[0].questions[1].answerBefore = 'x'), 'question "ledger"', 'answerBefore');
    expectFail((d) => {
      withBefore(d);
      delete d.clues[0].when;
    }, 'question "changed"', 'answerBefore');
  });
  it('answerFor picks the before text until the revealed clue is eligible', () => {
    const c = parseCase(mutate(withBefore), PATH);
    const run = createRun(c);
    run.step(10);
    expect(answerFor(c, 'priya', 'changed', run.snapshot)).toBe('Nothing has shipped yet.');
    expect(answerFor(c, 'priya', 'ledger', run.snapshot)).toBe(c.cast[0]!.questions[1]!.answer);
    run.step(15);
    expect(answerFor(c, 'priya', 'changed', run.snapshot)).toBe(c.cast[0]!.questions[0]!.answer);
    expect(() => answerFor(c, 'priya', 'nope', run.snapshot)).toThrow(/nope/);
    expect(() => answerFor(c, 'ghost', 'changed', run.snapshot)).toThrow(/ghost/);
  });
});
