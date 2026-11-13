import { evalCond } from './cond';
import { emptyFlow, stepFlow, topoOrder } from './flow';
import { makeRng } from './rng';
import type { CaseModel, GameEvent, Modifier, NodeId, NodeParams, Snapshot } from './types';

export interface Run {
  readonly snapshot: Snapshot;
  readonly log: readonly GameEvent[];
  step(ticks?: number): Snapshot;
  act(actionId: string): { ok: true } | { ok: false; reason: string };
}

interface ActiveModifier {
  mod: Modifier;
  appliedAt: number;
}

type EventBody =
  | { type: 'deploy' | 'fault'; target: NodeId; label: string }
  | { type: 'message'; from: string; lineKey: string }
  | { type: 'action'; actionId: string }
  | { type: 'action_landed'; actionId: string }
  | { type: 'action_rejected'; actionId: string; reason: 'unknown' | 'already_pending' | 'already_done' | 'not_running' }
  | { type: 'won' }
  | { type: 'lost'; reason: 'clock' | 'impact' };

const copyFlags = (f: Snapshot['flags']): Snapshot['flags'] =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { ...v }]));

export function createRun(model: CaseModel, seed: number = model.seed): Run {
  makeRng(seed); // created for later tasks; nothing here needs randomness
  const ids = Object.keys(model.nodes);
  const order = topoOrder(ids, model.edges);
  const log: GameEvent[] = [];
  const active: ActiveModifier[] = [];
  const done = new Set<string>();
  const pending: { actionId: string; landsAt: number }[] = [];
  let winStreak = 0;

  const baseParams = (): Record<NodeId, NodeParams> =>
    Object.fromEntries(ids.map((id) => [id, { ...model.nodes[id]! }]));

  let snap: Snapshot = {
    ...emptyFlow(ids, model.edges),
    tick: 0,
    status: 'running',
    flags: Object.fromEntries(ids.map((id) => [id, {}])),
    params: baseParams(),
    impact: { total: 0, failed: 0, errorRate: 0 },
    pending: [],
    changes: [],
  };

  const emit = (tick: number, e: EventBody): void => {
    log.push({ tick, ...e } as GameEvent);
  };

  const effective = (tick: number, prev: Snapshot): Record<NodeId, NodeParams> => {
    const params = baseParams();
    for (const { mod, appliedAt } of active) {
      if (mod.forTicks !== undefined && tick >= appliedAt + mod.forTicks) continue;
      if (mod.while && !evalCond(mod.while, prev)) continue;
      const p = params[mod.target];
      if (!p) continue;
      if (mod.set) Object.assign(p, mod.set);
      if (mod.mul) {
        if (mod.mul.costMul !== undefined) p.costMul *= mod.mul.costMul;
        if (mod.mul.capacityMul !== undefined) p.capacityMul *= mod.mul.capacityMul;
        if (mod.mul.instances !== undefined) p.instances *= mod.mul.instances;
      }
    }
    return params;
  };

  const tickOnce = (): void => {
    const prev = snap;
    const t = prev.tick + 1;
    const flags = copyFlags(prev.flags);
    const changes = [...prev.changes];

    const apply = (mod: Modifier): void => {
      active.push({ mod, appliedAt: t });
      const f = flags[mod.target];
      if (mod.flags && f) Object.assign(f, mod.flags);
    };

    for (const ev of model.timeline) {
      if (ev.at !== t) continue;
      const target = ev.target ?? ev.modifier?.target;
      if (ev.kind === 'message') {
        emit(t, { type: 'message', from: ev.from ?? '', lineKey: ev.lineKey ?? '' });
        continue;
      }
      const label = ev.label ?? '';
      if (target !== undefined) {
        emit(t, { type: ev.kind === 'deploy' ? 'deploy' : 'fault', target, label });
        if (ev.kind === 'deploy') changes.push({ tick: t, target, label, byPlayer: false });
      }
      if (ev.modifier) apply(ev.modifier);
    }

    for (let i = 0; i < pending.length; ) {
      const p = pending[i]!;
      if (p.landsAt > t) { i++; continue; }
      pending.splice(i, 1);
      const def = model.actions.find((a) => a.id === p.actionId);
      if (!def) continue;
      done.add(def.id);
      const f = flags[def.target];
      if (f) for (const name of def.clears ?? []) delete f[name];
      for (const eff of def.effects) apply(eff);
      emit(t, { type: 'action_landed', actionId: def.id });
      changes.push({ tick: t, target: def.target, label: def.label, byPlayer: true });
    }

    const params = effective(t, prev);
    const flow = stepFlow(prev, params, model.edges, order, model.entry, model.baseRps);
    const entry = flow.nodes[model.entry];
    const arrivals = entry?.arrivals ?? 0;
    const errorRate = entry?.errorRate ?? 0;

    let next: Snapshot = {
      ...flow,
      tick: t,
      status: 'running',
      flags,
      params,
      impact: {
        total: prev.impact.total + arrivals,
        failed: prev.impact.failed + arrivals * errorRate,
        errorRate,
      },
      pending: pending.map((p) => ({ ...p })),
      changes,
    };

    winStreak = evalCond(model.win.cond, next) ? winStreak + 1 : 0;
    if (winStreak >= model.win.holdTicks) {
      next = { ...next, status: 'won' };
      emit(t, { type: 'won' });
    } else if (next.impact.failed > model.lose.maxFailedRequests) {
      next = { ...next, status: 'lost' };
      emit(t, { type: 'lost', reason: 'impact' });
    } else if (t >= model.maxTicks) {
      next = { ...next, status: 'lost' };
      emit(t, { type: 'lost', reason: 'clock' });
    }
    snap = next;
  };

  return {
    get snapshot() { return snap; },
    get log() { return log; },
    step(ticks = 1) {
      for (let i = 0; i < ticks && snap.status === 'running'; i++) tickOnce();
      return snap;
    },
    act(actionId) {
      const reject = (reason: 'unknown' | 'already_pending' | 'already_done' | 'not_running') => {
        emit(snap.tick, { type: 'action_rejected', actionId, reason });
        return { ok: false as const, reason };
      };
      if (snap.status !== 'running') return reject('not_running');
      const def = model.actions.find((a) => a.id === actionId);
      if (!def) return reject('unknown');
      if (pending.some((p) => p.actionId === actionId)) return reject('already_pending');
      if (def.once && done.has(actionId)) return reject('already_done');
      pending.push({ actionId, landsAt: snap.tick + def.delayTicks });
      emit(snap.tick, { type: 'action', actionId });
      snap = { ...snap, pending: pending.map((p) => ({ ...p })) };
      return { ok: true };
    },
  };
}
