import { answerFor } from '../cases';
import type { CaseFile } from '../cases';
import type { GameEvent, Snapshot } from '../sim';
import type { Cast, CastContext, ChatLine } from './types';

export interface ScriptedOptions {
  /** real milliseconds an answer takes to arrive in full; 0 streams it all at once */
  delayMs?: number;
}

/** How many pieces an answer arrives in, so the chat shows it being written. */
const CHUNKS = 3;

/** Splits text at word boundaries into about `n` pieces that join back to the same text. */
function pieces(text: string, n: number): string[] {
  const words = text.split(/(?<= )/);
  const per = Math.max(1, Math.ceil(words.length / n));
  const out: string[] = [];
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(''));
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The cast as written in the case file: timeline messages, consequence lines
 * from the first teammate, a nudge from the stakeholder when a whole update
 * window passes in silence, and the stored answers to each question.
 */
export function scriptedCast(c: CaseFile, opts: ScriptedOptions = {}): Cast {
  const delayMs = opts.delayMs ?? 0;
  const teammate = c.cast.find((m) => m.role === 'teammate');
  const boss = c.cast.find((m) => m.role === 'stakeholder');
  const W = c.scoring.updateEveryTicks;
  /** start of the update window now running; null until the first fault */
  let windowStart: number | null = null;
  let updatedInWindow = false;

  const line = (tick: number, from: string | undefined, key: string | undefined): ChatLine[] => {
    const text = key === undefined ? undefined : c.lines[key];
    return from && text !== undefined ? [{ id: 0, tick, from, text }] : [];
  };

  return {
    async onEvent(e: GameEvent) {
      switch (e.type) {
        case 'message':
          return line(e.tick, e.from, e.lineKey);
        case 'action_landed':
          return line(e.tick, teammate?.id, c.actions.find((a) => a.id === e.actionId)?.consequenceKey);
        case 'fault':
          if (windowStart === null) windowStart = e.tick;
          return [];
        case 'update': {
          if (windowStart !== null && e.tick >= windowStart) updatedInWindow = true;
          const honest = c.updates.find((u) => u.id === e.id)?.honest;
          return honest === undefined ? [] : line(e.tick, boss?.id, honest ? 'update_ack_honest' : 'update_ack_spin');
        }
        case 'won':
          return line(e.tick, boss?.id, 'outcome_won');
        case 'lost':
          return line(e.tick, boss?.id, 'outcome_lost');
        default:
          return [];
      }
    },

    async onTick(snap: Snapshot) {
      if (windowStart === null || snap.status !== 'running') return [];
      let missed = false;
      while (snap.tick >= windowStart + W) {
        if (!updatedInWindow) missed = true;
        windowStart += W;
        updatedInWindow = false;
      }
      return missed ? line(snap.tick, boss?.id, 'nudge') : [];
    },

    async *ask(castId: string, questionId: string | null, _freeText: string | null, ctx: CastContext) {
      const text =
        questionId === null ? 'Pick one of the questions below and I will tell you what I know.'
        : answerFor(c, castId, questionId, ctx.snap);
      const parts = pieces(text, CHUNKS);
      for (let i = 0; i < parts.length; i++) {
        // half the delay before the first piece, the rest spread over the others
        if (delayMs > 0) await sleep(i === 0 || parts.length === 1 ? delayMs / 2 : delayMs / 2 / (parts.length - 1));
        yield parts[i]!;
      }
    },
  };
}
