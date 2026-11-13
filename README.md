# Downtown — the city is your production system

Downtown is a browser game about being on call. A production system is drawn as a small city at night: visitors come in through the gate as streams of light, buildings are services, roads are the calls between them. Something breaks and the city starts to go dark. You look at graphs and logs, ask your teammates, keep your boss told, and pick the fix. A case takes five to ten minutes. There is no account and no server; the whole game runs in your browser.

## Play

Run it locally:

```
git clone https://github.com/SaiPisey2/downtown.git
cd downtown && npm ci
npm run dev
```

then open the address it prints (http://127.0.0.1:5173).

## How a case plays

1. Inspect: click a building to see its graphs, logs and recent changes; the change log covers the whole city.
2. Ask: each teammate has a few questions they can answer, and what they know changes as the incident unfolds.
3. Act: actions sit on each building's Actions tab, say what they risk, and take time to land.
4. Update the boss: she asks what to tell customers; honest updates count, spin earns nothing.
5. Debrief: a score in five parts, a timeline of your run, what really happened, and a link that replays your run.

## The first case

"The rule that ate the city" retells Cloudflare's public write-up of its outage on 2 July 2019: <https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/>. It is told in this project's own words. The city, the people, the numbers and the layout are invented for play; only the shape of the story follows the real incident.

## Live characters (optional)

In Settings you can give the game your own key for Anthropic or for an OpenAI-compatible endpoint. Teammates then answer anything you type, and a reviewer comments on your run at the end. The key stays in the browser tab and is sent only to the provider you chose. Every answer costs you money with that provider. The game is complete without it: every character has written lines.

## Without 3D

Where the browser has no WebGL2, or when the address ends in `?flat=1`, the city is drawn as a flat board of tiles and roads with the same information. The game is desktop only for now; a window narrower than 900 pixels shows a notice instead.

## How it is built

- `src/sim/` is a pure, deterministic simulation of requests flowing through services. It imports nothing from the browser, so the same inputs always give the same run; replays and share links rely on that.
- `src/cases/` holds the case files in YAML, with a schema and checks that run when they load.
- `src/scene/` draws the city with three.js through react-three-fiber. The scene is a function of the simulation state; it never decides anything itself.
- `src/cast/` gives the characters their lines: scripted by default, or a live model when the player has set one up.
- `src/game/` holds the game state, the clock and the share links; `src/ui/` the screens and panels.

## Writing a case

A case is one YAML file. In brief:

- `nodes`, `edges` and `layout`: the services, the calls between them and where each building stands.
- `timeline`: what happens and when — deploys, faults, messages from the boss.
- `actions`: what the player can do on each building, how long it takes and what it changes.
- `clues`: each fact the player can find, where it is found (a graph, a log, the change log or a question) and when it becomes true.
- `cast`: teammates with their questions and answers, and the stakeholder.
- `updates`, `win`, `lose`, `scoring` and `debrief`: what the boss can be told, how the run ends and how it is scored and explained.

The rule that keeps a case fair: every fact a character can reveal is a listed clue, and a question that tells a fact names the clue it reveals. The loader checks that clues and questions point at each other and refuses a case where they do not. `src/cases/tutorial.yaml` is the small example to start from.

## Development

Node 22.

- `npm run dev` — the game at http://127.0.0.1:5173
- `npm test` — unit tests
- `npm run e2e` — end-to-end tests in the Google Chrome installed on your machine
- `npm run check` — build, size budget, unit tests and end-to-end tests, as CI runs them

## Licence

The code is under the MIT licence. The case text in `src/cases/` and the art the code generates are under CC BY 4.0. See [LICENSE](LICENSE).
