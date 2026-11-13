import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, IcosahedronGeometry, InstancedMesh, MeshBasicMaterial } from 'three';
import type { CaseFile } from '../cases';
import { getSpeed } from '../game/loop';
import { useGame } from '../game/store';
import type { Snapshot } from '../sim';
import { calmMotion, fps, fpsSamples, live, nodeLook, recordFrame } from './live';
import { worldPos } from './mapping';
import { ROAD_TOP } from './Roads';
import { QUEUE_STACK, dotBudget, healthyInflow, queueStack, stepDots, stepThinning, visualRng } from './dots';
import type { Dot, DotBudget } from './dots';

/** Instance capacity of the dot mesh; also the most dots ever shown. */
export const DOT_CAPACITY = 2000;
/** Dots per board unit of visible road, before the capacity applies. */
const DOTS_PER_UNIT = 30;
/** Distance from a building's centre to where its road shows past the plinth. */
const DOOR = 1.2;
const DOT_R = 0.052;
const DOT_Y = ROAD_TOP + DOT_R;
/** Real seconds a failed dot takes to fall, at normal speed. */
const FALL_SECONDS = 0.5;
/** Most simulated ticks one frame may move the dots, so a stalled tab does not teleport them. */
const MAX_FRAME_TICKS = 2;

const OK = new Color('#c4fff2');
const RETRY = new Color('#ffad33');
const FAILED = new Color('#ff2b1c');
const WAITING = new Color('#ffe0a0');
/** Queue beads per column, how far beside the road centre the pile stands, and the height of its lowest bead. */
const QUEUE_PILE = 4;
const QUEUE_KERB = 0.62;
const QUEUE_FLOOR = 0.16;

// 20 triangles: at a few pixels across, a finer sphere looks the same and costs four times as much
const dotGeo = new IcosahedronGeometry(DOT_R, 0);
const dotMat = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const beadGeo = new IcosahedronGeometry(0.06, 0);

interface Lane {
  /** start of the visible road */
  ax: number;
  az: number;
  /** unit direction of travel */
  dx: number;
  dz: number;
  /** visible length */
  len: number;
  /** centre and width of the band of road the dots use, across the road (positive is right of travel) */
  mid: number;
  spread: number;
}

/** Where each edge's dots run: between the plinths, in the right-hand half when the road is two-way. */
function lanes(c: Pick<CaseFile, 'edges' | 'layout'>): Map<string, Lane> {
  const out = new Map<string, Lane>();
  const ids = new Set(c.edges.map((e) => `${e.from}>${e.to}`));
  for (const e of c.edges) {
    const a = c.layout[e.from];
    const b = c.layout[e.to];
    if (!a || !b) continue;
    const [ax, , az] = worldPos(a.pos);
    const [bx, , bz] = worldPos(b.pos);
    const full = Math.hypot(bx - ax, bz - az);
    if (full <= 2 * DOOR) continue;
    const dx = (bx - ax) / full;
    const dz = (bz - az) / full;
    const twoWay = ids.has(`${e.to}>${e.from}`);
    out.set(`${e.from}>${e.to}`, {
      ax: ax + dx * DOOR,
      az: az + dz * DOOR,
      dx,
      dz,
      len: full - 2 * DOOR,
      mid: twoWay ? 0.2 : 0,
      spread: twoWay ? 0.24 : 0.5,
    });
  }
  return out;
}

interface Door {
  id: string;
  /** the spot just outside the plinth where the queue starts */
  x: number;
  z: number;
  /** direction the queue grows in (back along the busiest road in), and across it */
  bx: number;
  bz: number;
  queueMax: number;
}

/** Each building's door on its inbound side; the entry's is on the far side of its first road out. */
function doors(c: CaseFile): Door[] {
  const healthy = healthyInflow(c);
  const out: Door[] = [];
  for (const [id, n] of Object.entries(c.layout)) {
    const [x, , z] = worldPos(n.pos);
    const inbound = c.edges
      .filter((e) => e.to === id && c.layout[e.from])
      .sort((p, q) => healthy[q.from]! * q.fanout - healthy[p.from]! * p.fanout)[0];
    const outbound = c.edges.find((e) => e.from === id && c.layout[e.to]);
    let bx = 0;
    let bz = 1;
    if (inbound) {
      const [fx, , fz] = worldPos(c.layout[inbound.from]!.pos);
      const d = Math.hypot(fx - x, fz - z) || 1;
      bx = (fx - x) / d;
      bz = (fz - z) / d;
    } else if (outbound) {
      const [tx, , tz] = worldPos(c.layout[outbound.to]!.pos);
      const d = Math.hypot(tx - x, tz - z) || 1;
      bx = -(tx - x) / d;
      bz = -(tz - z) / d;
    }
    out.push({ id, x: x + bx * (DOOR + 0.08), z: z + bz * (DOOR + 0.08), bx, bz, queueMax: c.nodes[id]?.queueMax ?? 0 });
  }
  return out;
}

/** Writes a uniformly scaled, unrotated instance matrix straight into the buffer. */
function place(m: Float32Array, i: number, x: number, y: number, z: number, s: number): void {
  const o = i * 16;
  m[o] = s;
  m[o + 1] = 0;
  m[o + 2] = 0;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = s;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = 0;
  m[o + 9] = 0;
  m[o + 10] = s;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
}

/** Shows the first `n` instances and sends only those to the GPU. */
function upload(mesh: InstancedMesh, n: number): void {
  mesh.count = n;
  sendFirst(mesh.instanceMatrix, n * 16);
  if (mesh.instanceColor) sendFirst(mesh.instanceColor, n * 3);
}

function sendFirst(attr: InstancedMesh['instanceMatrix'], count: number): void {
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, Math.max(1, count));
  attr.needsUpdate = true;
}

function paint(c: Float32Array, i: number, col: Color, k = 1): void {
  c[i * 3] = col.r * k;
  c[i * 3 + 1] = col.g * k;
  c[i * 3 + 2] = col.b * k;
}

/**
 * Moving dots on the roads and queues at the doors. Everything per frame runs
 * on refs and instance buffers: no React state, no allocation per dot.
 */
export function Traffic({ c }: { c: CaseFile }) {
  const dotsMesh = useRef<InstancedMesh>(null);
  const beadsMesh = useRef<InstancedMesh>(null);
  const roadLanes = useMemo(() => lanes(c), [c]);
  const doorList = useMemo(() => doors(c), [c]);
  const sim = useRef({
    dots: [] as Dot[],
    rng: visualRng(0x5eed),
    budget: {} as DotBudget,
    budgetFor: null as Snapshot | null,
    thin: { maxDots: DOT_CAPACITY, slow: 0 },
    budgetMax: -1,
  });

  useEffect(() => {
    let length = 0;
    for (const l of roadLanes.values()) length += l.len;
    const s = sim.current;
    s.dots = [];
    s.thin.maxDots = Math.min(DOT_CAPACITY, Math.round(length * DOTS_PER_UNIT));
    s.budgetFor = null;
  }, [roadLanes]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    recordFrame(rawDt);
    const s = sim.current;
    if (fpsSamples() >= 60) stepThinning(s.thin, fps(), dt);

    const g = useGame.getState();
    const snap = g.snap;
    if (!snap) return;
    if (snap !== s.budgetFor || s.thin.maxDots !== s.budgetMax) {
      s.budget = dotBudget(snap.edges, s.thin.maxDots);
      s.budgetFor = snap;
      s.budgetMax = s.thin.maxDots;
    }
    const moving = !g.paused && snap.status === 'running';
    const tps = c.ticksPerSecond;
    const dtTicks = moving ? Math.min(dt * tps * getSpeed() * (calmMotion() ? 0.5 : 1), MAX_FRAME_TICKS) : 0;
    stepDots(s.dots, s.budget, dtTicks, s.rng, FALL_SECONDS * tps);

    const mesh = dotsMesh.current;
    if (mesh?.instanceColor) {
      const m = mesh.instanceMatrix.array as Float32Array;
      const col = mesh.instanceColor.array as Float32Array;
      let n = 0;
      let ok = 0;
      let retry = 0;
      let failed = 0;
      for (const d of s.dots) {
        if (n >= DOT_CAPACITY) break;
        const l = roadLanes.get(d.edge);
        if (!l) continue;
        const along = d.t * l.len;
        let across = l.mid + (d.lane - 0.5) * l.spread;
        let y = DOT_Y;
        let size = 1;
        if (d.kind === 'failed') {
          failed++;
          if (d.fall > 0) {
            // turned away: red, off the side of the road and down onto the slab
            across += (across >= l.mid ? 1 : -1) * d.fall * 0.75;
            y -= d.fall * d.fall * 0.2;
            size = 1 - 0.45 * d.fall;
            paint(col, n, FAILED);
          } else {
            const b = s.budget[d.edge];
            const retryShare = b ? b.retry / Math.max(1, b.ok + b.retry) : 0;
            paint(col, n, (d.lane * 7.31) % 1 < retryShare ? RETRY : OK);
          }
        } else if (d.kind === 'retry') {
          retry++;
          paint(col, n, RETRY);
        } else {
          ok++;
          paint(col, n, OK);
        }
        // right of travel is (-dz, dx)
        place(m, n, l.ax + l.dx * along - l.dz * across, y, l.az + l.dz * along + l.dx * across, size);
        n++;
      }
      upload(mesh, n);
      live.dots = n;
      live.okDots = ok;
      live.retryDots = retry;
      live.failedDots = failed;
    }

    const beads = beadsMesh.current;
    if (beads?.instanceColor) {
      const m = beads.instanceMatrix.array as Float32Array;
      const col = beads.instanceColor.array as Float32Array;
      const prev = g.prev;
      let n = 0;
      for (const door of doorList) {
        const now = snap.nodes[door.id]?.queue ?? 0;
        const was = prev?.nodes[door.id]?.queue ?? now;
        const k = queueStack(was + (now - was) * g.alpha, door.queueMax);
        nodeLook(door.id).queue = k;
        for (let j = 0; j < k; j++) {
          // piled four high on the kerb beside the road in, the pile growing back from the door
          const back = Math.floor(j / QUEUE_PILE) * 0.14;
          const up = j % QUEUE_PILE;
          const x = door.x + door.bx * back + door.bz * QUEUE_KERB;
          const z = door.z + door.bz * back - door.bx * QUEUE_KERB;
          place(m, n, x, QUEUE_FLOOR + up * 0.115, z, 1);
          paint(col, n, WAITING, 1 - 0.05 * up);
          n++;
        }
      }
      upload(beads, n);
    }
  });

  // instanceColor exists only once a colour has been set; seed both meshes with one
  const seed = (mesh: InstancedMesh | null) => {
    if (mesh && !mesh.instanceColor) {
      mesh.setColorAt(0, OK);
      mesh.count = 0;
    }
  };
  return (
    <group>
      <instancedMesh
        ref={(mesh) => {
          dotsMesh.current = mesh;
          seed(mesh);
        }}
        args={[dotGeo, dotMat, DOT_CAPACITY]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={(mesh) => {
          beadsMesh.current = mesh;
          seed(mesh);
        }}
        args={[beadGeo, dotMat, QUEUE_STACK * Math.max(1, doorList.length)]}
        frustumCulled={false}
      />
    </group>
  );
}
