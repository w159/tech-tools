// rows.ts: the band's row motion (redesign, SPEC "Motion"), pure over the one motion model (motion.ts): a frame is a function of the clock reading and a row's Entry,
// never a timer of its own. With no MotionCtx (the resting render the goldens use), with colour off, or past a window, every function here returns what it was given.
//
//   enter    a row that appears is drawn at the faint tone, then the secondary tone, then at rest: three frames of ENTER_FRAME_MS
//   finish   a row that turned done flashes on a green-tinted fill with its dim text lifted, then a lighter tint, then it is the resting (dim) row
//   sweep    a running row's label carries a SWEEP_W-cell bright window that crosses it once per SWEEP_MS
//   breath   the running cell of the progress bar eases between the accent and the dim tone
import { easedMs, MOTION_STEP_MS, animateRow, isCalm, mixHex, REVEAL_MS, type Entry, type MotionCtx } from './motion';
import { PALETTE5, PALETTES, surfaceHex, toneHex, type MarkState, type Run, type Ui } from '../design/atlas-ui';

/** One frame of the enter ramp: a third of the reveal window. */
const ENTER_FRAME_MS = Math.floor(REVEAL_MS / 3);
/** The sweep crosses a label once per second and is this many cells wide. */
const SWEEP_MS = 1000;
const SWEEP_W = 6;
/** The breath of the running progress cell: one full cycle. */
const BREATH_MS = 1600;
/** Beats of a finished row before it rests: the strong green tint, the light one, then the settle (no fill, the text one step above its dim rest) held for the last two beats of the 800 ms window; the row after it is the resting one. */
const FLASH_FRAMES = 4;

/** The enter frame of a row born at `e.born`: 0 faint, 1 sub; 2 when the row is at full tone (the resting render). */
function enterFrame(e: Entry | undefined, now: number): number {
  if (!e || e.changed !== e.born) return 2; // a row whose state moved later is not entering
  const age = now - e.born;
  return age < 0 ? 2 : Math.min(2, Math.floor(age / ENTER_FRAME_MS));
}

/** The flash frame (0..3) of a row that turned done inside its window, else -1. A row first seen done, or born done, is at rest. */
export function flashFrame(e: Entry | undefined, now: number): number {
  if (!e || e.state !== 'done' || e.changed <= e.born || now < e.changed) return -1;
  const beat = Math.floor(easedMs(e, now) / MOTION_STEP_MS);
  return beat < FLASH_FRAMES ? beat : -1;
}

/** The sweep's window over a label of `len` cells at clock `now`: [start, end) clipped to the label, or null when it is off the label this frame. */
function sweepWindow(now: number, len: number): { start: number; end: number } | null {
  if (len <= 0) return null;
  const span = len + SWEEP_W;
  const start = Math.floor(((((now % SWEEP_MS) + SWEEP_MS) % SWEEP_MS) / SWEEP_MS) * span) - SWEEP_W;
  const lo = Math.max(0, start);
  const hi = Math.min(len, start + SWEEP_W);
  return hi > lo ? { start: lo, end: hi } : null;
}

/** `0..1`: the breath of the running cell at `now`. */
const breath = (now: number): number => (1 + Math.sin((2 * Math.PI * (((now % BREATH_MS) + BREATH_MS) % BREATH_MS)) / BREATH_MS - Math.PI / 2)) / 2;

/** The row in the enter ramp: every run but the two border cells (first and last) at the faint tone (frame 0) or the secondary tone (frame 1). */
function enterRow(runs: Run[], frame: number, ui: Ui): Run[] {
  const hex = frame === 0 ? toneHex('dim', ui.theme) : toneHex('sub', ui.theme);
  return runs.map((r, i) => (i === 0 || i === runs.length - 1 || r.t.trim() === '' ? r : { ...r, fg: hex }));
}

/** The row on the done flash: every run on a green-tinted fill (strong, then light, then none), the muted text lifted to body text, then to the secondary tone, the green marks bold on the first frame.
 * A cell the row builder marked calm (the owner and the clock never change with the state) keeps its tone; it takes the fill only. */
function flashRow(runs: Run[], frame: number, ui: Ui): Run[] {
  const bgHex = frame >= 2 ? undefined : mixHex(surfaceHex('panel', ui), PALETTES[ui.theme].ok, frame === 0 ? 0.2 : 0.09);
  return runs.map((r) => {
    const { fg: _fg, ...rest } = r;
    const lifted: Run = r.tone === 'muted' && r.t.trim() !== '' && !isCalm(r) ? { ...rest, tone: frame === 0 ? 'text' : 'sub' } : r;
    return { ...lifted, ...(bgHex ? { bgHex } : {}), ...(frame === 0 && r.tone === 'ok' ? { bold: true } : {}) };
  });
}

/** A band row (already framed, first and last runs the borders) as drawn at `ctx.now`: the enter ramp, the done flash, else the shared state-change ease (motion.ts animateRow without its reveal or pop). Same reference at rest. */
export function animateBandRow(runs: Run[], key: string, accent: MarkState, ctx: MotionCtx | undefined, ui: Ui): Run[] {
  if (!ctx || ui.color === 'none') return runs;
  const e = ctx.entry(key);
  if (!e) return runs;
  if (accent === 'done' && e.state === 'done') {
    const f = flashFrame(e, ctx.now);
    return f >= 0 ? flashRow(runs, f, ui) : runs;
  }
  if (e.changed === e.born) {
    const f = enterFrame(e, ctx.now);
    return f < 2 ? enterRow(runs, f, ui) : runs;
  }
  return animateRow(runs, key, accent, ctx, ui, { reveal: false, pop: false });
}

/** `text` split around the sweep window as runs of `base`: the bright window is the white tone, bold. One run (the input) when the sweep is off this frame. */
export function sweepRuns(text: string, base: Omit<Run, 't'>, now: number | undefined, ui: Ui): Run[] {
  const cells = [...text];
  const w = now === undefined || ui.color === 'none' ? null : sweepWindow(now, cells.join('').trimEnd().length);
  if (!w) return [{ ...base, t: text }];
  const out: Run[] = [];
  const part = (a: number, b: number, hit: boolean): void => {
    const t = cells.slice(a, b).join('');
    if (t !== '') out.push(hit ? { ...base, t, tone: 'white', bold: true } : { ...base, t });
  };
  part(0, w.start, false);
  part(w.start, w.end, true);
  part(w.end, cells.length, false);
  return out;
}

/** The fill colour of the running progress cell at `now`: the accent easing toward the dim tone and back. */
export const breathHex = (now: number, ui: Ui): string => mixHex(PALETTES[ui.theme].accent, ui.theme === 'latte' ? PALETTES.latte.muted : PALETTE5.dim, breath(now) * 0.75);
