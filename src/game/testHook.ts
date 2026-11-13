import { setAutoDebrief } from './flow';
import { advance, setSpeed } from './loop';
import { useGame } from './store';
import type { GameState } from './store';

type Vec3 = [number, number, number];

export interface SceneStats {
  dots: number;
  okDots: number;
  retryDots: number;
  failedDots: number;
  smoke: number;
  nodes: Record<string, { tint: Vec3; glow: number; queue: number; crane: boolean }>;
}

/** What the board offers the test hook while it is on screen. */
export interface SceneProbe {
  camera(): { position: Vec3; target: Vec3 };
  /** distinct colours in a coarse sample of the rendered canvas */
  canvasColors(): number;
  /** traffic and per-building looks as drawn on the last frame */
  sceneStats(): SceneStats;
  /** rolling average frame rate */
  fps(): number;
  /** page (CSS pixel) position of a building's body */
  nodeScreen(id: string): [number, number];
}

export interface DowntownTestHook {
  state(): GameState;
  setSpeed(n: number): void;
  advance(ms: number): void;
  /** the debrief opening by itself after the end banner's beat; off under the hook until turned on */
  setAutoDebrief(on: boolean): void;
  camera(): { position: Vec3; target: Vec3 };
  canvasColors(): number;
  sceneStats(): SceneStats;
  fps(): number;
  nodeScreen(id: string): [number, number];
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
    setAutoDebrief,
    camera: () => needProbe().camera(),
    canvasColors: () => needProbe().canvasColors(),
    sceneStats: () => needProbe().sceneStats(),
    fps: () => needProbe().fps(),
    nodeScreen: (id) => needProbe().nodeScreen(id),
  };
}
