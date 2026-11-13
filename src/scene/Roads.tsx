import { useLayoutEffect, useMemo, useRef } from 'react';
import { BoxGeometry, InstancedMesh, MeshStandardMaterial, Object3D } from 'three';
import type { CaseFile } from '../cases';
import { worldPos } from './mapping';

/** Height of the road surface above the slab top. */
export const ROAD_TOP = 0.16;
const ROAD_WIDTH = 0.9;
const DASH = 0.32;
const DASH_STEP = 0.62;
/** Leave the ends under the plinths free of centre-line dashes. */
const END_CLEAR = 1.3;

const roadMat = new MeshStandardMaterial({ color: '#151d2e', roughness: 0.95 });
const lineMat = new MeshStandardMaterial({ color: '#56688a', roughness: 0.8, emissive: '#2b3a57', emissiveIntensity: 0.4 });
const unitBox = new BoxGeometry(1, 1, 1);

interface Segment { x: number; z: number; length: number; angle: number }

/** One straight segment per pair of connected buildings; two-way edges share a road. */
function segments(c: Pick<CaseFile, 'edges' | 'layout'>): Segment[] {
  const seen = new Set<string>();
  const out: Segment[] = [];
  for (const e of c.edges) {
    const a = c.layout[e.from];
    const b = c.layout[e.to];
    if (!a || !b) continue;
    const key = [e.from, e.to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const [ax, , az] = worldPos(a.pos);
    const [bx, , bz] = worldPos(b.pos);
    out.push({ x: (ax + bx) / 2, z: (az + bz) / 2, length: Math.hypot(bx - ax, bz - az), angle: -Math.atan2(bz - az, bx - ax) });
  }
  return out;
}

/** Slightly raised dark ribbons between connected buildings, with a faint dashed centre line. */
export function Roads({ c }: { c: Pick<CaseFile, 'edges' | 'layout'> }) {
  const segs = useMemo(() => segments(c), [c]);
  const dashes = useMemo(() => {
    const out: { x: number; z: number; angle: number }[] = [];
    for (const s of segs) {
      const usable = s.length - 2 * END_CLEAR;
      const n = Math.max(0, Math.floor(usable / DASH_STEP));
      const dx = Math.cos(-s.angle);
      const dz = Math.sin(-s.angle);
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * DASH_STEP;
        out.push({ x: s.x + dx * t, z: s.z + dz * t, angle: s.angle });
      }
    }
    return out;
  }, [segs]);

  const roads = useRef<InstancedMesh>(null);
  const lines = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const o = new Object3D();
    segs.forEach((s, i) => {
      o.position.set(s.x, ROAD_TOP / 2, s.z);
      o.rotation.set(0, s.angle, 0);
      o.scale.set(s.length, ROAD_TOP, ROAD_WIDTH);
      o.updateMatrix();
      roads.current?.setMatrixAt(i, o.matrix);
    });
    dashes.forEach((d, i) => {
      o.position.set(d.x, ROAD_TOP + 0.004, d.z);
      o.rotation.set(0, d.angle, 0);
      o.scale.set(DASH, 0.008, 0.07);
      o.updateMatrix();
      lines.current?.setMatrixAt(i, o.matrix);
    });
    if (roads.current) roads.current.instanceMatrix.needsUpdate = true;
    if (lines.current) lines.current.instanceMatrix.needsUpdate = true;
  }, [segs, dashes]);

  return (
    <group>
      {segs.length > 0 && <instancedMesh ref={roads} args={[unitBox, roadMat, segs.length]} receiveShadow />}
      {dashes.length > 0 && <instancedMesh ref={lines} args={[unitBox, lineMat, dashes.length]} />}
    </group>
  );
}
