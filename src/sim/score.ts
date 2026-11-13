import type { CaseModel, GameEvent, Snapshot } from './types';

export interface Score {
  total: number;
  detect: number;
  recover: number;
  traffic: number;
  harm: number;
  updates: number;
  outcome: 'won' | 'lost';
  ticks: number;
  hints: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const HINT_COST = 3;

export function score(model: CaseModel, log: readonly GameEvent[], final: Snapshot): Score {
  const { detectParTicks, recoverParTicks, updateEveryTicks } = model.scoring;
  const first = (type: GameEvent['type']): GameEvent | undefined => log.find((e) => e.type === type);
  const firstFault = (first('fault') ?? first('deploy'))?.tick ?? 0;

  const keyIds = new Set(model.clues.filter((c) => c.key).map((c) => c.id));
  const keyClue = log.find((e) => e.type === 'clue' && keyIds.has(e.clueId));
  const detect = keyClue ? 15 * clamp01(2 - (keyClue.tick - firstFault) / detectParTicks) : 0;

  const won = first('won');
  const recover = won ? 35 * clamp01(2 - (won.tick - firstFault) / recoverParTicks) : 0;

  const traffic = Math.max(0, 25 * (1 - final.impact.failed / model.lose.maxFailedRequests));

  const harmful = new Set(model.actions.filter((a) => a.harmful).map((a) => a.id));
  const landedHarm = log.filter((e) => e.type === 'action_landed' && harmful.has(e.actionId)).length;
  const harm = Math.max(0, 15 - 5 * landedHarm);

  const honest = new Set(model.updates.filter((u) => u.honest).map((u) => u.id));
  const honestTicks = log.filter((e) => e.type === 'update' && honest.has(e.id)).map((e) => e.tick);
  const windows = Math.floor((final.tick - firstFault) / updateEveryTicks);
  let covered = 0;
  for (let w = 0; w < windows; w++) {
    const lo = firstFault + w * updateEveryTicks;
    if (honestTicks.some((t) => t >= lo && t < lo + updateEveryTicks)) covered++;
  }
  const updates = windows > 0 ? 10 * (covered / windows) : 10;

  const hints = log.filter((e) => e.type === 'hint' && e.clueId !== null).length;
  const parts = [detect, recover, traffic, harm, updates].map(Math.round) as [number, number, number, number, number];
  const total = Math.max(0, parts[0] + parts[1] + parts[2] + parts[3] + parts[4] - HINT_COST * hints);
  return {
    total, detect: parts[0], recover: parts[1], traffic: parts[2], harm: parts[3], updates: parts[4],
    outcome: final.status === 'won' ? 'won' : 'lost', ticks: final.tick, hints,
  };
}
