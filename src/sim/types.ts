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
