import { describe, expect, it } from 'vitest';
import { cases } from '../cases';
import { FLAT_TILE, flatLayout, roadLook } from './flat';

const c = cases['edge-rule']!;

describe('flatLayout', () => {
  it('places every building from the layout grid, inside the board, without overlaps', () => {
    const f = flatLayout(c);
    expect(Object.keys(f.tiles).sort()).toEqual(Object.keys(c.layout).sort());
    const rects = Object.values(f.tiles);
    for (const t of rects) {
      expect(t.x - FLAT_TILE.w / 2).toBeGreaterThanOrEqual(0);
      expect(t.y - FLAT_TILE.h / 2).toBeGreaterThanOrEqual(0);
      expect(t.x + FLAT_TILE.w / 2).toBeLessThanOrEqual(f.width);
      expect(t.y + FLAT_TILE.h / 2).toBeLessThanOrEqual(f.height);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const apart = Math.abs(a.x - b.x) >= FLAT_TILE.w || Math.abs(a.y - b.y) >= FLAT_TILE.h;
        expect(apart, `${i} and ${j}`).toBe(true);
      }
    }
    // the gate is left of the edge, as in the 3D city
    expect(f.tiles.gate!.x).toBeLessThan(f.tiles.edge!.x);
  });

  it('runs one road per edge, from the edge of one tile to the edge of the next', () => {
    const f = flatLayout(c);
    expect(f.roads).toHaveLength(c.edges.length);
    const road = f.roads.find((r) => r.id === 'gate>edge')!;
    const gate = f.tiles.gate!;
    const edge = f.tiles.edge!;
    // horizontal road: starts at the gate's right side, ends short of the edge's left side
    expect(road.x1).toBeCloseTo(gate.x + FLAT_TILE.w / 2, 5);
    expect(road.x2).toBeLessThan(edge.x - FLAT_TILE.w / 2);
    expect(road.x2).toBeGreaterThan(edge.x - FLAT_TILE.w / 2 - 0.2);
    expect(road.y1).toBeCloseTo(gate.y, 5);
  });

  it('separates the two directions of a two-way road', () => {
    const two = { ...c, edges: [...c.edges, { from: 'edge', to: 'gate', fanout: 1, timeoutMs: 1000, retries: 0 }] };
    const f = flatLayout(two);
    const there = f.roads.find((r) => r.id === 'gate>edge')!;
    const back = f.roads.find((r) => r.id === 'edge>gate')!;
    expect(Math.abs(there.y1 - back.y2)).toBeGreaterThan(0.1);
  });
});

describe('roadLook', () => {
  it('grows with traffic and shows retries and failures', () => {
    const quiet = roadLook({ rate: 10, retryRate: 0, failRate: 0 }, 100);
    const busy = roadLook({ rate: 100, retryRate: 0, failRate: 0 }, 100);
    expect(busy.width).toBeGreaterThan(quiet.width);
    expect(roadLook({ rate: 0, retryRate: 0, failRate: 0 }, 100).width).toBeGreaterThan(0);
    expect(roadLook({ rate: 1e9, retryRate: 0, failRate: 0 }, 100).width).toBe(roadLook({ rate: 100, retryRate: 0, failRate: 0 }, 100).width);
    expect(busy.kind).toBe('ok');
    expect(roadLook({ rate: 100, retryRate: 20, failRate: 0 }, 100).kind).toBe('retry');
    expect(roadLook({ rate: 100, retryRate: 20, failRate: 30 }, 100).kind).toBe('fail');
    expect(roadLook({ rate: Number.NaN, retryRate: 0, failRate: 0 }, 0).width).toBeGreaterThan(0);
  });
});
