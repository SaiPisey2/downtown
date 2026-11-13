import { evalCond } from './cond';
import { emptyFlow, stepFlow, topoOrder } from './flow';
import type { CaseModel, ClueDef, GameEvent, Modifier, NodeId, NodeParams, PlayerInput, RejectReason, Snapshot } from './types';

export interface Run {
  readonly seed: number;
  readonly snapshot: Snapshot;
  readonly log: readonly GameEvent[];
  step(ticks?: number): Snapshot;
  act(actionId: string): { ok: true } | { ok: false; reason: RejectReason };
  /** newly found clues for a route; a clue is found only if its `when` holds now */
  observe(route: string): ClueDef[];
  update(id: string): void;
  /** the heaviest undiscovered, not-yet-hinted clue whose `when` holds; null when none */
  hint(): ClueDef | null;
  readonly inputs: readonly PlayerInput[];
}

interface ActiveModifier {
  mod: Modifier;
  appliedAt: number;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EventBody = DistributiveOmit<GameEvent, 'tick'>;

const copyFlags = (f: Snapshot['flags']): Snapshot['flags'] =>
  Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { ...v }]));

export function createRun(model: CaseModel, seed: number = model.seed): Run {
  const ids = Object.keys(model.nodes);
  const order = topoOrder(ids, model.edges);
  const log: GameEvent[] = [];
  const inputs: PlayerInput[] = [];
  const found = new Set<string>();
  const hinted = new Set<string>();
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
    log.push({ tick, ...e });
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

  const eligible = (c: ClueDef): boolean => !c.when || evalCond(c.when, snap);

  return {
    seed,
    get snapshot() { return snap; },
    get log() { return log; },
    get inputs() { return inputs; },
    step(ticks = 1) {
      for (let i = 0; i < ticks && snap.status === 'running'; i++) tickOnce();
      return snap;
    },
    act(actionId) {
      inputs.push({ tick: snap.tick, kind: 'act', id: actionId });
      const reject = (reason: RejectReason) => {
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
    observe(route) {
      if (snap.status !== 'running') return [];
      inputs.push({ tick: snap.tick, kind: 'observe', route });
      const fresh = model.clues.filter((c) => c.route === route && !found.has(c.id) && eligible(c));
      for (const c of fresh) {
        found.add(c.id);
        emit(snap.tick, { type: 'clue', clueId: c.id });
      }
      return fresh;
    },
    update(id) {
      if (snap.status !== 'running' || !model.updates.some((u) => u.id === id)) return;
      inputs.push({ tick: snap.tick, kind: 'update', id });
      emit(snap.tick, { type: 'update', id });
    },
    hint() {
      if (snap.status !== 'running') return null;
      inputs.push({ tick: snap.tick, kind: 'hint' });
      let best: ClueDef | null = null;
      for (const c of model.clues) {
        if (found.has(c.id) || hinted.has(c.id) || !eligible(c)) continue;
        if (!best || c.weight > best.weight) best = c;
      }
      if (best) hinted.add(best.id);
      emit(snap.tick, { type: 'hint', clueId: best?.id ?? null });
      return best;
    },
  };
}
