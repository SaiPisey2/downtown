import { describe, expect, it } from 'vitest';
import { cases } from '../cases';
import {
  CAMERA,
  boardBounds,
  buildingHeight,
  homeView,
  padOutline,
  padRadius,
  tint,
  worldPos,
} from './mapping';

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]!);
const len = (v: number[]) => Math.hypot(...v);

describe('tint', () => {
  it('is calm at zero and alarmed at half the requests failing', () => {
    expect(tint(0)).not.toEqual(tint(0.5));
  });
  it('stops changing past 0.5', () => {
    expect(tint(0.9)).toEqual(tint(0.5));
  });
  it('is red at 0.5 and teal at 0', () => {
    const [r0, g0, b0] = tint(0);
    const [r1, g1, b1] = tint(0.5);
    expect(g0).toBeGreaterThan(r0);
    expect(b0).toBeGreaterThan(r0);
    expect(r1).toBeGreaterThan(g1);
    expect(r1).toBeGreaterThan(b1);
  });
  it('treats NaN and negatives as calm', () => {
    expect(tint(Number.NaN)).toEqual(tint(0));
    expect(tint(-1)).toEqual(tint(0));
  });
});

describe('worldPos', () => {
  it('puts the grid on the ground at 3 units per step', () => {
    expect(worldPos([2, 1])).toEqual([6, 0, 3]);
  });
});

describe('buildingHeight', () => {
  it('is positive and grows with instances', () => {
    for (const kind of ['gate', 'proxy', 'filter', 'service', 'cache', 'database', 'queue']) {
      expect(buildingHeight(kind, 0)).toBeGreaterThan(0);
      expect(buildingHeight(kind, 4)).toBeGreaterThan(buildingHeight(kind, 1));
    }
  });
  it('stays on a miniature scale', () => {
    expect(buildingHeight('filter', 1000)).toBeLessThan(6);
  });
});

describe('homeView', () => {
  for (const id of ['tutorial', 'edge-rule']) {
    const layout = cases[id]!.layout;
    it(`targets the centroid of the ${id} layout`, () => {
      const pts = Object.values(layout).map((n) => worldPos(n.pos));
      const centroid = [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i]!, 0) / pts.length);
      const { target } = homeView(layout);
      target.forEach((v, i) => expect(v).toBeCloseTo(centroid[i]!, 9));
    });
    it(`places the ${id} camera inside the orbit limits`, () => {
      const { position, target } = homeView(layout);
      const off = sub(position, target);
      const dist = len(off);
      const polar = Math.acos(off[1]! / dist);
      expect(dist).toBeGreaterThanOrEqual(CAMERA.minDistance);
      expect(dist).toBeLessThanOrEqual(CAMERA.maxDistance);
      expect(polar).toBeGreaterThanOrEqual(CAMERA.minPolar);
      expect(polar).toBeLessThanOrEqual(CAMERA.maxPolar);
    });
  }
  it('copes with an empty layout', () => {
    expect(homeView({}).target).toEqual([0, 0, 0]);
  });
});

describe('district pads', () => {
  it('draws a circle around one point', () => {
    const ring = padOutline([[0, 0]], 2);
    for (const [x, z] of ring) expect(Math.hypot(x, z)).toBeCloseTo(2, 9);
  });
  it('keeps every outline point exactly radius away from the hull', () => {
    const pts: [number, number][] = [[0, 0], [6, 0], [6, 6], [3, 2]];
    const ring = padOutline(pts, 1.5);
    for (const [x, z] of ring) {
      // distance to the triangle (0,0) (6,0) (6,6)
      const d = Math.min(segDist([x, z], [0, 0], [6, 0]), segDist([x, z], [6, 0], [6, 6]), segDist([x, z], [6, 6], [0, 0]));
      expect(d).toBeCloseTo(1.5, 6);
    }
  });
  it('leaves a gap between the districts of the edge-rule city', () => {
    const layout = cases['edge-rule']!.layout;
    const r = padRadius(layout);
    expect(r).toBeGreaterThan(1.2);
    expect(r).toBeLessThan(2.13); // accounts sits 4.24 from the data pad's spine
  });
  it('bounds the board around every building', () => {
    const b = boardBounds(cases.tutorial!.layout);
    expect(b.minX).toBeLessThan(0);
    expect(b.maxX).toBeGreaterThan(12);
  });
});

function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
