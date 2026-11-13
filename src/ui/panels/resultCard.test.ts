import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Score } from '../../sim';
import { SCORE_PARTS, deductions, shareUrl, signed } from './ResultCard';

afterEach(() => vi.unstubAllGlobals());

describe('shareUrl', () => {
  it('is built from the origin and path only: no query string travels into a shared link', () => {
    vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/downtown/', search: '?test=1&flat=1', hash: '#r=old' });
    expect(shareUrl('abc')).toBe('https://example.test/downtown/#r=abc');
  });
});

describe('deductions', () => {
  const base: Score = {
    total: 87, detect: 15, recover: 33, traffic: 22, harm: 15, updates: 10, outcome: 'won', ticks: 621, hints: 0, shortcut: -8,
  };
  const parts = (s: Score) => SCORE_PARTS.reduce((a, p) => a + s[p.key], 0);

  it('names the fast-fix penalty, so the parts and the deductions add up to the total', () => {
    expect(deductions(base)).toEqual([{ name: 'Fast fix left a risk open', points: -8, says: expect.any(String) }]);
    expect(parts(base) + deductions(base).reduce((a, d) => a + d.points, 0)).toBe(base.total);
  });

  it('adds the hints, and says nothing for a clean run', () => {
    const hinted = { ...base, hints: 2, total: 81 };
    expect(deductions(hinted).map((d) => [d.name, d.points])).toEqual([['Fast fix left a risk open', -8], ['2 hints used', -6]]);
    expect(parts(hinted) + deductions(hinted).reduce((a, d) => a + d.points, 0)).toBe(hinted.total);
    expect(deductions({ ...base, shortcut: 0, total: 95 })).toEqual([]);
    expect(deductions({ ...base, shortcut: 0, hints: 1 }).map((d) => d.name)).toEqual(['1 hint used']);
  });

  it('writes signed numbers with a real minus sign', () => {
    expect([signed(-8), signed(0), signed(3)]).toEqual(['−8', '0', '+3']);
  });
});
