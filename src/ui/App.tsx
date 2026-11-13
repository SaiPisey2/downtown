import { useEffect } from 'react';
import { cases } from '../cases';
import { decodeRun, sharedCaseId } from '../game/share';
import { useGame } from '../game/store';
import { Briefing } from './screens/Briefing';
import { DesktopOnly } from './screens/DesktopOnly';
import { Debrief } from './screens/Debrief';
import { Play } from './screens/Play';
import { Title } from './screens/Title';
import { useNarrow } from './viewport';

const NOTICE = {
  malformed: 'That replay link is not valid.',
  too_long: 'That replay link is not valid.',
  unknown_case: 'That replay is for a case this version does not have.',
  old_version: 'That replay was made with an older version of this case.',
} as const;

/**
 * Opens what the address asks for: a replay for `#r=<data>`, else the title.
 * A link that cannot be used lands on the title with a plain notice; nothing here throws.
 */
export function openFromLocation(): void {
  try {
    open();
  } catch (err) {
    // a link that decodes but cannot be played is still only a bad link
    console.error('could not open the address', err);
    useGame.getState().showTitle({ text: NOTICE.malformed });
  }
}

function open(): void {
  const hash = location.hash;
  const g = useGame.getState();
  if (!hash.startsWith('#r=')) {
    if (g.caseId === null) g.showTitle();
    return;
  }
  const r = decodeRun(hash.slice(3), cases);
  if (r.ok) return g.watch(r.run);
  if (r.reason !== 'old_version') return g.showTitle({ text: NOTICE[r.reason] });
  // an older version of a case we have: offer it fresh
  const caseId = sharedCaseId(hash.slice(3));
  g.showTitle({ text: NOTICE.old_version, ...(caseId && Object.hasOwn(cases, caseId) ? { fresh: caseId } : {}) });
}

/** Mirrors the reduce-motion setting onto the page, so the stylesheet can calm every panel and toast. */
function useMotionAttribute(): void {
  const reduced = useGame((s) => s.reducedMotion);
  useEffect(() => {
    const root = document.documentElement;
    if (reduced) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
  }, [reduced]);
}

/** One screen at a time; each screen holds its own `main` landmark. A narrow window gets only the desktop notice. */
export function App() {
  const caseId = useGame((s) => s.caseId);
  const screen = useGame((s) => s.screen);
  const narrow = useNarrow();
  useMotionAttribute();
  return (
    <div data-testid="app" style={{ position: 'fixed', inset: 0, background: '#060a18' }}>
      {narrow ? <DesktopOnly />
        : !caseId ? null
        : screen === 'play' ? <Play />
        : screen === 'briefing' ? <Briefing key={caseId} />
        : screen === 'debrief' ? <Debrief />
        : <Title />}
    </div>
  );
}
