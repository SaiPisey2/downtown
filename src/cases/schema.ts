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
    questions: { id: string; label: string; answer: string; reveals?: string }[];
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

const cond: z.ZodType<Cond> = z.lazy(() =>
  z.union([
    o({
      metric: str,
      op: z.enum(['<', '<=', '>', '>=', '==', '!=']),
      value: z.union([num, z.boolean(), str]),
    }),
    o({ all: z.array(cond) }),
    o({ any: z.array(cond) }),
    o({ not: cond }),
  ]),
);

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
  mul: o({ costMul: num, capacityMul: num, instances: num }).partial().optional(),
  flags: z.record(str, flagValue).optional(),
  while: cond.optional(),
  forTicks: pos.optional(),
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
      questions: z.array(o({ id: z.string().min(1), label: str, answer: str, reveals: str.optional() })),
    }),
  ),
  lines: z.record(str, str),
  debrief: o({ happened: str, realTeam: str, fictionNote: str }),
});

// compile-time check: the schema output is a CaseFile
type SchemaOut = z.output<typeof caseSchema>;
export const assertSchemaMatchesCaseFile = (x: SchemaOut): CaseFile => x;
