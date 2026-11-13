import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import {
  CanvasTexture,
  ExtrudeGeometry,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Shape,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { cases } from '../cases';
import type { CaseFile } from '../cases';
import { useGame } from '../game/store';
import { setSceneProbe } from '../game/testHook';
import { Building } from './Building';
import type { BuildingParts } from './Building';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import { fps, live, resetLive } from './live';
import {
  CAMERA,
  DISTRICTS,
  boardBounds,
  buildingHeight,
  districtPoints,
  homeView,
  padOutline,
  padRadius,
  worldPos,
} from './mapping';
import type { District, Vec3 } from './mapping';
import { Roads } from './Roads';
import { Traffic } from './Traffic';
import { hasWebGL2 } from './webgl';

const BACKGROUND = 'radial-gradient(ellipse 120% 90% at 50% 30%, #1a2950 0%, #0d1630 55%, #060a18 100%)';

const SLAB_DEPTH = 0.9;
/** Half the width of a building's plinth (see Building). */
const PLINTH_HALF = 1.15;
const SLAB_BEVEL = 0.14;
const slabMat = new MeshStandardMaterial({ color: '#1c2840', roughness: 0.92 });

const PAD_TINT: Record<District, string> = { edge: '#2b3b5c', app: '#24425a', data: '#35355a' };
const DISTRICT_NAME: Record<District, string> = { edge: 'Edge', app: 'App', data: 'Data' };

function roundedRect(minX: number, maxX: number, minZ: number, maxZ: number, r: number): Shape {
  // shape space is (x, -z) so that rotating -90 degrees about x lays it on the ground
  const s = new Shape();
  const [x0, x1, y0, y1] = [minX, maxX, -maxZ, -minZ];
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

/** The floating slab the city stands on; its top face is y = 0. */
function Slab({ layout }: { layout: CaseFile['layout'] }) {
  const geo = useMemo(() => {
    const b = boardBounds(layout);
    const g = new ExtrudeGeometry(roundedRect(b.minX, b.maxX, b.minZ, b.maxZ, 1.6), {
      depth: SLAB_DEPTH,
      bevelEnabled: true,
      bevelThickness: SLAB_BEVEL,
      bevelSize: SLAB_BEVEL,
      bevelSegments: 3,
      curveSegments: 10,
    });
    return g;
  }, [layout]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh
      geometry={geo}
      material={slabMat}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -SLAB_DEPTH - SLAB_BEVEL, 0]}
      receiveShadow
    />
  );
}

/** A flat label texture drawn with the system font: pale letters under a dark top lip, as if cut into the pad. */
function engravedText(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = '700 34px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '9px';
    const t = text.toUpperCase();
    ctx.fillStyle = 'rgba(2, 6, 18, 0.75)';
    ctx.fillText(t, 132, 30);
    ctx.fillStyle = 'rgba(178, 200, 245, 0.42)';
    ctx.fillText(t, 132, 33);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function Pad({ district, points, radius }: { district: District; points: [number, number][]; radius: number }) {
  const { geo, label, labelSize, labelAt } = useMemo(() => {
    const ring = padOutline(points, radius);
    const s = new Shape();
    ring.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
    const g = new ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.05, bevelSegments: 2 });
    // label sits along the front (camera-facing) edge, under the front-most building
    const front = Math.max(...points.map((p) => p[1]));
    const row = points.filter((p) => p[1] === front);
    const x = row.reduce((s, p) => s + p[0], 0) / row.length;
    // fit the label in the strip between the front plinth and the pad's edge
    const h = Math.min(0.8, radius - PLINTH_HALF - 0.06);
    return {
      geo: g,
      label: engravedText(DISTRICT_NAME[district]),
      labelSize: [h * 4, h] as [number, number],
      labelAt: [x, 0.091, front + PLINTH_HALF + 0.02 + h / 2] as Vec3,
    };
  }, [district, points, radius]);
  useEffect(
    () => () => {
      geo.dispose();
      label.dispose();
    },
    [geo, label],
  );
  return (
    <group>
      <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <meshStandardMaterial color={PAD_TINT[district]} roughness={0.9} />
      </mesh>
      <mesh position={labelAt} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={labelSize} />
        <meshBasicMaterial map={label} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
      </mesh>
    </group>
  );
}

/** Lets the e2e test read the camera, the scene's stats and sample the canvas; mounted only when the test hook is on. */
function Probe({ layout }: { layout: CaseFile['layout'] }) {
  const get = useThree((s) => s.get);
  useEffect(() => {
    setSceneProbe({
      camera() {
        const { camera, controls } = get();
        const target = (controls as unknown as { target?: { toArray(): number[] } } | null)?.target;
        return {
          position: camera.position.toArray() as Vec3,
          target: (target?.toArray() ?? [0, 0, 0]) as Vec3,
        };
      },
      canvasColors() {
        const { gl, scene, camera } = get();
        // render and read back in the same task, before the drawing buffer is cleared
        gl.setRenderTarget(null);
        gl.render(scene, camera);
        const ctx = gl.getContext();
        const w = ctx.drawingBufferWidth;
        const h = ctx.drawingBufferHeight;
        const px = new Uint8Array(w * h * 4);
        ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
        const seen = new Set<number>();
        const N = 24;
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const x = Math.floor(((i + 0.5) / N) * w);
            const y = Math.floor(((j + 0.5) / N) * h);
            const o = (y * w + x) * 4;
            seen.add(((px[o]! >> 4) << 12) | ((px[o + 1]! >> 4) << 8) | ((px[o + 2]! >> 4) << 4) | (px[o + 3]! >> 4));
          }
        }
        return seen.size;
      },
      sceneStats() {
        const nodes: ReturnType<SceneStatsFn>['nodes'] = {};
        for (const [id, n] of Object.entries(live.nodes)) nodes[id] = { ...n, tint: [...n.tint] as Vec3 };
        const { dots, okDots, retryDots, failedDots, smoke } = live;
        return { dots, okDots, retryDots, failedDots, smoke, nodes };
      },
      fps,
      nodeScreen(id) {
        const { camera, gl } = get();
        const n = layout[id];
        if (!n) throw new Error(`no building "${id}"`);
        const p = new Vector3(...worldPos(n.pos)).setY(0.8).project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return [r.left + ((p.x + 1) / 2) * r.width, r.top + ((1 - p.y) / 2) * r.height];
      },
    });
    return () => setSceneProbe(null);
  }, [get, layout]);
  return null;
}

type SceneStatsFn = import('../game/testHook').SceneProbe['sceneStats'];

/** Per-second rate of the ease when a dock opens or closes. */
const INSET_EASE = 8;

/**
 * Shifts the picture sideways so the middle of the city sits in the middle of
 * the space the docks leave free, while the canvas still fills the window.
 */
function ViewInset({ left, right }: { left: number; right: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const shift = useRef(0);
  const goal = (right - left) / 2;
  useEffect(
    () => () => {
      if (camera instanceof PerspectiveCamera) camera.clearViewOffset();
    },
    [camera],
  );
  useFrame((_, dt) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * INSET_EASE);
    const next = Math.abs(goal - shift.current) < 0.5 ? goal : shift.current + (goal - shift.current) * k;
    const v = camera.view;
    if (v?.enabled && next === shift.current && v.fullWidth === size.width && v.fullHeight === size.height) return;
    shift.current = next;
    camera.setViewOffset(size.width, size.height, next, 0, size.width, size.height);
  });
  return null;
}

/** Pointer travel since the last press, in CSS pixels; past this a press is a drag, not a click. */
const CLICK_SLOP = 5;

function Scene({ c, onAccent, labels, wasDrag, inset }: {
  c: CaseFile;
  onAccent?: BoardProps['onAccent'];
  inset: { left: number; right: number };
  labels: RefObject<HTMLDivElement | null>;
  wasDrag: () => boolean;
}) {
  const parts = useRef(new Map<string, BuildingParts>());
  const onParts = useCallback((id: string, p: BuildingParts | null) => {
    if (p) parts.current.set(id, p);
    else parts.current.delete(id);
  }, []);
  // a fresh board starts with fresh stats
  useMemo(() => resetLive(), [c]);
  const home = useMemo(() => homeView(c.layout), [c]);
  const bounds = useMemo(() => boardBounds(c.layout), [c]);
  const pads = useMemo(() => {
    const pts = districtPoints(c.layout);
    const r = padRadius(c.layout);
    return DISTRICTS.filter((d) => pts[d].length > 0).map((d) => ({ district: d, points: pts[d], radius: r }));
  }, [c]);
  const sunTarget = useMemo(() => new Object3D(), []);
  const [cx, , cz] = home.target;
  const reach = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + 3;

  return (
    <>
      <hemisphereLight args={['#9db4ff', '#141026', 1.1]} />
      <primitive object={sunTarget} position={[cx, 0, cz]} />
      <directionalLight
        color="#e4ecff"
        intensity={2.2}
        position={[cx - 10, 20, cz + 9]}
        target={sunTarget}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
        shadow-camera-near={1}
        shadow-camera-far={60}
      />
      <Slab layout={c.layout} />
      {pads.map((p) => (
        <Pad key={p.district} {...p} />
      ))}
      <Roads c={c} />
      {Object.entries(c.layout).map(([id, n]) => (
        <Building
          key={id}
          id={id}
          kind={n.kind}
          name={n.name}
          height={buildingHeight(n.kind, c.nodes[id]?.instances ?? 1)}
          position={worldPos(n.pos)}
          onAccent={onAccent}
          onParts={onParts}
          wasDrag={wasDrag}
          labels={labels}
        />
      ))}
      <Traffic c={c} />
      <Effects c={c} parts={parts} />
      <CameraRig layout={c.layout} />
      <ViewInset left={inset.left} right={inset.right} />
      {typeof window !== 'undefined' && window.__downtown && <Probe layout={c.layout} />}
    </>
  );
}

export interface BoardProps {
  /** Receives each building's tintable accent material (null when it unmounts), for colouring from outside React. */
  onAccent?: (nodeId: string, material: MeshStandardMaterial | null) => void;
  /** CSS pixels covered by docks at each side; the city is centred in what is left */
  insetLeft?: number;
  insetRight?: number;
}

/** The 3D city for the current case: a function of the store, nothing else. */
export function Board({ onAccent, insetLeft = 0, insetRight = 0 }: BoardProps) {
  const caseId = useGame((s) => s.caseId);
  const c = caseId ? cases[caseId] : undefined;
  const home = useMemo(() => (c ? homeView(c.layout) : null), [c]);
  const labels = useRef<HTMLDivElement>(null);
  const press = useRef({ x: 0, y: 0, travel: 0 });
  const wasDrag = useCallback(() => press.current.travel > CLICK_SLOP, []);

  if (!hasWebGL2()) {
    return (
      <div data-testid="no-webgl" style={{ padding: 24, color: '#e9eef7', font: '15px system-ui, sans-serif' }}>
        This board needs WebGL2, which this browser does not offer.
      </div>
    );
  }
  if (!c || !home) return null;
  return (
    <div
      data-testid="board"
      style={{ position: 'absolute', inset: 0, background: BACKGROUND }}
      onPointerDownCapture={(e) => {
        press.current = { x: e.clientX, y: e.clientY, travel: 0 };
      }}
      onPointerMoveCapture={(e) => {
        if (e.buttons === 0) return;
        const p = press.current;
        p.travel += Math.hypot(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
      }}
    >
      <Canvas
        key={caseId}
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ fov: CAMERA.fov, near: 0.5, far: 250, position: home.position }}
      >
        <Scene c={c} onAccent={onAccent} labels={labels} wasDrag={wasDrag} inset={{ left: insetLeft, right: insetRight }} />
      </Canvas>
      {/* labels live outside the canvas's event target, so clicking one never picks the building behind it */}
      <div ref={labels} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />
    </div>
  );
}
