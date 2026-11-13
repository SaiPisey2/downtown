import { describe, expect, it } from 'vitest';
import { cases } from './index';

/** Every string a player can read in a case: anything with a space in it (ids, metrics and keys have none). */
function sentences(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') {
    if (/\s/.test(v.trim())) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) sentences(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) sentences(x, out);
  return out;
}

describe('case text', () => {
  it('finds the sentences it is meant to check', () => {
    const all = sentences(cases['edge-rule']);
    expect(all.length).toBeGreaterThan(40);
    expect(all.some((s) => s.includes('Rules update 412'))).toBe(true);
  });

  for (const [id, c] of Object.entries(cases)) {
    it(`${id}: no player-facing text says "tick", which is an engine word`, () => {
      expect(sentences(c).filter((s) => /\bticks?\b/i.test(s))).toEqual([]);
    });
  }
});
