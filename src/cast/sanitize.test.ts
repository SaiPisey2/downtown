import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanText } from './sanitize';

/** Every character the cleaner must remove besides the C0 and C1 controls. */
const INVISIBLE = [0x061c, ...range(0x200b, 0x200f), 0x2028, 0x2029, ...range(0x202a, 0x202e), ...range(0x2060, 0x2064), ...range(0x2066, 0x2069), 0xfeff];

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

describe('cleanText', () => {
  it('removes a right-to-left override, a bell and a zero-width space', () => {
    expect(cleanText('a\u202Eb\u0007c\u200Bd')).toBe('abcd');
  });

  it('removes every bidi mark, override and isolate, zero-width mark, separator, invisible operator and byte-order mark', () => {
    const hidden = String.fromCodePoint(...INVISIBLE);
    expect(cleanText(`x${hidden}y`)).toBe('xy');
    for (const cp of INVISIBLE) expect(cleanText(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toBe('ab');
  });

  it('keeps visible neighbours of the hidden ranges', () => {
    expect(cleanText('\u061B\u200A\u2010\u205F\u2065\u206A')).toBe('\u061B\u200A\u2010\u205F\u2065\u206A');
  });

  it('the source holds no invisible characters: the pattern is written as escapes', () => {
    const src = readFileSync(new URL('./sanitize.ts', import.meta.url), 'utf8');
    const literal = [...src].filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return (cp < 0x20 && ch !== '\n') || (cp >= 0x7f && cp <= 0x9f) || INVISIBLE.includes(cp);
    });
    expect(literal).toEqual([]);
  });

  it('removes C0 and C1 controls but keeps line breaks', () => {
    expect(cleanText('one\ntwo\r\tthree\u0000\u001B[31m\u0085\u009F')).toBe('one\ntwothree[31m');
  });

  it('cuts to the limit, 600 characters unless told otherwise', () => {
    expect(cleanText('a'.repeat(700))).toHaveLength(600);
    expect(cleanText('abcdef', 3)).toBe('abc');
  });

  it('does not split a character made of two code units at the limit', () => {
    expect(cleanText('ab\u{1F600}cd', 3)).toBe('ab\u{1F600}');
  });

  it('leaves markup as the same visible characters', () => {
    expect(cleanText('<img src=x onerror=1>')).toBe('<img src=x onerror=1>');
    expect(cleanText('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('a cleaned prefix is a prefix of the cleaned whole, so streamed text can be cleaned as it grows', () => {
    const whole = 'Volume\u202E is normal.\u0007 No attack.';
    let shown = '';
    for (let i = 1; i <= whole.length; i++) {
      const now = cleanText(whole.slice(0, i));
      expect(now.startsWith(shown)).toBe(true);
      shown = now;
    }
    expect(shown).toBe(cleanText(whole));
  });
});
