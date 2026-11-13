import { useEffect } from 'react';
import { useUi } from '../uiStore';
import type { Toast } from '../uiStore';

/** How long a toast stays up, by kind: clues and warnings are worth reading slowly. */
const SHOW_MS: Record<Toast['kind'], number> = { clue: 9000, warn: 9000, hint: 9000, info: 4000 };

function Item({ t }: { t: Toast }) {
  const dismiss = useUi((s) => s.dismiss);
  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), SHOW_MS[t.kind]);
    return () => clearTimeout(id);
  }, [t, dismiss]);
  return (
    <div className={`toast toast-${t.kind}`} role="status">
      <div className="toast-text">
        {t.title && <strong>{t.title} </strong>}
        {t.text}
      </div>
      <button type="button" className="btn-icon btn-small" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** Short notes at the bottom of the screen: clues found, hints, what an action did. */
export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <Item key={t.id} t={t} />
      ))}
    </div>
  );
}
