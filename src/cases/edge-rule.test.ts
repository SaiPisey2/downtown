import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRun, type Snapshot } from '../sim';
import { fuzz, playScript, type ScriptStep } from '../../test/bot/bot';
import { answerFor, cases, parseCase } from './index';

const text = readFileSync(new URL('./edge-rule.yaml', import.meta.url), 'utf8');
const c = parseCase(text, 'edge-rule.yaml');

const KEY_CLUES: ScriptStep[] = [
  { at: 300, do: 'observe', arg: 'graph:edge.saturation' },
  { at: 360, do: 'observe', arg: 'changes' },
];
const honestUpdates = (until: number): ScriptStep[] => {
  const out: ScriptStep[] = [];
  out.push({ at: 250, do: 'update', arg: 'investigating' });
  for (let t = 250 + c.scoring.updateEveryTicks; t < until; t += c.scoring.updateEveryTicks) {
    out.push({ at: t, do: 'update', arg: 'cause_found' });
  }
  return out;
};
const byTick = (s: ScriptStep[]): ScriptStep[] => [...s].sort((a, b) => a.at - b.at);

/** a run where the player does only `actions`, read at `tick` */
const at = (tick: number, actions: { at: number; id: string }[] = []): Snapshot => {
  const run = createRun(c);
  for (const a of [...actions].sort((x, y) => x.at - y.at)) {
    run.step(a.at - run.snapshot.tick);
    expect(run.act(a.id)).toEqual({ ok: true });
  }
  run.step(tick - run.snapshot.tick);
  return run.snapshot;
};

describe('edge-rule case', () => {
  it('the debrief states no publication date', () => {
    expect(c.debrief.realTeam).not.toMatch(/2019|July/);
  });

  it('loads and is exported by id with its source', () => {
    expect(c.id).toBe('edge-rule');
    expect(cases['edge-rule']?.title).toBe('The rule that ate the city');
    expect(Object.keys(c.nodes).sort()).toEqual(
      ['accounts', 'api', 'cache', 'db', 'edge', 'filter', 'gate', 'orders', 'web'],
    );
    expect(c.source).toEqual({
      url: 'https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/',
      publisher: 'Cloudflare',
      date: '2019-07-02',
    });
    expect(c.maxTicks).toBe(3600);
    expect(c.ticksPerSecond).toBe(4);
  });

  it('is healthy until the rules deploy, then the edge chokes', () => {
    const run = createRun(c);
    for (let t = 1; t <= 239; t++) {
      run.step();
      expect(run.snapshot.impact.errorRate, `tick ${t}`).toBeLessThan(0.01);
    }
    run.step(300 - 239);
    expect(run.snapshot.impact.errorRate).toBeGreaterThan(0.6);
    expect(run.snapshot.nodes.edge!.saturation).toBe(1);
    const faults = run.log.filter((e) => e.type === 'fault');
    expect(faults[0]?.tick).toBe(242);
  });

  it('Bot A: switching the filter off wins with a good score', () => {
    const { run, score } = playScript(c, byTick([
      ...KEY_CLUES,
      { at: 480, do: 'act', arg: 'filter_off' },
      ...honestUpdates(700),
    ]));
    expect(run.snapshot.status).toBe('won');
    expect(score.total).toBeGreaterThanOrEqual(80);
    expect(score.total).toBeLessThanOrEqual(95);
  });

  it('Bot B: rolling the rules back wins, but recovers later than Bot A', () => {
    const a = playScript(c, byTick([...KEY_CLUES, { at: 480, do: 'act', arg: 'filter_off' }, ...honestUpdates(700)]));
    const b = playScript(c, byTick([...KEY_CLUES, { at: 480, do: 'act', arg: 'rollback_rules' }, ...honestUpdates(1000)]));
    expect(b.run.snapshot.status).toBe('won');
    expect(b.score.recover).toBeLessThan(a.score.recover);
  });

  it('an action before anything is wrong is refused, and the run goes on to the fault', () => {
    const run = createRun(c);
    run.step(10);
    expect(run.act('filter_off')).toEqual({ ok: false, reason: 'too_early' });
    expect(run.inputs).toEqual([{ tick: 10, kind: 'act', id: 'filter_off' }]);
    run.step(300 - 10);
    expect(run.snapshot.params.filter!.enabled).toBe(true);
    expect(run.log.some((e) => e.type === 'fault')).toBe(true);
    expect(run.snapshot.impact.errorRate).toBeGreaterThan(0.5);
    // the same action once the deploy is out is taken
    const after = createRun(c);
    after.step(240);
    expect(after.act('filter_off')).toEqual({ ok: true });
  });

  it('Bot C: doing nothing loses', () => {
    const { run } = playScript(c, []);
    expect(run.snapshot.status).toBe('lost');
  });

  const harmful = c.actions.filter((a) => a.harmful).map((a) => a.id);
  it('has exactly the three harmful actions', () => {
    expect(harmful.sort()).toEqual(['block_sources', 'restart_edge', 'rollback_orders']);
  });

  for (const tick of [300, 480]) {
    it.each(['block_sources', 'restart_edge', 'rollback_orders'])(`%s at tick ${tick} fails more requests by tick 900 than doing nothing`, (id) => {
      const nothing = at(900).impact.failed;
      expect(at(900, [{ at: tick, id }]).impact.failed).toBeGreaterThan(nothing);
    });
  }

  it('lifting the block is not harmful and undoes the block', () => {
    expect(c.actions.find((a) => a.id === 'unblock_sources')?.harmful).toBe(false);
    const blocked = at(900, [{ at: 300, id: 'block_sources' }]).impact.failed;
    const lifted = at(900, [{ at: 300, id: 'block_sources' }, { at: 400, id: 'unblock_sources' }]).impact.failed;
    expect(lifted).toBeLessThan(blocked);
  });

  it('a block left in place stops the win after the fix', () => {
    const run = createRun(c);
    run.step(300);
    run.act('block_sources');
    run.step(180);
    run.act('filter_off');
    run.step(1000);
    expect(run.snapshot.status).not.toBe('won');
    run.act('unblock_sources');
    run.step(400);
    expect(run.snapshot.status).toBe('won');
  });

  it('scaling the api does nothing for the fault', () => {
    const scale = c.actions.find((a) => a.id === 'scale_api');
    expect(scale?.harmful).toBe(false);
    for (const tick of [300, 480]) {
      const nothing = at(900).impact.errorRate;
      expect(Math.abs(at(900, [{ at: tick, id: 'scale_api' }]).impact.errorRate - nothing)).toBeLessThanOrEqual(0.02);
    }
  });

  it('finds the key clues only once the fault is on', () => {
    const run = createRun(c);
    run.step(200);
    expect(run.observe('graph:edge.saturation')).toEqual([]);
    expect(run.observe('changes')).toEqual([]);
    run.step(100);
    expect(run.observe('graph:edge.saturation').map((x) => x.id)).toEqual(['cpu_everywhere']);
    expect(run.observe('changes').map((x) => x.id)).toEqual(['deploy_before']);
    expect(run.observe('ask:netops:volume').map((x) => x.id)).toEqual(['volume_normal']);
    expect(run.observe('graph:orders.errorRate').map((x) => x.id)).toEqual(['orders_fine']);
  });

  const BOT_A: ScriptStep[] = byTick([...KEY_CLUES, { at: 480, do: 'act', arg: 'filter_off' }, ...honestUpdates(700)]);
  const recovery: [string, ScriptStep[]][] = [
    ['restart_edge', [{ at: 300, do: 'act', arg: 'restart_edge' }]],
    ['block_sources', [{ at: 300, do: 'act', arg: 'block_sources' }, { at: 500, do: 'act', arg: 'unblock_sources' }]],
    ['rollback_orders', [{ at: 300, do: 'act', arg: 'rollback_orders' }]],
    ['restart_edge then rollback_orders', [{ at: 300, do: 'act', arg: 'restart_edge' }, { at: 360, do: 'act', arg: 'rollback_orders' }]],
  ];
  it.each(recovery)('a mistake (%s) followed by the right fix is still won, with a lower score than Bot A', (_name, mistakes) => {
    const a = playScript(c, BOT_A);
    const m = playScript(c, byTick([...BOT_A, ...mistakes]));
    expect(m.run.snapshot.status).toBe('won');
    expect(m.run.snapshot.tick).toBeLessThan(c.maxTicks);
    expect(m.score.total).toBeLessThan(a.score.total);
  });

  const asks = c.cast.flatMap((m) => m.questions.map((q) => ({ m, q, route: `ask:${m.id}:${q.id}` })));
  it('before the fault, no question reveals a clue and the "before" answers are shown', () => {
    const run = createRun(c);
    run.step(100);
    for (const { m, q, route } of asks) {
      expect(run.observe(route), route).toEqual([]);
      expect(answerFor(c, m.id, q.id, run.snapshot), route).toBe(q.answerBefore ?? q.answer);
    }
    expect(asks.filter((x) => x.q.answerBefore !== undefined).length).toBe(asks.length);
  });

  it('during the fault, every question gives its normal answer and reveals its clue', () => {
    const run = createRun(c);
    run.step(500);
    for (const { m, q, route } of asks) {
      expect(answerFor(c, m.id, q.id, run.snapshot), route).toBe(q.answer);
      expect(run.observe(route).map((x) => x.id), route).toEqual([q.reveals]);
    }
  });

  it('the shipped answer follows the rules deploy from its own tick, and stays true after a rollback', () => {
    const run = createRun(c);
    run.step(239);
    expect(answerFor(c, 'devlead', 'shipped', run.snapshot)).toBe('Nothing has shipped yet today.');
    run.step(1);
    expect(answerFor(c, 'devlead', 'shipped', run.snapshot)).toMatch(/rules update/);
    expect(run.observe('ask:devlead:shipped').map((x) => x.id)).toEqual(['rules_today']);
    const rolled = createRun(c);
    rolled.step(250);
    rolled.act('rollback_rules');
    rolled.step(310);
    expect(rolled.log.some((e) => e.type === 'action_landed' && e.actionId === 'rollback_rules')).toBe(true);
    expect(answerFor(c, 'devlead', 'shipped', rolled.snapshot)).toMatch(/rules update/);
  });

  it('keeps the cast honest: teammates have 3-4 questions, the stakeholder none, every answer that tells a fact reveals a clue', () => {
    for (const m of c.cast) {
      if (m.role === 'stakeholder') expect(m.questions).toHaveLength(0);
      else {
        expect(m.questions.length).toBeGreaterThanOrEqual(3);
        expect(m.questions.length).toBeLessThanOrEqual(4);
        for (const q of m.questions) {
          expect(q.reveals, `${m.id}.${q.id}`).toBeDefined();
          expect(m.knows).toContain(q.reveals);
        }
      }
    }
    expect(c.updates.filter((u) => u.honest)).toHaveLength(3);
    expect(c.updates.filter((u) => !u.honest)).toHaveLength(1);
  });

  it('fuzz: random inputs never throw and every sampled number is finite and non-negative', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') {
        if (!Number.isFinite(v) || v < 0) bad.push(`${path}=${v}`);
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      }
    };
    for (let seed = 1; seed <= 50; seed++) {
      let sampled = 0;
      expect(() => fuzz(c, seed, 400, {
        sample: (s) => {
          sampled++;
          walk(s, `seed ${seed} tick ${s.tick}`);
        },
      })).not.toThrow();
      expect(sampled).toBeGreaterThan(0);
    }
    expect(bad).toEqual([]);
  });

  it('fuzz: nothing is taken before the first deploy, and only then is an act refused as too early', () => {
    let early = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const run = fuzz(c, seed, 400);
      const trouble = run.log.find((e) => e.type === 'deploy' || e.type === 'fault')?.tick ?? Infinity;
      for (const e of run.log) {
        if (e.type === 'action') expect(e.tick, `seed ${seed}`).toBeGreaterThanOrEqual(trouble);
        if (e.type === 'action_rejected' && e.reason === 'too_early') {
          early++;
          expect(e.tick, `seed ${seed}`).toBeLessThan(trouble);
        }
      }
    }
    expect(early).toBeGreaterThan(0);
  });

  it('fuzz after the fix: the recovery path and post-fix mistakes stay finite and non-negative', () => {
    const bad: string[] = [];
    const walk = (v: unknown, path: string): void => {
      if (typeof v === 'number') {
        if (!Number.isFinite(v) || v < 0) bad.push(`${path}=${v}`);
      } else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      }
    };
    let toTheEnd = 0;
    let harmAfterFix = 0;
    const harmfulIds = new Set(harmful);
    for (let seed = 1; seed <= 50; seed++) {
      let sampled = 0;
      const run = fuzz(c, seed, 400, {
        fix: { at: 250, action: 'filter_off' },
        endless: true,
        sample: (s) => {
          sampled++;
          walk(s, `seed ${seed} tick ${s.tick}`);
        },
      });
      const fixedAt = run.log.find((e) => e.type === 'action_landed' && e.actionId === 'filter_off')?.tick;
      expect(fixedAt).toBeDefined();
      harmAfterFix += run.log.filter((e) => e.type === 'action_landed' && harmfulIds.has(e.actionId) && e.tick > fixedAt!).length;
      expect(sampled).toBeGreaterThan(0);
      if (run.snapshot.tick === c.maxTicks) toTheEnd++;
    }
    expect(bad).toEqual([]);
    expect(toTheEnd).toBeGreaterThanOrEqual(40);
    expect(harmAfterFix).toBeGreaterThan(50);
  });

  it('fuzz is deterministic', () => {
    const one = fuzz(c, 7, 400);
    const two = fuzz(c, 7, 400);
    expect(two.log).toEqual(one.log);
    expect(two.inputs).toEqual(one.inputs);
    expect(two.snapshot).toEqual(one.snapshot);
    const opts = { fix: { at: 250, action: 'filter_off' }, endless: true };
    const fixed = fuzz(c, 7, 400, opts);
    const again = fuzz(c, 7, 400, opts);
    expect(again.log).toEqual(fixed.log);
    expect(again.inputs).toEqual(fixed.inputs);
    expect(again.snapshot).toEqual(fixed.snapshot);
  });
});
