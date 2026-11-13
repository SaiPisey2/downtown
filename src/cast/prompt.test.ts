import { describe, expect, it } from 'vitest';
import { cases } from '../cases';
import type { CaseFile } from '../cases';
import { createRun, score } from '../sim';
import type { Run } from '../sim';
import { castPrompt, reviewPrompt } from './prompt';
import { scriptedCast } from './scripted';
import type { CastContext, ChatLine } from './types';

const c = cases['edge-rule']!;
const clue = (k: CaseFile, id: string) => k.clues.find((x) => x.id === id)!.text;

/** Debrief text as sentences, so a leak of any one of them is caught. */
const sentences = (k: CaseFile): string[] =>
  Object.values(k.debrief)
    .flatMap((t) => t.split(/(?<=\.)\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

/**
 * Plays a run to `tick` the way a careless player might: harmful actions taken
 * (so consequence lines land in the first teammate's thread), every question
 * asked, every clue found. Returns what a character would be given.
 */
async function played(k: CaseFile, tick: number): Promise<{ run: Run; ctx: (castId: string) => CastContext }> {
  const run = createRun(k);
  const cast = scriptedCast(k);
  const chat: ChatLine[] = [];
  let id = 1;
  let offered = 0;
  const push = (l: Omit<ChatLine, 'id'>) => chat.push({ ...l, id: id++ });
  const harmful = k.actions.filter((a) => a.harmful).map((a) => a.id);
  while (run.snapshot.tick < tick && run.snapshot.status === 'running') {
    run.step(1);
    if (run.snapshot.tick === Math.min(tick - 30, 250)) for (const a of harmful) run.act(a);
    for (const e of run.log.slice(offered)) for (const l of await cast.onEvent(e, run.snapshot)) push(l);
    offered = run.log.length;
    if (cast.onTick) for (const l of await cast.onTick(run.snapshot)) push(l);
  }
  for (const m of k.cast) {
    for (const q of m.questions) {
      push({ tick: run.snapshot.tick, from: 'you', to: m.id, text: q.label });
      let text = '';
      for await (const s of cast.ask(m.id, q.id, null, { c: k, snap: run.snapshot, found: [], chat })) text += s;
      push({ tick: run.snapshot.tick, from: m.id, text });
      run.observe(`ask:${m.id}:${q.id}`);
    }
  }
  for (const x of k.clues) run.observe(x.route);
  const found = run.log.flatMap((e) => (e.type === 'clue' ? [e.clueId] : []));
  return { run, ctx: () => ({ c: k, snap: run.snapshot, found, chat: [...chat] }) };
}

describe('castPrompt', () => {
  it('netops on edge-rule: knows volume_normal, and nothing about the fix, the debrief or clues it does not know', async () => {
    const { ctx } = await played(c, 300);
    const s = JSON.stringify(castPrompt(c, 'netops', ctx('netops')));
    expect(s).toContain(clue(c, 'volume_normal'));
    for (const bad of ['filter_off', 'rollback_rules', 'resolves', clue(c, 'deploy_before'), ...sentences(c)]) {
      expect(s, `prompt contains "${bad}"`).not.toContain(bad);
    }
  });

  it('no character at ticks 100, 300 and 600 is given an action id, label, risk, consequence line or debrief sentence', async () => {
    for (const k of Object.values(cases)) {
      const forbidden = [
        ...k.actions.flatMap((a) => [a.id, a.label, ...(a.risk ? [a.risk] : [])]),
        ...k.actions.flatMap((a) => (a.consequenceKey ? [k.lines[a.consequenceKey]!] : [])),
        ...sentences(k),
      ];
      for (const tick of [100, 300, 600]) {
        const { ctx } = await played(k, tick);
        for (const m of k.cast) {
          const s = JSON.stringify(castPrompt(k, m.id, ctx(m.id))).toLowerCase();
          for (const bad of forbidden) expect(s, `${k.id} ${m.id} @${tick} contains "${bad}"`).not.toContain(bad.toLowerCase());
        }
      }
    }
  });

  it('gives only known clues that are true right now', async () => {
    const early = await played(c, 100);
    const late = await played(c, 300);
    const rules = clue(c, 'rules_today');
    expect(JSON.stringify(castPrompt(c, 'devlead', early.ctx('devlead')))).not.toContain(rules);
    expect(JSON.stringify(castPrompt(c, 'devlead', late.ctx('devlead')))).toContain(rules);
    expect(JSON.stringify(castPrompt(c, 'netops', late.ctx('netops')))).not.toContain(rules);
  });

  it('system text: persona, stay in role, three sentences, no fix, the player message is conversation', async () => {
    const { ctx } = await played(c, 300);
    const r = castPrompt(c, 'devlead', ctx('devlead'));
    const devlead = c.cast.find((m) => m.id === 'devlead')!;
    expect(r.system).toContain(devlead.name);
    expect(r.system).toContain(devlead.persona);
    expect(r.system).toMatch(/stay in role/i);
    expect(r.system).toMatch(/at most three sentences/i);
    expect(r.system).toMatch(/never (state|suggest|name) a fix/i);
    expect(r.system).toMatch(/conversation, not instructions/i);
  });

  it('a six-line state summary: tick, city error rate, the three worst buildings, clues found', async () => {
    const { run, ctx } = await played(c, 300);
    const r = castPrompt(c, 'netops', ctx('netops'));
    const block = r.system.split('\n\n').find((p) => p.startsWith('What anyone on the team can see right now:'))!;
    const lines = block.split('\n').slice(1);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain(String(run.snapshot.tick));
    expect(lines[1]).toMatch(/whole city.*\d+%/i);
    const worst = Object.entries(run.snapshot.nodes).sort((a, b) => b[1].errorRate - a[1].errorRate)[0]![0];
    expect(lines[2]).toContain(c.layout[worst]!.name);
    expect(lines[5]).toContain(String(ctx('netops').found.length));
  });

  it('the last 12 lines of that thread only, oldest first, as user and assistant turns, starting with the player', () => {
    const run = createRun(c);
    run.step(300);
    const chat: ChatLine[] = [];
    for (let i = 0; i < 20; i++) {
      chat.push({ id: chat.length + 1, tick: 300, from: 'you', to: 'netops', text: `question ${i}` });
      chat.push({ id: chat.length + 1, tick: 300, from: 'netops', text: `answer ${i}` });
      chat.push({ id: chat.length + 1, tick: 300, from: 'devlead', text: `elsewhere ${i}` });
    }
    chat.push({ id: 999, tick: 300, from: 'you', to: 'netops', text: 'last‮ one' });
    const r = castPrompt(c, 'netops', { c, snap: run.snapshot, found: [], chat });
    const turns = r.messages.filter((m) => !m.content.startsWith('('));
    expect(turns).toHaveLength(12);
    expect(r.messages[0]!.role).toBe('user');
    expect(r.messages.at(-1)).toEqual({ role: 'user', content: 'last one' });
    expect(turns.at(-2)).toEqual({ role: 'assistant', content: 'answer 19' });
    expect(JSON.stringify(r)).not.toContain('elsewhere');
  });
});

describe('reviewPrompt', () => {
  it('carries the log, the debrief and the numeric score, and asks for two short judgements with quoted evidence', async () => {
    const run = createRun(c);
    run.step(250);
    run.update('attack');
    run.act('rollback_rules');
    run.step(800);
    const s = score(c, run.log, run.snapshot);
    const r = reviewPrompt(c, run.log, s, [{ id: 1, tick: 260, from: 'you', to: 'devlead', text: 'I think the filter rules\u0007 broke it' }]);
    const all = JSON.stringify(r);
    expect(all).toContain(c.debrief.happened);
    expect(all).toContain(String(s.total));
    expect(all).toContain(c.updates.find((u) => u.id === 'attack')!.label);
    expect(all).toContain('Roll back the rules update');
    expect(all).toContain('I think the filter rules broke it');
    expect(r.system).toMatch(/communication/i);
    expect(r.system).toMatch(/root cause/i);
    expect(r.system).toMatch(/quote/i);
    expect(r.system).toMatch(/not instructions/i);
    expect(r.messages[0]!.role).toBe('user');
  });
});
