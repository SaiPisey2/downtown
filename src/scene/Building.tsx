import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CaseFile } from '../cases';
import { useGame } from '../game/store';
import { calmMotion } from './live';
import { tint } from './mapping';
import type { Vec3 } from './mapping';

type Kind = CaseFile['layout'][string]['kind'];

/** Height of the plinth every building stands on. */
const PLINTH = 0.22;

const slate = new MeshStandardMaterial({ color: '#c3ccd8', roughness: 0.78, metalness: 0.05 });
const slateDark = new MeshStandardMaterial({ color: '#8d99ab', roughness: 0.85 });
const plinthMat = new MeshStandardMaterial({ color: '#3b4960', roughness: 0.9 });
const ringMat = new MeshBasicMaterial({ color: '#5eead4', toneMapped: false, transparent: true, opacity: 0.9 });
const windowGeo = new PlaneGeometry(0.15, 0.19);
const ringGeo = new RingGeometry(1.6, 1.76, 64).rotateX(-Math.PI / 2);
const LIT = new Color('#ffc46b');
const LIT_PALE = new Color('#ffe0a3');
const DARK = new Color('#26314a');
const craneMat = new MeshStandardMaterial({ color: '#ffd84a', emissive: '#b88a10', emissiveIntensity: 0.55, roughness: 0.6 });
const beaconMat = new MeshBasicMaterial({ color: '#fff4c2', toneMapped: false });
const unitBox = new BoxGeometry(1, 1, 1);

const boxCache = new Map<string, BufferGeometry>();
function roundedBox(w: number, h: number, d: number, r = 0.1): BufferGeometry {
  const key = `${w}|${h}|${d}|${r}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2));
    boxCache.set(key, g);
  }
  return g;
}

const cylCache = new Map<string, BufferGeometry>();
function cylinder(rTop: number, rBottom: number, h: number, seg = 28): BufferGeometry {
  const key = `${rTop}|${rBottom}|${h}|${seg}`;
  let g = cylCache.get(key);
  if (!g) {
    g = new CylinderGeometry(rTop, rBottom, h, seg);
    cylCache.set(key, g);
  }
  return g;
}

function Part(props: { geometry: BufferGeometry; material: Material; position: Vec3; rotation?: Vec3 }) {
  return <mesh {...props} castShadow receiveShadow />;
}

/** A rounded box resting on `y0`. */
function Block({ size, x = 0, y0, z = 0, material = slate, r }: {
  size: Vec3; x?: number; y0: number; z?: number; material?: Material; r?: number;
}) {
  const [w, h, d] = size;
  return <Part geometry={roundedBox(w, h, d, r)} material={material} position={[x, y0 + h / 2, z]} />;
}

/** A cylinder resting on `y0`. */
function Drum({ radius, height, y0, material = slate, top }: {
  radius: number; height: number; y0: number; material?: Material; top?: number;
}) {
  return <Part geometry={cylinder(top ?? radius, radius, height)} material={material} position={[0, y0 + height / 2, 0]} />;
}

interface WindowSpot { p: Vec3; rotY: number }

/** Window grid on the four faces of a box centred on x/z, standing on y0. */
function boxWindows(w: number, h: number, d: number, y0: number, faces = 4): WindowSpot[] {
  const out: WindowSpot[] = [];
  const rows = Math.max(1, Math.floor((h - 0.3) / 0.36));
  const face = (span: number, place: (u: number, y: number) => WindowSpot) => {
    const cols = Math.max(1, Math.floor((span - 0.3) / 0.34));
    for (let r = 0; r < rows; r++) {
      const y = y0 + 0.28 + r * 0.36;
      for (let c = 0; c < cols; c++) out.push(place((c - (cols - 1) / 2) * 0.34, y));
    }
  };
  const e = 0.006;
  face(w, (u, y) => ({ p: [u, y, d / 2 + e], rotY: 0 }));
  if (faces > 1) face(d, (u, y) => ({ p: [w / 2 + e, y, -u], rotY: Math.PI / 2 }));
  if (faces > 2) face(w, (u, y) => ({ p: [-u, y, -d / 2 - e], rotY: Math.PI }));
  if (faces > 3) face(d, (u, y) => ({ p: [-w / 2 - e, y, u], rotY: -Math.PI / 2 }));
  return out;
}

/** Windows in rows around a cylinder. */
function drumWindows(radius: number, h: number, y0: number): WindowSpot[] {
  const out: WindowSpot[] = [];
  const rows = Math.max(1, Math.floor((h - 0.35) / 0.36));
  const around = Math.floor((2 * Math.PI * radius) / 0.36);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < around; i++) {
      const a = ((i + (r % 2) * 0.5) / around) * 2 * Math.PI;
      out.push({ p: [(radius + 0.006) * Math.sin(a), y0 + 0.3 + r * 0.36, (radius + 0.006) * Math.cos(a)], rotY: a });
    }
  }
  return out;
}

/** Small deterministic hash so each building keeps its own pattern of lit windows. */
function hash(s: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function Windows({ spots, seed, material }: { spots: WindowSpot[]; seed: string; material: Material }) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    spots.forEach((s, i) => {
      o.position.set(...s.p);
      o.rotation.set(0, s.rotY, 0);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      const roll = hash(seed, i);
      mesh.setColorAt(i, roll < 0.62 ? LIT : roll < 0.74 ? LIT_PALE : DARK);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [spots, seed]);
  if (spots.length === 0) return null;
  return <instancedMesh ref={ref} args={[windowGeo, material, spots.length]} />;
}

interface Shape { body: ReactNode; windows: WindowSpot[]; top: number }

/** The kind-specific silhouette, standing on y0. `accent` is the building's tintable material. */
function silhouette(kind: Kind, h: number, y0: number, accent: Material): Shape {
  switch (kind) {
    case 'gate': {
      // an arch over the road: two pillars and a lintel, open along x
      const lintel = 0.42;
      const ph = h - lintel;
      return {
        body: (
          <>
            <Block size={[0.55, ph, 1.0]} x={-0.7} y0={y0} />
            <Block size={[0.55, ph, 1.0]} x={0.7} y0={y0} />
            <Block size={[2.0, lintel, 1.15]} y0={y0 + ph} r={0.12} />
            <Block size={[1.5, 0.1, 0.6]} y0={y0 + h} material={accent} r={0.04} />
          </>
        ),
        windows: [-0.7, 0.7].flatMap((x) =>
          boxWindows(0.55, ph, 1.0, y0).map((s) => ({ p: [s.p[0] + x, s.p[1], s.p[2]] as Vec3, rotY: s.rotY })),
        ),
        top: y0 + h + 0.1,
      };
    }
    case 'proxy': {
      // a wide slab with an antenna
      const ant = 1.0;
      return {
        body: (
          <>
            <Block size={[2.0, h, 1.3]} y0={y0} r={0.14} />
            <Block size={[1.6, 0.12, 0.95]} y0={y0 + h} material={accent} r={0.05} />
            <Part geometry={cylinder(0.035, 0.05, ant, 8)} material={slateDark} position={[0.55, y0 + h + ant / 2, -0.25]} />
            <Part geometry={cylinder(0.1, 0.1, 0.12, 12)} material={accent} position={[0.55, y0 + h + ant, -0.25]} />
          </>
        ),
        windows: boxWindows(2.0, h, 1.3, y0),
        top: y0 + h + ant,
      };
    }
    case 'filter': {
      // a sieve tower: slats with a glowing core showing through the gaps, a funnel on top
      const slat = 0.3;
      const gap = 0.12;
      const n = Math.max(3, Math.round(h / (slat + gap)));
      const body = n * (slat + gap) - gap;
      return {
        body: (
          <>
            <Block size={[0.8, body, 0.8]} y0={y0} material={accent} r={0.05} />
            {Array.from({ length: n }, (_, i) => (
              <Block key={i} size={[1.2, slat, 1.2]} y0={y0 + i * (slat + gap)} r={0.08} />
            ))}
            <Part geometry={cylinder(0.78, 0.3, 0.5, 24)} material={slateDark} position={[0, y0 + body + 0.25, 0]} />
          </>
        ),
        windows: [],
        top: y0 + body + 0.5,
      };
    }
    case 'service': {
      // a stepped block
      const t1 = h * 0.5;
      const t2 = h * 0.3;
      const t3 = h * 0.2;
      return {
        body: (
          <>
            <Block size={[1.9, t1, 1.6]} y0={y0} r={0.14} />
            <Block size={[1.45, t2, 1.2]} y0={y0 + t1} r={0.12} />
            <Block size={[1.0, t3, 0.85]} y0={y0 + t1 + t2} r={0.1} />
            <Block size={[0.7, 0.1, 0.55]} y0={y0 + h} material={accent} r={0.04} />
          </>
        ),
        windows: [
          ...boxWindows(1.9, t1, 1.6, y0),
          ...boxWindows(1.45, t2, 1.2, y0 + t1),
          ...boxWindows(1.0, t3, 0.85, y0 + t1 + t2),
        ],
        top: y0 + h + 0.1,
      };
    }
    case 'cache': {
      return {
        body: (
          <>
            <Drum radius={0.78} height={h} y0={y0} />
            <Drum radius={0.81} height={0.12} y0={y0 + h - 0.3} material={accent} />
            <Drum radius={0.56} height={0.14} y0={y0 + h} material={slateDark} />
          </>
        ),
        windows: drumWindows(0.78, h - 0.32, y0),
        top: y0 + h + 0.14,
      };
    }
    case 'database': {
      // stacked discs with glowing seams
      const gap = 0.13;
      const disc = (h - 2 * gap) / 3;
      return {
        body: (
          <>
            <Drum radius={0.68} height={h - 0.06} y0={y0 + 0.03} material={accent} />
            {[0, 1, 2].map((i) => (
              <Drum key={i} radius={0.86} height={disc} y0={y0 + i * (disc + gap)} />
            ))}
          </>
        ),
        windows: [],
        top: y0 + h,
      };
    }
    case 'queue': {
      // a long shed with a pitched roof
      const roof = 0.45;
      return {
        body: (
          <>
            <Block size={[2.1, h, 1.0]} y0={y0} r={0.1} />
            <Part
              geometry={cylinder(0.62, 0.62, 2.1, 3)}
              material={accent}
              position={[0, y0 + h + roof / 2 - 0.08, 0]}
              rotation={[Math.PI / 2, 0, Math.PI / 2]}
            />
          </>
        ),
        windows: boxWindows(2.1, h, 1.0, y0),
        top: y0 + h + roof,
      };
    }
  }
}

const labelStyle: CSSProperties = {
  font: '600 12.5px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  letterSpacing: '0.02em',
  color: '#e9eef7',
  background: 'rgba(10, 17, 34, 0.78)',
  border: '1px solid rgba(160, 186, 225, 0.28)',
  borderRadius: 999,
  padding: '5px 9px',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  pointerEvents: 'auto',
  userSelect: 'none',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
};
const labelSelected: CSSProperties = {
  ...labelStyle,
  color: '#ffffff',
  border: '1px solid #5eead4',
  boxShadow: '0 0 0 2px rgba(94, 234, 212, 0.3), 0 2px 8px rgba(0, 0, 0, 0.35)',
};

function Label({ id, name, y, portal }: { id: string; name: string; y: number; portal: RefObject<HTMLDivElement | null> }) {
  const selected = useGame((s) => s.selected === id);
  const select = useGame((s) => s.select);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    select(id);
  };
  return (
    <Html position={[0, y, 0]} center zIndexRange={[20, 0]} portal={portal as RefObject<HTMLElement>}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        data-node={id}
        style={selected ? labelSelected : labelStyle}
        onClick={() => select(id)}
        onKeyDown={onKey}
      >
        {name}
      </div>
    </Html>
  );
}

function SelectionRing({ id }: { id: string }) {
  const selected = useGame((s) => s.selected === id);
  const mesh = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (mesh.current) mesh.current.scale.setScalar(calmMotion() ? 1 : 1 + 0.03 * Math.sin(clock.elapsedTime * 3));
  });
  if (!selected) return null;
  return <mesh ref={mesh} geometry={ringGeo} material={ringMat} position={[0, 0.1, 0]} />;
}

/** A thin box from (x0, y0, z0) to (x1, y1, z1). */
function Beam({ from, to, material = craneMat }: { from: Vec3; to: Vec3; material?: Material }) {
  const size: Vec3 = [Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), Math.abs(to[2] - from[2])];
  const mid: Vec3 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
  return <mesh geometry={unitBox} material={material} position={mid} scale={size} castShadow />;
}

/**
 * A small tower crane at the back-right corner of the plinth, its jib swung
 * out to the side so it never sits under the name label: the building had a
 * change lately. Hidden until the board shows it; the beacon (the last child) blinks.
 */
function Crane({ top, ref }: { top: number; ref: RefObject<Group | null> }) {
  const h = top + 0.2;
  const x = 1.0;
  const z = -0.85;
  const t = 0.075;
  return (
    <group ref={ref} visible={false}>
      <Beam from={[x - t, PLINTH, z - t]} to={[x + t, h, z + t]} />
      <Beam from={[x - 0.5, h, z - t / 2]} to={[x + 1.5, h + 0.1, z + t / 2]} />
      <Beam from={[x - 0.55, h - 0.2, z - 0.1]} to={[x - 0.28, h, z + 0.1]} material={slateDark} />
      <Beam from={[x - 0.13, h - 0.24, z - 0.12]} to={[x + 0.13, h, z + 0.12]} />
      <Beam from={[x + 1.25, h - 0.9, z - 0.008]} to={[x + 1.266, h, z + 0.008]} material={slateDark} />
      <Beam from={[x + 1.18, h - 1.04, z - 0.07]} to={[x + 1.34, h - 0.9, z + 0.07]} />
      <mesh geometry={unitBox} material={beaconMat} position={[x, h + 0.2, z]} scale={0.1} />
    </group>
  );
}

/** The parts of a building the board animates from outside React. */
export interface BuildingParts {
  /** tintable accent, coloured by error rate and glowing when saturated */
  accent: MeshStandardMaterial;
  /** this building's window material; its colour scales every window's brightness */
  windows: MeshBasicMaterial;
  crane: Group;
  /** height of the roof, where smoke comes from */
  top: number;
}

export interface BuildingProps {
  id: string;
  kind: Kind;
  name: string;
  height: number;
  position: Vec3;
  /** Overlay element the name label is drawn into. */
  labels: RefObject<HTMLDivElement | null>;
  /** Receives the building's tintable accent material (null on unmount). */
  onAccent?: (nodeId: string, material: MeshStandardMaterial | null) => void;
  /** Receives the parts the board animates (null on unmount). */
  onParts?: (nodeId: string, parts: BuildingParts | null) => void;
  /** True when the pointer press that ends in this click travelled far enough to be a drag. */
  wasDrag?: () => boolean;
}

/** One service: plinth, kind silhouette, lit windows, name label, selection ring and crane. */
export function Building({ id, kind, name, height, position, labels, onAccent, onParts, wasDrag }: BuildingProps) {
  const select = useGame((s) => s.select);
  const accent = useMemo(() => {
    const c = new Color().setRGB(...tint(0));
    return new MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, roughness: 0.5 });
  }, []);
  useEffect(() => {
    onAccent?.(id, accent);
    return () => onAccent?.(id, null);
  }, [id, accent, onAccent]);
  const windows = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), []);
  useEffect(
    () => () => {
      accent.dispose();
      windows.dispose();
    },
    [accent, windows],
  );

  const shape = useMemo(() => silhouette(kind, height, PLINTH, accent), [kind, height, accent]);
  const crane = useRef<Group>(null);
  useEffect(() => {
    if (!crane.current) return;
    onParts?.(id, { accent, windows, crane: crane.current, top: shape.top });
    return () => onParts?.(id, null);
  }, [id, accent, windows, shape.top, onParts]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    // the end of a camera drag is not a choice of building
    if (wasDrag?.()) return;
    select(id);
  };
  return (
    <group position={position} userData={{ nodeId: id }}>
      <group
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <Part geometry={roundedBox(2.3, PLINTH, 2.3, 0.1)} material={plinthMat} position={[0, PLINTH / 2, 0]} />
        {shape.body}
      </group>
      <Windows spots={shape.windows} seed={id} material={windows} />
      <SelectionRing id={id} />
      <Crane top={shape.top} ref={crane} />
      <Label id={id} name={name} y={shape.top + 0.75} portal={labels} />
    </group>
  );
}
