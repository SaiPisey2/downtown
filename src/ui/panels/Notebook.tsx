import { cases } from '../../cases';
import { useGame } from '../../game/store';
import { clock } from '../logs';
import { CloseButton } from './ChangeLog';

/** The clues found so far, in the order they were found. */
export function Notebook({ onClose }: { onClose(): void }) {
  const caseId = useGame((s) => s.caseId);
  const log = useGame((s) => s.log);
  const c = caseId ? cases[caseId] : undefined;
  const found = log.flatMap((e) => (e.type === 'clue' ? [e] : []));
  return (
    <aside className="dock" aria-label="Notebook">
      <header className="dock-head">
        <div>
          <p className="eyebrow">What you know</p>
          <h2>Notebook</h2>
        </div>
        <CloseButton label="Close notebook" onClose={onClose} />
      </header>
      <div className="dock-body">
        {found.length === 0 ? (
          <p className="empty">
            Nothing yet. Clues turn up when you watch a graph for a moment, read a log or check what changed.
          </p>
        ) : (
          <ol className="notes">
            {found.map((e) => (
              <li key={e.clueId} className="note">
                <time>{clock(e.tick)}</time>
                <p>{c?.clues.find((x) => x.id === e.clueId)?.text ?? e.clueId}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
