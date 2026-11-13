import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareUrl } from './ResultCard';

afterEach(() => vi.unstubAllGlobals());

describe('shareUrl', () => {
  it('is built from the origin and path only: no query string travels into a shared link', () => {
    vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/downtown/', search: '?test=1&flat=1', hash: '#r=old' });
    expect(shareUrl('abc')).toBe('https://example.test/downtown/#r=abc');
  });
});
