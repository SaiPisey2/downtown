import type { EdgeId, EdgeParams, FlowState, NodeId, NodeParams, NodeView, EdgeView } from './types';

export const edgeId = (from: NodeId, to: NodeId): EdgeId => `${from}>${to}`;

const zeroNode = (): NodeView => ({
  arrivals: 0, served: 0, queue: 0, dropped: 0, latencyMs: 0, errorRate: 0, saturation: 0, retryArrivals: 0,
});
const zeroEdge = (): EdgeView => ({ rate: 0, retryRate: 0, failRate: 0 });

/** Finite and non-negative, or 0. */
const fin = (x: number): number => (Number.isFinite(x) && x > 0 ? x : 0);
const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export function emptyFlow(nodeIds: NodeId[], edges: EdgeParams[]): FlowState {
  const nodes: Record<NodeId, NodeView> = {};
  for (const id of nodeIds) nodes[id] = zeroNode();
  const es: Record<EdgeId, EdgeView> = {};
  for (const e of edges) es[edgeId(e.from, e.to)] = zeroEdge();
  return { nodes, edges: es };
}

export function topoOrder(nodeIds: NodeId[], edges: EdgeParams[]): NodeId[] {
  const indegree = new Map<NodeId, number>(nodeIds.map((id) => [id, 0]));
  const children = new Map<NodeId, NodeId[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) {
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    children.get(e.from)?.push(e.to);
  }
  const ready = nodeIds.filter((id) => indegree.get(id) === 0);
  const order: NodeId[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const c of children.get(id) ?? []) {
      const d = (indegree.get(c) ?? 0) - 1;
      indegree.set(c, d);
      if (d === 0) ready.push(c);
    }
  }
  if (order.length !== nodeIds.length) throw new Error('cycle in service graph');
  return order;
}

export function stepFlow(
  prev: FlowState,
  params: Record<NodeId, NodeParams>,
  edges: EdgeParams[],
  order: NodeId[],
  entry: NodeId,
  entryRps: number,
): FlowState {
  const nodes: Record<NodeId, NodeView> = {};
  const outEdges: Record<EdgeId, EdgeView> = {};
  const inbound = new Map<NodeId, EdgeParams[]>();
  const outbound = new Map<NodeId, EdgeParams[]>();
  for (const e of edges) {
    (inbound.get(e.to) ?? inbound.set(e.to, []).get(e.to)!).push(e);
    (outbound.get(e.from) ?? outbound.set(e.from, []).get(e.from)!).push(e);
  }

  for (const id of order) {
    const p = params[id];
    if (!p) continue;
    const before = prev.nodes[id] ?? zeroNode();

    let retryArrivals = 0;
    let arrivals = id === entry ? fin(entryRps) : 0;
    if (id !== entry) {
      for (const e of inbound.get(id) ?? []) {
        const ev = outEdges[edgeId(e.from, e.to)];
        if (!ev) continue;
        arrivals += ev.rate + ev.retryRate;
        retryArrivals += ev.retryRate;
      }
    }
    arrivals = fin(arrivals);

    const capacity = p.enabled && p.costMul > 0
      ? fin((p.instances * p.rpsPerInstance * p.capacityMul) / p.costMul)
      : 0;
    const queueMax = fin(p.queueMax);
    const demand = arrivals + fin(before.queue);
    const served = Math.min(demand, capacity);
    const queue = Math.min(queueMax, demand - served);
    const dropped = Math.max(0, demand - served - queueMax);
    const saturation = capacity > 0 ? Math.min(1, demand / capacity) : 1;
    const latencyMs = fin(
      p.baseLatencyMs / (1 - Math.min(saturation, 0.98)) + (capacity > 0 ? (queue / capacity) * 1000 : 60000),
    );
    const own = arrivals > 0 ? clamp01(dropped / arrivals) : 0;

    let survive = 1 - own;
    for (const e of outbound.get(id) ?? []) {
      const rate = fin(served * e.fanout);
      const child = prev.nodes[e.to];
      let childFail = child ? clamp01(child.errorRate) : 0;
      if (child && child.latencyMs > e.timeoutMs) childFail = 1;
      const failRate = rate * childFail;
      const retryRate = fin(Math.min(failRate * e.retries, rate * e.retries));
      outEdges[edgeId(e.from, e.to)] = { rate, retryRate, failRate: fin(failRate) };
      survive *= 1 - childFail;
    }

    nodes[id] = {
      arrivals, served: fin(served), queue: fin(queue), dropped: fin(dropped),
      latencyMs, errorRate: clamp01(1 - survive), saturation: clamp01(saturation), retryArrivals: fin(retryArrivals),
    };
  }
  return { nodes, edges: outEdges };
}
