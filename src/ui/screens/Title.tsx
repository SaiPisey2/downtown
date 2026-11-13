import { useEffect, useRef, useState } from 'react';
import { MAIN_CASE, TUTORIAL_CASE, tutorialDone } from '../../game/flow';
import { useGame } from '../../game/store';
import { Board } from '../../scene/Board';
import { GearIcon } from '../panels/Hud';
import { Settings } from '../panels/Settings';
import '../theme.css';
import { clearHash, useScreenHeading } from './heading';

/** Room the title text takes on the left; the city is centred in the rest. */
const TEXT_SPACE = 680;

/** The way in: the name, what the game is, Play and Tutorial, over the main case running quietly. */
export function Title() {
  const heading = useScreenHeading();
  const notice = useGame((s) => s.notice);
  const [settings, setSettings] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const { brief } = useGame.getState();

  const closeSettings = () => {
    setSettings(false);
    requestAnimationFrame(() => gear.current?.focus());
  };
  useEffect(() => {
    if (!settings) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings]);

  const go = (caseId: string) => {
    clearHash();
    brief(caseId);
  };

  return (
    <div className="play screen screen-title">
      <Board backdrop insetLeft={TEXT_SPACE} />
      <div className="screen-shade" aria-hidden="true" />
      <main className="title-panel" aria-labelledby="title-h">
        <p className="title-kicker">
          <span className="hud-mark" aria-hidden="true" />
          An incident game
        </p>
        <h1 id="title-h" ref={heading} tabIndex={-1} className="title-name">
          Downtown
        </h1>
        <p className="title-line">The city is your production system.</p>
        <p className="title-text">
          Every building is a service and every car is a request. Something is about to go wrong. Look inside the
          buildings, ask your team what they see, fix it, and keep your boss told as you go. About 15 minutes, no
          signup, and based on a real outage.
        </p>
        {notice && (
          <div className="notice" role="alert">
            <p>{notice.text}</p>
            {notice.fresh && (
              <button type="button" className="btn" onClick={() => go(notice.fresh!)}>
                Play it fresh
              </button>
            )}
          </div>
        )}
        <div className="title-buttons">
          <button type="button" className="btn btn-primary btn-big" onClick={() => go(tutorialDone() ? MAIN_CASE : TUTORIAL_CASE)}>
            Play
          </button>
          <button type="button" className="btn btn-big" onClick={() => go(TUTORIAL_CASE)}>
            Tutorial
          </button>
        </div>
      </main>
      <button
        ref={gear}
        type="button"
        className="btn btn-hud btn-hud-icon title-gear"
        aria-pressed={settings}
        onClick={() => (settings ? closeSettings() : setSettings(true))}
        title="Settings: live characters with your own AI key"
      >
        <GearIcon />
        <span className="sr-only">Settings</span>
      </button>
      {settings && (
        <div className="title-dock">
          <Settings onClose={closeSettings} />
        </div>
      )}
      <footer className="title-foot">
        Code under the MIT licence, case text under CC BY 4.0 · Each case retells a public incident write-up, linked in
        its debrief · No account, no tracking
      </footer>
    </div>
  );
}
