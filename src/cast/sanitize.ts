/**
 * Characters removed from any text that crosses the network, either way:
 * C0 and C1 controls except the line feed, the Arabic letter mark, the
 * Mongolian vowel separator, zero-width characters and marks, the line and
 * paragraph separators, bidi embeddings, overrides and isolates, invisible
 * operators, the byte-order mark, the interlinear annotation marks and the
 * Unicode tag characters (U+E0000 to U+E007F, which can spell out hidden text).
 * Also any unpaired surrogate: half a character, as when a stream is cut
 * mid-character, is never shown; the whole character is judged once it arrives.
 * Written as escapes so the source holds no invisible characters; the `u` flag
 * makes the pattern work on code points, so the astral tag range is one class.
 */
const HIDDEN =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}\uD800-\uDFFF]/gu;

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
