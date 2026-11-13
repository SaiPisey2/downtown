import { useEffect, useMemo, useState } from 'react';
import { cases } from '../../cases';
import { liveCharacters } from '../../cast';
import { MAIN_CASE, TUTORIAL_CASE } from '../../game/flow';
import { useGame } from '../../game/store';
import { timeline } from '../../game/timeline';
import type { TimelineEntry } from '../../game/timeline';
import { score as scoreRun } from '../../sim';
import { clock } from '../logs';
import { HealthIcon } from '../panels/HealthIcon';
import { ResultCard, SCORE_PARTS, deductions, partLevel, signed, timeLine } from '../panels/ResultCard';
import '../theme.css';
import { clearHash, useScreenHeading } from './heading';

const KIND_WORD: Record<TimelineEntry['kind'], string> = {
  fault: 'Fault',
  deploy: 'Deploy',
  clue: 'Clue',
  action: 'Action',
  landed: 'Landed',
  update: 'Update',
  hint: 'Hint',
  won: 'Recovered',
  lost: 'Lost',
};

/** "2019-07-02" as "2 July 2019"; anything else as it is. */
function longDate(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}

/** Streams the reviewer's comments once, when live characters are on and this is the player's own run. */
function useReview(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    const it = useGame.getState().review();
    void (async () => {
      for await (const _ of it) {
        // the store keeps the text; reading drives the stream
      }
    })();
  }, [on]);
}

function Reviewer() {
  const text = useGame((s) => s.reviewText);
  const state = useGame((s) => s.reviewState);
  if (state === 'failed' || state === 'idle') return null;
  return (
    <section className="debrief-section review" aria-labelledby="review-h" aria-busy={state === 'streaming'}>
      <h2 id="review-h" className="section-title">
        Reviewer’s comments — not part of your score
      </h2>
      <p className="review-text">
        {text}
        {state === 'streaming' && <span className="typing-caret" aria-hidden="true" />}
      </p>
    </section>
  );
}

/** After the run: how it went, the score in five parts, the timeline, the real incident and the result card. */
export function Debrief() {
  const heading = useScreenHeading();
  const caseId = useGame((s) => s.caseId);
  const run = useGame((s) => s.run);
  const replaying = useGame((s) => s.replaying);
  const c = caseId ? cases[caseId] : undefined;
  // the log as it stands at the end; the run is over, so it no longer changes
  const s = useMemo(() => (c && run ? scoreRun(c, run.log, run.snapshot) : null), [c, run]);
  const items = useMemo(() => (c && run ? timeline(c, run.log) : []), [c, run]);
  const live = useMemo(() => !replaying && liveCharacters(), [replaying]);
  useReview(live && !!s);
  // filled in after the screen opens, so the live region announces it
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (s) setAnnounce(`${s.outcome === 'won' ? 'Recovered' : 'Lost'}. Score ${s.total} out of 100.`);
  }, [s]);
  if (!c || !run || !s) return null;

  const won = s.outcome === 'won';
  const off = deductions(s);
  const partsSum = SCORE_PARTS.reduce((a, p) => a + s[p.key], 0);
  const { start, brief, showTitle } = useGame.getState();
  const lost = run.log.find((e) => e.type === 'lost');
  const why = won
    ? timeLine(c, s)
    : lost?.type === 'lost' && lost.reason === 'clock'
      ? 'The clock ran out before the city recovered.'
      : 'Too many customers saw errors before the city recovered.';
  const leave = (then: () => void) => {
    clearHash();
    then();
  };

  return (
    <div className="play screen screen-debrief">
      <main className="debrief">
        <header className={`debrief-head debrief-${won ? 'ok' : 'bad'}`}>
          <p className="eyebrow">
            {replaying ? 'Replay · ' : ''}
            {c.title}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {won ? 'You brought the city back' : 'The city went down'}
          </h1>
          <p className="debrief-why">
            <HealthIcon health={won ? 'ok' : 'bad'} />
            {why}
          </p>
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
        </header>

        <section className="debrief-section score" aria-labelledby="score-h">
          <div className="score-total">
            <h2 id="score-h" className="section-title">
              Score
            </h2>
            <p className="score-big num">
              {s.total}
              <span> / 100</span>
            </p>
            {s.hints === 0 && <p className="score-hints">No hints used</p>}
          </div>
          <ul className="parts">
            {SCORE_PARTS.map((p) => {
              const pts = s[p.key];
              return (
                <li key={p.key} className={`part part-${partLevel(pts, p.max)}`}>
                  <div className="part-head">
                    <strong>{p.name}</strong>
                    <span className="num">
                      {pts} of {p.max}
                    </span>
                  </div>
                  <div
                    className="part-bar"
                    role="meter"
                    aria-label={p.name}
                    aria-valuemin={0}
                    aria-valuemax={p.max}
                    aria-valuenow={pts}
                    aria-valuetext={`${pts} of ${p.max} points`}
                  >
                    <div className="part-fill" style={{ width: `${(Math.min(pts, p.max) / p.max) * 100}%` }} />
                  </div>
                  <p className="part-says">{p.says}</p>
                </li>
              );
            })}
            {off.map((d) => (
              <li key={d.name} className="part part-off">
                <div className="part-head">
                  <strong>{d.name}</strong>
                  <span className="num">{signed(d.points)}</span>
                </div>
                {d.says && <p className="part-says">{d.says}</p>}
              </li>
            ))}
            {off.length > 0 && (
              <li className="part part-sum">
                <span>
                  {partsSum} from the parts {off.map((d) => `${d.points < 0 ? '−' : '+'} ${Math.abs(d.points)}`).join(' ')}
                  {partsSum + off.reduce((a, d) => a + d.points, 0) < 0 ? ' (never below 0)' : ''}
                </span>
                <strong className="num">= {s.total}</strong>
              </li>
            )}
          </ul>
        </section>

        <section className="debrief-section" aria-labelledby="timeline-h">
          <h2 id="timeline-h" className="section-title">
            Timeline
          </h2>
          <ol className="timeline">
            {items.map((t, i) => (
              <li key={i} className={`tl tl-${t.kind}`}>
                <span className="tl-time num">{clock(t.tick)}</span>
                <span className="tl-dot" aria-hidden="true" />
                <span className="tl-kind">{KIND_WORD[t.kind]}</span>
                <span className="tl-body">{t.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="debrief-section real" aria-labelledby="real-h">
          <h2 id="real-h" className="section-title">
            What really happened
          </h2>
          <p>{c.debrief.happened}</p>
          <h2 className="section-title">What the real team did</h2>
          <p>{c.debrief.realTeam}</p>
          {c.source && (
            <p className="source">
              Source:{' '}
              <a href={c.source.url} target="_blank" rel="noopener noreferrer">
                {c.source.publisher}’s write-up of the outage on {longDate(c.source.date)}
              </a>
            </p>
          )}
          <p className="fiction">{c.debrief.fictionNote}</p>
        </section>

        {live && <Reviewer />}

        <ResultCard c={c} score={s} seed={run.seed} inputs={run.inputs}>
          {replaying ? (
            <button type="button" className="btn" onClick={() => leave(() => brief(c.id))}>
              Play it yourself
            </button>
          ) : c.id === TUTORIAL_CASE ? (
            <>
              <button type="button" className="btn" onClick={() => brief(MAIN_CASE)}>
                Play the real case
              </button>
              <button type="button" className="btn" onClick={() => start(c.id)}>
                Play again
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => start(c.id)}>
              Play again
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => leave(() => showTitle())}>
            Back to title
          </button>
        </ResultCard>
      </main>
    </div>
  );
}
