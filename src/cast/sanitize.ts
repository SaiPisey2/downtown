/**
 * Characters removed from any text that crosses the network, either way:
 * C0 and C1 controls except the line feed, bidi overrides and isolates, and
 * zero-width characters including the byte-order mark.
 */
const HIDDEN = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/**
 * Text safe to show and to send: hidden and control characters removed, cut to
 * `maxLen` characters (whole code points). Markup is left as the same visible
 * characters; it is only ever rendered as a text node. Character by character,
 * so cleaning text as it streams in gives the same result as cleaning it whole.
 */
export function cleanText(s: string, maxLen = 600): string {
  const out = s.replace(HIDDEN, '');
  if (out.length <= maxLen) return out;
  return Array.from(out).slice(0, maxLen).join('');
}
