import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CaseFile } from '../cases';
import { useGame } from '../game/store';
import { CAMERA, boardBounds, homeView, worldPos } from './mapping';

/** Per-second rate of the exponential ease toward a goal. */
const EASE = 6;
/** Close enough to snap onto the goal. */
const SNAP = 0.02;

interface Goal {
  target: Vector3;
  /** set for the home view; a selection keeps the current viewing angle and distance */
  position?: Vector3;
}

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Orbit controls within fixed limits, pan kept over the board, easing to the
 * selected building and `H` for the home view. Everything runs on refs inside
 * useFrame, so camera motion never re-renders React.
 */
export function CameraRig({ layout }: { layout: CaseFile['layout'] }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const goal = useRef<Goal | null>(null);
  const home = useMemo(() => homeView(layout), [layout]);
  const bounds = useMemo(() => boardBounds(layout), [layout]);
  const next = useMemo(() => new Vector3(), []);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'h' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      goal.current = { target: new Vector3(...home.target), position: new Vector3(...home.position) };
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [home]);

  useFrame((_, dt) => {
    const ctl = controls.current;
    if (!ctl) return;
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
