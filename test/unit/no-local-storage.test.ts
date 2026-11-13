import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../../src', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('storage', () => {
  it('nothing under src/ mentions localStorage: a key must never outlive the tab', () => {
    const all = files(SRC);
    expect(all.length).toBeGreaterThan(20);
    const hits = all.filter((f) => readFileSync(f, 'utf8').includes('localStorage'));
    expect(hits).toEqual([]);
  });
});
