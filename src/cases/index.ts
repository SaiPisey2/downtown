import { parseCase } from './load';
import type { CaseFile } from './schema';
import tutorialYaml from './tutorial.yaml?raw';
import edgeRuleYaml from './edge-rule.yaml?raw';

export { CaseError, parseCase } from './load';
export { answerFor } from './answer';
export { STAKEHOLDER_LINES } from './schema';
export type { CaseFile } from './schema';

/** Parses every case file and indexes it by id; two files with one id is an error. */
export function buildCases(sources: Record<string, string>): Record<string, CaseFile> {
  const out: Record<string, CaseFile> = {};
  const from: Record<string, string> = {};
  for (const [path, text] of Object.entries(sources)) {
    const c = parseCase(text, path);
    if (Object.hasOwn(out, c.id)) throw new Error(`duplicate case id "${c.id}" in ${from[c.id]} and ${path}`);
    out[c.id] = c;
    from[c.id] = path;
  }
  return out;
}

export const cases: Record<string, CaseFile> = buildCases({
  'tutorial.yaml': tutorialYaml,
  'edge-rule.yaml': edgeRuleYaml,
});
