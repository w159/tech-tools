// spark.ts: two fixed-width shape primitives, both pure and exactly as wide as asked (Bun.stringWidth equals the requested width).
//
// API
//   SPARK_RAMP   `⣀⣄⣤⣦⣶⣷⣿`, seven braille levels, lowest (a flat baseline) first
//   spark(series, width, { max?, ascii? })   one cell per sample, the newest `width` samples kept, a shorter series padded on the LEFT with the baseline.
//                                            0 draws the baseline; any positive sample draws at least level 2; `max` defaults to the series' own maximum.
//                                            ascii: `_.-:=+#` instead of braille. An all-zero or empty series is a flat baseline.
//   GAUGE_STEPS  `▏▎▍▌▋▊▉█`, the eight sub-cell steps (1/8 to 8/8 of a cell)
//   gauge(pct, width, ascii?)       inner bar of exactly `width` cells: full blocks, one partial block, then `░` track. pct clamps to 0..100; a positive
//                                   reading never rounds to empty (shows `▏`). ascii: `#` full, `=` partial, `.` track.
//   gaugeFramed(pct, width, ascii?) `▕` + gauge + `▏` (width + 2 cells); ascii `[` ... `]`
// Round 2 (D5, D6):
//   SPARK_MIN_SCALE, sparkOf(series, width, { ascii? })   spark on the event scale max(4, the WHOLE series' max): one event is a low cell, four fill it, and every width (band 8, panel 20, card 28) is the last N cells of one series
//   sparkRuns(series, width, ui, { newest? })   sparkOf as runs in the data-ink ramp (atlas-ui dataInk): baseline cells dim, the rest blue-grey, the newest highest cell one step brighter; `newest` (a style) replaces the last cell's run (returned last)
//   ctxTone(pct)   `ok` under 50, `warn` 50 to 80, `bad` over 80
//   gaugeRuns(pct, width, ui)   the framed gauge as runs: fill in ctxTone's colour, track in the dark track ink; an unmeasured gauge is all track
import { dataInk, type Run, type Tone, type Ui } from './atlas-ui';

export const SPARK_RAMP = '⣀⣄⣤⣦⣶⣷⣿';
export const GAUGE_STEPS = '▏▎▍▌▋▊▉█';
const SPARK_ASCII = '_.-:=+#';
const TRACK = '░';

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

export function spark(series: readonly number[], width: number, opts: { max?: number; ascii?: boolean } = {}): string {
  const ramp = [...(opts.ascii ? SPARK_ASCII : SPARK_RAMP)];
  const w = Math.max(0, Math.floor(width));
  const vals = series.slice(-w || undefined).map((v) => Math.max(0, num(v)));
  const kept = w === 0 ? [] : vals;
  const max = opts.max !== undefined ? num(opts.max) : Math.max(0, ...kept);
  const top = ramp.length - 1;
  const cells = kept.map((v) => {
    if (v <= 0 || max <= 0) return ramp[0]!;
    return ramp[Math.min(top, Math.max(1, Math.round((v / max) * top)))]!;
  });
  return ramp[0]!.repeat(Math.max(0, w - cells.length)) + cells.join('');
}

export function gauge(pct: number, width: number, ascii = false): string {
  const w = Math.max(0, Math.floor(width));
  const p = Math.min(100, Math.max(0, num(pct)));
  let eighths = Math.round((p / 100) * w * 8);
  if (p > 0 && eighths === 0) eighths = 1;
  const full = Math.floor(eighths / 8);
  const part = eighths % 8;
  const steps = [...GAUGE_STEPS];
  const fullCh = ascii ? '#' : '█';
  const partCh = ascii ? '=' : steps[part - 1]!;
  const track = ascii ? '.' : TRACK;
  return fullCh.repeat(full) + (part > 0 && full < w ? partCh : '') + track.repeat(Math.max(0, w - full - (part > 0 ? 1 : 0)));
}

export function gaugeFramed(pct: number, width: number, ascii = false): string {
  return (ascii ? '[' : '▕') + gauge(pct, width, ascii) + (ascii ? ']' : '▏');
}

/** The event scale's floor: a bucket holds up to this many events before the spark reaches full height. */
export const SPARK_MIN_SCALE = 4;

export function sparkOf(series: readonly number[], width: number, opts: { ascii?: boolean } = {}): string {
  const all = series.map((v) => Math.max(0, num(v)));
  return spark(series, width, { max: Math.max(SPARK_MIN_SCALE, ...all), ...(opts.ascii ? { ascii: true } : {}) });
}

export function sparkRuns(series: readonly number[], width: number, ui: Pick<Ui, 'theme' | 'ascii'>, o: { newest?: Partial<Run> } = {}): Run[] {
  const ink = dataInk(ui);
  const cells = [...sparkOf(series, width, { ascii: ui.ascii })];
  const w = cells.length;
  const vals = [...new Array<number>(Math.max(0, w - series.length)).fill(0), ...series.slice(-w || undefined)].map((v) => Math.max(0, num(v)));
  const top = Math.max(0, ...vals);
  const peak = top > 0 ? vals.lastIndexOf(top) : -1;
  const cls = (i: number): string => (vals[i]! <= 0 ? 'base' : i === peak ? 'peak' : 'body');
  const out: Run[] = [];
  const last = o.newest ? cells.length - 1 : -1;
  for (let i = 0; i < cells.length; i++) {
    if (i === last) { out.push({ t: cells[i]!, tone: 'text', ...o.newest } as Run); continue; }
    const c = cls(i);
    const prev = out.at(-1);
    const style: Partial<Run> = c === 'base' ? { tone: 'dim' } : { tone: 'sub', fg: c === 'peak' ? ink.peak : ink.body };
    if (prev && prev.tone === style.tone && prev.fg === style.fg && !(o.newest && i === last)) prev.t += cells[i]!;
    else out.push({ t: cells[i]!, tone: 'text', ...style } as Run);
  }
  return out;
}

export const ctxTone = (pct: number): Tone => (pct > 80 ? 'bad' : pct >= 50 ? 'warn' : 'ok');

export function gaugeRuns(pct: number | undefined, width: number, ui: Pick<Ui, 'theme' | 'ascii'>): Run[] {
  const ink = dataInk(ui);
  const g = gauge(pct === undefined ? 0 : pct, width, ui.ascii);
  const trackCh = ui.ascii ? '.' : TRACK;
  const at = g.indexOf(trackCh);
  const fill = at < 0 ? g : g.slice(0, at);
  const track = at < 0 ? '' : g.slice(at);
  return [
    { t: ui.ascii ? '[' : '▕', tone: 'dim' },
    ...(fill ? [{ t: fill, tone: ctxTone(pct ?? 0) } as Run] : []),
    ...(track ? [{ t: track, tone: 'line', fg: ink.track } as Run] : []),
    { t: ui.ascii ? ']' : '▏', tone: 'dim' },
  ];
}
