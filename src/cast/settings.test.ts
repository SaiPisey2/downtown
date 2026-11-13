import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for the browser's per-tab storage. */
function fakeTab(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

async function fresh() {
  vi.resetModules();
  return import('./settings');
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('sessionStorage', fakeTab());
});

describe('live settings', () => {
  it('start off, with the Anthropic default models, and give no live settings without a key', async () => {
    const { useLiveSettings, activeAiSettings } = await fresh();
    const s = useLiveSettings.getState();
    expect([s.provider, s.chatModel, s.reviewModel, s.live, s.keepForTab, s.key]).toEqual([
      'anthropic', 'claude-haiku-5-5', 'claude-opus-5-5', false, false, '',
    ]);
    s.change({ live: true });
    expect(useLiveSettings.getState().live).toBe(false);
    expect(activeAiSettings()).toBeNull();
  });

  it('with a key and the toggle on: live settings, the same object until a value that matters changes', async () => {
    const { useLiveSettings, activeAiSettings } = await fresh();
    useLiveSettings.getState().change({ key: ' sk-1 ', live: true });
    const a = activeAiSettings();
    expect(a).toEqual({ provider: 'anthropic', key: 'sk-1', chatModel: 'claude-haiku-5-5', reviewModel: 'claude-opus-5-5' });
    useLiveSettings.getState().change({ keepForTab: true });
    expect(activeAiSettings()).toBe(a);
    useLiveSettings.getState().change({ chatModel: 'other' });
    expect(activeAiSettings()).not.toBe(a);
  });

  it('OpenAI-compatible needs typed models and an acceptable base URL', async () => {
    const { useLiveSettings, activeAiSettings } = await fresh();
    useLiveSettings.getState().change({ key: 'k', live: true, provider: 'openai' });
    expect(useLiveSettings.getState().chatModel).toBe('');
    expect(activeAiSettings()).toBeNull();
    useLiveSettings.getState().change({ chatModel: 'm', reviewModel: 'r', baseUrl: 'http://evil.example/v1' });
    expect(activeAiSettings()).toBeNull();
    useLiveSettings.getState().change({ baseUrl: 'http://127.0.0.1:11434/v1' });
    expect(activeAiSettings()).toMatchObject({ provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', chatModel: 'm' });
  });

  it('base URLs: https, or plain http only to this computer', async () => {
    const { baseUrlProblem } = await fresh();
    expect(baseUrlProblem('')).toBeNull();
    expect(baseUrlProblem('https://api.example.com/v1')).toBeNull();
    expect(baseUrlProblem('http://localhost:1234/v1')).toBeNull();
    expect(baseUrlProblem('http://127.0.0.1/v1')).toBeNull();
    expect(baseUrlProblem('http://example.com/v1')).toMatch(/https:\/\//);
    expect(baseUrlProblem('http://127.0.0.1.example.com/')).toMatch(/https:\/\//);
    expect(baseUrlProblem('javascript:alert(1)')).toMatch(/https:\/\//);
    expect(baseUrlProblem('not a url')).toMatch(/web address/);
  });

  it('the key reaches the tab only while "keep for this tab" is on, and comes back after a reload', async () => {
    const tab = sessionStorage;
    const first = await fresh();
    first.useLiveSettings.getState().change({ key: 'sk-1', live: true });
    expect(tab.length).toBe(0);
    first.useLiveSettings.getState().change({ keepForTab: true });
    expect(tab.getItem(tab.key(0)!)).toContain('sk-1');
    const reloaded = await fresh();
    expect(reloaded.useLiveSettings.getState()).toMatchObject({ key: 'sk-1', live: true, keepForTab: true });
    reloaded.useLiveSettings.getState().change({ keepForTab: false });
    expect(tab.length).toBe(0);
    expect((await fresh()).useLiveSettings.getState().key).toBe('');
  });

  it('forget drops the key from memory and the tab, and turns live characters off', async () => {
    const { useLiveSettings, activeAiSettings } = await fresh();
    useLiveSettings.getState().change({ key: 'sk-1', live: true, keepForTab: true });
    useLiveSettings.getState().forget();
    expect(useLiveSettings.getState()).toMatchObject({ key: '', live: false });
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).not.toContain('sk-1');
    expect(activeAiSettings()).toBeNull();
  });

  it('works when the tab refuses storage', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    const { useLiveSettings } = await fresh();
    useLiveSettings.getState().change({ key: 'k', keepForTab: true });
    expect(useLiveSettings.getState().key).toBe('k');
  });
});
