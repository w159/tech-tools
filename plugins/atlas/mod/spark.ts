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
