import { describe, expect, it } from 'vitest';
import { cases } from '../cases';
import { createRun } from '../sim';
import type { Snapshot } from '../sim';
import { logLines } from './logs';

const edgeRule = cases['edge-rule']!;

function at(tick: number): Snapshot {
  const run = createRun(edgeRule);
  run.step(tick);
  return run.snapshot;
}

/** The line without its leading `mm:ss ` timestamp. */
const body = (line: string) => line.replace(/^\d{2,}:\d{2} /, '');

describe('logLines', () => {
  it('returns no lines when no rule for the building holds', () => {
    // the gate only logs while the block is on, and nothing has blocked anything
    expect(logLines(edgeRule, 'gate', at(50), 1)).toEqual([]);
    // a building with no rules at all
    expect(logLines(edgeRule, 'web', at(50), 1)).toEqual([]);
  });

  it('gives the same lines for the same case, building, snapshot and seed', () => {
    const s = at(300);
    const a = logLines(edgeRule, 'edge', s, 1907);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(8);
    expect(logLines(edgeRule, 'edge', s, 1907)).toEqual(a);
  });

  it('only ever picks lines from rules that hold, each with a simulated timestamp', () => {
    const allowed = new Set(edgeRule.signals.logs.edge![0]!.lines);
    const run = createRun(edgeRule);
    run.step(260);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      run.step(1);
      const lines = logLines(edgeRule, 'edge', run.snapshot, 1907);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(8);
      for (const l of lines) {
        expect(l).toMatch(/^\d{2,}:\d{2} /);
        expect(allowed.has(body(l))).toBe(true);
      }
      seen.add(lines.map(body).join('\n'));
    }
    // over forty seconds the picks change
    expect(seen.size).toBeGreaterThan(1);
  });

  it('stamps the newest line with the current simulated time', () => {
    const lines = logLines(edgeRule, 'edge', at(300), 3);
    expect(lines.at(-1)!.startsWith('05:00 ')).toBe(true);
  });
});
