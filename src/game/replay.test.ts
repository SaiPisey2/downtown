import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { playScript } from '../../test/bot/bot';
import { cases } from '../cases';
import { scriptedCast, setCastFactory } from '../cast';
import { replay, score } from '../sim';
import { advance, setSpeed } from './loop';
import { decodeRun, encodeRun, sharedInputs } from './share';
import type { SharedRun } from './share';
import { useGame } from './store';

const c = cases['edge-rule']!;
const g = () => useGame.getState();

/** A won bot run, with a question asked in the chat, a refused act, an empty look and a hint. */
function botRun(): SharedRun {
  const { run } = playScript(c, [
    { at: 0, do: 'observe', arg: '' },
    { at: 250, do: 'update', arg: 'investigating' },
    { at: 300, do: 'observe', arg: 'ask:netops:volume' },
    { at: 300, do: 'observe', arg: 'graph:edge.saturation' },
    { at: 330, do: 'hint' },
    { at: 360, do: 'observe', arg: 'changes' },
    { at: 480, do: 'act', arg: 'filter_off' },
    { at: 481, do: 'act', arg: 'filter_off' },
    { at: 490, do: 'update', arg: 'cause_found' },
  ]);
  const r = decodeRun(encodeRun(c.id, c.version, c.seed, run.inputs), cases);
  if (!r.ok) throw new Error(r.reason);
  return r.run;
}

const direct = (shared: SharedRun) => {
  const run = replay(c, shared.s, sharedInputs(shared));
  return { run, score: score(c, run.log, run.snapshot) };
};

beforeEach(() => setCastFactory((k) => scriptedCast(k)));
afterEach(() => setSpeed(1));

describe('watching a replay', () => {
  it('rebuilds the run tick by tick through the loop and ends with the score of a direct replay', () => {
    const shared = botRun();
    const want = direct(shared);
    expect(want.score.outcome).toBe('won');
    g().watch(shared);
    expect(g()).toMatchObject({ screen: 'play', replaying: true, caseId: 'edge-rule' });
    // the tick-0 input is in already
    expect(g().run!.inputs).toHaveLength(1);
    for (let i = 0; i < 10_000 && g().snap!.status === 'running'; i++) advance(250);
    const run = g().run!;
    expect(run.log).toEqual(want.run.log);
    expect(score(c, run.log, run.snapshot)).toEqual(want.score);
    // the question asked is shown with its written answer
    expect(g().chat.some((l) => l.from === 'you' && l.to === 'netops')).toBe(true);
  });

  it('runs eight times faster than play', () => {
    g().watch(botRun());
    advance(250); // 1 tick at 4 ticks per second, times 8
    expect(g().snap!.tick).toBe(8);
  });

  it('nothing the viewer does reaches the run', async () => {
    g().watch(botRun());
    const before = g().run!.inputs.length;
    g().act('filter_off');
    g().observe('changes');
    g().update('investigating');
    g().hint();
    await g().ask('netops', 'volume');
    g().say('hello');
    expect(g().run!.inputs).toHaveLength(before);
    expect(g().chat).toEqual([]);
  });

  it('skip to result opens the debrief with the same score', () => {
    const shared = botRun();
    g().watch(shared);
    advance(250);
    g().skipReplay();
    const run = g().run!;
    expect(g().screen).toBe('debrief');
    expect(score(c, run.log, run.snapshot)).toEqual(direct(shared).score);
  });

  it('starting a run of your own ends the replay', () => {
    g().watch(botRun());
    g().start('edge-rule');
    expect(g().replaying).toBe(false);
    g().act('filter_off');
    expect(g().run!.inputs).toHaveLength(1);
  });

  it('the title and the briefing show a healthy city with no run', () => {
    g().showTitle({ text: 'That replay link is not valid.' });
    expect(g()).toMatchObject({ screen: 'title', caseId: 'edge-rule', run: null, notice: { text: 'That replay link is not valid.' } });
    expect(g().snap!.status).toBe('running');
    expect(g().snap!.impact.failed).toBe(0);
    g().brief('tutorial');
    expect(g()).toMatchObject({ screen: 'briefing', caseId: 'tutorial', run: null, notice: null });
    expect(g().snap!.tick).toBeLessThan(cases.tutorial!.timeline[0]!.at);
    advance(250);
    expect(g().snap!.tick).toBeLessThan(cases.tutorial!.timeline[0]!.at);
  });
});
