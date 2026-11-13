import { evalCond, type Snapshot } from '../sim';
import type { CaseFile } from './schema';

/**
 * The text a cast member says to a question right now: `answerBefore` while the
 * clue the question reveals is not yet true, otherwise `answer`.
 */
export function answerFor(c: CaseFile, castId: string, questionId: string, snap: Snapshot): string {
  const member = c.cast.find((m) => m.id === castId);
  if (!member) throw new Error(`unknown cast "${castId}"`);
  const q = member.questions.find((x) => x.id === questionId);
  if (!q) throw new Error(`cast "${castId}" has no question "${questionId}"`);
  if (q.answerBefore === undefined) return q.answer;
  const clue = c.clues.find((x) => x.id === q.reveals);
  return clue?.when && !evalCond(clue.when, snap) ? q.answerBefore : q.answer;
}
