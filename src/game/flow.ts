/** The case the title screen shows and "Play" leads to. */
export const MAIN_CASE = 'edge-rule';
/** The case a first visit plays before the main one. */
export const TUTORIAL_CASE = 'tutorial';
/** How long the end banner stays before the debrief opens by itself. */
export const DEBRIEF_BEAT_MS = 2_000;
/** Simulated ticks per real tick while watching a replay. */
export const REPLAY_SPEED = 8;

const TUTORIAL_FLAG = 'downtown.tutorialDone';

function tab(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** True once the tutorial was finished or skipped in this tab. A browser that blocks storage always says false. */
export function tutorialDone(): boolean {
  try {
    return tab()?.getItem(TUTORIAL_FLAG) === '1';
  } catch {
    return false;
  }
}

/** Remembers for this tab that the tutorial was finished or skipped. */
export function markTutorialDone(): void {
  try {
    tab()?.setItem(TUTORIAL_FLAG, '1');
  } catch {
    // storage refused: the tutorial is offered again next time, nothing worse
  }
}

function underTest(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('test') === '1';
}

/** Off under the test hook so earlier tests can keep working on the end banner; the hook turns it on. */
let autoDebrief = !underTest();

export function autoDebriefOn(): boolean {
  return autoDebrief;
}

/** Test-hook only. */
export function setAutoDebrief(on: boolean): void {
  autoDebrief = on;
}
