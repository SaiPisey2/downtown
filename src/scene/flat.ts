import type { CaseFile } from '../cases';
import type { EdgeView } from '../sim';

/** Pure geometry for the flat board: tiles and roads in layout units (one unit per layout grid step). */

/** A tile's size in layout units; buildings sit two units apart, so tiles never touch. */
export const FLAT_TILE = { w: 1.5, h: 1.36 } as const;
/** Room around the outermost tiles, across and down (the bottom also holds the district names). */
const PAD_X = 0.2;
const PAD_Y = 0.5;
/** Gap between a road's arrowhead and the tile it enters. */
const ROAD_GAP = 0.08;
/** How far each direction of a two-way road sits from the middle. */
const TWO_WAY = 0.14;

export interface FlatTile {
  /** centre */
  x: number;
  y: number;
  district: CaseFile['layout'][string]['district'];
}

export interface FlatRoad {
  /** `${from}>${to}`, as the snapshot keys its edges */
  id: string;
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FlatLayout {
  width: number;
  height: number;
  tiles: Record<string, FlatTile>;
  roads: FlatRoad[];
}

/** Tiles at the layout's grid positions and a road for each edge, running between the tiles' sides. */
export function flatLayout(c: Pick<CaseFile, 'layout' | 'edges'>): FlatLayout {
  const entries = Object.entries(c.layout);
  const xs = entries.map(([, n]) => n.pos[0]);
  const ys = entries.map(([, n]) => n.pos[1]);
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  const ox = FLAT_TILE.w / 2 + PAD_X - minX;
  const oy = FLAT_TILE.h / 2 + PAD_Y - minY;
  const tiles: Record<string, FlatTile> = {};
  for (const [id, n] of entries) tiles[id] = { x: n.pos[0] + ox, y: n.pos[1] + oy, district: n.district };

  const pairs = new Set(c.edges.map((e) => `${e.from}>${e.to}`));
  const roads: FlatRoad[] = [];
  for (const e of c.edges) {
    const a = tiles[e.from];
    const b = tiles[e.to];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    // the fraction of the way from a centre to where the line leaves its tile
    const out = Math.min(dx ? FLAT_TILE.w / 2 / Math.abs(dx) : Infinity, dy ? FLAT_TILE.h / 2 / Math.abs(dy) : Infinity);
    const gap = ROAD_GAP / len;
    // a two-way road keeps each direction to its right
    const side = pairs.has(`${e.to}>${e.from}`) ? TWO_WAY : 0;
    const nx = (-dy / len) * side;
    const ny = (dx / len) * side;
    roads.push({
      id: `${e.from}>${e.to}`,
      from: e.from,
      to: e.to,
      x1: a.x + dx * out + nx,
      y1: a.y + dy * out + ny,
      x2: b.x - dx * (out + gap) + nx,
      y2: b.y - dy * (out + gap) + ny,
    });
  }
  return {
    width: maxX - minX + FLAT_TILE.w + 2 * PAD_X,
    height: maxY - minY + FLAT_TILE.h + 2 * PAD_Y,
    tiles,
    roads,
  };
}

/** Share of a road's traffic that must be retries or failures before the road shows them. */
const SHOW_SHARE = 0.03;

/**
 * How a road is drawn: its stroke width in pixels grows with the traffic on it
 * (against the busiest road on a healthy day), and its kind says whether a
 * noticeable share of that traffic is failing or being retried.
 */
export function roadLook(e: EdgeView, busiest: number): { width: number; kind: 'ok' | 'retry' | 'fail' } {
  const fin = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const rate = fin(e.rate);
  const share = busiest > 0 ? Math.min(1, rate / busiest) : 0;
  const width = 2 + 8 * Math.sqrt(share);
  const kind = fin(e.failRate) > SHOW_SHARE * rate && fin(e.failRate) > 0 ? 'fail' : fin(e.retryRate) > SHOW_SHARE * rate && fin(e.retryRate) > 0 ? 'retry' : 'ok';
  return { width, kind };
}
