import { cases } from '../cases';
import { decodeRun, sharedCaseId } from '../game/share';
import { useGame } from '../game/store';
import { Briefing } from './screens/Briefing';
import { Debrief } from './screens/Debrief';
import { Play } from './screens/Play';
import { Title } from './screens/Title';

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

export function App() {
  const caseId = useGame((s) => s.caseId);
  const screen = useGame((s) => s.screen);
  return (
    <main data-testid="app" style={{ position: 'fixed', inset: 0, background: '#060a18' }}>
      {!caseId ? null
        : screen === 'play' ? <Play />
        : screen === 'briefing' ? <Briefing key={caseId} />
        : screen === 'debrief' ? <Debrief />
        : <Title />}
    </main>
  );
}
