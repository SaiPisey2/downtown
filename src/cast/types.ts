import type { CaseFile } from '../cases';
import type { GameEvent, Snapshot } from '../sim';

/** One line in the chat. Lines are split into threads by `from` and, for the player's lines, `to`. */
export interface ChatLine {
  id: number;
  tick: number;
  /** cast id | 'you' | 'system' */
  from: string;
  /** whose thread the line belongs to: on the player's own lines, and on system notices about one character */
  to?: string;
  text: string;
  /** true while the text is still arriving */
  live?: boolean;
}

/** What a character may look at when answering. */
export interface CastContext {
  c: CaseFile;
  snap: Snapshot;
  found: string[];
  chat: ChatLine[];
}

/** What a reviewer may look at once the run is over. */
export interface ReviewContext {
  c: CaseFile;
  final: Snapshot;
  log: readonly GameEvent[];
  chat: ChatLine[];
}

/**
 * The people in a case. The store offers every game event in order, then the
 * tick itself; lines the cast returns are appended as they are (the store
 * gives them their ids). Answers stream: each yielded string is appended to
 * the line being written.
 */
export interface Cast {
  /** unsolicited lines prompted by one event */
  onEvent(e: GameEvent, snap: Snapshot): Promise<ChatLine[]>;
  /** unsolicited lines prompted by time passing, offered after the tick's events */
  onTick?(snap: Snapshot): Promise<ChatLine[]>;
  ask(castId: string, questionId: string | null, freeText: string | null, ctx: CastContext): AsyncIterable<string>;
  review?(ctx: ReviewContext): AsyncIterable<string>;
  /** stops anything still in flight; called when the run ends or is replaced */
  stop?(): void;
}

/** What a cast can tell the store besides what its characters say. */
export interface CastHooks {
  /** one plain system line in `castId`'s thread, e.g. that live answers failed */
  notice(castId: string, text: string): void;
}
