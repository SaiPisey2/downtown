import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Spherical, Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CaseFile } from '../cases';
import { useGame } from '../game/store';
import { CAMERA, boardBounds, homeView, stepOrbit, worldPos } from './mapping';

/** Per-second rate of the exponential ease toward a goal. */
const EASE = 6;
/** Close enough to snap onto the goal. */
const SNAP = 0.02;

interface Goal {
  target: Vector3;
  /** set for the home view; a selection keeps the current viewing angle and distance */
  position?: Vector3;
}

/**
 * Keys the camera listens to, by logical action; Tab, Enter and Space stay with
 * the focused label. `+` and `=` share a key, as do `-` and `_`, so releasing
 * Shift before the key still ends the zoom.
 */
const CAMERA_KEYS: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  '+': 'in',
  '=': 'in',
  '-': 'out',
  _: 'out',
};
const ARROWS = new Set(['left', 'right', 'up', 'down']);
/** How long a single quick press counts as held, so a tap always moves the camera. */
const TAP_SECONDS = 0.12;
/** Pan speed in camera distances per second. */
const PAN_RATE = 0.7;

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Orbit controls within fixed limits, pan kept over the board, easing to the
 * selected building and `H` for the home view. From the keyboard: arrows orbit
 * and tilt, Shift+arrows pan, `+`/`-` zoom, all driven per frame from the set
 * of held keys. Everything runs on refs inside
 * useFrame, so camera motion never re-renders React.
 */
export function CameraRig({ layout }: { layout: CaseFile['layout'] }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const goal = useRef<Goal | null>(null);
  const home = useMemo(() => homeView(layout), [layout]);
  const bounds = useMemo(() => boardBounds(layout), [layout]);
  const next = useMemo(() => new Vector3(), []);
  const held = useRef(new Set<string>());
  const tapped = useRef(new Map<string, number>());
  const shift = useRef(false);
  const tmp = useMemo(() => ({ sph: new Spherical(), off: new Vector3(), fwd: new Vector3(), right: new Vector3() }), []);

  useLayoutEffect(() => {
    camera.position.set(...home.position);
    controls.current?.target.set(...home.target);
    controls.current?.update();
  }, [camera, home]);

  useEffect(() => {
    const ctl = controls.current;
    if (!ctl) return;
    // the player grabbing the camera cancels any ease in progress
    const cancel = () => {
      goal.current = null;
    };
    ctl.addEventListener('start', cancel);
    return () => ctl.removeEventListener('start', cancel);
  }, []);

  useEffect(
    () =>
      useGame.subscribe((s, prev) => {
        if (s.selected === prev.selected || !s.selected) return;
        const n = layout[s.selected];
        if (n) goal.current = { target: new Vector3(...worldPos(n.pos)) };
      }),
    [layout],
  );

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      shift.current = e.shiftKey;
      if (e.key.toLowerCase() === 'h') {
        goal.current = { target: new Vector3(...home.target), position: new Vector3(...home.position) };
        return;
      }
      const action = CAMERA_KEYS[e.key];
      if (!action) return;
      e.preventDefault();
      goal.current = null;
      // a tap remembers whether Shift was down, since both keys may be up again before the next frame
      const tap = e.shiftKey && ARROWS.has(action) ? `pan-${action}` : action;
      if (!e.repeat) tapped.current.set(tap, (tapped.current.get(tap) ?? 0) + 1);
      held.current.add(action);
    };
    const onUp = (e: KeyboardEvent) => {
      shift.current = e.shiftKey;
      const action = CAMERA_KEYS[e.key];
      if (action) held.current.delete(action);
    };
    const release = () => held.current.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', release);
    };
  }, [home]);

  /**
   * Moves the camera for the keys held this frame. Every press counts as held
   * for at least TAP_SECONDS, so quick taps that land between frames still move it.
   */
  function driveFromKeys(ctl: OrbitControlsImpl, dt: number) {
    if (held.current.size === 0 && tapped.current.size === 0) return;
    // signed seconds of each action this frame; held arrows pan while Shift is down
    const secs = (a: string, pan = false) =>
      Math.max(
        held.current.has(a) && (!ARROWS.has(a) || shift.current === pan) ? dt : 0,
        (tapped.current.get(pan ? `pan-${a}` : a) ?? 0) * TAP_SECONDS,
      );
    const x = secs('right') - secs('left');
    const y = secs('up') - secs('down');
    const px = secs('right', true) - secs('left', true);
    const py = secs('up', true) - secs('down', true);
    const zoom = secs('in') - secs('out');
    tapped.current.clear();
    const { sph, off, fwd, right } = tmp;
    off.copy(camera.position).sub(ctl.target);
    if (px || py) {
      // pan across the ground: Up goes away from the camera, Right goes right
      fwd.set(-off.x, 0, -off.z).normalize();
      right.set(-fwd.z, 0, fwd.x);
      const d = PAN_RATE * off.length();
      next.copy(fwd).multiplyScalar(py * d).addScaledVector(right, px * d);
      ctl.target.add(next);
      camera.position.add(next);
    }
    const yaw = x;
    // Up looks more steeply down onto the board
    const pitch = -y;
    if (!yaw && !pitch && !zoom) return;
    sph.setFromVector3(off);
    const o = stepOrbit({ theta: sph.theta, phi: sph.phi, radius: sph.radius }, { yaw, pitch, zoom }, 1);
    sph.set(o.radius, o.phi, o.theta);
    camera.position.copy(ctl.target).add(off.setFromSpherical(sph));
  }

  useFrame((_, dt) => {
    const ctl = controls.current;
    if (!ctl) return;
    driveFromKeys(ctl, Math.min(dt, 0.1));
    const g = goal.current;
    if (g) {
      const k = 1 - Math.exp(-Math.min(dt, 0.1) * EASE);
      next.copy(ctl.target).lerp(g.target, k);
      if (g.position) camera.position.lerp(g.position, k);
      else camera.position.add(next).sub(ctl.target);
      ctl.target.copy(next);
      const done = ctl.target.distanceTo(g.target) < SNAP && (!g.position || camera.position.distanceTo(g.position) < SNAP);
      if (done) {
        if (g.position) camera.position.copy(g.position);
        else camera.position.add(g.target).sub(ctl.target);
        ctl.target.copy(g.target);
        goal.current = null;
      }
    }
    // keep the point we orbit around over the board
    const t = ctl.target;
    const cx = Math.min(Math.max(t.x, bounds.minX), bounds.maxX) - t.x;
    const cz = Math.min(Math.max(t.z, bounds.minZ), bounds.maxZ) - t.z;
    const cy = Math.min(Math.max(t.y, 0), 4) - t.y;
    if (cx || cy || cz) {
      t.x += cx;
      t.y += cy;
      t.z += cz;
      camera.position.x += cx;
      camera.position.y += cy;
      camera.position.z += cz;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minPolarAngle={CAMERA.minPolar}
      maxPolarAngle={CAMERA.maxPolar}
      minDistance={CAMERA.minDistance}
      maxDistance={CAMERA.maxDistance}
      screenSpacePanning={false}
    />
  );
}
