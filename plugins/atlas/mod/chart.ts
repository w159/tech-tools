// chart.ts: round 3 chart primitives, all pure and exactly as wide as asked (Bun.stringWidth equals the requested width).
//
// API
//   areaChart(series, { width, rows, max?, ascii? }) -> { lines, max }
//       a braille area chart: 2 samples per cell column (left and right dot column), 4 dot rows per cell row, filled from the baseline up to each value, scaled to
//       max(CHART_MIN_SCALE, the series' max) unless `max` is given, right-aligned (the newest sample is the last cell's right dot column, a shorter series is padded on the LEFT with zeros).
//       A zero sample draws a baseline dot row on the bottom cell row only (`⣀`), so an empty chart is a flat rule and a space is only ever a cell above the fill.
//       ascii: `_` baseline then `.:|#` for 1..4 dots of the cell's tallest column, blank above the fill.
//   areaChartRuns(series, { width, rows, max?, ascii? }, ui) -> { rows: Run[][], max }   the same cells as runs: body in the data ink, the newest cell column in the peak ink, baseline cells dim
//   chartFrame(chart, { yMax, xLeft, xRight, width }) -> string[]   the y label column (`yMax` on the first row, `0` on the last, right-aligned) + the chart rows + one x-axis row
//       (`xLeft` under the first chart cell, `xRight` ending on the last); every row is exactly `width` cells (a wider `width` pads on the right); xLeft drops when both labels do not fit
//   blockSpark(series, width, { ascii?, min? }) -> string   eighth blocks `▁▂▃▄▅▆▇█`, the event scale max(min = 4, max); a zero sample is the `▁` baseline, a positive one is at least `▂`
//   blockSparkRuns(series, width, ui, { newest? }) -> Run[]   the blocks in the data ink (baseline dim, the highest newest cell one step brighter); `newest` (a style) replaces the last cell's run (returned last)
//   runBars(runs, width, ui?) -> Run[]   one eighth-block cell per run, newest right, height scaled to the longest run, `ok` green and failed `bad`; the left is the dim `▁` track
//   runsSummary(runs, ascii?) -> `2 runs · avg 0:07 · 1 fail` (no fail part at 0), `no runs yet` when empty
import { dataInk, type Run, type Ui } from './atlas-ui';

export const CHART_MIN_SCALE = 4;
export const BLOCKS = '▁▂▃▄▅▆▇█';
const BLOCKS_ASCII = '_.,-:=+#';
const LEFT_BITS = [0x01, 0x02, 0x04, 0x40]; // dot rows top to bottom, left dot column
const RIGHT_BITS = [0x08, 0x10, 0x20, 0x80];
const AREA_ASCII = '.:|#';
const BRAILLE = 0x2800;

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const wholeW = (n: number): number => Math.max(0, Math.floor(num(n)));

export type ChartOpts = { width: number; rows: number; max?: number; ascii?: boolean };
export type Chart = { lines: string[]; max: number };
type Cell = { ch: string; base: boolean; col: number };

/** The samples as dot heights (0..rows*4), one per half column, right-aligned. */
function heights(series: readonly number[], w: number, rows: number, max: number): number[] {
  const slots = w * 2;
  const vals = series.slice(-slots || undefined).map((v) => Math.max(0, num(v)));
  const padded = [...new Array<number>(Math.max(0, slots - vals.length)).fill(0), ...(slots === 0 ? [] : vals)];
  return padded.map((v) => (v <= 0 || max <= 0 ? 0 : Math.min(rows * 4, Math.max(1, Math.round((v / max) * rows * 4)))));
}

function grid(series: readonly number[], o: ChartOpts): { cells: Cell[][]; max: number } {
  const w = wholeW(o.width);
  const rows = Math.max(1, wholeW(o.rows));
  const max = o.max !== undefined ? Math.max(0, num(o.max)) : Math.max(CHART_MIN_SCALE, ...series.map((v) => Math.max(0, num(v))));
  const hs = heights(series, w, rows, max);
  const cells: Cell[][] = [];
  for (let cr = 0; cr < rows; cr++) {
    const row: Cell[] = [];
    for (let c = 0; c < w; c++) {
      const hl = hs[c * 2]!;
      const hr = hs[c * 2 + 1]!;
      let bits = 0;
      let filled = 0; // the tallest column's dots in this cell, for the ascii form
      for (let dy = 0; dy < 4; dy++) {
        const dot = (rows - 1 - cr) * 4 + (3 - dy); // 0 = the bottom dot row
        if (dot < hl) { bits |= LEFT_BITS[dy]!; }
        if (dot < hr) { bits |= RIGHT_BITS[dy]!; }
      }
      const inCell = (h: number): number => Math.max(0, Math.min(4, h - (rows - 1 - cr) * 4));
      filled = Math.max(inCell(hl), inCell(hr));
      const bottom = cr === rows - 1;
      const base = bottom && hl === 0 && hr === 0;
      if (base) row.push({ ch: o.ascii ? '_' : '⣀', base, col: c });
      else if (bits === 0) row.push({ ch: ' ', base: false, col: c });
      else row.push({ ch: o.ascii ? AREA_ASCII[filled - 1]! : String.fromCharCode(BRAILLE + bits), base: false, col: c });
    }
    cells.push(row);
  }
  return { cells, max };
}

export function areaChart(series: readonly number[], o: ChartOpts): Chart {
  const { cells, max } = grid(series, o);
  return { lines: cells.map((r) => r.map((c) => c.ch).join('')), max };
}

export function areaChartRuns(series: readonly number[], o: ChartOpts, ui: Pick<Ui, 'theme' | 'ascii'>): { rows: Run[][]; max: number } {
  const ink = dataInk(ui);
  const { cells, max } = grid(series, { ...o, ascii: o.ascii ?? ui.ascii });
  const last = wholeW(o.width) - 1;
  const rows = cells.map((r) => {
    const out: Run[] = [];
    for (const c of r) {
      const style: Partial<Run> = c.base || c.ch === ' ' ? { tone: 'dim' } : { tone: 'sub', fg: c.col === last ? ink.peak : ink.body };
      const prev = out.at(-1);
      if (prev && prev.tone === style.tone && prev.fg === style.fg) prev.t += c.ch;
      else out.push({ t: c.ch, tone: 'text', ...style } as Run);
    }
    return out;
  });
  return { rows, max };
}

export function chartFrame(chart: Chart, o: { yMax: string; xLeft: string; xRight: string; width: number }): string[] {
  const cw = chart.lines[0] ? [...chart.lines[0]].length : 0;
  const lw = Math.max([...o.yMax].length, 1) + 1; // the label column plus one gap cell
  const total = Math.max(lw + cw, wholeW(o.width));
  const fit = (s: string): string => s + ' '.repeat(Math.max(0, total - [...s].length));
  const n = chart.lines.length;
  const body = chart.lines.map((l, i) => {
    const label = i === 0 ? o.yMax : i === n - 1 ? '0' : '';
    return fit(label.padStart(lw - 1) + ' ' + l);
  });
  const left = [...o.xLeft].length + 1 + [...o.xRight].length <= cw ? o.xLeft : '';
  const gap = Math.max(0, cw - [...left].length - [...o.xRight].length);
  const axis = left + ' '.repeat(gap) + o.xRight;
  return [...body, fit(' '.repeat(lw) + [...axis].slice(0, cw).join(''))];
}

// ---- eighth blocks --------------------------------------------------------------------------------------------------

const levelOf = (v: number, max: number): number => (v <= 0 || max <= 0 ? 0 : Math.min(7, Math.max(1, Math.round((v / max) * 7))));

export function blockSpark(series: readonly number[], width: number, o: { ascii?: boolean; /** The scale's floor (default CHART_MIN_SCALE): the band's spark uses 7 so one event reads `▂`, not `▃`. */ min?: number } = {}): string {
  const ramp = [...(o.ascii ? BLOCKS_ASCII : BLOCKS)];
  const w = wholeW(width);
  const max = Math.max(o.min ?? CHART_MIN_SCALE, ...series.map((v) => Math.max(0, num(v))));
  const vals = w === 0 ? [] : series.slice(-w).map((v) => Math.max(0, num(v)));
  return ramp[0]!.repeat(Math.max(0, w - vals.length)) + vals.map((v) => ramp[levelOf(v, max)]!).join('');
}

export function blockSparkRuns(series: readonly number[], width: number, ui: Pick<Ui, 'theme' | 'ascii'>, o: { newest?: Partial<Run> } = {}): Run[] {
  const ink = dataInk(ui);
  const cells = [...blockSpark(series, width, { ascii: ui.ascii })];
  const vals = [...new Array<number>(Math.max(0, cells.length - series.length)).fill(0), ...series.slice(-cells.length || undefined)].map((v) => Math.max(0, num(v)));
  const top = Math.max(0, ...vals);
  const peak = top > 0 ? vals.lastIndexOf(top) : -1;
  const out: Run[] = [];
  cells.forEach((ch, i) => {
    if (o.newest && i === cells.length - 1) { out.push({ t: ch, tone: 'text', ...o.newest } as Run); return; } // the newest cell wears `newest` (the idle breathing hex), as its own run, last
    const style: Partial<Run> = vals[i]! <= 0 ? { tone: 'dim' } : { tone: 'sub', fg: i === peak ? ink.peak : ink.body };
    const prev = out.at(-1);
    if (prev && prev.tone === style.tone && prev.fg === style.fg) prev.t += ch;
    else out.push({ t: ch, tone: 'text', ...style } as Run);
  });
  return out;
}

// ---- runs -----------------------------------------------------------------------------------------------------------

export type RunBar = { secs: number; ok: boolean };

export function runBars(runs: readonly RunBar[], width: number, ui: Pick<Ui, 'ascii'> = { ascii: false }): Run[] {
  const ramp = [...(ui.ascii ? BLOCKS_ASCII : BLOCKS)];
  const w = wholeW(width);
  const kept = w === 0 ? [] : runs.slice(-w);
  const longest = Math.max(0, ...kept.map((r) => Math.max(0, num(r.secs))));
  const out: Run[] = [];
  const push = (ch: string, tone: Run['tone']): void => {
    const prev = out.at(-1);
    if (prev && prev.tone === tone) prev.t += ch;
    else out.push({ t: ch, tone });
  };
  for (let i = 0; i < w - kept.length; i++) push(ramp[0]!, 'dim');
  for (const r of kept) push(ramp[levelOf(Math.max(0, num(r.secs)), longest)]!, r.ok ? 'ok' : 'bad');
  return out;
}

const clock = (secs: number): string => `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;

export function runsSummary(runs: readonly RunBar[], ascii = false): string {
  if (runs.length === 0) return 'no runs yet';
  const avg = Math.round(runs.reduce((n, r) => n + Math.max(0, num(r.secs)), 0) / runs.length);
  const fail = runs.filter((r) => !r.ok).length;
  const dot = ascii ? ' - ' : ' · ';
  return [`${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`, `avg ${clock(avg)}`, ...(fail > 0 ? [`${fail} fail`] : [])].join(dot);
}
