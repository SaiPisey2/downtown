import type { NodeView } from '../sim';

export type Health = 'ok' | 'warn' | 'bad';

interface MetricMeta {
  label: string;
  unit: string;
  /** values are fractions shown as percentages, on a fixed 0..1 scale */
  fraction?: boolean;
  health(v: number): Health;
}

const rate = (label: string, health: (v: number) => Health = () => 'ok'): MetricMeta => ({ label, unit: 'rps', health });

export const METRICS: Record<keyof NodeView, MetricMeta> = {
  arrivals: rate('Requests in'),
  served: rate('Served'),
  dropped: rate('Turned away', (v) => (v > 0.5 ? 'bad' : 'ok')),
  retryArrivals: rate('Retries in', (v) => (v > 0.5 ? 'warn' : 'ok')),
  queue: { label: 'Waiting', unit: 'queued', health: (v) => (v > 0.5 ? 'warn' : 'ok') },
  latencyMs: { label: 'Response time', unit: 'ms', health: (v) => (v > 1000 ? 'bad' : v > 300 ? 'warn' : 'ok') },
  errorRate: { label: 'Errors', unit: '%', fraction: true, health: (v) => (v > 0.05 ? 'bad' : v > 0.01 ? 'warn' : 'ok') },
  saturation: { label: 'Saturation', unit: '%', fraction: true, health: (v) => (v >= 0.95 ? 'bad' : v > 0.8 ? 'warn' : 'ok') },
};

const whole = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

/** The number part of a reading, without its unit. */
export function formatValue(metric: keyof NodeView, v: number): string {
  if (METRICS[metric].fraction) return whole.format(v * 100);
  return whole.format(v);
}

/** How a building is doing, in one word. */
export function buildingHealth(v: NodeView | undefined): Health {
  if (!v) return 'ok';
  if (v.errorRate > 0.05 || v.dropped > 0.5 || v.saturation >= 0.99) return 'bad';
  if (v.saturation > 0.8 || v.retryArrivals > 0.5 || v.queue > 0.5 || v.errorRate > 0.01) return 'warn';
  return 'ok';
}

export const HEALTH_WORD: Record<Health, string> = { ok: 'Healthy', warn: 'Strained', bad: 'Failing' };

/** A span of simulated seconds in plain words: "10 s", "1 min 30 s", "5 min". */
export function duration(secs: number): string {
  const t = Math.max(0, Math.ceil(secs));
  if (t < 60) return `${t} s`;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}
