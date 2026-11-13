import { describe, expect, it } from 'vitest';
import { createRun, findableClues, type GameEvent, type Snapshot } from '../sim';
import { STAKEHOLDER_LINES, answerFor, cases, type CaseFile } from './index';

/**
 * Every line the game can show, at every tick of a set of scripted runs, held
 * against what the city is doing at that tick. A line is shown when:
 * - a clue's `when` holds (a look or a hint could show its text now);
 * - a question is asked (its answer, `answerBefore` or `answer`, for this tick);
 * - an event in the log is said (timeline messages, consequences, outcomes, acknowledgements, the nudge).
 * The notebook only repeats a clue with the time it was found, so it is checked when found.
 */

interface Ctx {
  c: CaseFile;
  snap: Snapshot;
  /** the city's error rate for each of the last 60 ticks, this one included */
  recentErr: number[];
  log: readonly GameEvent[];
  /** the same case a few ticks before any trouble */
  healthy: Snapshot;
}

interface Rule {
  name: string;
  match: RegExp;
  holds(x: Ctx): boolean;
}

const deployed = (x: Ctx, target?: string) => x.log.some((e) => e.type === 'deploy' && (target === undefined || e.target === target));
const node = (x: Ctx, id: string) => x.snap.nodes[id]!;
const below = (x: Ctx, id: string) => node(x, id).arrivals < x.healthy.nodes[id]!.arrivals;
const errNow = (x: Ctx) => x.snap.impact.errorRate;

/** Machine-checked claims. A line that matches a rule must make that rule hold at the tick it is shown. */
const RULES: Rule[] = [
  { name: 'trouble words need recent errors', match: /\bdown\b|\berrors\b|timing out|still failing/i, holds: (x) => x.recentErr.some((e) => e >= 0.01) },
  { name: '"most people" needs most requests failing', match: /most people/i, holds: (x) => errNow(x) > 0.5 },
  { name: 'nothing shipped only before any deploy', match: /nothing has shipped/i, holds: (x) => !deployed(x) },
  { name: 'no orders deploy only before it', match: /no orders deploy/i, holds: (x) => !deployed(x, 'orders') },
  { name: 'out of CPU only while the edge is full', match: /out of CPU|CPU is pinned|spending their CPU/i, holds: (x) => node(x, 'edge').saturation > 0.95 },
  { name: 'normal CPU only while the edge has room', match: /CPU looks normal/i, holds: (x) => node(x, 'edge').saturation < 0.8 },
  { name: 'behind the edge, fewer requests', match: /behind the edge/i, holds: (x) => ['web', 'api', 'cache', 'accounts', 'orders', 'db'].every((id) => below(x, id)) },
  { name: 'orders sees fewer requests', match: /orders .*fewer requests/i, holds: (x) => below(x, 'orders') },
  { name: 'orders not failing', match: /orders service is not failing/i, holds: (x) => node(x, 'orders').errorRate < 0.01 },
  { name: 'the database is quieter', match: /quieter/i, holds: (x) => below(x, 'db') },
  { name: 'the database is not in trouble', match: /It looks normal/i, holds: (x) => node(x, 'db').errorRate < 0.01 && node(x, 'db').saturation < 0.8 },
  { name: 'nothing broken needs no errors', match: /Nothing is broken|All quiet/i, holds: (x) => errNow(x) < 0.01 },
  { name: 'the filter is off', match: /filter is off/i, holds: (x) => x.snap.params.filter?.enabled === false },
  { name: 'rolled back rules', match: /rolled back everywhere|yesterday's rules/i, holds: (x) => x.snap.flags.filter?.rules === undefined },
  { name: 'rules update out today', match: /rules update for the filter went out|pushed a rules update|Rules update 412 went out/i, holds: (x) => deployed(x, 'filter') },
  { name: 'a third of visitors turned away', match: /a third of visitors/i, holds: (x) => { const g = node(x, 'gate'); return g.dropped / g.arrivals > 0.3 && g.dropped / g.arrivals < 0.37; } },
  { name: 'no block at the gate', match: /no block at the gate/i, holds: (x) => x.snap.flags.gate?.blocked === undefined },
  { name: 'the api, doubled and not busy', match: /twice the servers/i, holds: (x) => x.snap.params.api!.instances === 8 && node(x, 'api').saturation < 0.8 },
  { name: 'the edge serves less after a restart', match: /edge serves less/i, holds: (x) => x.snap.params.edge!.capacityMul < 1 },
  { name: 'orders short-handed', match: /orders service restarted/i, holds: (x) => x.snap.params.orders!.capacityMul < 1 },
  { name: 'the wording fixes', match: /wording fixes|wording on the order page/i, holds: (x) => deployed(x, 'orders') },
  { name: 'the site is back', match: /back for customers|going through again/i, holds: (x) => errNow(x) < 0.01 },
  // the tutorial
  { name: 'a new shop build', match: /put out a new shop build|shop got a new build|new shop build today/i, holds: (x) => deployed(x, 'shop') },
  { name: 'orders started to fail', match: /before the orders started to fail/i, holds: (x) => x.recentErr.some((e) => e >= 0.01) },
  { name: 'a build about to go out', match: /about to go out/i, holds: (x) => !deployed(x, 'shop') },
];

/**
 * Lines no rule above can judge by itself, read by hand against every state the
 * runs below reach. Each is listed with why it holds; a new line fails this test
 * until it is given a rule or added here.
 */
const READ_BY_HAND: Record<string, string> = {
  // edge-rule
  'Volume is normal. Same sources as yesterday. No sign of an attack.': 'the case has no attack; arrivals at the gate are constant',
  'Traffic volume is normal and comes from the usual places. This does not look like an attack.': 'as above',
  'No network changes from my team today. I checked.': 'nothing in the case changes the network; the gate block is the player\'s',
  'Nobody on the network team changed anything today.': 'as above',
  'Customers say the site is down. Are we being attacked? What do I tell them?': 'gated on most requests failing; rule "trouble words" checks it too',
  'I have not heard anything new in a while, and customers keep asking. Can you give me something to post?': 'makes no claim about the city',
  'Thanks, that is clear. I will post it as it is.': 'acknowledgement',
  'Oh good, that is easy to explain. Sending it out now.': 'acknowledgement',
  // tutorial
  'I have not touched the ledger today. I would leave it alone.': 'nothing in the case changes the ledger but the player\'s restart',
  'Restarting the ledger dropped the orders it was writing. Nothing improved.': 'the restart switches the ledger off: whatever it was writing fails, and nothing gets better',
  'Thanks. I will pass that on to the customers who wrote in.': 'acknowledgement',
  'Great, that is what they want to hear. Sending it now.': 'acknowledgement',
  'Customers are asking about their orders. What should I tell them?': 'makes no claim about the city',
};

type Script = [label: string, acts: [tick: number, id: string][]];

const SCRIPTS: Record<string, Script[]> = {
  'edge-rule': [
    ['left alone: healthy, then the fault until the city is lost', []],
    ['filter off as early as allowed', [[240, 'filter_off']]],
    ['filter off at 480', [[480, 'filter_off']]],
    ['rollback as early as allowed', [[240, 'rollback_rules']]],
    ['rollback at 480', [[480, 'rollback_rules']]],
    ['filter off, then the rollback as well', [[250, 'filter_off'], [260, 'rollback_rules']]],
    ['restart the edge in the fault', [[300, 'restart_edge']]],
    ['block the sources in the fault', [[300, 'block_sources']]],
    ['block, then lift it, in the fault', [[300, 'block_sources'], [400, 'unblock_sources']]],
    ['lift a block that was never there', [[300, 'unblock_sources']]],
    ['roll back orders before its deploy', [[300, 'rollback_orders']]],
    ['roll back orders after its deploy', [[450, 'rollback_orders']]],
    ['double the api in the fault', [[300, 'scale_api']]],
    ['recovered, then restart the edge', [[240, 'filter_off'], [300, 'restart_edge']]],
    ['recovered, then block the sources', [[240, 'filter_off'], [300, 'block_sources']]],
    ['recovered, then roll back orders', [[240, 'filter_off'], [300, 'rollback_orders']]],
    ['recovered, then double the api', [[240, 'filter_off'], [300, 'scale_api']]],
    ['recovered, then lift a block that was never there', [[240, 'filter_off'], [300, 'unblock_sources']]],
    ['rolled back, then block the sources', [[240, 'rollback_rules'], [560, 'block_sources']]],
    ['rolled back, then restart the edge', [[240, 'rollback_rules'], [560, 'restart_edge']]],
  ],
  tutorial: [
    ['left alone', []],
    ['rollback as early as allowed', [[12, 'rollback']]],
    ['rollback at 30', [[30, 'rollback']]],
    ['restart the ledger in the fault', [[20, 'restart']]],
    ['rolled back, then restart the ledger', [[12, 'rollback'], [24, 'restart']]],
  ],
};

interface Shown {
  tick: number;
  source: string;
  text: string;
}

/** Plays the acts (each at its tick) to the end, and returns every line that could be shown, with its context. */
function play(c: CaseFile, acts: [number, string][]): { shown: Shown[]; checks: { s: Shown; x: Ctx }[] } {
  const healthyRun = createRun(c);
  const firstTrouble = Math.min(...c.timeline.filter((e) => e.kind !== 'message').map((e) => e.at));
  const healthy = healthyRun.step(firstTrouble - 2);
  const run = createRun(c);
  const errs: number[] = [];
  const checks: { s: Shown; x: Ctx }[] = [];
  const shown: Shown[] = [];
  const later: Shown[] = [];
  const consequence = (id: string) => c.actions.find((a) => a.id === id)?.consequenceKey;
  let faulted = false;
  for (;;) {
    const snap = run.snapshot;
    errs.push(snap.impact.errorRate);
    const x: Ctx = { c, snap, recentErr: errs.slice(-60), log: [...run.log], healthy };
    // a consequence describes the action's effect, which shows from the tick after it lands
    for (const s of later.splice(0)) checks.push({ s, x });
    const say = (source: string, text: string | undefined, judgeNextTick = false) => {
      if (text === undefined) return;
      const s = { tick: snap.tick, source, text };
      shown.push(s);
      if (judgeNextTick && snap.status === 'running') later.push(s);
      else checks.push({ s, x });
    };
    // a clue is shown exactly when a look or a hint could find it now
    if (snap.status === 'running') {
      for (const clue of c.clues) {
        if (findableClues(c, clue.route, snap, []).some((f) => f.id === clue.id)) say(`clue ${clue.id}`, clue.text);
      }
    }
    for (const m of c.cast) for (const q of m.questions) say(`ask ${m.id}:${q.id}`, answerFor(c, m.id, q.id, snap));
    for (const e of run.log.filter((e) => e.tick === snap.tick)) {
      if (e.type === 'message') say(`message ${e.lineKey}`, c.lines[e.lineKey]);
      if (e.type === 'action_landed') {
        const k = consequence(e.actionId);
        if (k) say(`consequence ${k}`, c.lines[k], true);
      }
      if (e.type === 'won') say('outcome_won', c.lines.outcome_won);
      if (e.type === 'lost') say('outcome_lost', c.lines.outcome_lost);
      if (e.type === 'fault' || e.type === 'deploy') faulted = true;
    }
    // the nudge and the acknowledgements can come at any tick once the trouble has begun
    if (faulted && snap.status === 'running') for (const k of STAKEHOLDER_LINES.filter((k) => k !== 'outcome_won' && k !== 'outcome_lost')) say(k, c.lines[k]);
    if (snap.status !== 'running') break;
    for (const [at, id] of acts) if (at === snap.tick) expect(run.act(id), `${id} at ${at}`).toEqual({ ok: true });
    run.step();
  }
  return { shown, checks };
}

describe.each(Object.keys(SCRIPTS))('every line in %s is true when it can be shown', (caseId) => {
  const c = cases[caseId]!;
  const runs = SCRIPTS[caseId]!.map(([label, acts]) => ({ label, ...play(c, acts) }));

  it('breaks no rule in any scripted run', () => {
    const broken: string[] = [];
    for (const { label, checks } of runs) {
      const seen = new Set<string>();
      for (const { s, x } of checks) {
        for (const r of RULES) {
          if (!r.match.test(s.text) || r.holds(x)) continue;
          const key = `${label} | ${s.source} | ${r.name}`;
          if (!seen.has(key)) broken.push(`${key} (first at tick ${s.tick}): "${s.text}"`);
          seen.add(key);
        }
      }
    }
    expect(broken).toEqual([]);
  }, 30_000);

  it('every line shown is either judged by a rule or was read by hand', () => {
    const lines = new Set(runs.flatMap((r) => r.shown.map((s) => s.text)));
    const unjudged = [...lines].filter((t) => !RULES.some((r) => r.match.test(t)) && !Object.hasOwn(READ_BY_HAND, t));
    expect(unjudged).toEqual([]);
  });

  it('the runs reach the states they are meant to', () => {
    const outcome = (label: string) => runs.find((r) => r.label === label)!.shown.find((s) => s.source.startsWith('outcome'))?.source;
    if (caseId === 'edge-rule') {
      expect(outcome('left alone: healthy, then the fault until the city is lost')).toBe('outcome_lost');
      expect(outcome('filter off as early as allowed')).toBe('outcome_won');
      expect(outcome('rollback as early as allowed')).toBe('outcome_won');
      expect(outcome('rolled back, then block the sources')).toBe('outcome_lost');
    } else {
      expect(outcome('left alone')).toBe('outcome_lost');
      expect(outcome('rollback as early as allowed')).toBe('outcome_won');
    }
  });
});
