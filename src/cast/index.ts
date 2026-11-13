import type { CaseFile } from '../cases';
import { aiCast } from './ai';
import type { AISettings } from './ai';
import { scriptedCast } from './scripted';
import { activeAiSettings } from './settings';
import type { Cast, CastHooks } from './types';

export { scriptedCast } from './scripted';
export { aiCast } from './ai';
export { cleanText } from './sanitize';
export type { AISettings } from './ai';
export type { Cast, CastContext, CastHooks, ChatLine, ReviewContext } from './types';

/** How long a scripted answer takes to arrive, for feel; none under test so nothing waits on the wall clock. */
const SCRIPTED_DELAY_MS = 300;

function underTest(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('test', '1');
}

/** True while the player has live characters switched on and set up. */
export function liveCharacters(): boolean {
  return activeAiSettings() !== null;
}

/**
 * The scripted cast, with free-text questions and the review going to the
 * player's own model whenever live characters are on. Settings are read at the
 * moment of asking, so switching them mid-run takes effect at once and the
 * scripted state (update windows, nudges) carries on undisturbed.
 */
function defaultCast(c: CaseFile, hooks: CastHooks): Cast {
  const scripted = scriptedCast(c, { delayMs: underTest() ? 0 : SCRIPTED_DELAY_MS });
  let live: { settings: AISettings; cast: Cast } | null = null;
  const current = (): Cast => {
    const settings = activeAiSettings();
    if (live?.settings !== settings) {
      live?.cast.stop?.();
      live = settings ? { settings, cast: aiCast(c, settings, scripted, undefined, hooks) } : null;
    }
    return live?.cast ?? scripted;
  };
  return {
    onEvent: (e, snap) => scripted.onEvent(e, snap),
    onTick: (snap) => scripted.onTick!(snap),
    ask: (...a) => current().ask(...a),
    /** present only while live characters are on: there is no scripted reviewer */
    get review() {
      const cast = current();
      return cast === scripted ? undefined : cast.review;
    },
    stop() {
      live?.cast.stop?.();
    },
  };
}

let factory: (c: CaseFile, hooks: CastHooks) => Cast = defaultCast;

/** The cast for a new run. The store calls this once per start(). */
export function makeCast(c: CaseFile, hooks: CastHooks): Cast {
  return factory(c, hooks);
}

/** Replaces the cast every later run gets. */
export function setCastFactory(f: (c: CaseFile, hooks: CastHooks) => Cast): void {
  factory = f;
}
