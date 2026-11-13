import { beforeEach, describe, expect, it } from 'vitest';
import { advance, setSpeed } from './loop';
import { useGame } from './store';

const g = () => useGame.getState();
const tick = () => g().snap!.tick;
const to = (t: number) => {
  while (tick() < t) advance(250);
};
const looks = (route: string) => g().run!.inputs.filter((i) => i.kind === 'observe' && i.route === route).length;

beforeEach(() => {
  setSpeed(1);
  g().start('edge-rule');
});

describe('a view left on screen', () => {
  it('watching the edge graphs from before the fault finds the key clue once it shows, with one recorded look', () => {
    // a panel on screen looks at its routes on every tick
    while (tick() < 300) {
      advance(250);
      g().observe('graph:edge.saturation');
    }
    expect(g().found).toContain('cpu_everywhere');
    const found = g().log.find((e) => e.type === 'clue' && e.clueId === 'cpu_everywhere');
    expect(found?.tick).toBe(242);
    expect(looks('graph:edge.saturation')).toBe(1);
  });

  it('the change log left open across the deploy finds the deploy clue, with one recorded look', () => {
    while (tick() < 300) {
      advance(250);
      g().observe('changes');
    }
    expect(g().found).toContain('deploy_before');
    expect(g().log.find((e) => e.type === 'clue' && e.clueId === 'deploy_before')?.tick).toBe(240);
    expect(looks('changes')).toBe(1);
  });

  it('a look that finds nothing is not recorded', () => {
    to(100);
    g().observe('graph:edge.saturation');
    g().observe('changes');
    g().observe('log:edge');
    expect(g().run!.inputs).toEqual([]);
  });

  it('a question is recorded even before its clue is true, so a replay shows it', () => {
    to(100);
    void g().ask('netops', 'volume');
    expect(looks('ask:netops:volume')).toBe(1);
    expect(g().found).toEqual([]);
  });
});
