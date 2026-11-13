import { create } from 'zustand';

export type ToastKind = 'clue' | 'hint' | 'info' | 'warn';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  text: string;
}

/** The newest unsolicited line from a character the player is not looking at. */
export interface ChatPreview {
  id: number;
  castId: string;
  text: string;
}

/** Interface state that is not part of the game: which dock is open, the confirm dialog, toasts, the chat dock. */
export interface UiState {
  /** a city-wide view shown in the right dock in place of the building panel */
  overlay: 'changes' | 'notebook' | null;
  /** the action waiting for Confirm, and the control to give focus back to */
  confirm: { actionId: string; returnTo: HTMLElement | null } | null;
  /** plain-words refusal shown under an action, by action id */
  refusals: Record<string, string>;
  toasts: Toast[];
  /** the left chat dock is expanded */
  chatOpen: boolean;
  /** whose thread the chat dock shows */
  chatWith: string | null;
  /** lines not yet seen, by character */
  unread: Record<string, number>;
  preview: ChatPreview | null;
  openOverlay(o: 'changes' | 'notebook' | null): void;
  askConfirm(actionId: string, returnTo: HTMLElement | null): void;
  closeConfirm(): void;
  refuse(actionId: string, text: string | null): void;
  toast(kind: ToastKind, title: string, text: string): void;
  dismiss(id: number): void;
  openChat(open: boolean): void;
  chatTo(castId: string): void;
  /** a character said something: unread unless their thread is on screen; `preview` shows it briefly */
  noteLine(castId: string, text: string, preview: boolean): void;
  dismissPreview(id: number): void;
  reset(): void;
}

let nextToast = 1;
let nextPreview = 1;
const MAX_TOASTS = 4;
/** How long a refusal stays under its action. */
const REFUSAL_MS = 6000;
const refusalTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Marks `castId`'s thread read when it is on screen. */
const readIfShown = (s: Pick<UiState, 'chatOpen' | 'chatWith' | 'unread' | 'preview'>): Partial<UiState> => {
  if (!s.chatOpen || s.chatWith === null) return {};
  const unread = { ...s.unread };
  delete unread[s.chatWith];
  return { unread, preview: s.preview?.castId === s.chatWith ? null : s.preview };
};

export const useUi = create<UiState>()((set) => ({
  overlay: null,
  confirm: null,
  refusals: {},
  toasts: [],
  chatOpen: false,
  chatWith: null,
  unread: {},
  preview: null,
  openOverlay(o) {
    set({ overlay: o });
  },
  askConfirm(actionId, returnTo) {
    set({ confirm: { actionId, returnTo } });
  },
  closeConfirm() {
    set({ confirm: null });
  },
  refuse(actionId, text) {
    const drop = () =>
      set((s) => {
        const refusals = { ...s.refusals };
        delete refusals[actionId];
        return { refusals };
      });
    clearTimeout(refusalTimers.get(actionId));
    if (text === null) return drop();
    set((s) => ({ refusals: { ...s.refusals, [actionId]: text } }));
    refusalTimers.set(actionId, setTimeout(drop, REFUSAL_MS));
  },
  toast(kind, title, text) {
    set((s) => ({ toasts: [...s.toasts, { id: nextToast++, kind, title, text }].slice(-MAX_TOASTS) }));
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  openChat(open) {
    set((s) => ({ chatOpen: open, ...readIfShown({ ...s, chatOpen: open }) }));
  },
  chatTo(castId) {
    set((s) => ({ chatWith: castId, ...readIfShown({ ...s, chatWith: castId }) }));
  },
  noteLine(castId, text, preview) {
    set((s) => {
      if (s.chatOpen && s.chatWith === castId) return {};
      return {
        unread: { ...s.unread, [castId]: (s.unread[castId] ?? 0) + 1 },
        preview: preview ? { id: nextPreview++, castId, text } : s.preview,
      };
    });
  },
  dismissPreview(id) {
    set((s) => (s.preview?.id === id ? { preview: null } : {}));
  },
  reset() {
    for (const t of refusalTimers.values()) clearTimeout(t);
    refusalTimers.clear();
    set({ overlay: null, confirm: null, refusals: {}, toasts: [], chatOpen: false, chatWith: null, unread: {}, preview: null });
  },
}));
