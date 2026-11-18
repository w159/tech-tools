// status-frame.ts: the side panel's status tab of the approved frame spec (critics/mock-final.md frames S1-S8), as runs. Pure: the panel hands it the run state, the phase list and the health figures.
//
// Grid (spec 2.1): every row is `gutter + U usable cells` (the host draws the border before it and the margin after it); a ribbon starts at usable col 1, body content at col 5 (indent 4), numbers
// are right-aligned to col U. The sections, in order: NOW (state head, phase stepper `●●◆○○○ 3/6`, the `doing` line or the denial), ACTIVITY (20 buckets x 15 s as 3 rows of eighth blocks, the
// `0└5m───now` axis and the stats column), CONTEXT (gauge `▰▱`, `~N turns left`, `+Nk/turn`; absent before the first measure), RUNS (after the first run), GATES (checks ok fail), HOOKS (the elastic
// section: every free row), then the footer pinned to the last row. One blank row separates sections; spare rows are blank at the bottom, never between sections.
//
// Overflow (2.8): HOOKS rows shrink first (one row stays), then RUNS goes, then gate child rows collapse to group rows. NOW and the denial line never shrink.
// Colour (2.4): green only for measured passes, amber for ctx >= 70 % or a hook p50 >= 50 ms, red for denial and failure, violet ramp 97/141/183 for the bars.
import { dataCell, dataStateOf, type DataState, type ReadInfo } from '../../data/datastate';
import { elapsedClock, type Run, type Ui } from '../../design/atlas-ui';
import { bandLook, ctxLevel, latencyLevel } from '../band/band-frame';
import { WIRED_HOOKS } from '../../host/hook-log';
import { agoText, gatesSummary, promptedOf, severityOf, teamOf, tokenText, type Health } from '../../data/idle-health';
import { bucketLabel, chartSeries, CHART_AXIS_MIN, chartMinutes, metricsOf, P95_MIN_SAMPLES, PANEL_CHART_COLS, ROUND_BUCKETS, roundBucket, runFigures, runsOf, STATUS_BUCKETS, type ChartData } from '../../data/metrics';
import { ctxDelta, ctxRunway } from '../../data/pulse';
import { blockSpark } from '../../design/chart';
import { fitText, textWidth } from '../../design/theme';
import { gateCounts } from '../../design/vocab';

// The level helpers live in band-frame.ts (it cannot import this file back); re-exported for the callers that import them from here.
export { ctxLevel, latencyLevel };

// AA1: the figures live in metrics.ts; the frames only format them (re-exported here for the callers that always imported them from this file).
export { bucketLabel, chartSeries, CHART_AXIS_MIN, chartMinutes, P95_MIN_SAMPLES, PANEL_CHART_COLS, ROUND_BUCKETS, roundBucket, runFigures, runsOf, STATUS_BUCKETS, type ChartData };
/** Rows of the activity chart (eighth blocks, 8 levels each). */
const CHART_ROWS = 3;
const CHART_AT = 7; // usable col of the first bucket
const INDENT = 4;
const GAUGE_W = 12;
const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const BLOCKS_ASCII = [' ', '_', '.', ',', '-', ':', '=', '+', '#'];

export type StatusGateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
export type StatusGate = { id: string; title: string; error?: string; lines: readonly StatusGateLine[] };
export type StatusIn = {
  /** The panel's width in cells: gutter + U usable cells + margin. */
  cols: number;
  /** Rows the body may fill, footer included (0: unknown, no limit). */
  room: number;
  ui: Ui;
  kind: 'idle' | 'working' | 'done' | 'blocked';
  /** The phase list, the current phase (an unknown or `blocked` one lights none) and the glyph the spinner shows this frame. */
  phases: readonly string[];
  phase: string;
  spin: string;
  /** Shared clock reading in ms: the idle heartbeat reads it. */
  now?: number;
  todos: { done: number; total: number };
  /** The gate groups as the panel holds them: the failing lines (label, detail, fix) of a failing group are its child rows. */
  gates: readonly StatusGate[];
  health: Health;
  /** The phases the run entered, in order (the panel's memo): the stepper fills only those it passed. Absent or empty: the position decides. */
  entered?: readonly string[];
  /** M6: how the gate and hook figures were read; absent: nothing is marked stale or failed. */
  read?: ReadInfo;
  /** A blank row first: the header leaves none above the body (below 100 columns). */
  lead: boolean;
};

const HEART = ['◌', '◎', '◌', '◌'] as const;
const HEART_ASCII = ['.', 'o', '.', '.'] as const;
const HEART_MS = 400;

const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);

export { promptedOf };

/** The one run kit of the frame spec at `u` usable cells: the styled run makers, the grid row (indent 4, a number flush right at col U), the ribbon (`── TITLE ──── meta`) and the chip row (one fill spanning U). */
export function frameKit(ui: Ui, u: number) {
  const k = bandLook(ui);
  const ascii = ui.ascii;
  const g = (full: string, plain: string): string => (ascii ? plain : full);
  const on = (t: string, fg: string, o: Partial<Run> = {}): Run => ({ t, tone: 'text', fg, ...o });
  const dim = (t: string, o: Partial<Run> = {}): Run => on(t, k.dim, { tone: 'sub', ...o });
  const txt = (t: string, o: Partial<Run> = {}): Run => on(t, k.text, o);
  const green = (t: string): Run => on(t, k.ok, { tone: 'ok' });
  const red = (t: string, o: Partial<Run> = {}): Run => on(t, k.bad, { tone: 'bad', ...o });
  const amber = (t: string): Run => on(t, k.warn, { tone: 'warn' });
  const violet = (t: string, i = 1): Run => on(t, k.ramp[i]!, { tone: 'accent' });
  const w = (runs: readonly Run[]): number => sum(runs.map((x) => textWidth(x.t)));
  const sp = (n: number): Run => ({ t: ' '.repeat(Math.max(0, n)), tone: 'text' });

  /** One row: gutter, `at` blank cells, `left`, the gap, `right` flush to col U (the left side gives way when they do not both fit). */
  const row = (left: readonly Run[], right: readonly Run[] = [], at = INDENT): Run[] => {
    const rw = w(right);
    const room = u - at - (rw ? rw + 1 : 0);
    let l = [...left];
    if (w(l) > room) {
      let over = w(l) - Math.max(1, room);
      l = l.map((x, i) => {
        if (i < l.length - 1 || over <= 0) return x;
        const t = fitText(x.t, Math.max(1, textWidth(x.t) - over));
        over = 0;
        return { ...x, t };
      });
    }
    return [sp(1 + at), ...l, ...(rw ? [sp(u - at - w(l) - rw)] : []), ...right];
  };
  const ribbon = (title: string, meta: readonly Run[] = []): Run[] => {
    const head = ` ${title} `;
    const rule = (n: number): Run => on(g('─', '-').repeat(n), k.rule, { tone: 'dim' });
    const fit = w(meta) > 0 && u - 2 - textWidth(head) - 1 - w(meta) >= 2 ? meta : [];
    const fill = u - 2 - textWidth(head) - (fit.length ? 1 + w(fit) : 0);
    return [sp(1), rule(2), on(head, k.work, { tone: 'accent', bold: true }), rule(Math.max(0, fill)), ...(fit.length ? [sp(1), ...fit] : [])];
  };
  const metaText = (t: string): Run[] => [dim(t)];
  /** A clickable chip (2.3): one filled run spanning U (or `span` cells), one cell of padding each side, `left` flush left and `right` flush right inside the fill. `alert` is the denial chip (bg 52), `lit` the selected one. Y2c: the fill is the raised tile (chip fill 239, violet text). Y2d: `o.right` paints the right text with a semantic colour and `o.mark` the first cell of `left` (a state glyph); both keep the chip's fill. */
  const chip = (left: string, right: string, style: 'idle' | 'lit' | 'alert' = 'idle', span = u, o: { right?: { fg: string; tone: Run['tone'] }; mark?: { at: number; fg: string; tone: Run['tone'] } } = {}): Run[] => {
    const inner = Math.max(1, span - 2);
    const l = fitText(left, Math.max(1, inner - (right ? textWidth(right) + 1 : 0)));
    const gap = Math.max(0, inner - textWidth(l) - textWidth(right));
    const look = style === 'alert' ? { fg: k.alertFg, bgHex: k.alertBg } : style === 'lit' ? { fg: k.litFg, bgHex: k.litBg, bold: true } : { fg: k.chipFg, bgHex: k.chipBg };
    const base = { tone: 'text' as const, hover: true as const, ...look };
    const parts: Run[] = [];
    const chars = Array.from(l);
    const at = style === 'alert' ? -1 : o.mark?.at ?? -1;
    if (at >= 0 && at < chars.length) {
      parts.push({ ...base, t: ` ${chars.slice(0, at).join('')}` }, { ...base, t: chars[at]!, fg: o.mark!.fg, tone: o.mark!.tone }, { ...base, t: chars.slice(at + 1).join('') });
    } else parts.push({ ...base, t: ` ${l}` });
    if (o.right && style !== 'alert' && right) parts.push({ ...base, t: ' '.repeat(gap) }, { ...base, t: right, fg: o.right.fg, tone: o.right.tone }, { ...base, t: ' ' });
    else parts.push({ ...base, t: `${' '.repeat(gap)}${right} ` });
    return [sp(1), ...parts.filter((x) => x.t !== '')];
  };
  /** Y2c: a chip as one small cell (` ▸ `, ` more › `): the raised tile around `text`, `alert` for a failing row; no fill beyond it. */
  const cell = (text: string, style: 'idle' | 'alert' = 'idle'): Run => ({ t: text, tone: 'text', hover: true, ...(style === 'alert' ? { fg: k.alertFg, bgHex: k.alertBg } : { fg: k.chipFg, bgHex: k.chipBg }) });
  return { u, k, ascii, g, on, dim, txt, green, red, amber, violet, w, sp, row, ribbon, metaText, chip, cell, blank: [] as Run[] };
}
export type Kit = ReturnType<typeof frameKit>;

/** The elements the dock and the card share. Each builder takes the kit (so the width is the caller's: U in the pane, a column in the card) and the health. */
export type GateSrc = { gates: readonly StatusGate[]; prompted: boolean; /** M6: how the gate figures were read (age, failed read); absent: nothing is marked. */ read?: ReadInfo };

export type FeedRow = { label: string; ageSecs: number; n: number; ms?: number };
/** The HOOKS feed: events of one label in one second fold into one row (`×2`), newest first. */
export function hookFeed(h: Health): FeedRow[] {
  const out: FeedRow[] = [];
  for (const e of h.hooks?.recent ?? []) {
    const at = out.at(-1);
    if (at && at.label === e.label && at.ageSecs === e.ageSecs) { at.n++; if (e.ms !== undefined) at.ms = Math.max(at.ms ?? 0, e.ms); }
    else out.push({ label: e.label, ageSecs: e.ageSecs, n: 1, ...(e.ms !== undefined ? { ms: e.ms } : {}) });
  }
  return out;
}
// ---- the W1 status tab builders (round W spec, items A-E): full-width chart, gates table, wired-hooks table, recent log ----

const GUTTER = 3; // y gutter of the chart: a two-cell label and the `┤` tick
/** M6: what the caller knows about how the gate and hook figures were read: the snapshot's age against its refresh interval (past it a figure is drawn `~` with its real age), and which read failed (drawn `err`, never the no-data dash). Absent: nothing is known, so nothing is marked. */
export type { ReadInfo };
/** The ReadInfo the hook rows get: the snapshot age is the gate reader's, the hook log is in memory with no refresh interval, so a hook figure is never aged by it (only a failed hook read is drawn). */
export const hooksRead = (read: ReadInfo | undefined): ReadInfo | undefined => (read ? (({ ageSecs: _a, refreshSecs: _r, ...rest }) => rest)(read) : undefined);

/** The `last` cell of a gates or hooks row through the shared data state: `err` for a failed read, the no-data dash for none, `~` and the figure's real age (its own age plus the snapshot's) once the snapshot is older than its refresh interval, else the plain age. */
export function lastCellText(secs: number | undefined, none: string, read: ReadInfo | undefined, failed: boolean): string {
  const s: DataState = dataStateOf({ has: secs !== undefined, failed, ...(read?.ageSecs !== undefined ? { ageSecs: read.ageSecs } : {}), ...(read?.refreshSecs !== undefined ? { refreshSecs: read.refreshSecs } : {}) });
  if (s.kind === 'error') return dataCell(s);
  if (s.kind === 'stale') return `~${agoText((secs ?? 0) + s.ageSecs)}`;
  return secs === undefined ? none : agoText(secs);
}

export const GATE_COL = 5;
/** Z1: the activity chart's rows follow the pane's height alone (never the run's state): the same pane draws the same chart idle, working and done. Rows the chart does not take go to the section that grows (RECENT, RUNS). Unknown room: 4. */
export const chartRows = (room: number): number => (room <= 0 ? 4 : room >= 40 ? 6 : room >= 32 ? 5 : room >= 26 ? 4 : 3);

/** Merge neighbouring cells of one style into one run (a 46-cell chart row is a handful of runs, not 46). */
const merge = (runs: readonly Run[]): Run[] => {
  const out: Run[] = [];
  for (const x of runs) {
    const p = out.at(-1);
    if (p && !p.hover && !x.hover && p.tone === x.tone && p.fg === x.fg && !p.bold === !x.bold && p.bgHex === x.bgHex) out[out.length - 1] = { ...p, t: p.t + x.t };
    else out.push(x);
  }
  return out;
};

const trimNum = (x: number): string => String(Math.round(x * 10) / 10);
/** `-1.5m`: a minute count on the axis. */
const axisMin = (m: number): string => `-${trimNum(m)}m`;

/** ACTIVITY (C, AA3): the section rule carries the stats from the one metrics (`6 ev · peak 3 / 5s · last 1s`, idle `0 ev · waiting`); under it `rows` chart rows of eighth blocks, one bucket per column after a 3-cell y gutter. The y axis tops out at max(peak, 2) and the top label IS that maximum (`3┤`); a zero bucket is blank above a dim `─` baseline (never a `▁`), and the columns the plot has no data for (before the session, before the persisted history) are a dim `·` on the baseline, so the plot spans the full chart width. Y1b: the window is the session's age rounded up to the minute (2 to 30 minutes), the x labels follow it (`-3m ... now`). Y1a: earlier sessions' minutes, dimmed, sit left of a `│` marker (`prev`). The `last` age is left out when the state already says the same instant (a finished run's `ended 18s ago`). */
export function statusActivityRows(kit: Kit, h: Health, rows: number): Run[][] {
  const { on, dim, row, ribbon, metaText, g, k, ascii, sp } = kit;
  const w = Math.max(8, kit.u - INDENT - GUTTER);
  const m = metricsOf(h);
  const ch = m.activity;
  const { total } = ch;
  const ramp = ascii ? BLOCKS_ASCII : BLOCKS;
  const scale = m.scale;
  const levels = rows * 8;
  const level = (v: number): number => (v <= 0 ? 0 : Math.max(1, Math.min(levels, Math.round((v / scale) * levels))));
  const lastSecs = h.hooks?.lastEventSecs;
  const sameInstant = lastSecs !== undefined && h.last?.endedAgo !== undefined && Math.abs(h.last.endedAgo - lastSecs) <= 2;
  const meta = total > 0 ? `${total} ev · ${m.peakText}${lastSecs !== undefined && !sameInstant ? ` · last ${agoText(lastSecs)}` : ''}` : '0 ev · waiting';
  const out: Run[][] = [ribbon('ACTIVITY', metaText(meta))];
  // the drawn series: earlier sessions' minutes, the marker, this session's buckets; cut at the left to the chart width, the rest of the width is the dim lead
  const series: { v: number; kind: 'prev' | 'mark' | 'now' }[] = [...ch.prev.map((v) => ({ v, kind: 'prev' as const })), ...(ch.prev.length ? [{ v: 0, kind: 'mark' as const }] : []), ...ch.vals.map((v) => ({ v, kind: 'now' as const }))];
  const cut = Math.max(0, series.length - w);
  const drawn = series.slice(cut);
  const lead = w - drawn.length;
  const nowCount = drawn.filter((x) => x.kind === 'now').length;
  for (let r = 0; r < rows; r++) {
    const bottom = rows - 1 - r;
    const gutter = r === 0 ? `${String(Math.min(99, scale)).padStart(2)}${g('┤', '|')}` : bottom === 0 ? ` 0${g('┤', '|')}` : `  ${g('│', '|')}`;
    let seen = 0;
    const cells: Run[] = [
      ...(lead > 0 ? [bottom === 0 ? on(g('·', '.').repeat(lead), k.rule, { tone: 'dim' }) : sp(lead)] : []),
      ...drawn.map((x): Run => {
        if (x.kind === 'mark') return on(g('│', '|'), k.rule, { tone: 'dim' });
        const lv = Math.max(0, Math.min(8, level(x.v) - bottom * 8));
        if (x.kind === 'now') seen++;
        if (lv === 0) return bottom === 0 ? on(g('─', '-'), k.rule, { tone: 'dim' }) : { t: ' ', tone: 'text' };
        return x.kind === 'prev' ? on(ramp[lv]!, k.dim, { tone: 'sub' }) : on(ramp[lv]!, k.ramp[Math.min(2, Math.floor(((seen - 1) * 3) / Math.max(1, nowCount)))]!, { tone: 'accent' });
      }),
    ];
    out.push(row([dim(gutter), ...merge(cells)], [], INDENT));
  }
  const axis = new Array<string>(w).fill(' ');
  const put = (at: number, t: string): void => { for (let i = 0; i < t.length; i++) if (at + i >= 0 && at + i < w) axis[at + i] = t[i]!; };
  const prevN = drawn.filter((x) => x.kind === 'prev').length;
  const s0 = lead + (prevN ? prevN + 1 : 0); // the first column of this session's window
  if (prevN) { put(lead, prevN >= 4 ? 'prev' : ''); put(s0 - 1, g('│', '|')); }
  put(s0, axisMin(ch.minutes));
  put(w - 3, 'now');
  if (nowCount >= 24) { const mid = axisMin(ch.minutes / 2); put(s0 + Math.floor((nowCount - mid.length) / 2), mid); }
  out.push(row([sp(GUTTER), dim(axis.join(''))], [], INDENT));
  return out;
}

/** CONTEXT (E): the ribbon carries the runway; one row, the gauge and `6% · 64k of 1M · +12k/turn` (the delta from two measures on). The gauge and the percentage take the ramp (Y2d: green, amber from 70 %, red from 90 %); the token figures are neutral. Absent before the first measure. */
export function statusContextRows(kit: Kit, h: Health): Run[][] {
  const { dim, txt, amber, green, red, row, ribbon, metaText, g } = kit;
  const ctxs = h.pulse?.ctx ?? [];
  const pct = h.ctxPct ?? ctxs.at(-1)?.pct;
  if (pct === undefined) return [];
  const tokens = h.tokens ?? ctxs.at(-1)?.tokens;
  const window = h.pulse?.window ?? h.window;
  const delta = h.pulse && ctxs.length >= 2 ? ctxDelta({ ctx: ctxs }) : undefined;
  const pctText = `${Math.round(pct)}%`;
  const rest = [...(tokens !== undefined ? [`${tokenText(tokens)}${window !== undefined ? ` of ${tokenText(window)}` : ' tokens'}`] : []), ...(delta ? [delta] : [])];
  const tail = rest.length ? ` · ${rest.join(' · ')}` : '';
  const gw = Math.max(6, Math.min(GAUGE_W, kit.u - INDENT - 1 - textWidth(pctText + tail)));
  const paint = ctxLevel(pct) === 'bad' ? red : ctxLevel(pct) === 'warn' ? amber : green;
  const filled = pct > 0 ? Math.max(1, Math.min(gw, Math.round((pct / 100) * gw))) : 0;
  const gauge: Run[] = [paint(g('▰', '#').repeat(filled)), dim(g('▱', '-').repeat(gw - filled))].filter((x) => x.t !== '');
  const runway = h.pulse ? ctxRunway({ ctx: ctxs, ...(window !== undefined ? { window } : {}) }) : undefined;
  return [ribbon('CONTEXT', runway !== undefined ? metaText(`~${runway} ${runway === 1 ? 'turn' : 'turns'} left`) : []), row([...gauge, txt(' '), paint(pctText), ...(tail ? [txt(tail)] : [])])];
}

/** Z2: the run figures that may be printed for `n` runs: the single value from one run, the median from two, the 90th percentile only from 5 (never the same number twice as two statistics). Longest wording first. */
function runFigureTexts(runs: readonly { secs: number }[]): string[] {
  const n = runs.length;
  const count = `${n} ${n === 1 ? 'run' : 'runs'}`;
  const { med, p90 } = runFigures(runs.map((x) => x.secs));
  if (n === 1) return [`${count} · ${elapsedClock(med)}`, count];
  if (n < 5) return [`${count} · med ${elapsedClock(med)}`, count];
  return [`${count} · med ${elapsedClock(med)} · p90 ${elapsedClock(p90)}`, `${count} · med ${elapsedClock(med)}`, count];
}

/** AA3: fewer than 3 runs are a one-line list (`▇ 0:05 ok · ▃ 0:02 ok`, a run of an earlier session dim), never a chart: the glyph is the run's length against the longest of them. */
export function runListRow(kit: Kit, h: Health): Run[] {
  const { on, dim, red, row, k, ascii } = kit;
  const ramp = ascii ? BLOCKS_ASCII : BLOCKS;
  const runs = runsOf(h).slice(-2);
  const longest = Math.max(1, ...runs.map((x) => x.secs));
  const parts: Run[] = [];
  runs.forEach((x, i) => {
    if (i) parts.push(dim(' · '));
    const lv = Math.max(1, Math.min(8, Math.round((x.secs / longest) * 7) + 1));
    parts.push(on(ramp[lv]!, x.ok ? (x.prev ? k.dim : k.ok) : k.bad, { tone: x.ok ? (x.prev ? 'sub' : 'ok') : 'bad' }), on(` ${elapsedClock(x.secs)} `, x.prev ? k.dim : k.text, { tone: x.prev ? 'sub' : 'text' }), x.ok ? dim('ok') : red('failed'));
  });
  return row(parts);
}
/** The RUNS rule's right-hand label: `prev` while every run is from an earlier session, `+N prev` when this session's join them. */
const runsPrevLabel = (runs: readonly { prev: boolean }[]): string => {
  const nPrev = runs.filter((x) => x.prev).length;
  return nPrev === 0 ? '' : nPrev === runs.length ? 'prev' : `+${nPrev} prev`;
};

/** RUNS (E, Y1a): one bar per run (the last 12) scaled to the longest (green ok, red failed; a run of an earlier session is drawn dim when it passed), then `12 runs · med 0:41 · p90 1:20 · 1 failed` over every run the history holds (Z2: the median from 2 runs, the p90 from 5). The rule says `prev` while every run is from an earlier session, `+N prev` when this session's join them. */
export function statusRunsRows(kit: Kit, h: Health): Run[][] {
  const { on, dim, red, sp, row, ribbon, metaText, k, ascii } = kit;
  const ramp = ascii ? BLOCKS_ASCII : BLOCKS;
  const runs = runsOf(h);
  if (!runs.length) return [];
  if (runs.length < 3) return [ribbon('RUNS', runsPrevLabel(runs) ? metaText(runsPrevLabel(runs)) : []), runListRow(kit, h)];
  const longest = Math.max(1, ...runs.map((x) => x.secs));
  const shown = runs.slice(-12);
  const bars: Run[] = merge(shown.map((x) => on(ramp[Math.max(1, Math.min(8, Math.round((x.secs / longest) * 7) + 1))]!, x.ok ? (x.prev ? k.dim : k.ok) : k.bad, { tone: x.ok ? (x.prev ? 'sub' : 'ok') : 'bad' })));
  const failed = runs.filter((x) => !x.ok).length;
  // the figures give way from the right (p90, then med) before a word is cut in a narrow pane
  const failedW = failed ? textWidth(` · ${failed} failed`) : 0;
  const room = kit.u - INDENT - shown.length - 2;
  const texts = runFigureTexts(runs);
  const figs = texts.find((t) => textWidth(t) + failedW <= room) ?? texts[texts.length - 1]!;
  const nPrev = runs.filter((x) => x.prev).length;
  const label = nPrev === 0 ? '' : nPrev === runs.length ? 'prev' : `+${nPrev} prev`;
  return [ribbon('RUNS', label ? metaText(label) : []), row([...bars, sp(2), dim(`${figs}${failed ? ' · ' : ''}`), ...(failed ? [red(`${failed} failed`)] : [])])];
}

/** AA3: the RUNS section is never taller than 6 rows: the rule, at most this many chart rows, the x labels. */
export const RUNS_CHART_MAX = 4;
/** The run chart's y axis never tops out below this many seconds, so a 5 s run is a short bar, not a pillar. */
export const RUN_AXIS_MIN_SECS = 60;
/** Z4: RUNS as a multi-row bar chart of every recorded run (history.ts: this session's and the earlier ones'), oldest left, newest right: y is the run's duration (`1:00┤` at the top, `0┤` on the baseline), a passed run green, a failed one red, the x labels `oldest` and `newest`. The rule carries the figures (`12 runs · med 0:41 · p90 1:20 · 1 failed`). `rows` is the chart's height; no runs: the rule and one honest line. */
export function statusRunsChart(kit: Kit, h: Health, rows: number): Run[][] {
  const { on, dim, red, sp, row, ribbon, metaText, k, ascii, g } = kit;
  const runs = runsOf(h);
  if (!runs.length) return [ribbon('RUNS'), row([dim('no runs yet · a finished run adds a bar')])];
  if (runs.length < 3) return [ribbon('RUNS', runsPrevLabel(runs) ? metaText(runsPrevLabel(runs)) : []), runListRow(kit, h)];
  rows = Math.max(1, Math.min(RUNS_CHART_MAX, rows));
  const ramp = ascii ? BLOCKS_ASCII : BLOCKS;
  const gw = 5; // the y gutter: `1:00┤`
  const w = Math.max(8, kit.u - INDENT - gw);
  const slot = runs.length * 3 <= w ? 3 : 2; // a bar of 2 cells and a gap, or one cell and a gap
  const shown = runs.slice(-Math.max(1, Math.floor(w / slot)));
  const longest = Math.max(RUN_AXIS_MIN_SECS, ...shown.map((x) => x.secs));
  const levels = Math.max(1, rows) * 8;
  const level = (v: number): number => (v <= 0 ? 0 : Math.max(1, Math.min(levels, Math.round((v / longest) * levels))));
  const barW = slot - 1;
  const failed = runs.filter((x) => !x.ok).length;
  const texts = runFigureTexts(runs);
  const figs = texts.find((t) => textWidth(t) + (failed ? textWidth(` · ${failed} failed`) : 0) + 8 <= kit.u - 2) ?? texts[texts.length - 1]!;
  const nPrev = runs.filter((x) => x.prev).length;
  const meta: Run[] = [dim(figs), ...(failed ? [dim(' · '), red(`${failed} failed`)] : []), ...(nPrev ? [dim(nPrev === runs.length ? ' · prev' : ` · +${nPrev} prev`)] : [])];
  const out: Run[][] = [ribbon('RUNS', meta)];
  const used = shown.length * slot;
  const lead = w - used; // the chart is right-aligned: the newest run sits at the right edge
  for (let r = 0; r < rows; r++) {
    const bottom = rows - 1 - r;
    const gutter = r === 0 ? `${elapsedClock(longest).padStart(gw - 1)}${g('┤', '|')}` : bottom === 0 ? `${'0'.padStart(gw - 1)}${g('┤', '|')}` : `${' '.repeat(gw - 1)}${g('│', '|')}`;
    const cells: Run[] = [];
    for (const x of shown) {
      const lv = Math.max(0, Math.min(8, level(x.secs) - bottom * 8));
      cells.push(lv === 0 ? (bottom === 0 ? on(ramp[1]!.repeat(barW), k.rule, { tone: 'dim' }) : sp(barW)) : x.ok ? on(ramp[lv]!.repeat(barW), k.ok, { tone: 'ok' }) : on(ramp[lv]!.repeat(barW), k.bad, { tone: 'bad' }));
      cells.push(bottom === 0 ? on(ramp[1]!, k.rule, { tone: 'dim' }) : sp(1));
    }
    out.push(row([dim(gutter), ...(lead > 0 ? [bottom === 0 ? on(ramp[1]!.repeat(lead), k.rule, { tone: 'dim' }) : sp(lead)] : []), ...merge(cells)]));
  }
  const axis = new Array<string>(w).fill(' ');
  const put = (at: number, t: string): void => { for (let i = 0; i < t.length; i++) if (at + i >= 0 && at + i < w) axis[at + i] = t[i]!; };
  if (shown.length >= 2 && used >= 'oldest'.length + 3 + 'newest'.length) put(lead, 'oldest');
  put(w - 'newest'.length, 'newest');
  out.push(row([sp(gw), dim(axis.join(''))]));
  return out;
}

/** The hook whose event runs each gate: the completion and routing gates are read on Stop, the tripwire on every tool call, the header contract when a turn completes. */
export const GATE_HOOK: Readonly<Record<string, string>> = { completion: 'classic.Stop', routing: 'classic.Stop', tripwire: 'tool.call', header: 'turn.complete' };
/** Seconds since this gate last ran a check (item N): the gate's own stamp when the mod holds one, else the last time the hook that runs it fired (the hook log's per-hook clock). Absent when neither exists: the table shows `—`, never a figure shared by every row. */
export function gateLastSecs(h: Health, c: { id: string; lastSecs?: number }): number | undefined {
  if (c.lastSecs !== undefined) return c.lastSecs;
  const hook = GATE_HOOK[c.id];
  return hook === undefined ? undefined : hookTable(h).find((x) => x.name === hook)?.lastSecs;
}

/** The GATES table's column names (`pass deny last`, 5 cells each): the section rule of the status tab, the gates tab and the health card. */
export const gateHead = (): string => ['pass', 'deny', 'last'].map((t) => t.padStart(GATE_COL)).join('');

/** GATES (B): a real table. Columns: state dot, name, then right-aligned `pass deny last` (5 cells each, flush right) named in the section rule. Before any check a row reads dim `0 0 —` with the hollow `○`. A failing group's failing lines hang under its row when `children`. `last` is the check's own age (`lastSecs`), else the age of the newest hook event the gates ran on. */
export function statusGatesRows(kit: Kit, h: Health, src: GateSrc, children: boolean): Run[][] {
  const { dim, txt, green, red, row, ribbon, metaText, g } = kit;
  const u = kit.u;
  const cell = (t: string): string => t.padStart(GATE_COL);
  const nameW = Math.max(4, Math.min(12, u - INDENT - 2 - GATE_COL * 3 - 1));
  const none = g(dataCell({ kind: 'empty' }), dataCell({ kind: 'empty' }, true));
  const counts = h.gates.checks.map((c) => { const n = gateCounts(c); return { c, n, deny: n.total - n.pass, fired: n.total > 0 && (src.prompted || n.total - n.pass > 0) }; });
  // AA4: before any check ran, the table is one summary line; with the gate counts of an earlier session (history) it is that session's rows, dimmed and tagged `prev`
  // a failed read is never folded into the `0 checks yet` summary: its rows say `err`
  const failedOf = (id: string): boolean => !!src.read?.failed?.gates || !!src.gates.find((x) => x.id === id)?.error;
  if (counts.length && !counts.some((x) => x.fired) && !counts.some((x) => failedOf(x.c.id))) {
    const old = h.hist?.gates ?? [];
    if (!old.length) return [ribbon('GATES'), row([dim(`${g('○', 'o')} ${counts.length} ${counts.length === 1 ? 'gate' : 'gates'} armed · 0 checks yet`)])];
    const out: Run[][] = [ribbon('GATES', metaText(`${cell('pass')}${cell('deny')}${cell('last')}`))];
    for (const { c } of counts) {
      const o = old.find((x) => x.id === c.id);
      out.push(row([dim(`${g('○', 'o')} ${fitText(c.id, nameW)}`)], o ? [dim(cell(String(o.pass))), dim(cell(String(o.deny))), dim(cell('prev'))] : [dim(cell('0')), dim(cell('0')), dim(cell(none))]));
    }
    return out;
  }
  const out: Run[][] = [ribbon('GATES', metaText(`${cell('pass')}${cell('deny')}${cell('last')}`))];
  for (const { c, n, deny, fired } of counts) {
    const mark = deny > 0 ? red(g('■', 'x')) : fired ? green(g('●', '*')) : dim(g('○', 'o'));
    const lastSecs = fired ? gateLastSecs(h, c) : undefined;
    const right: Run[] = fired
      ? [n.pass > 0 ? green(cell(String(n.pass))) : dim(cell('0')), deny > 0 ? red(cell(String(deny))) : dim(cell('0')), dim(cell(lastCellText(lastSecs, none, src.read, failedOf(c.id))))]
      : [dim(cell('0')), dim(cell('0')), dim(cell(lastCellText(undefined, none, src.read, failedOf(c.id))))];
    out.push(row([mark, fired ? txt(` ${fitText(c.id, nameW)}`) : dim(` ${fitText(c.id, nameW)}`)], right));
    if (deny > 0 && children) {
      const grp = src.gates.find((x) => x.id === c.id);
      const bad = (grp?.lines ?? []).filter((l) => !l.ok);
      bad.forEach((l, i) => {
        const last = i === bad.length - 1;
        const detail = (l.detail ?? '').trim();
        const rw = detail ? textWidth(detail) + 2 : 0;
        const label = fitText(l.label, Math.max(4, u - 9 - rw));
        out.push(row([dim(`${last ? g('└', '+') : g('├', '+')} `), red(g('■', 'x')), txt(` ${label}`)], detail ? [red(detail)] : [], 5));
        if (l.fix) out.push(row([dim(`${last ? ' ' : g('│', '|')}   fix: ${l.fix}`)], [], 5));
      });
    }
  }
  return out;
}

export type HookRow = { name: string; n: number; p50?: number; p95?: number; /** AA4: the newest handler latencies of the kind (the history ring), oldest first, for the row's 8-cell spark. */ ring?: number[]; /** Z2: the latency samples behind p50 and p95; the p95 column is drawn only from P95_MIN_SAMPLES of them. */ samples?: number; lastSecs?: number; /** Y1a: the latency figures are the persisted ring's alone (this session has stamped none for this hook). */ prev?: true };
/** One row per wired hook (every hook in WIRED_HOOKS, fired or not) from the hook log's per-kind figures; a health without `perHook` gets them from `byLabel` and the recent events. */
export function hookTable(h: Health): HookRow[] {
  const hk = h.hooks;
  return WIRED_HOOKS.map((name): HookRow => {
    const ph = hk?.perHook?.find((x) => x.label === name);
    if (ph) return { name, n: ph.n, ...(ph.ring?.length ? { ring: ph.ring } : {}), ...(ph.p50 !== undefined ? { p50: ph.p50 } : {}), ...(ph.p95 !== undefined ? { p95: ph.p95 } : {}), samples: ph.samples ?? ph.n, ...(ph.lastSecs !== undefined ? { lastSecs: ph.lastSecs } : {}), ...(ph.prev ? { prev: true as const } : {}) };
    const mine = (hk?.recent ?? []).filter((e) => e.label.split(' ')[0] === name);
    const ms = mine.flatMap((e) => (e.ms !== undefined ? [e.ms] : [])).sort((a, b) => a - b);
    const rank = (p: number): number => ms[Math.min(ms.length - 1, Math.max(0, Math.ceil(ms.length * p) - 1))]!;
    const n = (hk?.byLabel ?? []).find((x) => x.label === name)?.n ?? mine.length;
    return { name, n, ...(ms.length ? { p50: rank(0.5), p95: rank(0.95), samples: ms.length } : {}), ...(mine.length ? { lastSecs: Math.min(...mine.map((e) => e.ageSecs)) } : {}) };
  });
}

/** HOOKS (D): the fixed table of the wired hooks, header row then one row each: name, count, p50, p95, last (right-aligned, flush right). A hook that never fired is dim `0 — — —`. Z2: a hook with fewer than 5 samples shows its single or median value in p50 and `—` in p95, so one number is never printed as two statistics. Z3: p50 and p95 take the latency colours (green to 100 ms, amber above, red above 500) whatever the session; the rule states the two thresholds once. `rows` cuts the table from the end on a short pane. */
export function statusHooksRows(kit: Kit, h: Health, rows = WIRED_HOOKS.length, read?: ReadInfo): Run[][] {
  const { on, dim, txt, red, amber, green, row, ribbon, metaText, g, k, ascii } = kit;
  const table = hookTable(h);
  // M6: a failed hook read says `err` where an unread one says the no-data dash
  const failed = !!read?.failed?.hooks;
  const none = failed ? dataCell({ kind: 'error' }) : g(dataCell({ kind: 'empty' }), dataCell({ kind: 'empty' }, true));
  // AA4: nothing measured and nothing fired but the session's own start: one summary line instead of a table of zeros
  if (!failed && !table.some((e) => e.p50 !== undefined) && table.every((e) => e.name === 'session.start' || e.n === 0)) {
    const start = table.find((e) => e.name === 'session.start');
    return [ribbon('HOOKS'), row([dim(`${g('○', 'o')} ${table.length} ${table.length === 1 ? 'hook' : 'hooks'} wired · ${start?.lastSecs !== undefined ? `last session.start ${agoText(start.lastSecs)}` : 'none fired yet'}`)])];
  }
  const narrow = kit.u < 44;
  const wl = narrow ? 5 : 6;
  const pad = (t: string, n: number): string => t.padStart(n);
  const ms = (v: number | undefined, quiet = false): Run => (v === undefined ? dim(pad(none, wl)) : quiet ? dim(pad(`${v}ms`, wl)) : { ok: green, warn: amber, bad: red }[latencyLevel(v)](pad(`${v}ms`, wl)));
  // AA4: the p95 column exists only once some hook has the samples for it
  const withP95 = table.some((e) => (e.samples ?? e.n) >= P95_MIN_SAMPLES);
  const nameW = 15;
  const rightW = 4 + wl + (withP95 ? wl : 0) + 5;
  const sparkOn = kit.u - INDENT - rightW - 1 >= nameW + 1 + 8 && table.some((e) => (e.ring?.length ?? 0) >= 2);
  const roomL = kit.u - INDENT - rightW - 1; // what the name column has left of the figures
  const head = table.some((e) => e.p50 !== undefined) && roomL >= 20 ? 'hook · last 64 calls' : 'hook';
  const lat = metricsOf(h).hook;
  const meta = lat ? `p50 ${lat.p50}ms · amber>100ms red>500ms` : 'amber>100ms red>500ms';
  const out: Run[][] = [ribbon('HOOKS', metaText(meta)), row([dim(head)], [dim(pad('n', 4)), dim(pad('p50', wl)), ...(withP95 ? [dim(pad('p95', wl))] : []), dim(pad('last', 5))])];
  for (const e of table.slice(0, Math.max(0, rows))) {
    const fired = e.n > 0;
    const old = !fired && e.p50 !== undefined; // an earlier session's figures, this session has not fired the hook
    const p95 = (e.samples ?? e.n) >= P95_MIN_SAMPLES ? e.p95 : undefined;
    const spark: Run[] = sparkOn ? [dim(' '.repeat(Math.max(0, nameW - textWidth(e.name)))), sp8(e.ring ?? [], on, k, ascii)] : [];
    out.push(row([fired ? txt(e.name) : dim(e.name), ...spark], [fired ? txt(pad(String(e.n), 4)) : dim(pad('0', 4)), ms(e.p50, old), ...(withP95 ? [ms(p95, old)] : []), e.lastSecs !== undefined && !failed ? dim(pad(lastCellText(e.lastSecs, none, read, false), 5)) : dim(pad(old && !failed ? 'prev' : none, 5))]));
  }
  return out;
}

/** AA4: a hook row's latency spark, 8 cells from the newest samples (scale floor 100 ms, the amber threshold, so a run of 3 ms calls reads flat); a kind with fewer than 2 samples draws nothing. */
function sp8(ring: readonly number[], on: Kit['on'], k: Kit['k'], ascii: boolean): Run {
  if (ring.length < 2) return on(' '.repeat(9), k.dim, { tone: 'sub' });
  return on(` ${blockSpark(ring, 8, { ascii, min: 100 })}`, k.ramp[0]!, { tone: 'accent' });
}

/** RECENT (D): the newest hook events (age, glyph, event, `×N` for one label in one second) fill the rows the sections leave. */
export function statusRecentRows(kit: Kit, h: Health, feed: readonly FeedRow[], n: number): Run[][] {
  const { dim, txt, red, green, sp, row, ribbon, metaText, g } = kit;
  const SEV = { info: [dim, '·', '.'], ok: [green, '●', '*'], bad: [red, '■', 'x'] } as const;
  const shown = feed.slice(0, Math.max(0, n));
  return [ribbon('RECENT', metaText(`${h.hooks?.total ?? 0} seen`)), ...shown.map((e): Run[] => {
    const [paint, full, plain] = SEV[severityOf(e.label)];
    const text = `${e.label}${e.n > 1 ? ` ×${e.n}` : ''}`;
    return row([dim(agoText(e.ageSecs).padStart(3)), sp(1), paint(g(full, plain)), sp(1), txt(text)]);
  })];
}

/** The footer pinned to the last row: `atlas 17.23.0 · master`, the session cost flush right. */
export function footerRow(kit: Kit, h: Health): Run[] {
  const left = [h.version ? `atlas ${h.version}` : '', h.branch ?? ''].filter(Boolean).join(' · ');
  if (!left) return kit.blank;
  return kit.row([kit.dim(left)], h.pulse?.cost ? [kit.dim(`cost $${h.pulse.cost.usd.toFixed(2)}`)] : []);
}

/** Press keys of the `+N more ›` chip (Y2a): `goto:<view>` on a pane tab (the view that holds a dropped section), `card:more` on the health card. */
export const GOTO_PREFIX = 'goto:';
export const CARD_MORE_KEY = 'card:more';
/** The view that holds each section a short pane drops (`route` is the status tab). */
export const STATUS_HOLDER: Readonly<Record<string, string>> = { activity: 'team', context: 'route', runs: 'board', hooks: 'gates', recent: 'channel', gates: 'gates' };
/** The last row of a view that dropped whole sections: a chip `+N more ›` (N sections) that carries `key`. */
export function moreRow(kit: Kit, n: number, target: string, key = `${GOTO_PREFIX}${target}`): Run[] {
  return kit.row([{ ...kit.cell(` +${n} more ${kit.g('›', '>')} `), press: key, bold: true }], [], 0);
}

/** The status body as rows of runs (each starts with the gutter cell); the first row is blank when `lead`, the last is the footer. */
export function statusFrame(a: StatusIn): Run[][] {
  const { ui, health: h } = a;
  const u = Math.max(20, a.cols - 2);
  const kit = frameKit(ui, u);
  const { ascii, g, dim, txt, green, red, violet, row, ribbon, metaText, blank } = kit;

  // ---- NOW ----
  const kind = a.kind;
  const denied = Math.max(0, h.gates.denied ?? gatesSummary(h).deny);
  const fireAt = kind === 'working' || kind === 'blocked' || h.denyAgeSecs === undefined || h.denyAgeSecs < 60;
  const failing = a.gates.flatMap((x) => x.lines.filter((l) => !l.ok).map((l) => ({ group: x.id, ...l })));
  const showDenial = denied > 0 && fireAt;
  const idx = a.phases.indexOf(a.phase);
  const stepper = (): Run[] => {
    if (!a.phases.length) return [];
    // A: a passed stage `●` (green), the current one `◆` (violet), the rest `○`; done fills every pip. A stage counts as passed only when the run entered it (the panel's memo; with no record the position decides); the figure is passed + current, so it always agrees with the pips.
    const seen = a.entered && a.entered.length > 0 ? new Set(a.entered) : null;
    const passed = (p: string, i: number): boolean => kind === 'done' || (i < Math.max(0, idx) && (seen ? seen.has(p) : true));
    const isNow = (i: number): boolean => kind !== 'done' && i === idx;
    const cells: Run[] = a.phases.map((p, i): Run => (passed(p, i) ? green(g('●', '*')) : isNow(i) ? violet(g('◆', '#'), 1) : dim(g('○', 'o'))));
    const n = a.phases.filter((p, i) => passed(p, i) || isNow(i)).length;
    return [...merge(cells), dim(` ${n}/${a.phases.length}`)];
  };
  const toolsRun = h.hooks?.runTools;
  const lastRun = h.pulse?.runs.at(-1);
  const prevRun = h.hist?.runs.at(-1); // Y1a: the newest run of an earlier session, drawn `prev run` while this session has none
  const prompted = promptedOf(kind, h);
  const now: Run[][] = [];
  if (kind === 'idle') {
    const beat = a.now === undefined || ui.color === 'none' ? 0 : Math.floor(a.now / HEART_MS) % HEART.length;
    const noPrompt = !prompted;
    const prevText = prevRun ? `prev run ${elapsedClock(prevRun.secs)} ${prevRun.ok ? 'ok' : 'failed'}` : '';
    now.push(ribbon('NOW'));
    now.push(row([dim(ascii ? HEART_ASCII[beat]! : HEART[beat]!), txt(' idle'), dim(` · ${noPrompt ? 'no prompt yet' : lastRun ? `last run ${elapsedClock(lastRun.secs)}` : prevRun ? prevText : 'ready'}${noPrompt && prevRun ? ` · ${prevText}` : ''}`)]));
    const team = teamOf(h);
    now.push(row([dim(`armed: ${h.gates.checks.length} gates · ${WIRED_HOOKS.length} hooks${team ? ` · team ${team}` : ''}`)]));
  } else {
    now.push(ribbon('NOW', h.upSecs !== undefined ? metaText(`up ${elapsedClock(h.upSecs)}`) : []));
    const head: Run[] = kind === 'done' ? [green(g('●', '*')), txt(' done', { bold: true })]
      : kind === 'blocked' ? [red(g('■', 'x')), txt(' blocked', { bold: true })]
        : [violet(a.spin, 2), txt(` ${a.phase && idx >= 0 ? a.phase : 'working'}`, { bold: true })];
    now.push(row(head, stepper()));
    if (showDenial) {
      const first = failing[0];
      const what = first ? first.label.replace(/\s+calls?$/i, '') : '';
      now.push(row([red(`${g('■', 'x')} ${denied} ${denied === 1 ? 'call' : 'calls'} denied${what ? ` · ${what}` : ''}`)]));
      if (first?.fix) now.push(row([dim(`fix: ${first.fix}`)]));
    } else {
      const parts = kind === 'done'
        ? [...(toolsRun !== undefined ? [`${toolsRun} ${toolsRun === 1 ? 'tool' : 'tools'}`] : []), ...(h.last?.endedAgo !== undefined ? [`ended ${agoText(h.last.endedAgo)} ago`] : [])]
        : [...(h.hooks?.runTool ? [h.hooks.runTool.replace(/^mcp__.*__/, '')] : []), ...(toolsRun !== undefined ? [`${toolsRun} ${toolsRun === 1 ? 'tool' : 'tools'}`] : []), ...(a.todos.total > 0 ? [`item ${a.todos.done}/${a.todos.total} done`] : [])];
      if (parts.length) now.push(row([dim(parts.join(' · '))]));
    }
  }

  const src: GateSrc = { gates: a.gates, prompted, ...(a.read ? { read: a.read } : {}) };
  const feed = hookFeed(h);
  const footer = footerRow(kit, h);
  const context = statusContextRows(kit, h);
  const runsSec = statusRunsRows(kit, h);

  // ---- the stack (D, Y2a, Z1): sections, then every spare row down to the pinned footer goes to the RECENT log. A short pane gives up whole sections, never rows of one: HOOKS, RUNS, the gate children, CONTEXT, ACTIVITY in that order; a `+N more ›` chip ends the body when a section went. ----
  type Plan = { chart: number; recent: number; hooks: boolean; runs: boolean; children: boolean; ctx: boolean; activity: boolean };
  const dropped = (o: Plan): string[] => [...(o.activity ? [] : ['activity']), ...(o.ctx || !context.length ? [] : ['context']), ...(o.runs || !runsSec.length ? [] : ['runs']), ...(o.hooks ? [] : ['hooks'])];
  const sectionsOf = (o: Plan): Run[][][] => [
    now, ...(o.activity ? [statusActivityRows(kit, h, o.chart)] : []), ...(o.ctx && context.length ? [context] : []), ...(o.runs && runsSec.length ? [runsSec] : []),
    statusGatesRows(kit, h, src, o.children), ...(o.hooks ? [statusHooksRows(kit, h, undefined, hooksRead(a.read))] : []), ...(o.recent > 0 && feed.length ? [statusRecentRows(kit, h, feed, o.recent)] : []),
  ];
  const sizeOf = (o: Plan): number => { const s = sectionsOf(o); return (a.lead ? 1 : 0) + sum(s.map((x) => x.length)) + s.length - 1 + (dropped(o).length ? 2 : 0); };
  const foot = footer.length ? 1 : 0;
  const cap = a.room > 0 ? a.room - foot : Infinity;
  // Z1: the chart's rows are the pane's alone (chartRows), never the run's state; rows the sections leave go to the RECENT log
  let plan: Plan = { chart: chartRows(a.room), recent: 0, hooks: true, runs: true, children: true, ctx: true, activity: true };
  if (a.room > 0) {
    const fits = (o: Plan): boolean => sizeOf(o) <= cap;
    if (!fits(plan)) plan = { ...plan, hooks: false };
    if (!fits(plan)) plan = { ...plan, runs: false };
    if (!fits(plan)) plan = { ...plan, children: false };
    if (!fits(plan)) plan = { ...plan, ctx: false };
    if (!fits(plan)) plan = { ...plan, activity: false };
    if (fits(plan) && plan.activity) while (plan.recent < feed.length && fits({ ...plan, recent: plan.recent + 1 })) plan = { ...plan, recent: plan.recent + 1 };
  }
  const secs = sectionsOf(plan);
  const gone = dropped(plan);
  const more: Run[][] = gone.length ? [blank, moreRow(kit, gone.length, STATUS_HOLDER[gone[0]!] ?? 'gates')] : [];
  const body: Run[][] = [...(a.lead ? [blank] : []), ...secs.flatMap((s, i) => [...s, ...(i < secs.length - 1 ? [blank] : [])]), ...more];
  if (a.room > 0) {
    const cut = body.slice(0, cap);
    return [...cut, ...Array.from({ length: Math.max(0, cap - cut.length) }, () => blank), ...(foot ? [footer] : [])];
  }
  return [...body, ...(foot ? [blank, footer] : [])];
}
