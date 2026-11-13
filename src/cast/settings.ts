import { create } from 'zustand';
import { DEFAULT_ANTHROPIC_MODELS } from './ai';
import type { AISettings } from './ai';

/** The player's choices for live characters. The key is held in memory; see `keepForTab`. */
export interface LiveSettings {
  provider: AISettings['provider'];
  key: string;
  /** OpenAI-compatible only; empty means OpenAI itself */
  baseUrl: string;
  chatModel: string;
  reviewModel: string;
  /** mirror these settings, key included, to this tab's sessionStorage so a reload keeps them */
  keepForTab: boolean;
  /** "Use live characters"; has no effect without a key */
  live: boolean;
}

export interface SettingsState extends LiveSettings {
  change(patch: Partial<LiveSettings>): void;
  /** drops the key from memory and from the tab, and turns live characters off */
  forget(): void;
}

const TAB_KEY = 'downtown.liveCharacters';

const DEFAULTS: LiveSettings = {
  provider: 'anthropic',
  key: '',
  baseUrl: '',
  ...DEFAULT_ANTHROPIC_MODELS,
  keepForTab: false,
  live: false,
};

function tab(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function load(): LiveSettings {
  try {
    const raw = tab()?.getItem(TAB_KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<LiveSettings>;
    const str = (x: unknown, d: string) => (typeof x === 'string' ? x : d);
    return {
      provider: v.provider === 'openai' ? 'openai' : 'anthropic',
      key: str(v.key, ''),
      baseUrl: str(v.baseUrl, ''),
      chatModel: str(v.chatModel, DEFAULTS.chatModel),
      reviewModel: str(v.reviewModel, DEFAULTS.reviewModel),
      keepForTab: true,
      live: v.live === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function save(s: LiveSettings): void {
  try {
    const store = tab();
    if (!store) return;
    if (!s.keepForTab) return store.removeItem(TAB_KEY);
    const { provider, key, baseUrl, chatModel, reviewModel, keepForTab, live } = s;
    store.setItem(TAB_KEY, JSON.stringify({ provider, key, baseUrl, chatModel, reviewModel, keepForTab, live }));
  } catch {
    // storage refused (private mode, quota): the settings still hold for this page
  }
}

export const useLiveSettings = create<SettingsState>()((set, get) => ({
  ...load(),
  change(patch) {
    const next = { ...get(), ...patch };
    // switching provider resets the models: the defaults name Anthropic models, other providers' are typed in
    if (patch.provider && patch.provider !== get().provider && !('chatModel' in patch)) {
      Object.assign(next, patch.provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODELS : { chatModel: '', reviewModel: '' });
    }
    if (!next.key.trim()) next.live = false;
    set(next);
    save(next);
  },
  forget() {
    const next = { ...get(), key: '', live: false };
    set(next);
    save(next);
  },
}));

/** Why a base URL cannot be used, in plain words; null when it can. Empty means the provider's default. */
export function baseUrlProblem(url: string): string | null {
  const t = url.trim();
  if (t === '') return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return 'That is not a web address. It should look like https://example.com/v1.';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return null;
  return 'Use an https:// address, or http://127.0.0.1 or http://localhost for a model on this computer.';
}

let memo: { from: LiveSettings | null; out: AISettings | null } = { from: null, out: null };

/** The settings for a live cast, or null when live characters are off or not fully set up. Same object until they change. */
export function activeAiSettings(s: LiveSettings = useLiveSettings.getState()): AISettings | null {
  if (memo.from === s) return memo.out;
  const key = s.key.trim();
  const usable =
    s.live && key !== '' && s.chatModel.trim() !== '' && s.reviewModel.trim() !== '' &&
    (s.provider === 'anthropic' || baseUrlProblem(s.baseUrl) === null);
  const out: AISettings | null = !usable
    ? null
    : {
        provider: s.provider,
        key,
        chatModel: s.chatModel.trim(),
        reviewModel: s.reviewModel.trim(),
        ...(s.provider === 'openai' && s.baseUrl.trim() ? { baseUrl: s.baseUrl.trim() } : {}),
      };
  // same values, same object: a change elsewhere in the form does not restart the live cast
  const same = out && memo.out && JSON.stringify(out) === JSON.stringify(memo.out);
  memo = { from: s, out: same ? memo.out : out };
  return memo.out;
}
