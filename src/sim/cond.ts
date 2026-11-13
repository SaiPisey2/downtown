import type { Snapshot } from './types';

/** Conditions are data, never strings to evaluate. */
export type Cond =
  | { metric: string; op: '<' | '<=' | '>' | '>=' | '==' | '!='; value: number | boolean | string }
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond };

type Reading = number | boolean | string | undefined;

/**
 * Metric forms: `<node>.<NodeView key>`, `<node>.enabled`, `<node>.flag:<name>`,
 * `city.errorRate`, `city.tick`. Anything else reads as undefined.
 */
function read(metric: string, s: Snapshot): Reading {
  if (metric === 'city.tick') return s.tick;
  if (metric === 'city.errorRate') return s.impact.errorRate;
  const dot = metric.indexOf('.');
  if (dot <= 0) return undefined;
  const id = metric.slice(0, dot);
  const key = metric.slice(dot + 1);
  if (!Object.hasOwn(s.params, id)) return undefined;
  if (key === 'enabled') return s.params[id]!.enabled;
  if (key.startsWith('flag:')) {
    const flags = s.flags[id];
    const name = key.slice(5);
    return flags && Object.hasOwn(flags, name) ? flags[name] : undefined;
  }
  const view = s.nodes[id];
  if (view && Object.hasOwn(view, key)) {
    const v = (view as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : undefined;
  }
  return undefined;
}

export function evalCond(c: Cond, s: Snapshot): boolean {
  if ('all' in c) return c.all.every((x) => evalCond(x, s));
  if ('any' in c) return c.any.some((x) => evalCond(x, s));
  if ('not' in c) return !evalCond(c.not, s);
  if (typeof c.metric !== 'string') return false;
  const m = c.metric;
  const got = read(m, s);
  // an unset flag is a known metric with no value: it equals nothing
  if (got === undefined) return m.includes('.flag:') && Object.hasOwn(s.params, m.slice(0, m.indexOf('.'))) && c.op === '!=';
  if (typeof got !== typeof c.value) return false;
  if (typeof got === 'number') {
    const v = c.value as number;
    switch (c.op) {
      case '<': return got < v;
      case '<=': return got <= v;
      case '>': return got > v;
      case '>=': return got >= v;
      case '==': return got === v;
      case '!=': return got !== v;
    }
    return false;
  }
  if (c.op === '==') return got === c.value;
  if (c.op === '!=') return got !== c.value;
  return false;
}
