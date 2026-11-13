import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { cases } from '../../cases';
import type { CaseFile } from '../../cases';
import { useGame } from '../../game/store';
import type { NodeId } from '../../sim';
import { logLines } from '../logs';
import { HEALTH_WORD, buildingHealth, duration } from '../metrics';
import { useUi } from '../uiStore';
import { ChangeList, CloseButton } from './ChangeLog';
import { HealthIcon } from './HealthIcon';
import { Sparkline } from './Sparkline';

const TABS = ['Graphs', 'Logs', 'Changes', 'Actions'] as const;
type Tab = (typeof TABS)[number];

/** Real time a graph must stay on screen, unpaused, before it counts as looked at. */
const GRAPH_LOOK_MS = 1000;

const KIND_WORD: Record<CaseFile['layout'][string]['kind'], string> = {
  gate: 'Gate',
  proxy: 'Proxy',
  filter: 'Filter',
  service: 'Service',
  cache: 'Cache',
  database: 'Database',
  queue: 'Queue',
};

function Graphs({ c, node }: { c: CaseFile; node: NodeId }) {
  const history = useGame((s) => s.history);
  const paused = useGame((s) => s.paused);
  const running = useGame((s) => s.snap?.status === 'running');
  const observe = useGame((s) => s.observe);
  const metrics = c.signals.graphs[node] ?? [];
  // per panel opening: the panel is keyed by selection, so this resets with it
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (paused || !running) return;
    const t = setTimeout(() => {
      for (const m of metrics) {
        if (seen.current.has(m)) continue;
        seen.current.add(m);
        observe(`graph:${node}.${m}`);
      }
    }, GRAPH_LOOK_MS);
    return () => clearTimeout(t);
  }, [paused, running, metrics, node, observe]);

  if (metrics.length === 0) return <p className="empty">No graphs for this building.</p>;
  return (
    <div className="graphs">
      {metrics.map((m) => (
        <Sparkline key={m} metric={m} values={history[`${node}.${m}`] ?? []} />
      ))}
      <p className="footnote">Last two minutes of simulated time, one point a second.</p>
    </div>
  );
}

function Logs({ c, node }: { c: CaseFile; node: NodeId }) {
  const snap = useGame((s) => s.snap);
  const seed = useGame((s) => s.run?.seed ?? 0);
  const observe = useGame((s) => s.observe);
  useEffect(() => observe(`log:${node}`), [node, observe]);
  const lines = useMemo(() => (snap ? logLines(c, node, snap, seed) : []), [c, node, snap, seed]);
  if (lines.length === 0) return <p className="empty">Nothing in this building's log right now.</p>;
  return (
    <ol className="log" aria-label={`${c.layout[node]?.name ?? node} log, newest last`}>
      {lines.map((l, i) => {
        const [time, level] = l.split(' ', 2);
        const rest = l.slice((time?.length ?? 0) + (level?.length ?? 0) + 2);
        return (
          <li key={i} className={`log-${level?.toLowerCase()}`}>
            <time>{time}</time>
            <span className="log-level">{level}</span>
            <span>{rest}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Changes({ node }: { node: NodeId }) {
  const observe = useGame((s) => s.observe);
  useEffect(() => observe('changes'), [observe]);
  return <ChangeList only={node} empty="No changes to this building yet." />;
}

function Actions({ c, node }: { c: CaseFile; node: NodeId }) {
  const tick = useGame((s) => s.snap?.tick ?? 0);
  const pending = useGame((s) => s.snap?.pending);
  const askConfirm = useUi((s) => s.askConfirm);
  const refusals = useUi((s) => s.refusals);
  const actions = c.actions.filter((a) => a.target === node);
  if (actions.length === 0) return <p className="empty">Nothing you can do to this building directly.</p>;
  return (
    <ul className="actions">
      {actions.map((a) => {
        const p = pending?.find((x) => x.actionId === a.id);
        return (
          <li key={a.id} className="action">
            <button type="button" className="btn btn-action" onClick={(e) => askConfirm(a.id, e.currentTarget)}>
              {a.label}
            </button>
            <p className="action-meta">
              <ClockIcon /> {a.delayTicks === 0 ? 'Lands at once' : `Takes ${duration(a.delayTicks)} to land`}
            </p>
            {a.risk && (
              <p className="action-risk">
                <span className="tag">Risk</span> {a.risk}
              </p>
            )}
            {p && (
              <p className="pending-line">
                <span className="spinner" aria-hidden="true" /> In progress. Lands in {duration(p.landsAt - tick)}
              </p>
            )}
            {refusals[a.id] && (
              <p className="refusal" role="status">
                <HealthIcon health="warn" /> {refusals[a.id]}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ClockIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 4.8V8l2.2 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The right dock for one building: graphs, logs, changes and actions in tabs. */
export function BuildingPanel({ node, onClose }: { node: NodeId; onClose(): void }) {
  const caseId = useGame((s) => s.caseId);
  const view = useGame((s) => s.snap?.nodes[node]);
  const c = caseId ? cases[caseId] : undefined;
  const [tab, setTab] = useState<Tab>('Graphs');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!c) return null;
  const info = c.layout[node];
  const name = info?.name ?? node;
  const health = buildingHealth(view);
  const base = `panel-${node}`;

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const to =
      e.key === 'ArrowRight' ? (i + 1) % TABS.length
      : e.key === 'ArrowLeft' ? (i - 1 + TABS.length) % TABS.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? TABS.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to]!);
    tabs.current[to]?.focus();
  };

  return (
    <aside className="dock" aria-label={`${name} building`}>
      <header className="dock-head">
        <div>
          <p className="eyebrow">
            {info ? `${KIND_WORD[info.kind]} · ${info.district} district` : 'Building'}
          </p>
          <h2>{name}</h2>
        </div>
        <span className={`chip chip-${health}`}>
          <HealthIcon health={health} />
          {HEALTH_WORD[health]}
        </span>
        <CloseButton label={`Close ${name}`} onClose={onClose} />
      </header>
      <div className="tabs" role="tablist" aria-label={`${name} views`} onKeyDown={onTabKey}>
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${base}-body`}
            tabIndex={tab === t ? 0 : -1}
            className="tab"
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="dock-body" role="tabpanel" id={`${base}-body`} aria-labelledby={`${base}-tab-${tab}`} tabIndex={0}>
        {tab === 'Graphs' && <Graphs c={c} node={node} />}
        {tab === 'Logs' && <Logs c={c} node={node} />}
        {tab === 'Changes' && <Changes node={node} />}
        {tab === 'Actions' && <Actions c={c} node={node} />}
      </div>
    </aside>
  );
}
