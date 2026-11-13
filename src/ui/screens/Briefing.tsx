import { cases } from '../../cases';
import { MAIN_CASE, TUTORIAL_CASE, markTutorialDone } from '../../game/flow';
import { useGame } from '../../game/store';
import { Board } from '../../scene/Board';
import '../theme.css';
import { useScreenHeading } from './heading';

const TEXT_SPACE = 680;

const HOW = [
  { n: '1', title: 'Inspect buildings', text: 'Pick a building to see its graphs, logs and recent changes.' },
  { n: '2', title: 'Ask your team', text: 'Teammates in the chat know things the graphs do not show.' },
  { n: '3', title: 'Act, and keep the boss updated', text: 'Fix it from a building’s actions, and tell the boss what is going on.' },
];

/** What the case is about and how to play, before the clock starts. */
export function Briefing() {
  const heading = useScreenHeading();
  const caseId = useGame((s) => s.caseId);
  const c = caseId ? cases[caseId] : undefined;
  if (!c) return null;
  const tutorial = c.id === TUTORIAL_CASE;
  const { start, brief, showTitle } = useGame.getState();

  return (
    <div className="play screen screen-briefing">
      <Board backdrop insetLeft={TEXT_SPACE} />
      <div className="screen-shade" aria-hidden="true" />
      <main className="title-panel brief-panel" aria-labelledby="brief-h">
        <p className="eyebrow">{tutorial ? 'Tutorial · about 3 minutes' : 'Your case · 5 to 10 minutes'}</p>
        <h1 id="brief-h" ref={heading} tabIndex={-1} className="brief-title">
          {c.title}
        </h1>
        <p className="brief-text">{c.briefing}</p>
        <h2 className="eyebrow brief-how">How to play</h2>
        <ol className="how">
          {HOW.map((h) => (
            <li key={h.n}>
              <span className="how-n" aria-hidden="true">
                {h.n}
              </span>
              <span>
                <strong>{h.title}</strong>
                <span className="how-text">{h.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <div className="title-buttons">
          <button type="button" className="btn btn-primary btn-big" onClick={() => start(c.id)}>
            Start
          </button>
          {tutorial && (
            <button
              type="button"
              className="btn btn-big"
              onClick={() => {
                markTutorialDone();
                brief(MAIN_CASE);
              }}
            >
              Skip tutorial
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => showTitle()}>
            Back
          </button>
        </div>
      </main>
    </div>
  );
}
