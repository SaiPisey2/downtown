import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cases } from '../../cases';
import { useGame } from '../../game/store';
import { Board } from '../../scene/Board';
import { ActionConfirm, trapTab } from '../panels/ActionConfirm';
import { BuildingPanel } from '../panels/BuildingPanel';
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

/** Turns new game events into toasts: clues found, and what a landed action did. */
function useEventToasts(): void {
  useEffect(() => {
    let run = useGame.getState().run;
    let seen = useGame.getState().log.length;
    return useGame.subscribe((s) => {
      if (s.run !== run) {
        run = s.run;
        seen = 0;
        useUi.getState().reset();
      }
      if (s.log.length <= seen) return;
      const fresh = s.log.slice(seen);
      seen = s.log.length;
      const c = s.caseId ? cases[s.caseId] : undefined;
      if (!c) return;
      const { toast } = useUi.getState();
      for (const e of fresh) {
        if (e.type === 'clue') {
          const clue = c.clues.find((x) => x.id === e.clueId);
          if (clue) toast('clue', 'Clue found', clue.text);
        } else if (e.type === 'action_landed') {
          const a = c.actions.find((x) => x.id === e.actionId);
          const line = a?.consequenceKey ? c.lines[a.consequenceKey] : undefined;
          if (a && line) toast(a.harmful ? 'warn' : 'info', `${a.label}:`, line);
        }
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

/** The play screen: the city fills the window, the HUD runs across the top, the right dock holds a panel. */
export function Play() {
  const selected = useGame((s) => s.selected);
  const selectSeq = useGame((s) => s.selectSeq);
  const overlay = useUi((s) => s.overlay);
  const dock = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const ui = useUi.getState();
      const g = useGame.getState();
      if (e.key === 'Escape') {
        if (ui.confirm) ui.closeConfirm();
        else if (g.pauseReason !== 'hidden') closeDock();
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && !isTyping(e.target) && !ui.confirm && g.snap?.status === 'running') {
        e.preventDefault();
        g.setPaused(!g.paused, 'user');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeDock]);

  return (
    <div className="play">
      <Hud />
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
      <Board insetRight={overlay || selected ? DOCK_SPACE : 0} />
      <EndBanner />
      <Toasts />
      <ActionConfirm />
      <AwayNotice />
    </div>
  );
}
