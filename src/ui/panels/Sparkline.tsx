import { useId } from 'react';
import type { NodeView } from '../../sim';
import { METRICS, formatValue } from '../metrics';
import type { Health } from '../metrics';
import { HealthIcon } from './HealthIcon';

const W = 132;
const H = 34;
const PAD = 2;

/** Line and filled area for a series, scaled into the box. */
function paths(values: number[], max: number): { line: string; area: string } {
  if (values.length === 0) return { line: '', area: '' };
  const n = values.length;
  const x = (i: number) => (n === 1 ? W : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - (Math.min(Math.max(v, 0), max) / max) * (H - 2 * PAD);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const line = `M${pts.join('L')}`;
  const area = `${line}L${x(n - 1).toFixed(1)},${H - PAD}L${x(0).toFixed(1)},${H - PAD}Z`;
  return { line, area };
}

/** One graph row: name, a small chart of the last two minutes, and the value now with its unit. */
export function Sparkline({ metric, values }: { metric: keyof NodeView; values: number[] }) {
  const meta = METRICS[metric];
  const gradient = useId();
  const now = values.at(-1);
  const health: Health = now === undefined ? 'ok' : meta.health(now);
  const peak = Math.max(0, ...values);
  const max = meta.fraction ? 1 : peak > 0 ? peak * 1.15 : 1;
  const { line, area } = paths(values, max);
  const reading = now === undefined ? 'no data yet' : `${formatValue(metric, now)} ${meta.unit}`;
  return (
    <div className={`graph graph-${health}`}>
      <div className="graph-name">{meta.label}</div>
      <svg
        className="spark"
        role="img"
        aria-label={`${meta.label}, last ${values.length} s: ${reading}`}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        width={W}
        height={H}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line className="spark-base" x1={0} x2={W} y1={H - PAD} y2={H - PAD} />
        {area && <path d={area} fill={`url(#${gradient})`} />}
        {line && <path d={line} className="spark-line" />}
      </svg>
      <div className="graph-value">
        {now !== undefined && <HealthIcon health={health} />}
        <span className="num">{now === undefined ? '–' : formatValue(metric, now)}</span>
        <span className="unit">{now === undefined ? '' : meta.unit}</span>
      </div>
    </div>
  );
}
