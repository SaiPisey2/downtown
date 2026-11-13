import type { Cond } from './cond';

export type NodeId = string;
export type EdgeId = string; // `${from}>${to}`

export interface NodeParams {
  instances: number;
  rpsPerInstance: number;
  costMul: number;
  capacityMul: number;
  enabled: boolean;
  queueMax: number;
  baseLatencyMs: number;
}

export interface EdgeParams {
  from: NodeId;
  to: NodeId;
  fanout: number;
  timeoutMs: number;
  retries: number;
}

export interface NodeView {
  arrivals: number;
  served: number;
  queue: number;
  dropped: number;
  latencyMs: number;
  errorRate: number;
  saturation: number;
  retryArrivals: number;
}

export interface EdgeView {
  rate: number;
  retryRate: number;
  failRate: number;
}

export interface FlowState {
  nodes: Record<NodeId, NodeView>;
  edges: Record<EdgeId, EdgeView>;
}

export interface Modifier {
  target: NodeId;
  set?: Partial<NodeParams>;
  mul?: Partial<Record<'costMul' | 'capacityMul' | 'instances', number>>;
  flags?: Record<string, string | boolean>;
  while?: Cond;
  forTicks?: number;
}

export interface TimelineEvent {
  at: number;
  kind: 'modify' | 'deploy' | 'message';
  target?: NodeId;
  modifier?: Modifier;
  label?: string;
  from?: string;
  lineKey?: string;
  /** messages only: said only if this holds at its tick, otherwise skipped and not logged */
  when?: Cond;
}

export interface ActionDef {
  id: string;
  target: NodeId;
  label: string;
  verb: 'rollback' | 'restart' | 'scale' | 'reroute' | 'switch' | 'block';
  delayTicks: number;
  effects: Modifier[];
  /** flag names deleted on `target` when the action lands */
  clears?: string[];
  resolves: boolean;
  harmful: boolean;
  consequenceKey?: string;
  once?: boolean;
  /** one plain line shown before the player confirms; never says whether it is the right fix */
  risk?: string;
}

export interface CaseModel {
  id: string;
  version: number;
  title: string;
  seed: number;
  maxTicks: number;
  ticksPerSecond: number;
  entry: NodeId;
  baseRps: number;
  nodes: Record<NodeId, NodeParams>;
  edges: EdgeParams[];
  timeline: TimelineEvent[];
  actions: ActionDef[];
  win: { cond: Cond; holdTicks: number };
  lose: { maxFailedRequests: number };
  clues: ClueDef[];
  updates: UpdateDef[];
  scoring: ScoringDef;
}

export interface ClueDef {
  id: string;
  /** 'graph:edge.saturation' | 'log:edge' | 'changes' | 'ask:netops:volume' */
  route: string;
  when?: Cond;
  weight: number;
  text: string;
  /** counts as the first key clue for detection scoring */
  key?: boolean;
}

export interface UpdateDef { id: string; label: string; honest: boolean }

export interface ScoringDef {
  detectParTicks: number;
  recoverParTicks: number;
  updateEveryTicks: number;
  /** the fix that removes the cause; its own delay is added to the recovery par when it lands before the win */
  cleanFixAction?: string;
  /** fixes that bring the city back but leave the cause in place */
  shortcutActions?: string[];
  /** taken off a won run where a shortcut landed and the clean fix never did */
  shortcutPenalty?: number;
}

export interface Snapshot extends FlowState {
  tick: number;
  status: 'running' | 'won' | 'lost';
  flags: Record<NodeId, Record<string, string | boolean>>;
  params: Record<NodeId, NodeParams>;
  /** errorRate is the entry node's rate this tick; total and failed are cumulative */
  impact: { total: number; failed: number; errorRate: number };
  pending: { actionId: string; landsAt: number }[];
  changes: { tick: number; target: NodeId; label: string; byPlayer: boolean }[];
}

/** `too_early`: nothing has gone wrong yet (no deploy or fault has happened) */
export type RejectReason = 'unknown' | 'too_early' | 'already_pending' | 'already_done' | 'not_running';

export type PlayerInput = { tick: number } & (
  | { kind: 'act'; id: string }
  | { kind: 'observe'; route: string }
  | { kind: 'update'; id: string }
  | { kind: 'hint' }
);

export type GameEvent = { tick: number } & (
  | { type: 'deploy' | 'fault'; target: NodeId; label: string }
  | { type: 'message'; from: string; lineKey: string }
  | { type: 'action'; actionId: string }
  | { type: 'action_landed'; actionId: string }
  | { type: 'action_rejected'; actionId: string; reason: RejectReason }
  | { type: 'clue'; clueId: string }
  | { type: 'update'; id: string }
  | { type: 'hint'; clueId: string | null }
  | { type: 'won' }
  | { type: 'lost'; reason: 'clock' | 'impact' }
);
