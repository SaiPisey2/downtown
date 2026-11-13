import { createRun } from './run';
import type { Run } from './run';
import type { CaseModel, PlayerInput } from './types';

/**
 * Re-plays recorded inputs (non-decreasing tick order) and then runs on until
 * the run ends. Inputs timed after the end of the run are ignored.
 */
export function replay(model: CaseModel, seed: number, inputs: PlayerInput[]): Run {
  const run = createRun(model, seed);
  for (const input of inputs) {
    if (input.tick > run.snapshot.tick) run.step(input.tick - run.snapshot.tick);
    if (input.tick > run.snapshot.tick) continue; // the run ended before this input
    switch (input.kind) {
      case 'act': run.act(input.id); break;
      case 'observe': run.observe(input.route); break;
      case 'update': run.update(input.id); break;
      case 'hint': run.hint(); break;
    }
  }
  while (run.snapshot.status === 'running') run.step(run.snapshot.tick < model.maxTicks ? model.maxTicks - run.snapshot.tick : 1);
  return run;
}
