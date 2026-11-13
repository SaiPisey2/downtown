import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { cases } from '../../cases';
import type { CaseFile } from '../../cases';
import type { ChatLine } from '../../cast';
import { useGame } from '../../game/store';
import { clock } from '../logs';
import { useUi } from '../uiStore';
import { CloseButton } from './ChangeLog';

type Member = CaseFile['cast'][number];

/** Width of the chat dock plus its margins, as in theme.css. */
export const CHAT_SPACE = 340 + 2 * 12;

/** How long a preview of a new line stays up. */
const PREVIEW_MS = 8000;

/** Avatar tints by cast position: apart from the teal, amber and red that mean health. */
const TINTS = ['#7dd3fc', '#c4b5fd', '#f0abfc', '#86efac'];

const ROLE_WORD: Record<Member['role'], string> = { teammate: 'teammate', stakeholder: 'stakeholder' };

/** The first sentence of the persona, which names the job. */
const job = (m: Member): string => m.persona.split('.')[0] ?? '';

function Avatar({ m, i, size = 'md' }: { m: Member; i: number; size?: 'sm' | 'md' }) {
  return (
    <span className={`avatar avatar-${size}`} style={{ '--tint': TINTS[i % TINTS.length] } as CSSProperties} aria-hidden="true">
      {m.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** One thread, newest at the bottom, kept scrolled to the end as lines arrive. */
function Thread({ m, lines }: { m: Member; lines: ChatLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  const last = lines.at(-1);
  useLayoutEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length, last?.text, m.id]);
  return (
    <div ref={box} className="chat-scroll">
      <ol className="thread" role="log" aria-live="polite" aria-busy={last?.live ? true : undefined} aria-label={`Conversation with ${m.name}`}>
        {lines.length === 0 && (
          <li className="thread-empty">
            {m.role === 'stakeholder'
              ? `${m.name} passes what you send on to customers.`
              : `${m.name} has not said anything yet. Ask below.`}
          </li>
        )}
        {lines.map((l) => {
          const mine = l.from === 'you';
          return (
            <li key={l.id} className={`msg ${mine ? 'msg-you' : 'msg-them'}`}>
              <span className="msg-meta">
                {mine ? 'You' : m.name} · <time>{clock(l.tick)}</time>
              </span>
              <p className="msg-text">
                {l.text}
                {l.live && (
                  <span className="typing" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A short look at a new line from someone the player is not looking at. */
export function ChatPreview({ inline = false }: { inline?: boolean }) {
  const preview = useUi((s) => s.preview);
  const caseId = useGame((s) => s.caseId);
  const c = caseId ? cases[caseId] : undefined;
  const i = c && preview ? c.cast.findIndex((m) => m.id === preview.castId) : -1;
  const m = c?.cast[i];

  useEffect(() => {
    if (!preview) return;
    const t = setTimeout(() => useUi.getState().dismissPreview(preview.id), PREVIEW_MS);
    return () => clearTimeout(t);
  }, [preview]);

  if (!preview || !m) return null;
  const open = () => {
    const ui = useUi.getState();
    ui.openChat(true);
    ui.chatTo(m.id);
  };
  return (
    <div className={`chat-preview ${inline ? 'chat-preview-inline' : ''}`} role="status">
      <Avatar m={m} i={i} size="sm" />
      <p className="chat-preview-text">
        <strong>{m.name}</strong> {preview.text}
      </p>
      <button type="button" className="btn btn-small-text" onClick={open}>
        Open
      </button>
      <button type="button" className="btn-icon btn-small" aria-label="Dismiss" onClick={() => useUi.getState().dismissPreview(preview.id)}>
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** What the player can say to `m`: their questions, or status updates for the stakeholder. */
function Replies({ c, m, lines, ended }: { c: CaseFile; m: Member; lines: ChatLine[]; ended: boolean }) {
  const ask = useGame((s) => s.ask);
  const update = useGame((s) => s.update);
  const busy = lines.some((l) => l.live);
  const said = new Set(lines.filter((l) => l.from === 'you').map((l) => l.text));
  if (m.role === 'stakeholder') {
    return (
      <div className="chat-replies" role="group" aria-labelledby="chat-replies-title">
        <p id="chat-replies-title" className="eyebrow">Send {m.name} a status update</p>
        <ul>
          {c.updates.map((u) => (
            <li key={u.id}>
              <button type="button" className="btn btn-say" disabled={ended} onClick={() => update(u.id)}>
                {u.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="chat-replies" role="group" aria-labelledby="chat-replies-title">
      <p id="chat-replies-title" className="eyebrow">Ask {m.name}</p>
      {m.questions.length === 0 ? (
        <p className="empty">Nothing to ask {m.name} right now.</p>
      ) : (
        <ul>
          {m.questions.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                className={`btn btn-say ${said.has(q.label) ? 'btn-said' : ''}`}
                disabled={ended || busy}
                onClick={() => void ask(m.id, q.id)}
              >
                {q.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The left dock: the cast as chips, the thread with the chosen character, and what you can say to them. */
export function ChatDock({ onClose }: { onClose(): void }) {
  const caseId = useGame((s) => s.caseId);
  const chat = useGame((s) => s.chat);
  const ended = useGame((s) => s.snap?.status !== 'running');
  const chatWith = useUi((s) => s.chatWith);
  const unread = useUi((s) => s.unread);
  const chatTo = useUi((s) => s.chatTo);
  const c = caseId ? cases[caseId] : undefined;
  if (!c || c.cast.length === 0) return null;
  const i = Math.max(0, c.cast.findIndex((m) => m.id === chatWith));
  const m = c.cast[i]!;
  const lines = chat.filter((l) => l.from === m.id || l.to === m.id);

  return (
    <aside className="chat" aria-label="Team chat">
      <header className="dock-head chat-head">
        <div>
          <p className="eyebrow">Your team</p>
          <h2>Chat</h2>
        </div>
        <CloseButton label="Close chat" onClose={onClose} />
      </header>
      <ul className="cast" aria-label="People">
        {c.cast.map((x, j) => {
          const n = unread[x.id] ?? 0;
          return (
            <li key={x.id}>
              <button type="button" className="cast-chip" aria-pressed={x.id === m.id} onClick={() => chatTo(x.id)}>
                <Avatar m={x} i={j} />
                <span className="cast-name">{x.name}</span>
                <span className="cast-role">{ROLE_WORD[x.role]}</span>
                {n > 0 && (
                  <span className="badge">
                    {n}
                    <span className="sr-only"> new</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <ChatPreview inline />
      <p className="thread-who">
        <Avatar m={m} i={i} size="sm" />
        <span>
          <strong>{m.name}</strong> · {job(m)}
        </span>
      </p>
      <Thread m={m} lines={lines} />
      <Replies c={c} m={m} lines={lines} ended={ended} />
    </aside>
  );
}
