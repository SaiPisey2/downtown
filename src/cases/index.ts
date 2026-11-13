import { parseCase } from './load';
import type { CaseFile } from './schema';
import tutorialYaml from './tutorial.yaml?raw';

export { CaseError, parseCase } from './load';
export type { CaseFile } from './schema';

const sources: Record<string, string> = {
  'tutorial.yaml': tutorialYaml,
};

export const cases: Record<string, CaseFile> = Object.fromEntries(
  Object.entries(sources).map(([path, text]) => {
    const c = parseCase(text, path);
    return [c.id, c];
  }),
);
