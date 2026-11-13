/** Test support: a scripted player and a random player for case tuning. Not shipped. */
import { createRun, makeRng, replay, score, type PlayerInput, type Run, type Score, type Snapshot } from '../../src/sim';
import type { CaseFile } from '../../src/cases';

export interface ScriptStep {
  at: number;
  do: PlayerInput['kind'];
  arg?: string;
}

const toInput = (s: ScriptStep): PlayerInput => {
  switch (s.do) {
    case 'act': return { tick: s.at, kind: 'act', id: s.arg ?? '' };
    case 'observe': return { tick: s.at, kind: 'observe', route: s.arg ?? '' };
    case 'update': return { tick: s.at, kind: 'update', id: s.arg ?? '' };
    case 'hint': return { tick: s.at, kind: 'hint' };
  }
};

/** Plays the script (sorted by tick) and runs on until the case ends. */
export function playScript(c: CaseFile, script: ScriptStep[], seed: number = c.seed): { run: Run; score: Score } {
  const inputs = [...script].sort((a, b) => a.at - b.at).map(toInput);
  const run = replay(c, seed, inputs);
  return { run, score: score(c, run.log, run.snapshot) };
}

/**
 * A random player: `steps` inputs of every kind, with valid and invalid ids,
 * each after a random jump forward. `sample` sees the snapshot at every tick
 * that is a multiple of 50.
 */
export function fuzz(c: CaseFile, seed: number, steps: number, sample?: (s: Snapshot) => void): Run {
  const rng = makeRng(seed);
  const run = createRun(c, seed);
  const pick = <T>(xs: readonly T[]): T => xs[rng.int(xs.length)]!;
  const actionIds = [...c.actions.map((a) => a.id), 'no_such_action', ''];
  const routes = [
    ...c.clues.map((x) => x.route), 'changes', 'graph:edge', 'graph:nowhere.queue', 'log:nowhere', 'ask:nobody:x', '',
  ];
  const updateIds = [...c.updates.map((u) => u.id), 'no_such_update'];
  const advance = (ticks: number): void => {
    for (let i = 0; i < ticks && run.snapshot.status === 'running'; i++) {
      run.step();
      if (sample && run.snapshot.tick % 50 === 0) sample(run.snapshot);
    }
  };
  for (let i = 0; i < steps && run.snapshot.status === 'running'; i++) {
    advance(rng.int(4) === 0 ? rng.int(60) : rng.int(8));
    switch (rng.int(4)) {
      case 0: run.act(pick(actionIds)); break;
      case 1: run.observe(pick(routes)); break;
      case 2: run.update(pick(updateIds)); break;
      default: run.hint();
    }
  }
  return run;
}
