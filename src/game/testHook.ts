import { advance, setSpeed } from './loop';
import { useGame } from './store';
import type { GameState } from './store';

export interface DowntownTestHook {
  state(): GameState;
  setSpeed(n: number): void;
  advance(ms: number): void;
}

declare global {
  interface Window {
    __downtown?: DowntownTestHook;
  }
}

/** Installs window.__downtown only when the URL has test=1. */
export function installTestHook(): void {
  if (!new URLSearchParams(location.search).has('test', '1')) return;
  window.__downtown = {
    state: () => useGame.getState(),
    setSpeed,
    advance,
  };
}
