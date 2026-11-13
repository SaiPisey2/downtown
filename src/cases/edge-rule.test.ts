import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRun, type Snapshot } from '../sim';
import { fuzz, playScript, type ScriptStep } from '../../test/bot/bot';
import { cases, parseCase } from './index';

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
      expect(() => fuzz(c, seed, 400, (s) => {
        sampled++;
        walk(s, `seed ${seed} tick ${s.tick}`);
      })).not.toThrow();
      expect(sampled).toBeGreaterThan(0);
    }
    expect(bad).toEqual([]);
  });
});
