import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
} from 'three';
import type { CaseFile } from '../cases';
import { getSpeed } from '../game/loop';
import { useGame } from '../game/store';
import type { NodeView, Snapshot } from '../sim';
import type { BuildingParts } from './Building';
import { calmMotion, live, nodeLook } from './live';
import { tintInto, worldPos } from './mapping';
import { craneOn, glowLevel, healthyInflow, windowLevel, visualRng } from './traffic';

/** Emissive colour a saturated building's accent heats toward. */
const HOT = new Color('#ff1e0a');
/** Accent glow at rest, as Building sets it. */
const BASE_EMISSIVE = 0.6;
/** A building smokes once its glow passes this. */
const SMOKE_FROM = 0.5;

const SMOKE_POOL = 48;
/** Real seconds a puff lives, at normal speed. */
const PUFF_LIFE = 2.6;
/** Puffs per second from a building at full glow. */
const PUFF_RATE = 3;
const SMOKE_WARM = new Color('#ffa27a');
const SMOKE_GREY = new Color('#a3a9bd');
const puffGeo = new IcosahedronGeometry(1, 1);
const puffMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false });

/** Radius of the red pool on the ground around a building failing every other request or worse. */
const HALO_R = 2.1;
const HALO_RED = '#ff2412';
const haloGeo = new CircleGeometry(1, 40).rotateX(-Math.PI / 2);

/** A soft round spot, bright in the middle and gone at the rim. */
function haloTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new CanvasTexture(canvas);
}

type Metric = keyof NodeView;

/** A node's metric between the last two snapshots. */
function at(prev: Snapshot | null, snap: Snapshot, id: string, k: Metric, alpha: number): number {
  const now = snap.nodes[id]?.[k] ?? 0;
  const was = prev?.nodes[id]?.[k] ?? now;
  return was + (now - was) * alpha;
}

interface Puff {
  /** -1 when free */
  age: number;
  x: number;
  y: number;
  z: number;
  drift: number;
}

/**
 * Per-building looks drawn from the simulation every frame: accent tint from
 * the error rate, a pulsing warm glow and roof smoke when saturated, windows
 * that dim when the building is starved, and the crane after a change.
 */
export function Effects({ c, parts }: { c: CaseFile; parts: RefObject<Map<string, BuildingParts>> }) {
  const healthy = useMemo(() => healthyInflow(c), [c]);
  const ids = useMemo(() => Object.keys(c.layout), [c]);
  const centres = useMemo(() => new Map(ids.map((id) => [id, worldPos(c.layout[id]!.pos)])), [c, ids]);
  const smokeMesh = useRef<InstancedMesh>(null);
  const haloMesh = useRef<InstancedMesh>(null);
  const haloMat = useMemo(
    () =>
      new MeshBasicMaterial({
        map: haloTexture(),
        color: HALO_RED,
        opacity: 0.8,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    [],
  );
  useEffect(
    () => () => {
      haloMat.map?.dispose();
      haloMat.dispose();
    },
    [haloMat],
  );
  const fx = useRef({
    puffs: Array.from({ length: SMOKE_POOL }, (): Puff => ({ age: -1, x: 0, y: 0, z: 0, drift: 0 })),
    owed: new Map<string, number>(),
    rng: visualRng(0xc0ffee),
    clock: 0,
    hot: new Color(),
  });

  useFrame((_, rawDt) => {
    const g = useGame.getState();
    const snap = g.snap;
    if (!snap) return;
    const s = fx.current;
    const calm = calmMotion();
    const moving = !g.paused && snap.status === 'running';
    // smoke and pulse keep pace with the simulation, like the dots
    const dt = moving ? Math.min(rawDt, 0.1) * Math.min(Math.max(getSpeed(), 0), 4) : 0;
    s.clock += dt;

    const halos = haloMesh.current;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const look = nodeLook(id);
      const p = parts.current.get(id);
      const err = at(g.prev, snap, id, 'errorRate', g.alpha);
      tintInto(look.tint, err);
      const glow = glowLevel({
        saturation: at(g.prev, snap, id, 'saturation', g.alpha),
        queue: at(g.prev, snap, id, 'queue', g.alpha),
        dropped: at(g.prev, snap, id, 'dropped', g.alpha),
        arrivals: at(g.prev, snap, id, 'arrivals', g.alpha),
      });
      look.glow = glow;
      look.crane = craneOn(snap.changes, id, snap.tick);

      // a red pool on the ground whose area grows with the error rate: red spreading through the city
      if (halos) {
        const ctr = centres.get(id)!;
        const k = Math.min(1, Math.max(0, err / 0.5));
        const m = halos.instanceMatrix.array as Float32Array;
        const o = i * 16;
        m.fill(0, o, o + 16);
        m[o] = m[o + 10] = k < 0.04 ? 0 : HALO_R * Math.sqrt(k);
        m[o + 5] = 1;
        m[o + 12] = ctr[0];
        m[o + 13] = 0.11;
        m[o + 14] = ctr[2];
        m[o + 15] = 1;
      }
      if (!p) continue;

      const [r, gr, b] = look.tint;
      p.accent.color.setRGB(r, gr, b);
      s.hot.setRGB(r, gr, b).lerp(HOT, glow);
      p.accent.emissive.copy(s.hot);
      const pulse = calm ? 0.5 : 0.5 + 0.5 * Math.sin(s.clock * 5);
      // kept low enough that tone mapping leaves the red red instead of washing it to orange
      p.accent.emissiveIntensity = BASE_EMISSIVE + glow * (0.1 + 0.55 * pulse);

      p.windows.color.setScalar(windowLevel(at(g.prev, snap, id, 'arrivals', g.alpha), healthy[id] ?? 0));

      p.crane.visible = look.crane;
      const beacon = p.crane.children[p.crane.children.length - 1];
      if (beacon) beacon.visible = calm || s.clock % 1.2 < 0.6;

      // owe this building puffs in proportion to its glow
      if (!calm && glow > SMOKE_FROM && dt > 0) {
        let owed = (s.owed.get(id) ?? 0) + dt * PUFF_RATE * glow;
        while (owed >= 1) {
          owed -= 1;
          const free = s.puffs.find((q) => q.age < 0);
          if (!free) break;
          const ctr = centres.get(id)!;
          free.age = 0;
          // from the right of the roof, drifting off sideways: clear of the label above the
          // middle, and low enough not to drift over the building behind
          free.x = ctr[0] + 0.3 + s.rng() * 0.3;
          free.y = p.top + 0.05;
          free.z = ctr[2] + (s.rng() - 0.5) * 0.4;
          free.drift = 1.1 + s.rng() * 0.6;
        }
        s.owed.set(id, owed);
      } else s.owed.set(id, 0);
    }

    if (halos) {
      halos.count = ids.length;
      halos.instanceMatrix.needsUpdate = true;
    }

    const mesh = smokeMesh.current;
    if (!mesh) return;
    let n = 0;
    for (const q of s.puffs) {
      if (q.age < 0) continue;
      if (calm) {
        q.age = -1;
        continue;
      }
      q.age += dt / PUFF_LIFE;
      if (q.age >= 1) {
        q.age = -1;
        continue;
      }
      const a = q.age;
      // swell as it rises and drifts downwind, then thin away to nothing
      const size = (0.2 + 0.4 * a) * Math.sqrt(a < 0.12 ? a / 0.12 : (1 - a) / 0.88);
      const m = mesh.instanceMatrix.array as Float32Array;
      const o = n * 16;
      m.fill(0, o, o + 16);
      m[o] = m[o + 5] = m[o + 10] = size;
      m[o + 12] = q.x + a * q.drift;
      m[o + 13] = q.y + a * 0.75;
      m[o + 14] = q.z;
      m[o + 15] = 1;
      s.hot.copy(SMOKE_WARM).lerp(SMOKE_GREY, Math.min(1, a * 2.2));
      mesh.setColorAt(n, s.hot);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    live.smoke = n;
  });

  return (
    <group>
      <instancedMesh
        ref={(mesh) => {
          haloMesh.current = mesh;
          if (mesh) mesh.count = 0;
        }}
        args={[haloGeo, haloMat, Math.max(1, ids.length)]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={(mesh) => {
          smokeMesh.current = mesh;
          if (mesh && !mesh.instanceColor) {
            mesh.setColorAt(0, SMOKE_GREY);
            mesh.count = 0;
          }
        }}
        args={[puffGeo, puffMat, SMOKE_POOL]}
        frustumCulled={false}
        renderOrder={2}
      />
    </group>
  );
}
