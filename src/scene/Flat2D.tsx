import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { CaseFile } from '../cases';
import { useGame } from '../game/store';
import type { NodeView } from '../sim';
import { HealthIcon } from '../ui/panels/HealthIcon';
import { STATUS_WORD, buildingHealth } from '../ui/metrics';
import { craneOn, healthyInflow } from './dots';
import { FLAT_TILE, flatLayout, roadLook } from './flat';
import type { FlatLayout } from './flat';

/** What the board region is called for a screen reader, on the flat board and the 3D one alike. */
export const BOARD_NAME = 'City map of services. Use the building buttons to inspect.';

const DISTRICT_NAME = { edge: 'Edge', app: 'App', data: 'Data' } as const;
/** How far a tile's district plate shows around it, in layout units. */
const PLATE = 0.09;
/** Arrowhead length and half-width, in layout units. */
const ARROW = { len: 0.13, half: 0.075 };

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const tenth = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

function percent(v: number): string {
  const p = Math.max(0, Number.isFinite(v) ? v * 100 : 0);
  return `${p > 0 && p < 10 ? tenth.format(p) : whole.format(p)}%`;
}

function count(v: number): string {
  const n = Math.max(0, Number.isFinite(v) ? v : 0);
  return n >= 10_000 ? `${whole.format(n / 1000)}k` : n >= 1000 ? `${tenth.format(n / 1000)}k` : whole.format(n);
}

/**
 * Districts as on the 3D board: each tile stands on a plate tinted for its
 * district (whole pads would overlap at this tile size), and the district's
 * name sits under its front (lowest) row of tiles.
 */
function districtLabels(f: FlatLayout) {
  const groups = new Map<keyof typeof DISTRICT_NAME, [number, number][]>();
  for (const t of Object.values(f.tiles)) groups.set(t.district, [...(groups.get(t.district) ?? []), [t.x, t.y]]);
  return [...groups].map(([district, pts]) => {
    const front = Math.max(...pts.map((p) => p[1]));
    const row = pts.filter((p) => p[1] === front);
    return { district, x: row.reduce((s, p) => s + p[0], 0) / row.length, y: front + FLAT_TILE.h / 2 + PLATE + 0.16 };
  });
}

interface Flat2DProps {
  c: CaseFile;
  /** CSS pixels covered by docks at each side; the board sits in what is left */
  insetLeft: number;
  insetRight: number;
  /** behind a menu: nothing can be picked, focused or read out */
  backdrop: boolean;
  /** the flat view was asked for in the address, not forced by the browser */
  chosen: boolean;
}

/**
 * The city without 3D: one tile per building at its place on the layout grid,
 * roads as lines whose width follows the traffic, all drawn from the same
 * snapshot as the 3D board. Tiles are buttons that select their building.
 */
export function Flat2D({ c, insetLeft, insetRight, backdrop, chosen }: Flat2DProps) {
  const snap = useGame((s) => s.snap);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const f = useMemo(() => flatLayout(c), [c]);
  const labels = useMemo(() => districtLabels(f), [f]);
  const busiest = useMemo(() => {
    const inflow = healthyInflow(c);
    return Math.max(0, ...c.edges.map((e) => (inflow[e.from] ?? 0) * e.fanout));
  }, [c]);
  if (!snap) return null;

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const stage = { '--ar': f.width / f.height, '--cols': f.width } as CSSProperties;

  return (
    <div
      data-testid="flat-board"
      className={`flat ${backdrop ? 'flat-backdrop' : ''}`}
      inert={backdrop}
      aria-hidden={backdrop || undefined}
      role={backdrop ? undefined : 'region'}
      aria-label={backdrop ? undefined : BOARD_NAME}
      style={{ '--inset-left': `${insetLeft}px`, '--inset-right': `${insetRight}px` } as CSSProperties}
    >
      {!backdrop && (
        <div className="flat-head">
          <p className="flat-notice" data-testid="no-webgl">
            {chosen ? 'This is the flat view of the city, as the address asks.' : '3D is not available in this browser, so this is the flat view.'}
          </p>
          <p className="flat-legend" aria-hidden="true">
            <span>
              <i className="flat-key flat-key-ok" /> wider road, more traffic
            </span>
            <span>
              <i className="flat-key flat-key-retry" /> retries
            </span>
            <span>
              <i className="flat-key flat-key-fail" /> failures
            </span>
          </p>
        </div>
      )}
      <div className="flat-area">
        <div className="flat-stage" style={stage}>
          <svg className="flat-map" viewBox={`0 0 ${f.width} ${f.height}`} aria-hidden="true">
            {Object.entries(f.tiles).map(([id, t]) => (
              <rect
                key={id}
                className={`flat-plate flat-plate-${t.district}`}
                x={t.x - FLAT_TILE.w / 2 - PLATE}
                y={t.y - FLAT_TILE.h / 2 - PLATE}
                width={FLAT_TILE.w + 2 * PLATE}
                height={FLAT_TILE.h + 2 * PLATE}
                rx={0.16}
              />
            ))}
            {labels.map((l) => (
              <text key={l.district} className="flat-district" x={l.x} y={l.y}>
                {DISTRICT_NAME[l.district].toUpperCase()}
              </text>
            ))}
            {f.roads.map((r) => {
              const look = roadLook(snap.edges[r.id] ?? { rate: 0, retryRate: 0, failRate: 0 }, busiest);
              const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1) || 1;
              const ux = (r.x2 - r.x1) / len;
              const uy = (r.y2 - r.y1) / len;
              const bx = r.x2 - ux * ARROW.len;
              const by = r.y2 - uy * ARROW.len;
              return (
                <g key={r.id} className={`flat-road flat-road-${look.kind}`} data-edge={r.id}>
                  <line x1={r.x1} y1={r.y1} x2={bx} y2={by} strokeWidth={look.width} vectorEffect="non-scaling-stroke" />
                  <polygon
                    points={`${r.x2},${r.y2} ${bx - uy * ARROW.half},${by + ux * ARROW.half} ${bx + uy * ARROW.half},${by - ux * ARROW.half}`}
                  />
                </g>
              );
            })}
          </svg>
          {Object.entries(f.tiles).map(([id, t]) => {
            const v: NodeView | undefined = snap.nodes[id];
            const health = buildingHealth(v);
            const word = STATUS_WORD[health];
            const load = Math.min(1, Math.max(0, v?.saturation ?? 0));
            const changed = craneOn(snap.changes, id, snap.tick);
            const name = c.layout[id]!.name;
            const on = selected === id;
            const style: CSSProperties = {
              left: pct(t.x - FLAT_TILE.w / 2, f.width),
              top: pct(t.y - FLAT_TILE.h / 2, f.height),
              width: pct(FLAT_TILE.w, f.width),
              height: pct(FLAT_TILE.h, f.height),
            };
            const body = (
              <>
                <span className="flat-top">
                  <span className="flat-name">{name}</span>
                  {changed && <span className="flat-changed">changed</span>}
                </span>
                <span className={`flat-status flat-status-${health}`}>
                  <HealthIcon health={health} />
                  {word}
                </span>
                <span className="flat-load">
                  <span className="flat-load-bar">
                    <span className="flat-load-fill" style={{ width: `${load * 100}%` }} />
                  </span>
                  <span className="flat-k">load {percent(load)}</span>
                </span>
                <span className="flat-nums">
                  <span>
                    <span className="num">{count(v?.queue ?? 0)}</span> queued
                  </span>
                  <span>
                    <span className="num">{percent(v?.errorRate ?? 0)}</span> errors
                  </span>
                </span>
              </>
            );
            const cls = `flat-tile flat-tile-${health} ${on ? 'flat-tile-on' : ''}`;
            if (backdrop) {
              return (
                <div key={id} className={cls} style={style}>
                  {body}
                </div>
              );
            }
            return (
              <button
                key={id}
                type="button"
                className={cls}
                style={style}
                data-node={id}
                aria-pressed={on}
                aria-label={`${name}: ${word}, load ${percent(load)}, ${count(v?.queue ?? 0)} queued, ${percent(v?.errorRate ?? 0)} errors${changed ? ', changed lately' : ''}`}
                onClick={() => select(id)}
              >
                {body}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
