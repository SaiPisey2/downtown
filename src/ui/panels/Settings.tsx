import { useId } from 'react';
import type { ReactNode } from 'react';
import { activeAiSettings, baseUrlProblem, keyHost, useLiveSettings } from '../../cast/settings';
import type { LiveSettings } from '../../cast/settings';
import { CloseButton } from './ChangeLog';

const PROVIDERS: { id: LiveSettings['provider']; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI-compatible' },
];

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children(id: string, describedBy?: string): ReactNode }) {
  const id = useId();
  const note = hint || error ? `${id}-note` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, note)}
      {error ? (
        <p id={note} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={note} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Live characters: the player's own provider and key, and whether teammates answer through it. */
export function Settings({ onClose }: { onClose(): void }) {
  const s = useLiveSettings();
  const on = useLiveSettings((x) => activeAiSettings(x) !== null);
  const hasKey = s.key.trim() !== '';
  const urlProblem = s.provider === 'openai' ? baseUrlProblem(s.baseUrl) : null;
  const host = keyHost(s);
  const missing =
    !hasKey ? 'Add a key to switch them on.'
    : urlProblem ? 'Fix the base URL to switch them on.'
    : !s.chatModel.trim() || !s.reviewModel.trim() ? 'Name both models to switch them on.'
    : null;

  return (
    <aside className="dock" aria-label="Settings">
      <header className="dock-head">
        <div>
          <p className="eyebrow">Optional</p>
          <h2>Live characters</h2>
        </div>
        <CloseButton label="Close settings" onClose={onClose} />
      </header>
      <div className="dock-body settings">
        <p className="lede">
          With your own AI key, teammates answer anything you type, and a reviewer comments on your run at the end. The
          game is fully playable without it: everyone has written lines.
        </p>
        <p className="settings-cost">
          Live characters cost you money with your provider, a little for every answer. The game never sees the bill.
        </p>

        <Field label="Provider">
          {(id) => (
            <select id={id} value={s.provider} onChange={(e) => s.change({ provider: e.target.value as LiveSettings['provider'] })}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        {s.provider === 'openai' && (
          <Field label="Base URL" hint="Leave empty for OpenAI itself." error={urlProblem}>
            {(id, note) => (
              <input
                id={id}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://api.openai.com/v1"
                aria-describedby={note}
                aria-invalid={urlProblem ? true : undefined}
                value={s.baseUrl}
                onChange={(e) => s.change({ baseUrl: e.target.value })}
              />
            )}
          </Field>
        )}

        <Field label="Your key" hint={host ? `Your key will be sent to ${host}` : 'Fix the base URL to see where your key will be sent.'}>
          {(id, note) => (
            <input
              id={id}
              aria-describedby={note}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={s.key}
              onChange={(e) => s.change({ key: e.target.value })}
            />
          )}
        </Field>
        <p className="privacy">Your key stays in this tab and is sent only to the provider you chose.</p>
        <label className="check">
          <input type="checkbox" checked={s.keepForTab} onChange={(e) => s.change({ keepForTab: e.target.checked })} />
          Keep for this tab
          <span className="check-note">so a reload does not ask again; closing the tab forgets it</span>
        </label>

        <div className="field-row">
          <Field label="Chat model">
            {(id) => (
              <input id={id} type="text" autoComplete="off" spellCheck={false} value={s.chatModel} onChange={(e) => s.change({ chatModel: e.target.value })} />
            )}
          </Field>
          <Field label="Review model">
            {(id) => (
              <input id={id} type="text" autoComplete="off" spellCheck={false} value={s.reviewModel} onChange={(e) => s.change({ reviewModel: e.target.value })} />
            )}
          </Field>
        </div>

        <label className={`switch ${missing ? 'switch-off' : ''}`}>
          <input
            type="checkbox"
            role="switch"
            checked={on}
            disabled={missing !== null}
            aria-describedby="live-status"
            onChange={(e) => s.change({ live: e.target.checked })}
          />
          <span className="switch-track" aria-hidden="true" />
          Use live characters
        </label>
        <p id="live-status" className="field-hint" role="status">
          {on ? 'On: type a question to a teammate in the chat.' : (missing ?? 'Off: everyone uses written lines.')}
        </p>

        <div className="settings-buttons">
          <button type="button" className="btn" disabled={!hasKey} onClick={() => s.forget()}>
            Forget key
          </button>
        </div>
      </div>
    </aside>
  );
}
