import { z } from 'zod';
import type { Cond, CaseModel, NodeId, NodeView } from '../sim';

export interface CaseFile extends CaseModel {
  source?: { url: string; publisher: string; date: string };
  briefing: string;
  layout: Record<
    NodeId,
    {
      pos: [number, number];
      district: 'edge' | 'app' | 'data';
      kind: 'gate' | 'proxy' | 'filter' | 'service' | 'cache' | 'database' | 'queue';
      name: string;
    }
  >;
  signals: {
    graphs: Record<NodeId, (keyof NodeView)[]>;
    logs: Record<NodeId, { when: Cond; lines: string[] }[]>;
  };
  cast: {
    id: string;
    name: string;
    role: 'teammate' | 'stakeholder';
    persona: string;
    knows: string[];
    questions: {
      id: string;
      label: string;
      answer: string;
      reveals?: string;
      /** shown instead of `answer` while the revealed clue's `when` does not hold */
      answerBefore?: string;
    }[];
  }[];
  /** scripted lines by key (timeline messages, consequences) */
  lines: Record<string, string>;
  debrief: { happened: string; realTeam: string; fictionNote: string };
}

const o = z.strictObject;
const num = z.number(); // zod rejects NaN and infinities
const nonNeg = z.number().min(0);
const pos = z.number().positive();
const posInt = z.number().int().min(1);
const str = z.string();
const flagValue = z.union([z.string(), z.boolean()]);

const OPS = ['<', '<=', '>', '>=', '==', '!='] as const;
const COND_SHAPES = 'expected {metric, op, value}, {all: [...]}, {any: [...]} or {not: {...}}';

/** Problems with a condition, each as [path, message]; names the bad key or value. */
function condProblems(v: unknown, path: (string | number)[] = []): [(string | number)[], string][] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return [[path, `not a condition (${COND_SHAPES})`]];
  const keys = Object.keys(v);
  const rec = v as Record<string, unknown>;
  const only = (allowed: string[]): [(string | number)[], string][] =>
    keys.filter((k) => !allowed.includes(k)).map((k) => [path, `unknown key "${k}" in condition (${COND_SHAPES})`]);
  for (const join of ['all', 'any'] as const) {
    if (!keys.includes(join)) continue;
    const list = rec[join];
    if (!Array.isArray(list)) return [...only([join]), [[...path, join], `"${join}" must be a list of conditions`]];
    return [...only([join]), ...list.flatMap((x, i) => condProblems(x, [...path, join, i]))];
  }
  if (keys.includes('not')) return [...only(['not']), ...condProblems(rec.not, [...path, 'not'])];
  if (!keys.some((k) => ['metric', 'op', 'value'].includes(k))) {
    return keys.length ? only([]) : [[path, `empty condition (${COND_SHAPES})`]];
  }
  const out = only(['metric', 'op', 'value']);
  if (typeof rec.metric !== 'string') out.push([[...path, 'metric'], `"metric" must be a string, got ${JSON.stringify(rec.metric)}`]);
  if (!(OPS as readonly unknown[]).includes(rec.op)) {
    out.push([[...path, 'op'], `"op" must be one of ${OPS.join(' ')}, got ${JSON.stringify(rec.op)}`]);
  }
  const val = rec.value;
  if (!(typeof val === 'string' || typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val)))) {
    out.push([[...path, 'value'], `"value" must be a finite number, boolean or string, got ${JSON.stringify(val)}`]);
  }
  return out;
}

const cond = z.custom<Cond>().superRefine((v, ctx) => {
  for (const [path, message] of condProblems(v)) ctx.addIssue({ code: 'custom', message, path });
});

const nodeParams = o({
  instances: nonNeg,
  rpsPerInstance: nonNeg,
  costMul: pos,
  capacityMul: pos,
  enabled: z.boolean(),
  queueMax: nonNeg,
  baseLatencyMs: nonNeg,
});

const modifier = o({
  target: str,
  set: nodeParams.partial().optional(),
  mul: o({ costMul: pos, capacityMul: pos, instances: pos }).partial().optional(),
  flags: z.record(str, flagValue).optional(),
  while: cond.optional(),
  forTicks: posInt.optional(),
});

export const NODE_VIEW_KEYS = [
  'arrivals', 'served', 'queue', 'dropped', 'latencyMs', 'errorRate', 'saturation', 'retryArrivals',
] as const satisfies readonly (keyof NodeView)[];

export const caseSchema = o({
  id: z.string().min(1),
  version: posInt,
  title: z.string().min(1),
  seed: z.number().int(),
  maxTicks: posInt,
  ticksPerSecond: pos,
  entry: str,
  baseRps: pos,
  nodes: z.record(str, nodeParams),
  edges: z.array(o({ from: str, to: str, fanout: nonNeg, timeoutMs: pos, retries: z.number().int().min(0) })),
  timeline: z.array(
    o({
      at: posInt,
      kind: z.enum(['modify', 'deploy', 'message']),
      target: str.optional(),
      modifier: modifier.optional(),
      label: str.optional(),
      from: str.optional(),
      lineKey: str.optional(),
    }),
  ),
  actions: z.array(
    o({
      id: z.string().min(1),
      target: str,
      label: str,
      verb: z.enum(['rollback', 'restart', 'scale', 'reroute', 'switch', 'block']),
      delayTicks: z.number().int().min(0),
      effects: z.array(modifier),
      clears: z.array(str).optional(),
      resolves: z.boolean(),
      harmful: z.boolean(),
      consequenceKey: str.optional(),
      once: z.boolean().optional(),
      risk: z.string().min(1).optional(),
    }),
  ),
  win: o({ cond, holdTicks: posInt }),
  lose: o({ maxFailedRequests: pos }),
  clues: z.array(
    o({ id: z.string().min(1), route: str, when: cond.optional(), weight: num, text: str, key: z.boolean().optional() }),
  ),
  updates: z.array(o({ id: z.string().min(1), label: str, honest: z.boolean() })),
  scoring: o({
    detectParTicks: pos,
    recoverParTicks: pos,
    updateEveryTicks: pos,
    cleanFixBonusAction: str.optional(),
  }),
  source: o({ url: str, publisher: str, date: str }).optional(),
  briefing: str,
  layout: z.record(
    str,
    o({
      pos: z.tuple([num, num]),
      district: z.enum(['edge', 'app', 'data']),
      kind: z.enum(['gate', 'proxy', 'filter', 'service', 'cache', 'database', 'queue']),
      name: z.string().min(1),
    }),
  ),
  signals: o({
    graphs: z.record(str, z.array(z.enum(NODE_VIEW_KEYS))),
    logs: z.record(str, z.array(o({ when: cond, lines: z.array(str) }))),
  }),
  cast: z.array(
    o({
      id: z.string().min(1),
      name: z.string().min(1),
      role: z.enum(['teammate', 'stakeholder']),
      persona: str,
      knows: z.array(str),
      questions: z.array(
        o({ id: z.string().min(1), label: str, answer: str, reveals: str.optional(), answerBefore: str.optional() }),
      ),
    }),
  ),
  lines: z.record(str, str),
  debrief: o({ happened: str, realTeam: str, fictionNote: str }),
});

// compile-time check: the schema output is a CaseFile
type SchemaOut = z.output<typeof caseSchema>;
export const assertSchemaMatchesCaseFile = (x: SchemaOut): CaseFile => x;
