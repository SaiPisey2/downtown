import { advance, setSpeed } from './loop';
import { useGame } from './store';
import type { GameState } from './store';

type Vec3 = [number, number, number];

/** What the board offers the test hook while it is on screen. */
export interface SceneProbe {
  camera(): { position: Vec3; target: Vec3 };
  /** distinct colours in a coarse sample of the rendered canvas */
  canvasColors(): number;
}

export interface DowntownTestHook {
  state(): GameState;
  setSpeed(n: number): void;
  advance(ms: number): void;
  camera(): { position: Vec3; target: Vec3 };
  canvasColors(): number;
}

declare global {
  interface Window {
    __downtown?: DowntownTestHook;
  }
}

let probe: SceneProbe | null = null;

/** The board registers itself here while mounted; null when it goes away. */
export function setSceneProbe(p: SceneProbe | null): void {
  probe = p;
}

function needProbe(): SceneProbe {
  if (!probe) throw new Error('no board on screen');
  return probe;
}

/** Installs window.__downtown only when the URL has test=1. */
export function installTestHook(): void {
  if (!new URLSearchParams(location.search).has('test', '1')) return;
  window.__downtown = {
    state: () => useGame.getState(),
    setSpeed,
    advance,
    camera: () => needProbe().camera(),
    canvasColors: () => needProbe().canvasColors(),
  };
}
