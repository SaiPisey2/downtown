import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGame } from '../game/store';
import { openFromLocation } from './App';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('openFromLocation', () => {
  it('lands on the title with a plain notice when opening the link throws', () => {
    vi.stubGlobal('location', { hash: `#r=${b64(JSON.stringify({ v: 1, c: 'tutorial', cv: 1, s: 7, i: [] }))}`, search: '' });
    const watch = useGame.getState().watch;
    useGame.setState({
      watch: () => {
        throw new Error('boom');
      },
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => openFromLocation()).not.toThrow();
      expect(useGame.getState()).toMatchObject({ screen: 'title', replaying: false, notice: { text: 'That replay link is not valid.' } });
      expect(logged).toHaveBeenCalled();
    } finally {
      useGame.setState({ watch });
    }
  });

  it('still opens a good link', () => {
    vi.stubGlobal('location', { hash: `#r=${b64(JSON.stringify({ v: 1, c: 'tutorial', cv: 1, s: 7, i: [] }))}`, search: '' });
    openFromLocation();
    expect(useGame.getState()).toMatchObject({ screen: 'play', replaying: true, caseId: 'tutorial' });
  });
});
