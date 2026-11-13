import { cases } from '../../cases';
import { activeAiSettings, useLiveSettings } from '../../cast/settings';
import { useGame } from '../../game/store';
import { clock } from '../logs';
import { duration } from '../metrics';
import { useUi } from '../uiStore';
import { ClockIcon } from './BuildingPanel';
import { HealthIcon } from './HealthIcon';

const pct = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

function Impact({ failed, limit }: { failed: number; limit: number }) {
  const share = Math.min(1, Math.max(0, failed / limit));
  const level = share >= 0.75 ? 'bad' : share >= 0.4 ? 'warn' : 'ok';
  const shown = pct.format(share * 100);
  return (
    <div className={`impact impact-${level}`}>
      <div
        className="meter"
        role="meter"
        aria-label="Customer impact"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-valuetext={`${shown}% of the failed requests the city can take`}
      >
        <div className="meter-fill" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="impact-num">{shown}%</span>
      <span className="impact-word">customer impact</span>
    </div>
  );
}

/** The bar across the top: case, simulated clock, impact, pending actions and the main controls. */
export function Hud() {
  const caseId = useGame((s) => s.caseId);
  const snap = useGame((s) => s.snap);
  const paused = useGame((s) => s.paused);
  const found = useGame((s) => s.found.length);
  const { setPaused, hint, goHome } = useGame.getState();
  const overlay = useUi((s) => s.overlay);
  const openOverlay = useUi((s) => s.openOverlay);
  const chatOpen = useUi((s) => s.chatOpen);
  const openChat = useUi((s) => s.openChat);
  const unread = useUi((s) => Object.values(s.unread).reduce((a, b) => a + b, 0));
  const toast = useUi((s) => s.toast);
  const live = useLiveSettings((s) => activeAiSettings(s) !== null);
  const c = caseId ? cases[caseId] : undefined;
  if (!c || !snap) return null;
  const ended = snap.status !== 'running';

  const askHint = () => {
    hint();
    const h = useGame.getState().lastHint;
    if (h?.text) toast('hint', 'Hint:', h.text);
    else toast('info', '', 'No more hints');
  };

  return (
    <header className="hud" role="banner">
      <div className="hud-case">
        <span className="hud-mark" aria-hidden="true" />
        <div>
          <p className="eyebrow">Downtown</p>
          <h1>{c.title}</h1>
        </div>
      </div>

      <div className="hud-clock" aria-label="Simulated time">
        <ClockIcon />
        <span>
          <span className="hud-k">Elapsed</span> <strong className="num">{clock(snap.tick)}</strong>
        </span>
        <span>
          <span className="hud-k">Left</span> <strong className="num">{clock(c.maxTicks - snap.tick)}</strong>
        </span>
      </div>

      <Impact failed={snap.impact.failed} limit={c.lose.maxFailedRequests} />

      <nav className="hud-buttons" aria-label="Game controls">
        <button
          type="button"
          className="btn btn-hud"
          data-opens="chat"
          aria-pressed={chatOpen}
          onClick={() => openChat(!chatOpen)}
          title="Talk to your team"
        >
          Team
          {unread > 0 && (
            <span className="count count-new">
              {unread}
              <span className="sr-only"> new</span>
            </span>
          )}
        </button>
        <button
          type="button"
          className="btn btn-hud"
          disabled={ended}
          aria-keyshortcuts="P"
          onClick={() => setPaused(!paused, 'user')}
          title={paused ? 'Resume (P)' : 'Pause (P)'}
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="btn btn-hud"
          disabled={ended}
          onClick={askHint}
          title="Shows one clue you have not found. Costs 3 points."
        >
          Hint <span className="cost">−3 points</span>
        </button>
        <button type="button" className="btn btn-hud" aria-keyshortcuts="H" onClick={goHome} title="Home view (H)">
          Home view
        </button>
        <button
          type="button"
          className="btn btn-hud"
          data-opens="changes"
          aria-pressed={overlay === 'changes'}
          onClick={() => openOverlay(overlay === 'changes' ? null : 'changes')}
        >
          Change log
        </button>
        <button
          type="button"
          className="btn btn-hud"
          data-opens="notebook"
          aria-pressed={overlay === 'notebook'}
          onClick={() => openOverlay(overlay === 'notebook' ? null : 'notebook')}
        >
          Notebook <span className="count">{found}</span>
        </button>
        <button
          type="button"
          className="btn btn-hud btn-hud-icon"
          data-opens="settings"
          aria-pressed={overlay === 'settings'}
          onClick={() => openOverlay(overlay === 'settings' ? null : 'settings')}
          title={live ? 'Settings: live characters are on' : 'Settings: live characters with your own AI key'}
        >
          <GearIcon />
          <span className="sr-only">Settings{live ? ', live characters on' : ''}</span>
          {live && <span className="live-dot" aria-hidden="true" />}
        </button>
      </nav>

      {snap.pending.length > 0 && (
        <ul className="hud-pending" aria-label="Actions on their way">
          {snap.pending.map((p) => (
            <li key={p.actionId} className="chip chip-warn">
              <span className="spinner" aria-hidden="true" />
              {c.actions.find((a) => a.id === p.actionId)?.label ?? p.actionId}
              <span className="chip-sep" aria-hidden="true">·</span>
              lands in {duration(p.landsAt - snap.tick)}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

function GearIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8zm5.6 3.2-.1-1.6 1.3-1-1.3-2.3-1.6.5a5 5 0 0 0-1.4-.8L10.2 2H7.6l-.3 1.6c-.5.2-1 .5-1.4.8l-1.6-.5L3 6.2l1.3 1a5 5 0 0 0 0 1.6L3 9.8l1.3 2.3 1.6-.5c.4.3.9.6 1.4.8l.3 1.6h2.6l.3-1.6c.5-.2 1-.5 1.4-.8l1.6.5 1.3-2.3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M4.5 3l8 5-8 5z" fill="currentColor" />
    </svg>
  );
}

/** The outcome, once the run has ended. The full debrief comes later. */
export function EndBanner() {
  const snap = useGame((s) => s.snap);
  const lost = useGame((s) => s.log.find((e) => e.type === 'lost'));
  if (!snap || snap.status === 'running') return null;
  const won = snap.status === 'won';
  const why =
    won ? `The city is working normally again at ${clock(snap.tick)}.`
    : lost?.type === 'lost' && lost.reason === 'clock' ? 'The clock ran out before the city recovered.'
    : 'Too many customers saw errors before the city recovered.';
  return (
    <div className="end-row">
      <div className={`end end-${won ? 'ok' : 'bad'}`} role="status">
        <HealthIcon health={won ? 'ok' : 'bad'} />
        <div>
          <strong>{won ? 'Recovered' : 'Lost'}</strong>
          <span>{why}</span>
        </div>
      </div>
    </div>
  );
}
