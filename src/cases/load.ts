import { parse } from 'yaml';
import type { Cond } from '../sim';
import { NODE_VIEW_KEYS, STAKEHOLDER_LINES, caseSchema, type CaseFile } from './schema';

export class CaseError extends Error {
  readonly path: string;
  readonly issues: string[];
  constructor(path: string, issues: string[]) {
    super(`${path}: ${issues.length} problem${issues.length === 1 ? '' : 's'}\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'CaseError';
    this.path = path;
    this.issues = issues;
  }
}

const has = (o: object, k: string): boolean => Object.hasOwn(o, k);

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

function condMetrics(c: Cond, out: string[]): void {
  if ('all' in c) c.all.forEach((x) => condMetrics(x, out));
  else if ('any' in c) c.any.forEach((x) => condMetrics(x, out));
  else if ('not' in c) condMetrics(c.not, out);
  else out.push(c.metric);
}

/** Nodes left over after peeling off nodes with no remaining inbound edges: they sit on or behind a cycle. */
function cycleNodes(ids: string[], edges: { from: string; to: string }[]): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of edges) if (indeg.has(e.from) && indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to)! + 1);
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const done = new Set<string>();
  while (ready.length) {
    const id = ready.pop()!;
    done.add(id);
    for (const e of edges) {
      if (e.from !== id || !indeg.has(e.to)) continue;
      const d = indeg.get(e.to)! - 1;
      indeg.set(e.to, d);
      if (d === 0) ready.push(e.to);
    }
  }
  return ids.filter((id) => !done.has(id));
}

function check(c: CaseFile): string[] {
  const issues: string[] = [];
  const nodeIds = Object.keys(c.nodes);
  const isNode = (id: string): boolean => has(c.nodes, id);
  const needNode = (id: string, where: string): void => {
    if (!isNode(id)) issues.push(`${where}: unknown node "${id}"`);
  };
  const unique = (ids: string[], what: string): void => {
    for (const d of duplicates(ids)) issues.push(`duplicate ${what} "${d}"`);
  };

  needNode(c.entry, 'entry');
  for (const id of nodeIds) if (!has(c.layout, id)) issues.push(`node "${id}" has no layout entry`);
  for (const id of Object.keys(c.layout)) needNode(id, 'layout');
  for (const id of Object.keys(c.signals.graphs)) needNode(id, 'signals.graphs');
  for (const id of Object.keys(c.signals.logs)) needNode(id, 'signals.logs');

  unique(c.edges.map((e) => `${e.from}>${e.to}`), 'edge');
  for (const e of c.edges) {
    needNode(e.from, `edge ${e.from}>${e.to} from`);
    needNode(e.to, `edge ${e.from}>${e.to} to`);
  }
  const cyc = cycleNodes(nodeIds, c.edges);
  if (cyc.length) issues.push(`service graph has a cycle through: ${cyc.join(', ')}`);

  const castIds = c.cast.map((m) => m.id);
  const clueIds = c.clues.map((x) => x.id);
  unique(clueIds, 'clue id');
  unique(c.actions.map((a) => a.id), 'action id');
  unique(c.updates.map((u) => u.id), 'update id');
  unique(castIds, 'cast id');
  for (const m of c.cast) unique(m.questions.map((q) => q.id), `question id in cast "${m.id}"`);

  const lineKey = (key: string | undefined, where: string): void => {
    if (key !== undefined && !has(c.lines, key)) issues.push(`${where}: missing line "${key}"`);
  };
  c.timeline.forEach((ev, i) => {
    const w = `timeline[${i}] (${ev.kind} at ${ev.at})`;
    if (ev.kind === 'message') {
      if (ev.from === undefined || !castIds.includes(ev.from)) issues.push(`${w}: "from" must be a cast id, got "${ev.from ?? ''}"`);
      if (ev.lineKey === undefined) issues.push(`${w}: message needs a lineKey`);
      lineKey(ev.lineKey, w);
      for (const k of ['target', 'modifier', 'label'] as const) {
        if (ev[k] !== undefined) issues.push(`${w}: a message has no "${k}"`);
      }
      return;
    }
    if (ev.when !== undefined) issues.push(`${w}: only a message has a "when"`);
    if (ev.target === undefined) issues.push(`${w}: needs a target`);
    else needNode(ev.target, w);
    if (ev.kind === 'modify' && !ev.modifier) issues.push(`${w}: modify needs a modifier`);
    if (ev.modifier) needNode(ev.modifier.target, `${w} modifier`);
  });

  const stakeholders = c.cast.filter((m) => m.role === 'stakeholder');
  if (stakeholders.length > 1) issues.push(`at most one stakeholder, got ${stakeholders.map((m) => m.id).join(', ')}`);
  if (stakeholders.length) for (const k of STAKEHOLDER_LINES) lineKey(k, `stakeholder "${stakeholders[0]!.id}"`);
  // said instead of a live answer when the player's own model cannot be reached
  for (const m of c.cast) if (m.role === 'teammate') lineKey(`busy_${m.id}`, `teammate "${m.id}"`);

  for (const a of c.actions) {
    needNode(a.target, `action "${a.id}"`);
    a.effects.forEach((m) => needNode(m.target, `action "${a.id}" effect`));
    lineKey(a.consequenceKey, `action "${a.id}" consequenceKey`);
  }
  if (!c.actions.some((a) => a.resolves)) issues.push('no action has resolves: true');
  const isAction = (id: string): boolean => c.actions.some((a) => a.id === id);
  const clean = c.scoring.cleanFixAction;
  if (clean !== undefined && !isAction(clean)) issues.push(`scoring.cleanFixAction: unknown action "${clean}"`);
  for (const id of c.scoring.shortcutActions ?? []) {
    if (!isAction(id)) issues.push(`scoring.shortcutActions: unknown action "${id}"`);
  }

  // every Cond metric must name a real node
  const conds: { where: string; cond: Cond }[] = [{ where: 'win.cond', cond: c.win.cond }];
  for (const x of c.clues) if (x.when) conds.push({ where: `clue "${x.id}" when`, cond: x.when });
  c.timeline.forEach((ev, i) => {
    if (ev.modifier?.while) conds.push({ where: `timeline[${i}] while`, cond: ev.modifier.while });
    if (ev.when) conds.push({ where: `timeline[${i}] when`, cond: ev.when });
  });
  for (const a of c.actions) {
    a.effects.forEach((m) => m.while && conds.push({ where: `action "${a.id}" effect while`, cond: m.while }));
  }
  for (const [node, rules] of Object.entries(c.signals.logs)) {
    rules.forEach((r, i) => conds.push({ where: `signals.logs.${node}[${i}] when`, cond: r.when }));
  }
  for (const { where, cond } of conds) {
    const metrics: string[] = [];
    condMetrics(cond, metrics);
    for (const m of metrics) {
      if (m === 'city.tick' || m === 'city.errorRate') continue;
      const dot = m.indexOf('.');
      const node = dot > 0 ? m.slice(0, dot) : '';
      const key = dot > 0 ? m.slice(dot + 1) : '';
      if (!isNode(node)) issues.push(`${where}: metric "${m}" names unknown node "${node}"`);
      else if (!(key === 'enabled' || (key.startsWith('flag:') && key.length > 5) || (NODE_VIEW_KEYS as readonly string[]).includes(key))) {
        issues.push(`${where}: metric "${m}" has unknown key "${key}"`);
      }
    }
  }
  for (const [node, rules] of Object.entries(c.signals.logs)) {
    rules.forEach((r, i) => r.lines.length === 0 && issues.push(`signals.logs.${node}[${i}]: no lines`));
  }

  for (const m of c.cast) {
    for (const k of m.knows) if (!clueIds.includes(k)) issues.push(`cast "${m.id}" knows unknown clue "${k}"`);
    for (const q of m.questions) {
      if (q.reveals !== undefined && !clueIds.includes(q.reveals)) {
        issues.push(`cast "${m.id}" question "${q.id}" reveals unknown clue "${q.reveals}"`);
      }
      if (q.answerBefore !== undefined && !c.clues.some((x) => x.id === q.reveals && x.when !== undefined)) {
        issues.push(`cast "${m.id}" question "${q.id}": answerBefore is never shown (it needs a revealed clue with a "when")`);
      }
    }
  }

  for (const clue of c.clues) {
    const w = `clue "${clue.id}" route "${clue.route}"`;
    if (clue.route === 'changes') continue;
    const [kind, a, b, ...rest] = clue.route.split(':');
    if (kind === 'graph' && b === undefined && rest.length === 0 && a) {
      const dot = a.indexOf('.');
      const node = a.slice(0, dot);
      const metric = a.slice(dot + 1);
      const shown = dot > 0 && has(c.signals.graphs, node) ? c.signals.graphs[node]! : [];
      if (dot <= 0) issues.push(`${w}: a graph route must be "graph:<node>.<metric>"`);
      else if (!isNode(node)) issues.push(`${w}: unknown node "${node}"`);
      else if (!(shown as string[]).includes(metric)) issues.push(`${w}: "${metric}" is not among the graphs of "${node}"`);
    } else if (kind === 'log' && b === undefined && a) {
      if (!isNode(a)) issues.push(`${w}: unknown node "${a}"`);
      else if (!(has(c.signals.logs, a) && c.signals.logs[a]!.length > 0)) issues.push(`${w}: node "${a}" has no log rules`);
    } else if (kind === 'ask' && a && b && rest.length === 0) {
      const member = c.cast.find((m) => m.id === a);
      const q = member?.questions.find((x) => x.id === b);
      if (!member) issues.push(`${w}: unknown cast "${a}"`);
      else if (!q) issues.push(`${w}: cast "${a}" has no question "${b}"`);
      else if (q.reveals !== clue.id) issues.push(`${w}: question "${b}" must reveal "${clue.id}"`);
    } else {
      issues.push(`${w}: not a valid route`);
    }
  }
  return issues;
}

export function parseCase(yamlText: string, path: string): CaseFile {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (e) {
    throw new CaseError(path, [`invalid YAML: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`]);
  }
  const res = caseSchema.safeParse(raw);
  if (!res.success) {
    throw new CaseError(
      path,
      res.error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`),
    );
  }
  const issues = check(res.data);
  if (issues.length) throw new CaseError(path, issues);
  return res.data;
}
