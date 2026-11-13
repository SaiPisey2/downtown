import { afterEach, describe, expect, it, vi } from 'vitest';
import { flatAsked } from './webgl';

describe('flatAsked', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is true only for flat=1, even where URLSearchParams.has ignores its second argument', () => {
    // older browsers implement has(name) only, so has('flat', '1') is true for any value
    const has = URLSearchParams.prototype.has;
    vi.spyOn(URLSearchParams.prototype, 'has').mockImplementation(function (this: URLSearchParams, name: string) {
      return has.call(this, name);
    });
    const at = (search: string) => {
      vi.stubGlobal('location', { search });
      return flatAsked();
    };
    expect(at('?flat=1')).toBe(true);
    expect(at('?test=1&flat=1')).toBe(true);
    expect(at('?flat=0')).toBe(false);
    expect(at('?flat=')).toBe(false);
    expect(at('?test=1')).toBe(false);
  });
});
