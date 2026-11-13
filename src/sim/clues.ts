import { evalCond } from './cond';
import type { CaseModel, ClueDef, Snapshot } from './types';

/**
 * The clues a look at `route` would find now: on that route, not found yet,
 * and with a `when` that holds in `snap`. Pure; `observe` finds exactly these.
 */
export function findableClues(
  model: Pick<CaseModel, 'clues'>,
  route: string,
  snap: Snapshot,
  found: ReadonlySet<string> | readonly string[],
): ClueDef[] {
  const has = (id: string): boolean => ('has' in found ? found.has(id) : found.includes(id));
  return model.clues.filter((c) => c.route === route && !has(c.id) && (!c.when || evalCond(c.when, snap)));
}
