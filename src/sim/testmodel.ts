import type { CaseModel, NodeParams } from './types';

/** Shared fixture for sim tests: an edge/app/db chain with a rules deploy that blows up the edge at tick 10. */
export const node = (over: Partial<NodeParams> = {}): NodeParams => ({
  instances: 1, rpsPerInstance: 1000, costMul: 1, capacityMul: 1,
  enabled: true, queueMax: 200, baseLatencyMs: 10, ...over,
});

export const testModel = (over: Partial<CaseModel> = {}): CaseModel => ({
  id: 't', version: 1, title: 't', seed: 1, maxTicks: 400, ticksPerSecond: 10,
  entry: 'edge', baseRps: 500,
  nodes: { edge: node(), app: node(), db: node() },
  edges: [
    { from: 'edge', to: 'app', fanout: 1, timeoutMs: 1000, retries: 0 },
    { from: 'app', to: 'db', fanout: 1, timeoutMs: 1000, retries: 0 },
  ],
  timeline: [
    { at: 10, kind: 'deploy', target: 'edge', label: 'rules v2', modifier: { target: 'edge', flags: { rules: 'v2' } } },
    {
      at: 10, kind: 'modify', target: 'edge', label: 'rules blow up',
      modifier: { target: 'edge', mul: { costMul: 40 }, while: { metric: 'edge.flag:rules', op: '==', value: 'v2' } },
    },
  ],
  actions: [
    {
      id: 'rollback_rules', target: 'edge', label: 'Roll back rules', verb: 'rollback',
      delayTicks: 10, effects: [], clears: ['rules'], resolves: true, harmful: false,
    },
    {
      id: 'restart_db', target: 'db', label: 'Restart db', verb: 'restart',
      delayTicks: 2, effects: [], resolves: false, harmful: true,
    },
  ],
  win: {
    cond: { all: [{ metric: 'city.errorRate', op: '<', value: 0.01 }, { metric: 'city.tick', op: '>=', value: 15 }] },
    holdTicks: 5,
  },
  lose: { maxFailedRequests: 100_000 },
  clues: [
    { id: 'sat', route: 'graph:edge.saturation', when: { metric: 'edge.saturation', op: '>', value: 0.9 }, weight: 5, text: 'edge is saturated', key: true },
    { id: 'log', route: 'log:edge', weight: 2, text: 'edge logs show slow rules' },
    { id: 'chg', route: 'changes', when: { metric: 'edge.flag:rules', op: '==', value: 'v2' }, weight: 8, text: 'rules v2 deployed' },
    { id: 'old', route: 'changes', weight: 1, text: 'nothing else changed' },
  ],
  updates: [{ id: 'honest', label: 'We are investigating', honest: true }, { id: 'spin', label: 'All fine', honest: false }],
  scoring: { detectParTicks: 20, recoverParTicks: 60, updateEveryTicks: 20 },
  ...over,
});
