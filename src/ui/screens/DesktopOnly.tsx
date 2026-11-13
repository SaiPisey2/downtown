import { REPO_URL } from '../site';

/** All a narrow window gets: what the game is, that it needs a desktop browser, and where the code is. */
export function DesktopOnly() {
  return (
    <main className="desktop-only" data-testid="desktop-only">
      <div className="desktop-only-box">
        <p className="title-kicker">
          <span className="hud-mark" aria-hidden="true" />
          An incident game
        </p>
        <h1>Downtown</h1>
        <p className="desktop-only-need">Downtown needs a desktop browser for now.</p>
        <p className="desktop-only-text">
          It is a game about keeping a production system up, drawn as a small city at night: every building is a
          service and every car is a request. When something goes wrong you look inside the buildings, ask your team
          what they see and fix it. The city and its panels need a window at least 900 pixels wide.
        </p>
        <a className="desktop-only-link" href={REPO_URL} rel="noopener noreferrer">
          See the code on GitHub
        </a>
      </div>
    </main>
  );
}
