// status-frame.ts: the side panel's status tab of the approved frame spec (critics/mock-final.md frames S1-S8), as runs. Pure: the panel hands it the run state, the phase list and the health figures.
//
// Grid (spec 2.1): every row is `gutter + U usable cells` (the host draws the border before it and the margin after it); a ribbon starts at usable col 1, body content at col 5 (indent 4), numbers
// are right-aligned to col U. The sections, in order: NOW (state head, phase stepper `●●◆○○○ 3/6`, the `doing` line or the denial), ACTIVITY (20 buckets x 15 s as 3 rows of eighth blocks, the
// `0└5m───now` axis and the stats column), CONTEXT (gauge `▰▱`, `~N turns left`, `+Nk/turn`; absent before the first measure), RUNS (after the first run), GATES (checks ok fail), HOOKS (the elastic
// section: every free row), then the footer pinned to the last row. One blank row separates sections; spare rows are blank at the bottom, never between sections.
//
// Overflow (2.8): HOOKS rows shrink first (one row stays), then RUNS goes, then gate child rows collapse to group rows. NOW and the denial line never shrink.
// Colour (2.4): green only for measured passes, amber for ctx >= 70 % or a hook p50 >= 50 ms, red for denial and failure, violet ramp 97/141/183 for the bars.
import { elapsedClock, type Run, type Ui } from './atlas-ui';
import { bandLook } from './band-frame';
import { WIRED_HOOKS } from './hook-log';
import { agoText, gatesSummary, promptedOf, severityOf, teamOf, tokenText, type Health } from './idle-health';
import { ctxDelta, ctxRunway, RATE_BUCKETS } from './pulse';
import { fitText, textWidth } from './theme';
import { gateCounts } from './vocab';

/** Buckets of the activity chart: 20 x 15 s = the 5 minutes every surface counts. */
export const STATUS_BUCKETS = RATE_BUCKETS;
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
  /** A clickable chip (2.3): one filled run spanning U (or `span` cells), one cell of padding each side, `left` flush left and `right` flush right inside the fill. `alert` is the denial chip (bg 52), `lit` the selected one. */
  const chip = (left: string, right: string, style: 'idle' | 'lit' | 'alert' = 'idle', span = u): Run[] => {
    const inner = Math.max(1, span - 2);
    const l = fitText(left, Math.max(1, inner - (right ? textWidth(right) + 1 : 0)));
    const gap = Math.max(0, inner - textWidth(l) - textWidth(right));
    const text = ` ${l}${' '.repeat(gap)}${right} `;
    const look = style === 'alert' ? { fg: k.alertFg, bgHex: k.alertBg } : style === 'lit' ? { fg: k.litFg, bgHex: k.litBg, bold: true } : { fg: k.chipFg, bgHex: k.chipBg };
    return [sp(1), { t: text, tone: 'text', hover: true, ...look }];
  };
  return { u, k, ascii, g, on, dim, txt, green, red, amber, violet, w, sp, row, ribbon, metaText, chip, blank: [] as Run[] };
}
export type Kit = ReturnType<typeof frameKit>;

/** The elements the dock and the card share. Each builder takes the kit (so the width is the caller's: U in the pane, a column in the card) and the health. */
export type GateSrc = { gates: readonly StatusGate[]; prompted: boolean };

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

const WINDOW_MS = 300_000;
const GUTTER = 3; // y gutter of the chart: a two-cell label and the `┤` tick
export const GATE_COL = 5;
/** The y gutter and the last chart row of one stack are the most the chart takes; spare rows beyond the spec's 8 go to it only when nothing else can use them (no blank void above the footer). */
const CHART_SPEC_MAX = 8;
const CHART_MAX = 12;
const CHART_MIN = 3;

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

/** The chart's series at `cols` columns: events per column, bucket width = 5 min / cols, aligned to the wall clock (`pulse.stamps`); a pulse with only the 20 x 15 s series spreads each bucket's count to the column at its centre. */
export function chartSeries(h: Health, cols: number): { vals: number[]; total: number; peak15: number } {
  const vals = new Array<number>(cols).fill(0);
  const p = h.pulse;
  let peak15 = 0;
  if (p?.stamps && p.at !== undefined) {
    const bms = WINDOW_MS / cols;
    const cur = Math.floor(p.at / bms);
    const wide = new Map<number, number>();
    for (const at of p.stamps) {
      const slot = cols - 1 - Math.max(0, cur - Math.floor(at / bms));
      if (slot < 0) continue;
      vals[slot]!++;
      const k = Math.floor(at / 15_000);
      wide.set(k, (wide.get(k) ?? 0) + 1);
    }
    peak15 = Math.max(0, ...wide.values());
  } else {
    const ev = [...new Array<number>(Math.max(0, STATUS_BUCKETS - (p?.events.length ?? 0))).fill(0), ...(p?.events ?? []).slice(-STATUS_BUCKETS)];
    ev.forEach((v, i) => { if (v > 0) vals[Math.min(cols - 1, Math.floor(((i + 0.5) * cols) / STATUS_BUCKETS))]! += v; });
    peak15 = Math.max(0, ...ev);
  }
  return { vals, total: sum(vals), peak15 };
}

/** ACTIVITY (C): the section rule carries the stats (`6 ev · peak 4/15s · last 1s`, idle `0 ev · waiting`); under it `rows` chart rows of eighth blocks, one bucket per column across the whole content width after a 3-cell y gutter (`4┤` on the top row, `0┤` on the baseline), an empty baseline cell the dim zero glyph; then the x labels aligned to the chart's own first and last columns. */
export function statusActivityRows(kit: Kit, h: Health, rows: number): Run[][] {
  const { on, dim, txt, row, ribbon, metaText, g, k, ascii, sp } = kit;
  const w = Math.max(8, kit.u - INDENT - GUTTER);
  const { vals, total, peak15 } = chartSeries(h, w);
  const ramp = ascii ? BLOCKS_ASCII : BLOCKS;
  const scale = Math.max(4, ...vals);
  const levels = rows * 8;
  const level = (v: number): number => (v <= 0 ? 0 : Math.max(1, Math.min(levels, Math.round((v / scale) * levels))));
  const lastSecs = h.hooks?.lastEventSecs;
  const meta = total > 0 ? `${total} ev · peak ${peak15}/15s${lastSecs !== undefined ? ` · last ${agoText(lastSecs)}` : ''}` : '0 ev · waiting';
  const out: Run[][] = [ribbon('ACTIVITY', metaText(meta))];
  for (let r = 0; r < rows; r++) {
    const bottom = rows - 1 - r;
    const gutter = r === 0 ? `${String(Math.min(99, scale)).padStart(2)}${g('┤', '|')}` : bottom === 0 ? ` 0${g('┤', '|')}` : `  ${g('│', '|')}`;
    const cells: Run[] = vals.map((v, i): Run => {
      const lv = Math.max(0, Math.min(8, level(v) - bottom * 8));
      if (lv === 0) return bottom === 0 ? on(ramp[1]!, k.rule, { tone: 'dim' }) : { t: ' ', tone: 'text' };
      return on(ramp[lv]!, k.ramp[Math.min(2, Math.floor((i * 3) / vals.length))]!, { tone: 'accent' });
    });
    out.push(row([dim(gutter), ...merge(cells)], [], INDENT));
  }
  const axis = new Array<string>(w).fill(' ');
  const put = (at: number, t: string): void => { for (let i = 0; i < t.length; i++) if (at + i >= 0 && at + i < w) axis[at + i] = t[i]!; };
  put(0, '-5m');
  put(w - 3, 'now');
  if (w >= 24) put(Math.floor((w - 5) / 2), '-2.5m');
  out.push(row([sp(GUTTER), dim(axis.join(''))], [], INDENT));
  void txt;
  return out;
}

/** CONTEXT (E): the ribbon carries the runway; one row, the gauge and `6% · 64k of 1M · +12k/turn` (the delta from two measures on). Absent before the first measure. */
export function statusContextRows(kit: Kit, h: Health): Run[][] {
  const { dim, txt, amber, violet, row, ribbon, metaText, g } = kit;
  const ctxs = h.pulse?.ctx ?? [];
  const pct = h.ctxPct ?? ctxs.at(-1)?.pct;
  if (pct === undefined) return [];
  const tokens = h.tokens ?? ctxs.at(-1)?.tokens;
  const window = h.pulse?.window ?? h.window;
  const delta = h.pulse && ctxs.length >= 2 ? ctxDelta({ ctx: ctxs }) : undefined;
  const text = [`${Math.round(pct)}%`, ...(tokens !== undefined ? [`${tokenText(tokens)}${window !== undefined ? ` of ${tokenText(window)}` : ' tokens'}`] : []), ...(delta ? [delta] : [])].join(' · ');
  const gw = Math.max(6, Math.min(GAUGE_W, kit.u - INDENT - 1 - textWidth(text)));
  const hot = pct >= 70;
  const filled = pct > 0 ? Math.max(1, Math.min(gw, Math.round((pct / 100) * gw))) : 0;
  const gauge: Run[] = [hot ? amber(g('▰', '#').repeat(filled)) : violet(g('▰', '#').repeat(filled), 1), dim(g('▱', '-').repeat(gw - filled))].filter((x) => x.t !== '');
  const runway = h.pulse ? ctxRunway({ ctx: ctxs, ...(window !== undefined ? { window } : {}) }) : undefined;
  return [ribbon('CONTEXT', runway !== undefined ? metaText(`~${runway} ${runway === 1 ? 'turn' : 'turns'} left`) : []), row([...gauge, hot ? amber(` ${text}`) : txt(` ${text}`)])];
}

/** RUNS (E): one bar per run scaled to the longest (green ok, red failed), then `1 run · med 0:05 · max 0:05`. */
export function statusRunsRows(kit: Kit, h: Health): Run[][] {
  const { on, dim, red, sp, row, ribbon, k, ascii } = kit;
  const ramp = ascii ? BLOCKS_ASCII : BLOCKS;
  const runs = h.pulse?.runs ?? [];
  if (!runs.length) return [];
  const longest = Math.max(1, ...runs.map((x) => x.secs));
  const bars: Run[] = merge(runs.slice(-12).map((x) => on(ramp[Math.max(1, Math.min(8, Math.round((x.secs / longest) * 7) + 1))]!, x.ok ? k.ok : k.bad, { tone: x.ok ? 'ok' : 'bad' })));
  const sorted = runs.map((x) => x.secs).sort((p, q) => p - q);
  const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);
  const failed = runs.filter((x) => !x.ok).length;
  // the figures give way from the right (max, then med) before a word is cut in a narrow pane
  const count = `${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`;
  const failedW = failed ? textWidth(` · ${failed} failed`) : 0;
  const room = kit.u - INDENT - runs.slice(-12).length - 2;
  const figs = [`${count} · med ${elapsedClock(med)} · max ${elapsedClock(longest)}`, `${count} · med ${elapsedClock(med)}`, count].find((t) => textWidth(t) + failedW <= room) ?? count;
  return [ribbon('RUNS'), row([...bars, sp(2), dim(`${figs}${failed ? ' · ' : ''}`), ...(failed ? [red(`${failed} failed`)] : [])])];
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
  const out: Run[][] = [ribbon('GATES', metaText(`${cell('pass')}${cell('deny')}${cell('last')}`))];
  const none = g('—', '-');
  for (const c of h.gates.checks) {
    const n = gateCounts(c);
    const deny = n.total - n.pass;
    const fired = n.total > 0 && (src.prompted || deny > 0);
    const mark = deny > 0 ? red(g('■', 'x')) : fired ? green(g('●', '*')) : dim(g('○', 'o'));
    const lastSecs = fired ? gateLastSecs(h, c) : undefined;
    const right: Run[] = fired
      ? [txt(cell(String(n.pass))), deny > 0 ? red(cell(String(deny))) : txt(cell('0')), lastSecs !== undefined ? dim(cell(agoText(lastSecs))) : dim(cell(none))]
      : [dim(cell('0')), dim(cell('0')), dim(cell(none))];
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

export type HookRow = { name: string; n: number; p50?: number; p95?: number; lastSecs?: number };
/** One row per wired hook (every hook in WIRED_HOOKS, fired or not) from the hook log's per-kind figures; a health without `perHook` gets them from `byLabel` and the recent events. */
export function hookTable(h: Health): HookRow[] {
  const hk = h.hooks;
  return WIRED_HOOKS.map((name): HookRow => {
    const ph = hk?.perHook?.find((x) => x.label === name);
    if (ph) return { name, n: ph.n, ...(ph.p50 !== undefined ? { p50: ph.p50 } : {}), ...(ph.p95 !== undefined ? { p95: ph.p95 } : {}), ...(ph.lastSecs !== undefined ? { lastSecs: ph.lastSecs } : {}) };
    const mine = (hk?.recent ?? []).filter((e) => e.label.split(' ')[0] === name);
    const ms = mine.flatMap((e) => (e.ms !== undefined ? [e.ms] : [])).sort((a, b) => a - b);
    const rank = (p: number): number => ms[Math.min(ms.length - 1, Math.max(0, Math.ceil(ms.length * p) - 1))]!;
    const n = (hk?.byLabel ?? []).find((x) => x.label === name)?.n ?? mine.length;
    return { name, n, ...(ms.length ? { p50: rank(0.5), p95: rank(0.95) } : {}), ...(mine.length ? { lastSecs: Math.min(...mine.map((e) => e.ageSecs)) } : {}) };
  });
}

/** HOOKS (D): the fixed table of the wired hooks, header row then one row each: name, count, p50, p95, last (right-aligned, flush right). A hook that never fired is dim `0 — — —`. The rule states the latency colours once (amber over 100 ms, red over 500 ms); only the latency cells take them. `rows` cuts the table from the end on a short pane. */
export function statusHooksRows(kit: Kit, h: Health, rows = WIRED_HOOKS.length): Run[][] {
  const { dim, txt, red, amber, row, ribbon, metaText, g } = kit;
  const narrow = kit.u < 44;
  const wl = narrow ? 5 : 6;
  const pad = (t: string, n: number): string => t.padStart(n);
  const none = g('—', '-');
  const ms = (v: number | undefined): Run => (v === undefined ? dim(pad(none, wl)) : v > 500 ? red(pad(`${v}ms`, wl)) : v > 100 ? amber(pad(`${v}ms`, wl)) : txt(pad(`${v}ms`, wl)));
  const out: Run[][] = [ribbon('HOOKS', metaText('p95 amber>100ms red>500ms')), row([dim('hook')], [dim(pad('n', 4)), dim(pad('p50', wl)), dim(pad('p95', wl)), dim(pad('last', 5))])];
  for (const e of hookTable(h).slice(0, Math.max(0, rows))) {
    const fired = e.n > 0;
    out.push(row([fired ? txt(e.name) : dim(e.name)], [fired ? txt(pad(String(e.n), 4)) : dim(pad('0', 4)), ms(e.p50), ms(e.p95), e.lastSecs !== undefined ? dim(pad(agoText(e.lastSecs), 5)) : dim(pad(none, 5))]));
  }
  return out;
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
  const prompted = promptedOf(kind, h);
  const now: Run[][] = [];
  if (kind === 'idle') {
    const beat = a.now === undefined || ui.color === 'none' ? 0 : Math.floor(a.now / HEART_MS) % HEART.length;
    const noPrompt = !prompted;
    now.push(ribbon('NOW'));
    now.push(row([dim(ascii ? HEART_ASCII[beat]! : HEART[beat]!), txt(' idle'), dim(` · ${noPrompt ? 'no prompt yet' : lastRun ? `last run ${elapsedClock(lastRun.secs)}` : 'ready'}`)]));
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

  const src: GateSrc = { gates: a.gates, prompted };
  const feed = hookFeed(h);
  const footer = footerRow(kit, h);
  const context = statusContextRows(kit, h);
  const runsSec = statusRunsRows(kit, h);

  // ---- the stack (D): sections, then every spare row down to the pinned footer goes to the chart (to 8), then the RECENT log, then the chart again (to 12); a short pane gives up hooks rows, RUNS, gate children, CONTEXT in that order ----
  type Plan = { chart: number; recent: number; hooks: number; runs: boolean; children: boolean; ctx: boolean };
  const sectionsOf = (o: Plan): Run[][][] => [
    now, statusActivityRows(kit, h, o.chart), ...(o.ctx && context.length ? [context] : []), ...(o.runs && runsSec.length ? [runsSec] : []),
    statusGatesRows(kit, h, src, o.children), statusHooksRows(kit, h, o.hooks), ...(o.recent > 0 && feed.length ? [statusRecentRows(kit, h, feed, o.recent)] : []),
  ];
  const sizeOf = (o: Plan): number => { const s = sectionsOf(o); return (a.lead ? 1 : 0) + sum(s.map((x) => x.length)) + s.length - 1; };
  const foot = footer.length ? 1 : 0;
  const cap = a.room > 0 ? a.room - foot : Infinity;
  let plan: Plan = { chart: a.room > 0 ? CHART_MIN : 4, recent: 0, hooks: WIRED_HOOKS.length, runs: true, children: true, ctx: true };
  if (a.room > 0) {
    const fits = (o: Plan): boolean => sizeOf(o) <= cap;
    while (!fits(plan) && plan.hooks > 1) plan = { ...plan, hooks: plan.hooks - 1 };
    if (!fits(plan)) plan = { ...plan, runs: false };
    if (!fits(plan)) plan = { ...plan, children: false };
    if (!fits(plan)) plan = { ...plan, ctx: false };
    if (fits(plan)) {
      while (plan.chart < CHART_SPEC_MAX && fits({ ...plan, chart: plan.chart + 1 })) plan = { ...plan, chart: plan.chart + 1 };
      while (plan.recent < feed.length && fits({ ...plan, recent: plan.recent + 1 })) plan = { ...plan, recent: plan.recent + 1 };
      while (plan.chart < CHART_MAX && fits({ ...plan, chart: plan.chart + 1 })) plan = { ...plan, chart: plan.chart + 1 };
    }
  }
  const secs = sectionsOf(plan);
  const body: Run[][] = [...(a.lead ? [blank] : []), ...secs.flatMap((s, i) => [...s, ...(i < secs.length - 1 ? [blank] : [])])];
  if (a.room > 0) {
    const cut = body.slice(0, cap);
    return [...cut, ...Array.from({ length: Math.max(0, cap - cut.length) }, () => blank), ...(foot ? [footer] : [])];
  }
  return [...body, ...(foot ? [blank, footer] : [])];
}
