import type { CaseFile } from '../cases';
import { scriptedCast } from './scripted';
import type { Cast } from './types';

export { scriptedCast } from './scripted';
export type { Cast, CastContext, ChatLine, ReviewContext } from './types';

/** How long a scripted answer takes to arrive, for feel; none under test so nothing waits on the wall clock. */
const SCRIPTED_DELAY_MS = 300;

function underTest(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('test', '1');
}

let factory: (c: CaseFile) => Cast = (c) => scriptedCast(c, { delayMs: underTest() ? 0 : SCRIPTED_DELAY_MS });

/** The cast for a new run. The store calls this once per start(). */
export function makeCast(c: CaseFile): Cast {
  return factory(c);
}

/** Replaces the cast every later run gets, e.g. with one backed by a language model. */
export function setCastFactory(f: (c: CaseFile) => Cast): void {
  factory = f;
}
