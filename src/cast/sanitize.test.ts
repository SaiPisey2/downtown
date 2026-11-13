import { describe, expect, it } from 'vitest';
import { cleanText } from './sanitize';

describe('cleanText', () => {
  it('removes a right-to-left override, a bell and a zero-width space', () => {
    expect(cleanText('a‮b\u0007c​d')).toBe('abcd');
  });

  it('removes every bidi override and isolate, zero-width mark and byte-order mark', () => {
    const hidden = '‪‫‬‭‮⁦⁧⁨⁩​‌‍‎‏﻿';
    expect(cleanText(`x${hidden}y`)).toBe('xy');
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
    const whole = 'Volume‮ is normal.\u0007 No attack.';
    let shown = '';
    for (let i = 1; i <= whole.length; i++) {
      const now = cleanText(whole.slice(0, i));
      expect(now.startsWith(shown)).toBe(true);
      shown = now;
    }
    expect(shown).toBe(cleanText(whole));
  });
});
