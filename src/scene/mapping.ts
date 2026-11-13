import type { CaseFile } from '../cases';

/** Pure maps from case data to board space. No three.js here, so it runs in Node. */

export type Vec3 = [number, number, number];
type Layout = CaseFile['layout'];
type XZ = [number, number];

/** Board units per layout grid step. */
export const GRID = 3;

const deg = Math.PI / 180;

/** Orbit limits, shared by the camera rig and the home view. */
export const CAMERA = {
  minPolar: 20 * deg,
  maxPolar: 75 * deg,
  homePolar: 50 * deg,
  minDistance: 12,
  maxDistance: 60,
  fov: 35,
} as const;

const CALM: Vec3 = [0.03, 0.42, 0.36];
const ALARM: Vec3 = [0.75, 0.04, 0.03];

/** Linear RGB: calm teal at 0, red at an error rate of 0.5 or more. */
export function tint(errorRate: number): Vec3 {
  return tintInto([0, 0, 0], errorRate);
}

/** `tint`, written into `out` (for per-frame use without allocating). */
export function tintInto(out: Vec3, errorRate: number): Vec3 {
  const t = Number.isFinite(errorRate) ? Math.min(Math.max(errorRate / 0.5, 0), 1) : 0;
  for (let i = 0; i < 3; i++) out[i] = CALM[i]! + (ALARM[i]! - CALM[i]!) * t;
  return out;
}

const BASE_HEIGHT: Record<string, number> = {
  gate: 1.5,
  proxy: 1.3,
  filter: 2.6,
  service: 1.9,
  cache: 1.4,
  database: 1.5,
  queue: 0.9,
};

/** Height of a building's body: a per-kind base plus a little for each doubling of instances. */
export function buildingHeight(kind: string, instances: number): number {
  const n = Number.isFinite(instances) ? Math.min(Math.max(instances, 0), 64) : 0;
  return (BASE_HEIGHT[kind] ?? 1.8) + 0.4 * Math.log2(1 + n);
}

/** A layout grid position on the ground plane: x stays x, y becomes z. */
export function worldPos(pos: [number, number]): Vec3 {
  return [pos[0] * GRID, 0, pos[1] * GRID];
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Margin of slab around the outermost buildings. */
const BOARD_MARGIN = 3.6;

/** The slab's footprint: every building plus a margin. */
export function boardBounds(layout: Layout): Bounds {
  const pts = Object.values(layout).map((n) => worldPos(n.pos));
  if (pts.length === 0) return { minX: -BOARD_MARGIN, maxX: BOARD_MARGIN, minZ: -BOARD_MARGIN, maxZ: BOARD_MARGIN };
  return {
    minX: Math.min(...pts.map((p) => p[0])) - BOARD_MARGIN,
    maxX: Math.max(...pts.map((p) => p[0])) + BOARD_MARGIN,
    minZ: Math.min(...pts.map((p) => p[2])) - BOARD_MARGIN,
    maxZ: Math.max(...pts.map((p) => p[2])) + BOARD_MARGIN,
  };
}

/** Highest the camera's orbit point may rise above the ground. */
const TARGET_CEILING = 4;

/** The nearest point to `target` that keeps the camera's orbit point over the board. */
export function clampTarget(b: Bounds, target: Vec3): Vec3 {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return [clamp(target[0], b.minX, b.maxX), clamp(target[1], 0, TARGET_CEILING), clamp(target[2], b.minZ, b.maxZ)];
}

/** Looks at the centroid from the south, far enough back to frame the whole slab. */
export function homeView(layout: Layout): { position: Vec3; target: Vec3 } {
  const pts = Object.values(layout).map((n) => worldPos(n.pos));
  const target: Vec3 = pts.length
    ? ([0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i]!, 0) / pts.length) as Vec3)
    : [0, 0, 0];
  const b = boardBounds(layout);
  // the frame is wider than tall, so depth counts for more than width
  const span = Math.max(b.maxX - b.minX, (b.maxZ - b.minZ) * 1.7);
  const d = Math.min(Math.max(span * 1.35, CAMERA.minDistance + 4), CAMERA.maxDistance - 4);
  const p = CAMERA.homePolar;
  return { target, position: [target[0], target[1] + d * Math.cos(p), target[2] + d * Math.sin(p)] };
}

/** Convex hull, counter-clockwise in (x, z), duplicates removed (monotone chain). */
function hull(points: XZ[]): XZ[] {
  const pts = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (pts.length < 3) return pts;
  const cross = (o: XZ, a: XZ, b: XZ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: XZ[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: XZ[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Outline of the convex hull of `points` grown by `radius`: straight sides
 * joined by round corners. One point gives a circle, two give a stadium.
 */
export function padOutline(points: XZ[], radius: number, stepsPerTurn = 48): XZ[] {
  const h = hull(points);
  if (h.length === 0) return [];
  if (h.length === 1) {
    const [cx, cz] = h[0]!;
    return Array.from({ length: stepsPerTurn }, (_, i) => {
      const a = (i / stepsPerTurn) * 2 * Math.PI;
      return [cx + radius * Math.cos(a), cz + radius * Math.sin(a)] as XZ;
    });
  }
  // outward normal angle of the edge a -> b for a counter-clockwise hull
  const normal = (a: XZ, b: XZ) => Math.atan2(-(b[0] - a[0]), b[1] - a[1]);
  const out: XZ[] = [];
  for (let i = 0; i < h.length; i++) {
    const prev = h[(i - 1 + h.length) % h.length]!;
    const cur = h[i]!;
    const next = h[(i + 1) % h.length]!;
    const a0 = normal(prev, cur);
    let a1 = normal(cur, next);
    while (a1 < a0) a1 += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(((a1 - a0) / (2 * Math.PI)) * stepsPerTurn));
    for (let s = 0; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      out.push([cur[0] + radius * Math.cos(a), cur[1] + radius * Math.sin(a)]);
    }
  }
  return out;
}

function segDist(p: XZ, a: XZ, b: XZ): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

/** Shortest distance between two convex hulls that do not overlap. */
function hullDist(a: XZ[], b: XZ[]): number {
  const edges = (h: XZ[]): [XZ, XZ][] => h.map((p, i) => [p, h[(i + 1) % h.length]!]);
  let d = Infinity;
  for (const p of a) for (const [s, e] of edges(b)) d = Math.min(d, segDist(p, s, e));
  for (const p of b) for (const [s, e] of edges(a)) d = Math.min(d, segDist(p, s, e));
  return d;
}

export type District = 'edge' | 'app' | 'data';
export const DISTRICTS: readonly District[] = ['edge', 'app', 'data'];

/** Each district's building positions in board space (x, z). */
export function districtPoints(layout: Layout): Record<District, XZ[]> {
  const out: Record<District, XZ[]> = { edge: [], app: [], data: [] };
  for (const n of Object.values(layout)) {
    const [x, , z] = worldPos(n.pos);
    out[n.district].push([x, z]);
  }
  return out;
}

/** One radius for every district pad: as large as looks right, small enough to leave a gap. */
export function padRadius(layout: Layout): number {
  const pts = districtPoints(layout);
  const hulls = DISTRICTS.map((d) => hull(pts[d])).filter((h) => h.length > 0);
  let gap = Infinity;
  for (let i = 0; i < hulls.length; i++) {
    for (let j = i + 1; j < hulls.length; j++) gap = Math.min(gap, hullDist(hulls[i]!, hulls[j]!));
  }
  return Math.min(2.3, Math.max(1.3, gap / 2 - 0.25));
}

/** Camera orbit in spherical terms around the target: theta is azimuth, phi is polar angle from +y. */
export interface Orbit {
  theta: number;
  phi: number;
  radius: number;
}

/**
 * Keyboard intent as signed rates (or, with dt = 1, signed key-seconds): yaw
 * (positive turns right), pitch (positive tilts toward the horizon), zoom (positive moves in).
 */
export interface OrbitInput {
  yaw: number;
  pitch: number;
  zoom: number;
}

/** Radians per second of yaw and pitch, and e-folds per second of zoom, for held keys. */
export const KEY_RATES = { yaw: 1.6, pitch: 0.9, zoom: 1.4 } as const;

/** One keyboard step of the orbit, held inside the polar and distance limits. */
export function stepOrbit(o: Orbit, input: OrbitInput, dt: number): Orbit {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  return {
    theta: o.theta + input.yaw * KEY_RATES.yaw * dt,
    phi: clamp(o.phi + input.pitch * KEY_RATES.pitch * dt, CAMERA.minPolar, CAMERA.maxPolar),
    radius: clamp(o.radius * Math.exp(-input.zoom * KEY_RATES.zoom * dt), CAMERA.minDistance, CAMERA.maxDistance),
  };
}
