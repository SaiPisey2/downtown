import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CaseFile } from '../../cases';
import { MAX_LINK, encodeRun } from '../../game/share';
import { faultTick } from '../../game/timeline';
import { HINT_COST } from '../../sim';
import type { PlayerInput, Score } from '../../sim';
import { duration } from '../metrics';

export const CARD_W = 1200;
export const CARD_H = 630;

/** The five parts of a score: what each is worth and what it means in plain words. */
export const SCORE_PARTS = [
  { key: 'detect', name: 'Detection', max: 15, says: 'How quickly you found the first key clue' },
  { key: 'recover', name: 'Recovery', max: 35, says: 'How quickly traffic recovered' },
  { key: 'traffic', name: 'Traffic saved', max: 25, says: 'How much customer traffic you saved' },
  { key: 'harm', name: 'No harm done', max: 15, says: 'Avoiding moves that made things worse' },
  { key: 'updates', name: 'Updates', max: 10, says: 'Keeping the boss informed, honestly' },
] as const satisfies readonly { key: keyof Score; name: string; max: number; says: string }[];

/** What is taken off the five parts, in plain words: the fast fix that left a risk open, and hints. Empty when nothing is. */
export function deductions(s: Score): { name: string; points: number; says?: string }[] {
  const out: { name: string; points: number; says?: string }[] = [];
  if (s.shortcut < 0) {
    out.push({ name: 'Fast fix left a risk open', points: s.shortcut, says: 'The city came back, but what caused the trouble is still in place' });
  }
  if (s.hints > 0) out.push({ name: `${s.hints} hint${s.hints === 1 ? '' : 's'} used`, points: -HINT_COST * s.hints });
  return out;
}

/** A signed whole number with a real minus sign: "−8", "+3", "0". */
export const signed = (n: number): string => (n < 0 ? `−${-n}` : n > 0 ? `+${n}` : '0');

/** The colour of a part's bar: teal when most of it was earned, amber for some, red for little. */
export function partLevel(points: number, max: number): 'ok' | 'warn' | 'bad' {
  const share = max > 0 ? points / max : 0;
  return share >= 2 / 3 ? 'ok' : share >= 1 / 3 ? 'warn' : 'bad';
}

const C = {
  bgTop: '#1a2950',
  bgMid: '#0d1630',
  bgEnd: '#060a18',
  panel: 'rgba(12, 20, 40, 0.94)',
  line: 'rgba(150, 178, 230, 0.22)',
  track: 'rgba(150, 178, 230, 0.16)',
  text: '#eaf0fa',
  dim: '#b0bdd6',
  faint: '#8d9bb6',
  teal: '#5eead4',
  amber: '#fbc35e',
  red: '#ff8585',
  blue: '#9db4ff',
  ok: '#5eead4',
  warn: '#fbc35e',
  bad: '#ff8585',
} as const;

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

/** One line of the time it took, for the card and the debrief. */
export function timeLine(c: CaseFile, s: Score): string {
  if (s.outcome === 'won') return `Recovered ${duration(Math.max(0, s.ticks - faultTick(c)))} after the trouble began`;
  return `The city went down after ${duration(s.ticks)}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Splits text into lines no wider than `width`, at most `max` lines, the last one cut with an ellipsis. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1]!;
  while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
  kept[max - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** A row of quiet towers with a few lit windows along the bottom; the same every time. */
function skyline(ctx: CanvasRenderingContext2D): void {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let x = -10;
  while (x < CARD_W) {
    const w = 38 + rnd() * 54;
    const h = 40 + rnd() * 120;
    const top = CARD_H - h;
    ctx.fillStyle = 'rgba(28, 40, 72, 0.75)';
    ctx.fillRect(x, top, w - 6, h);
    for (let wy = top + 12; wy < CARD_H - 10; wy += 14) {
      for (let wx = x + 7; wx < x + w - 14; wx += 11) {
        const r = rnd();
        if (r > 0.82) {
          ctx.fillStyle = r > 0.97 ? 'rgba(94, 234, 212, 0.55)' : 'rgba(255, 196, 107, 0.45)';
          ctx.fillRect(wx, wy, 4, 6);
        }
      }
    }
    x += w;
  }
  const fade = ctx.createLinearGradient(0, CARD_H - 170, 0, CARD_H);
  fade.addColorStop(0, 'rgba(6, 10, 24, 0)');
  fade.addColorStop(1, 'rgba(6, 10, 24, 0.55)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, CARD_H - 170, CARD_W, 170);
}

/** The game's mark: three little towers in the play screen's colours. */
function mark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const u = size / 100;
  const bars: [number, number, number, string][] = [
    [0, 45, 22, '#ffc46b'],
    [39, 0, 22, C.teal],
    [78, 52, 22, C.blue],
  ];
  for (const [bx, by, bw, col] of bars) {
    ctx.fillStyle = col;
    ctx.fillRect(x + bx * u, y + by * u, bw * u, (100 - by) * u);
  }
}

/**
 * The result card, 1200 × 630, in the game's palette with system fonts only:
 * the game's name, the case, the outcome, the score, the time it took and the
 * five parts of the score as bars.
 */
export function drawCard(canvas: HTMLCanvasElement, c: CaseFile, s: Score): void {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const bg = ctx.createRadialGradient(600, 160, 40, 600, 260, 820);
  bg.addColorStop(0, C.bgTop);
  bg.addColorStop(0.55, C.bgMid);
  bg.addColorStop(1, C.bgEnd);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  skyline(ctx);

  const won = s.outcome === 'won';
  const left = 72;
  ctx.textBaseline = 'alphabetic';

  // the name
  mark(ctx, left, 62, 34);
  ctx.fillStyle = C.text;
  ctx.font = `700 24px ${FONT}`;
  ctx.letterSpacing = '6px';
  ctx.fillText('DOWNTOWN', left + 50, 92);
  ctx.letterSpacing = '0px';

  // the case
  ctx.font = `700 46px ${FONT}`;
  ctx.fillStyle = C.text;
  const title = wrap(ctx, c.title, 560, 2);
  title.forEach((l, i) => ctx.fillText(l, left, 172 + i * 54));
  let y = 172 + (title.length - 1) * 54 + 52;

  // the outcome
  const word = won ? 'RECOVERED' : 'LOST';
  ctx.font = `700 18px ${FONT}`;
  ctx.letterSpacing = '3px';
  const chipW = ctx.measureText(word).width + 52;
  roundRect(ctx, left, y, chipW, 38, 19);
  ctx.fillStyle = won ? 'rgba(94, 234, 212, 0.14)' : 'rgba(255, 110, 110, 0.16)';
  ctx.fill();
  ctx.strokeStyle = won ? 'rgba(94, 234, 212, 0.55)' : 'rgba(255, 133, 133, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(left + 20, y + 19, 5, 0, Math.PI * 2);
  ctx.fillStyle = won ? C.teal : C.red;
  ctx.fill();
  ctx.fillText(word, left + 34, y + 26);
  ctx.letterSpacing = '0px';

  // the score
  y += 38 + 150;
  ctx.font = `800 150px ${FONT}`;
  ctx.fillStyle = C.text;
  const total = String(s.total);
  ctx.fillText(total, left - 6, y);
  const tw = ctx.measureText(total).width;
  ctx.font = `600 36px ${FONT}`;
  ctx.fillStyle = C.faint;
  ctx.fillText('/ 100', left + tw + 4, y);
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = C.dim;
  ctx.fillText(timeLine(c, s), left, y + 44);
  // what came off the five parts, so they visibly add up to the total
  const off = deductions(s);
  if (off.length > 0) {
    ctx.fillStyle = C.faint;
    ctx.font = `500 18px ${FONT}`;
    ctx.fillText(off.map((d) => `${d.name}: ${signed(d.points)}`).join('  ·  '), left, y + 74);
  }

  // the parts
  const px = 700;
  const pw = 428;
  const py = 70;
  const ph = 470;
  roundRect(ctx, px, py, pw, ph, 18);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = `700 15px ${FONT}`;
  ctx.letterSpacing = '2.5px';
  ctx.fillStyle = C.faint;
  ctx.fillText('THE SCORE IN FIVE PARTS', px + 32, py + 48);
  ctx.letterSpacing = '0px';
  SCORE_PARTS.forEach((p, i) => {
    const ry = py + 104 + i * 76;
    const pts = s[p.key];
    ctx.font = `600 22px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(p.name, px + 32, ry);
    ctx.font = `600 22px ${FONT}`;
    const right = `${pts} / ${p.max}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(right, px + pw - 32 - ctx.measureText(right).width, ry);
    roundRect(ctx, px + 32, ry + 14, pw - 64, 10, 5);
    ctx.fillStyle = C.track;
    ctx.fill();
    const share = Math.min(1, Math.max(0, pts / p.max));
    if (share > 0) {
      roundRect(ctx, px + 32, ry + 14, Math.max(10, (pw - 64) * share), 10, 5);
      ctx.fillStyle = C[partLevel(pts, p.max)];
      ctx.fill();
    }
  });

}

/** The share link for a run: this page with the run in the fragment. Origin and path only: no query string (such as a test switch) is passed on. */
export function shareUrl(data: string): string {
  return `${location.origin}${location.pathname}#r=${data}`;
}

/**
 * The result card with its buttons: copy a link that replays the run, save
 * the card as an image, and the ways on. A run too long for a link says so
 * rather than being cut.
 */
export function ResultCard({ c, score, seed, inputs, children }: {
  c: CaseFile;
  score: Score;
  seed: number;
  inputs: readonly PlayerInput[];
  /** the buttons that lead on (play again, back to title) */
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'manual'>('idle');
  const fieldId = useId();
  const data = encodeRun(c.id, c.version, seed, inputs);
  const fits = data.length <= MAX_LINK;
  const url = fits ? shareUrl(data) : '';

  useEffect(() => {
    if (canvas.current) drawCard(canvas.current, c, score);
  }, [c, score]);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      setCopied('copied');
    } catch {
      setCopied('manual');
    }
  };

  const save = () => {
    const el = canvas.current;
    if (!el) return;
    el.toBlob((blob) => {
      if (!blob) return;
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `downtown-${c.id}-${score.total}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    }, 'image/png');
  };

  return (
    <section className="card-block" aria-labelledby={`${fieldId}-h`}>
      <h2 id={`${fieldId}-h`} className="section-title">
        Your result card
      </h2>
      <canvas
        ref={canvas}
        className="card-canvas"
        width={CARD_W}
        height={CARD_H}
        role="img"
        aria-label={`Result card: ${c.title}, ${score.outcome === 'won' ? 'recovered' : 'lost'}, ${score.total} points out of 100.`}
      />
      <div className="card-buttons">
        {fits ? (
          <button type="button" className="btn btn-primary" onClick={copy}>
            Copy link
          </button>
        ) : (
          <p className="card-note">This run is too long to share as a link.</p>
        )}
        <button type="button" className="btn" onClick={save}>
          Save image
        </button>
        {children}
      </div>
      <p className="card-status" role="status">
        {copied === 'copied' ? 'Link copied. Anyone who opens it watches this run replayed.' : ''}
      </p>
      {copied === 'manual' && (
        <div className="field card-manual">
          <label htmlFor={fieldId}>Copying is not allowed here. Select the link and copy it yourself:</label>
          <input id={fieldId} type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} autoFocus />
        </div>
      )}
    </section>
  );
}
