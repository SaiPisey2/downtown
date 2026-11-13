import { create } from 'zustand';

export type ToastKind = 'clue' | 'hint' | 'info' | 'warn';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  text: string;
}

/** Interface state that is not part of the game: which dock is open, the confirm dialog, toasts. */
export interface UiState {
  /** a city-wide view shown in the right dock in place of the building panel */
  overlay: 'changes' | 'notebook' | null;
  /** the action waiting for Confirm, and the control to give focus back to */
  confirm: { actionId: string; returnTo: HTMLElement | null } | null;
  /** plain-words refusal shown under an action, by action id */
  refusals: Record<string, string>;
  toasts: Toast[];
  openOverlay(o: 'changes' | 'notebook' | null): void;
  askConfirm(actionId: string, returnTo: HTMLElement | null): void;
  closeConfirm(): void;
  refuse(actionId: string, text: string | null): void;
  toast(kind: ToastKind, title: string, text: string): void;
  dismiss(id: number): void;
  reset(): void;
}

let nextToast = 1;
const MAX_TOASTS = 4;
/** How long a refusal stays under its action. */
const REFUSAL_MS = 6000;
const refusalTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUi = create<UiState>()((set) => ({
  overlay: null,
  confirm: null,
  refusals: {},
  toasts: [],
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
  reset() {
    set({ overlay: null, confirm: null, refusals: {}, toasts: [] });
  },
}));
