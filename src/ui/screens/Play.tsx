import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cases } from '../../cases';
import { useGame } from '../../game/store';
import { Board } from '../../scene/Board';
import { ActionConfirm, trapTab } from '../panels/ActionConfirm';
import { BuildingPanel } from '../panels/BuildingPanel';
import { CHAT_SPACE, ChatDock, ChatPreview } from '../panels/Chat';
import { ChangeLog } from '../panels/ChangeLog';
import { EndBanner, Hud } from '../panels/Hud';
import { Notebook } from '../panels/Notebook';
import { Toasts } from '../panels/Toasts';
import { useUi } from '../uiStore';
import '../theme.css';

/** Width of the right dock plus its margins, as in theme.css. */
const DOCK_SPACE = 360 + 2 * 12;

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** Clears interface state left from an earlier run and opens the chat on the first character. */
function resetUi(): void {
  const ui = useUi.getState();
  ui.reset();
  const g = useGame.getState();
  const first = g.caseId ? cases[g.caseId]?.cast[0] : undefined;
  if (first) ui.chatTo(first.id);
}

/** Turns new game events into toasts (clues found) and new chat lines into unread counts and previews. */
function useEventToasts(): void {
  useEffect(() => {
    resetUi();
    let run = useGame.getState().run;
    let seen = useGame.getState().log.length;
    let chat = useGame.getState().chat;
    let lastLine = chat.at(-1)?.id ?? 0;
    return useGame.subscribe((s) => {
      if (s.run !== run) {
        run = s.run;
        seen = 0;
        resetUi();
      }
      const c = s.caseId ? cases[s.caseId] : undefined;
      if (s.chat !== chat) {
        chat = s.chat;
        for (const l of chat) {
          if (l.id <= lastLine) continue;
          lastLine = l.id;
          if (c?.cast.some((m) => m.id === l.from)) useUi.getState().noteLine(l.from, l.text, !l.live);
        }
      }
      if (s.log.length <= seen) return;
      const fresh = s.log.slice(seen);
      seen = s.log.length;
      if (!c) return;
      const { toast } = useUi.getState();
      // what a landed action did is not toasted: it reaches the player as a teammate's chat line
      for (const e of fresh) {
        if (e.type !== 'clue') continue;
        const clue = c.clues.find((x) => x.id === e.clueId);
        if (clue) toast('clue', 'Clue found', clue.text);
      }
    });
  }, []);
}

/** Shown when the game paused itself because the tab was hidden. */
function AwayNotice() {
  const away = useGame((s) => s.pauseReason === 'hidden');
  const box = useRef<HTMLDivElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (away) resume.current?.focus();
  }, [away]);
  if (!away) return null;
  return (
    <div className="backdrop">
      <div
        ref={box}
        className="dialog dialog-small"
        role="dialog"
        aria-modal="true"
        aria-labelledby="away-title"
        onKeyDown={(e: ReactKeyboardEvent<HTMLDivElement>) => trapTab(e, box.current)}
      >
        <h2 id="away-title">Paused while you were away</h2>
        <p>The city waited for you. Nothing moved while this tab was hidden.</p>
        <div className="dialog-buttons">
          <button ref={resume} type="button" className="btn btn-primary" onClick={() => useGame.getState().setPaused(false)}>
            Resume
          </button>
        </div>
      </div>
    </div>
  );
}

/** The play screen: the city fills the window, the HUD runs across the top, the chat on the left, the right dock holds a panel. */
export function Play() {
  const selected = useGame((s) => s.selected);
  const selectSeq = useGame((s) => s.selectSeq);
  const overlay = useUi((s) => s.overlay);
  const chatOpen = useUi((s) => s.chatOpen);
  const dock = useRef<HTMLDivElement>(null);
  const chatSlot = useRef<HTMLDivElement>(null);
  useEventToasts();

  // picking a building replaces a city-wide view in the dock
  useEffect(
    () =>
      useGame.subscribe((s, p) => {
        if (s.selectSeq !== p.selectSeq && s.selected) useUi.getState().openOverlay(null);
      }),
    [],
  );

  /** Closes whatever is in the dock and, if focus was in it, hands focus to what opened it. */
  const closeDock = useRef(() => {
    const ui = useUi.getState();
    const g = useGame.getState();
    if (!ui.overlay && !g.selected) return;
    const hadFocus = !!dock.current?.contains(document.activeElement);
    const back = ui.overlay
      ? document.querySelector<HTMLElement>(`[data-opens="${ui.overlay}"]`)
      : document.querySelector<HTMLElement>(`[data-node="${g.selected}"]`);
    ui.openOverlay(null);
    if (g.selected) g.select(null);
    if (hadFocus) requestAnimationFrame(() => back?.focus());
  }).current;

  /** Collapses the chat and, if focus was in it, hands focus to the HUD button that opens it. */
  const closeChat = useRef(() => {
    const hadFocus = !!chatSlot.current?.contains(document.activeElement);
    useUi.getState().openChat(false);
    if (hadFocus) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-opens="chat"]')?.focus());
  }).current;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useUi.getState();
      const g = useGame.getState();
      if (e.key === 'Escape') {
        if (ui.confirm) ui.closeConfirm();
        else if (g.pauseReason === 'hidden') return;
        else if (chatSlot.current?.contains(document.activeElement)) closeChat();
        else closeDock();
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && !isTyping(e.target) && !ui.confirm && g.snap?.status === 'running') {
        e.preventDefault();
        g.setPaused(!g.paused, 'user');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDock, closeChat]);

  return (
    <div className="play">
      <Hud />
      <div ref={chatSlot} className="chat-slot">
        {chatOpen ? <ChatDock onClose={closeChat} /> : <ChatPreview />}
      </div>
      <div ref={dock} className="dock-slot">
        {overlay === 'changes' ? (
          <ChangeLog onClose={closeDock} />
        ) : overlay === 'notebook' ? (
          <Notebook onClose={closeDock} />
        ) : selected ? (
          <BuildingPanel key={`${selected}:${selectSeq}`} node={selected} onClose={closeDock} />
        ) : null}
      </div>
      {/* after the dock in the DOM: Tab goes HUD, dock, then the building labels */}
      <Board insetLeft={chatOpen ? CHAT_SPACE : 0} insetRight={overlay || selected ? DOCK_SPACE : 0} />
      <EndBanner />
      <Toasts />
      <ActionConfirm />
      <AwayNotice />
    </div>
  );
}
