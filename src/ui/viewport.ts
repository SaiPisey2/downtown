import { useSyncExternalStore } from 'react';

/** Narrower than this, in CSS pixels, the game is not offered: the docks and the city need the room. */
export const MIN_WIDTH = 900;

/** True while the window is too narrow to play. */
export function isNarrow(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MIN_WIDTH;
}

function onResize(change: () => void): () => void {
  window.addEventListener('resize', change);
  return () => window.removeEventListener('resize', change);
}

/** isNarrow(), re-read whenever the window is resized. */
export function useNarrow(): boolean {
  return useSyncExternalStore(onResize, isNarrow, () => false);
}
