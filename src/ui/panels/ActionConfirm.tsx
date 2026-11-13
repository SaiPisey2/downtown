import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { cases } from '../../cases';
import { useGame } from '../../game/store';
import type { RejectReason } from '../../sim';
import { duration } from '../metrics';
import { useUi } from '../uiStore';
import { ClockIcon } from './BuildingPanel';
import { HealthIcon } from './HealthIcon';

export const REFUSAL: Record<RejectReason, string> = {
  too_early: 'Nothing is wrong yet',
  already_pending: 'That is already in progress',
  already_done: 'Already done',
  not_running: 'The incident is over',
  unknown: 'Not available',
};

/** Keeps Tab and Shift+Tab inside `box`. */
export function trapTab(e: KeyboardEvent<HTMLElement>, box: HTMLElement | null): void {
  if (e.key !== 'Tab' || !box) return;
  const items = [...box.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Asks before an action goes out: what it is, how long it takes to land, and what it risks. */
export function ActionConfirm() {
  const confirm = useUi((s) => s.confirm);
  const closeConfirm = useUi((s) => s.closeConfirm);
  const refuse = useUi((s) => s.refuse);
  const caseId = useGame((s) => s.caseId);
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const c = caseId ? cases[caseId] : undefined;
  const a = confirm ? c?.actions.find((x) => x.id === confirm.actionId) : undefined;

  useEffect(() => {
    if (confirm) cancel.current?.focus();
  }, [confirm]);

  if (!confirm || !a || !c) return null;

  const close = () => {
    const back = confirm.returnTo;
    closeConfirm();
    if (back?.isConnected) back.focus();
  };
  const go = () => {
    const g = useGame.getState();
    g.act(a.id);
    const r = useGame.getState().lastAction;
    refuse(a.id, r && !r.ok ? (REFUSAL[r.reason as RejectReason] ?? REFUSAL.unknown) : null);
    close();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    trapTab(e, box.current);
  };

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={box}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-facts"
        onKeyDown={onKey}
      >
        <p className="eyebrow">Confirm action · {c.layout[a.target]?.name ?? a.target}</p>
        <h2 id="confirm-title">{a.label}</h2>
        <dl id="confirm-facts" className="facts">
          <div>
            <dt>
              <ClockIcon /> Time to land
            </dt>
            <dd>{a.delayTicks === 0 ? 'Lands at once' : `Takes ${duration(a.delayTicks)} to land after you confirm`}</dd>
          </div>
          {a.risk && (
            <div>
              <dt>
                <HealthIcon health="warn" /> Risk
              </dt>
              <dd>{a.risk}</dd>
            </div>
          )}
        </dl>
        <div className="dialog-buttons">
          <button ref={cancel} type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={go}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
