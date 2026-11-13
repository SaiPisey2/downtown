import type { CaseFile } from '../cases';
import type { GameEvent } from '../sim';

export interface TimelineEntry {
  tick: number;
  kind: 'fault' | 'deploy' | 'clue' | 'action' | 'landed' | 'update' | 'hint' | 'won' | 'lost';
  text: string;
}

/**
 * The run told in plain words, oldest first: the fault, deploys, clues found,
 * actions taken and landed, status updates, hints, and how it ended. Messages
 * and refused actions are left out. Ids the case does not know are shown as they are.
 */
export function timeline(c: CaseFile, log: readonly GameEvent[]): TimelineEntry[] {
  const action = (id: string) => c.actions.find((a) => a.id === id)?.label ?? id;
  const out: TimelineEntry[] = [];
  for (const e of log) {
    const at = (kind: TimelineEntry['kind'], text: string) => out.push({ tick: e.tick, kind, text });
    switch (e.type) {
      case 'deploy': at('deploy', `Deploy: ${e.label}`); break;
      case 'fault': at('fault', `The fault begins: ${e.label}`); break;
      case 'clue': at('clue', `Clue found: ${c.clues.find((x) => x.id === e.clueId)?.text ?? e.clueId}`); break;
      case 'action': at('action', `You started: ${action(e.actionId)}`); break;
      case 'action_landed': at('landed', `Landed: ${action(e.actionId)}`); break;
      case 'update': {
        const u = c.updates.find((x) => x.id === e.id);
        at('update', `You told the boss: ${u?.label ?? e.id}${u && !u.honest ? ' (not the whole truth)' : ''}`);
        break;
      }
      case 'hint':
        at('hint', e.clueId === null ? 'You asked for a hint; there was nothing left to show' : 'You used a hint (−3 points)');
        break;
      case 'won': at('won', 'The city recovered'); break;
      case 'lost': at('lost', e.reason === 'clock' ? 'The clock ran out' : 'Too many customers saw errors'); break;
      default: break;
    }
  }
  return out;
}

/** The tick the trouble starts, as scoring counts it: the first fault, else the first deploy. */
export function faultTick(c: CaseFile): number {
  return (c.timeline.find((e) => e.kind === 'modify') ?? c.timeline.find((e) => e.kind === 'deploy'))?.at ?? 0;
}
