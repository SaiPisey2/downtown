import { z } from 'zod';
import type { CaseFile } from '../cases';
import type { PlayerInput } from '../sim';

/** A run as a share link carries it: the case, its version, the seed and every input as a compact tuple. */
export interface SharedRun {
  v: 1;
  /** case id */
  c: string;
  /** case version */
  cv: number;
  /** seed */
  s: number;
  i: [number, 'a' | 'o' | 'u' | 'h', string?][];
}

export type DecodeResult =
  | { ok: true; run: SharedRun }
  | { ok: false; reason: 'malformed' | 'too_long' | 'unknown_case' | 'old_version' };

/** Longest link data accepted, in characters. */
export const MAX_LINK = 16_000;
/** Most inputs a shared run may hold. */
export const MAX_INPUTS = 2_000;
/** Longest id, route or case id inside a shared run. */
const MAX_STR = 80;

const tick = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const str = z.string().max(MAX_STR);
const input = z.union([z.tuple([tick, z.enum(['a', 'o', 'u']), str]), z.tuple([tick, z.literal('h')])]);

const sharedRun = z.strictObject({
  v: z.literal(1),
  c: str,
  cv: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  s: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  i: z
    .array(input)
    .max(MAX_INPUTS)
    .refine((xs) => xs.every((x, n) => n === 0 || x[0] >= xs[n - 1]![0]), 'inputs out of order'),
});

const CODE = { act: 'a', observe: 'o', update: 'u', hint: 'h' } as const;

function toTuple(p: PlayerInput): SharedRun['i'][number] {
  switch (p.kind) {
    case 'act': return [p.tick, 'a', p.id];
    case 'observe': return [p.tick, 'o', p.route];
    case 'update': return [p.tick, 'u', p.id];
    case 'hint': return [p.tick, CODE.hint];
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The text inside base64url data, or null when it is not valid base64url of UTF-8. */
function fromBase64Url(data: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(data) || data.length % 4 === 1) return null;
  try {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * The link data for a run: base64url of compact JSON. Only the case, its
 * version, the seed and the inputs go in; nothing else about the player or
 * their settings.
 */
export function encodeRun(caseId: string, caseVersion: number, seed: number, inputs: readonly PlayerInput[]): string {
  const run: SharedRun = { v: 1, c: caseId, cv: caseVersion, s: seed, i: inputs.map(toTuple) };
  return toBase64Url(JSON.stringify(run));
}

/** Link data checked strictly for shape and size, before any case is looked at; null when it is not a shared run. */
function parse(fragment: string): SharedRun | 'too_long' | null {
  if (typeof fragment !== 'string') return null;
  if (fragment.length > MAX_LINK) return 'too_long';
  const text = fromBase64Url(fragment);
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = sharedRun.safeParse(raw);
  return parsed.success ? (parsed.data as SharedRun) : null;
}

/** Reads link data, checking every part strictly before anything else sees it. Never throws. */
export function decodeRun(fragment: string, cases: Record<string, CaseFile>): DecodeResult {
  const run = parse(fragment);
  if (run === 'too_long') return { ok: false, reason: 'too_long' };
  if (run === null) return { ok: false, reason: 'malformed' };
  const c = Object.hasOwn(cases, run.c) ? cases[run.c] : undefined;
  // a version newer than ours is a case this version of the game does not have
  if (!c || run.cv > c.version) return { ok: false, reason: 'unknown_case' };
  if (run.cv < c.version) return { ok: false, reason: 'old_version' };
  return { ok: true, run };
}

/** The case a well-formed link is for, whether or not this version can replay it; null for bad data. */
export function sharedCaseId(fragment: string): string | null {
  const run = parse(fragment);
  return run && run !== 'too_long' ? run.c : null;
}

/** The recorded inputs of a decoded run, in order. */
export function sharedInputs(run: SharedRun): PlayerInput[] {
  return run.i.map(([t, k, s = '']) => {
    switch (k) {
      case 'a': return { tick: t, kind: 'act', id: s };
      case 'o': return { tick: t, kind: 'observe', route: s };
      case 'u': return { tick: t, kind: 'update', id: s };
      case 'h': return { tick: t, kind: 'hint' };
    }
  });
}
