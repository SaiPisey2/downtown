import { useEffect } from 'react';
import { cases } from '../../cases';
import { useGame } from '../../game/store';
import type { NodeId } from '../../sim';
import { clock } from '../logs';

/** Changes to the city, newest first; `only` limits them to one building. */
export function ChangeList({ only, empty }: { only?: NodeId; empty: string }) {
  const caseId = useGame((s) => s.caseId);
  const changes = useGame((s) => s.snap?.changes);
  const c = caseId ? cases[caseId] : undefined;
  const list = (changes ?? []).filter((x) => !only || x.target === only).slice().reverse();
  if (list.length === 0) return <p className="empty">{empty}</p>;
  return (
    <ol className="changes">
      {list.map((x, i) => (
        <li key={`${x.tick}-${x.target}-${i}`} className="change">
          <time className="change-time">{clock(x.tick)}</time>
          <div className="change-body">
            <div className="change-label">{x.label}</div>
            <div className="change-meta">
              {!only && <span>{c?.layout[x.target]?.name ?? x.target}</span>}
              <span className={`tag ${x.byPlayer ? 'tag-you' : 'tag-deploy'}`}>{x.byPlayer ? 'Your action' : 'Deploy'}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The city-wide change log, in the right dock. While it is open, the changes count as read, new ones included. */
export function ChangeLog({ onClose }: { onClose(): void }) {
  const observe = useGame((s) => s.observe);
  const tick = useGame((s) => s.snap?.tick ?? 0);
  useEffect(() => observe('changes'), [observe, tick]);
  return (
    <aside className="dock" aria-label="City change log">
      <header className="dock-head">
        <div>
          <p className="eyebrow">Whole city</p>
          <h2>Change log</h2>
        </div>
        <CloseButton label="Close change log" onClose={onClose} />
      </header>
      <div className="dock-body">
        <p className="lede">Every deploy and every action that has landed, newest first. Times are simulated.</p>
        <ChangeList empty="Nothing has changed yet today." />
      </div>
    </aside>
  );
}

export function CloseButton({ label, onClose }: { label: string; onClose(): void }) {
  return (
    <button type="button" className="btn-icon" aria-label={label} title="Close (Esc)" onClick={onClose}>
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
