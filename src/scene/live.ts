import { useGame } from '../game/store';
import type { Vec3 } from './mapping';

/**
 * What the board drew on its last frame, written in place by the per-frame
 * code (no allocation) and read by the test hook. These are the same numbers
 * the scene renders from, not a second calculation.
 */
export interface NodeLook {
  tint: Vec3;
  glow: number;
  queue: number;
  crane: boolean;
}

export const live = {
  dots: 0,
  okDots: 0,
  retryDots: 0,
  failedDots: 0,
  smoke: 0,
  nodes: {} as Record<string, NodeLook>,
};

/** The look record for a building, created once and then updated in place. */
export function nodeLook(id: string): NodeLook {
  return (live.nodes[id] ??= { tint: [0, 0, 0], glow: 0, queue: 0, crane: false });
}

/** Forgets every building (a new case mounts a new board). */
export function resetLive(): void {
  live.dots = live.okDots = live.retryDots = live.failedDots = live.smoke = 0;
  live.nodes = {};
}

const FPS_WINDOW = 60;
const frameTimes = new Float32Array(FPS_WINDOW);
let frames = 0;
let frameSum = 0;

/** Records one frame's duration in seconds for the rolling frame rate. */
export function recordFrame(dt: number): void {
  const i = frames % FPS_WINDOW;
  frameSum += dt - frameTimes[i]!;
  frameTimes[i] = dt;
  frames++;
}

/** Frames per second over the last 60 frames; 0 before the first. */
export function fps(): number {
  const n = Math.min(frames, FPS_WINDOW);
  return n > 0 && frameSum > 0 ? n / frameSum : 0;
}

/** Frames recorded so far, capped at the window size. */
export function fpsSamples(): number {
  return Math.min(frames, FPS_WINDOW);
}

/** True when the player asks for less motion (Settings; it starts from the system's preference). */
export function calmMotion(): boolean {
  return useGame.getState().reducedMotion;
}
