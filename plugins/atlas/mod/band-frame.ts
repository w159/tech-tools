// band-frame.ts: the one-row band of the approved frame spec (critics/mock-final.md frames B1-B10), as runs. Pure: the model hands it the pill, the state and the health figures.
//
// Row grammar (columns 1-based at pill width 11): pill 1-11, one space, the state slot from column 13: head (17 cells, `◌ idle up 0:41`, `◐ test 3/6`, `● done 6/6`) and, from W >= 85, a detail
// slot (1 gap + 10 cells: the newest tool while working, `ended 12s` once done), then segments joined by ` │ `: the gates chip (12 cells, fixed), the events spark (20/10/5 cells by width) with
// `%3d ev/5m`, or the bare `%3d/5m` when the spark does not fit, then the extras `ctx %3d%%`, `hook %3dms`, `last %-4s`, `$0.00` while they fit, then (pane closed) the 10-cell `▸ health` chip,
// right-anchored. Every figure is fixed width so the dividers never move when digits change. Narrowing order (2.7): state slot, gates chip, spark or count, health chip, detail slot, extras from the end.
// Colour (2.4): band bg 235, text 252, dim 244, rules 238, chips bg 239 fg 183, alert chip bg 52 fg 210, ok green 78 only on the done head, amber 214 for ctx >= 70 % and hook p50 >= 50 ms, red 203 for
// the denial mark. The only thing that changes colour with time is the heartbeat glyph (97 to 183).
import { contrast, elapsedClock, PALETTES, xtermHex, type Run, type Ui } from './atlas-ui';
import { idleRamp } from './band-motion';
import { blockSpark } from './chart';
import { agoText, gatesSummary, promptedOf, type Health } from './idle-health';
import { metricsOf } from './metrics';
import { fitText, textWidth } from './theme';

/** Cells of the state head (`◌ idle up 0:41`); the detail slot adds a gap and DETAIL_W after it (AA2: packed in one 28-cell state slot, `● done 6/6 · ended 18s`). */
const HEAD_W = 17;
const DETAIL_W = 10;
/** The head's width below NARROW_BELOW cells of band (the pane open at 110 columns). */
const HEAD_NARROW = 11;
const NARROW_BELOW = 75;
/** The detail rides the state slot from this band width, while the pane is closed (the pane's NOW row says it otherwise): 121 = the state slot with detail, every figure slot and the health chip. */
export const DETAIL_FROM = 121;
/** AA2: the figure slots' widths: the spark (always 8 cells), `peak 3 / 5s`, `hook p50 7ms`, `ctx 6%`. */
export const SPARK_W = 8;
export const PEAK_W = 12;
export const HOOK_W = 14;
export const CTX_W = 8;
/** The gates chip and the health chip, in cells, padding included. */
export const GATES_CHIP_W = 16;
export const HEALTH_CHIP_W = 10;
/** Press keys: the gates chip opens the pane on its gates tab, the health chip toggles the card. A `#n` suffix keeps the pieces of one chip apart; hover scopes read what is before it. */
export const BAND_GATES_KEY = 'band:gates';
export const BAND_HEALTH_KEY = 'band:health';
/** A denial reads red for this long after it was raised (and for as long as the run works). */
export const DENY_RED_SECS = 300;

export type BandFrameIn = {
  cols: number;
  ui: Ui;
  /** The wordmark pill runs (`◖ ◆ ATLAS ◗`). */
  cap: Run[];
  kind: 'idle' | 'working' | 'done';
  /** The shared spinner clock in ms: the heartbeat frame and its colour read it. */
  clockMs: number;
  /** The working spinner glyph (`◐◓◑◒`). */
  spin: string;
  /** Reduced motion: the heartbeat holds one glyph and one colour. */
  still: boolean;
  /** The phase word (`test`) and its place `n` of `of`; an empty word reads `working`. */
  phase: { word: string; n: number; of: number };
  /** Seconds since the last run ended (the done detail `ended 12s`). */
  restSecs?: number;
  health: Health;
};

/** The context figure's colour (Y2d): green below 70 %, amber from 70 %, red from 90 %. */
export const ctxLevel = (pct: number): 'ok' | 'warn' | 'bad' => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');

/** The latency colour on every surface (Z3): green up to 100 ms, amber above 100, red above 500. */
export const latencyLevel = (ms: number): 'ok' | 'warn' | 'bad' => (ms > 500 ? 'bad' : ms > 100 ? 'warn' : 'ok');

export const bandLook = (ui: Ui) => ui.theme === 'latte'
  ? { fill: PALETTES.latte.base, text: PALETTES.latte.text, dim: xtermHex(241), rule: xtermHex(250), chipBg: xtermHex(253), chipFg: xtermHex(54), litBg: xtermHex(147), litFg: xtermHex(54), alertBg: xtermHex(224), alertFg: xtermHex(124), ok: PALETTES.latte.ok, warn: PALETTES.latte.warn, bad: PALETTES.latte.bad, work: xtermHex(54), ramp: [xtermHex(97), xtermHex(98), xtermHex(54)] as const }
  : { fill: xtermHex(235), text: xtermHex(252), dim: xtermHex(244), rule: xtermHex(238), chipBg: xtermHex(239), chipFg: xtermHex(183), litBg: xtermHex(60), litFg: xtermHex(255), alertBg: xtermHex(52), alertFg: xtermHex(210), ok: ui.color === '256' ? PALETTES.mocha.ok : xtermHex(78), warn: xtermHex(214), bad: xtermHex(203), work: xtermHex(183), ramp: [xtermHex(97), xtermHex(141), xtermHex(183)] as const };

/** The frame's text pieces: `fg` the colour, `dim`/`text` shorthand; every piece sits on the band fill unless it is a chip. */
export function bandFrameRuns(a: BandFrameIn): Run[] {
  const { ui, cols, health: h } = a;
  const k = bandLook(ui);
  const ascii = ui.ascii;
  const capW = a.cap.reduce((n, x) => n + textWidth(x.t), 0);
  // The wordmark pill (H, L): the `◖ ◗` caps sit on the band's own fill (no notch), and at rest the pill's background breathes (2.4 s, 13 tones in truecolor, 8 in 256 colours, none without colour or with reduced motion).
  const breath = a.kind === 'idle' && !ascii ? idleRamp(a.clockMs, ui, undefined, a.still).hex : undefined;
  const cap: Run[] = ui.color === 'none' || ascii ? a.cap : a.cap.map((x): Run => {
    if (x.t === '◖' || x.t === '◗') return { ...x, bgHex: k.fill, ...(breath ? { fg: breath } : {}) };
    if (!breath) return x;
    const ink = contrast(xtermHex(234), breath) >= contrast(xtermHex(255), breath) ? xtermHex(234) : xtermHex(255);
    const { bg: _bg, ...rest } = x;
    return { ...rest, bgHex: breath, fg: ink };
  });
  const on = (t: string, fg: string, o: Partial<Run> = {}): Run => ({ t, tone: 'text', fg, bgHex: k.fill, ...o });
  const dim = (t: string): Run => on(t, k.dim, { tone: 'sub' });
  const txt = (t: string, o: Partial<Run> = {}): Run => on(t, k.text, o);
  const pad = (n: number): Run[] => (n > 0 ? [on(' '.repeat(n), k.text)] : []);
  const join = (): Run[] => [on(' ', k.text), on(ascii ? '|' : '│', k.rule, { tone: 'dim' }), on(' ', k.text)];

  // AA2: fixed geometry. Every slot has one width per band width, whatever the state or the data, so a separator sits at the same column in idle, working and done; a slot is shed whole, from the end, when it does not fit:
  // state slot (head, and the detail packed after it from DETAIL_FROM when the pane is closed), gates chip, spark (8 cells), `peak 3 / 5s`, `hook p50 7ms`, `ctx 6%`, then the health chip right-anchored.
  const detailOn = cols >= DETAIL_FROM && h.panel !== true;
  const stateW = detailOn ? HEAD_W + 1 + DETAIL_W : cols >= NARROW_BELOW ? HEAD_W : HEAD_NARROW;
  // ---- the gates chip ----
  const g = gatesSummary(h);
  const denied = g.deny > 0 || (h.gates.denied ?? 0) > 0 ? Math.max(1, Math.min(99, h.gates.denied ?? g.deny)) : 0;
  const chip = (pieces: { t: string; fg: string; bold?: boolean }[], key: string, bg: string): Run[] => pieces.map((p, i): Run => ({ t: p.t, tone: 'accent', fg: p.fg, bgHex: bg, bold: p.bold ?? true, press: pieces.length > 1 ? `${key}#${i}` : key, hover: true }));
  const glyph = (full: string, plain: string): string => (ascii ? plain : full);
  // One idiom (F): the gates chip is clickable (it opens the gates tab), so it is a raised chip with a trailing ` ›`; the dot is the panel's own colour (green once checks passed, grey while armed, red on a denial).
  const tail = glyph('›', '>');
  const body = (text: string, fg: string, dot: { t: string; fg: string }, bg: string): Run[] => chip([{ t: ` ${dot.t} `, fg: dot.fg }, { t: (`${text} ${tail}`).padEnd(GATES_CHIP_W - 3), fg }], BAND_GATES_KEY, bg);
  let gates: Run[];
  if (denied > 0) {
    const fresh = a.kind === 'working' || h.denyAgeSecs === undefined || h.denyAgeSecs < DENY_RED_SECS;
    gates = fresh
      ? body(`${denied} denied`, k.alertFg, { t: glyph('■', 'x'), fg: k.alertFg }, k.alertBg)
      : body(`${denied} denied`, k.warn, { t: glyph('■', 'x'), fg: k.warn }, k.chipBg);
  } else if (g.fired === 0 || !promptedOf(a.kind, h)) gates = body('gates armed', k.chipFg, { t: glyph('○', 'o'), fg: k.dim }, k.chipBg);
  else gates = body('gates ok', k.chipFg, { t: glyph('●', '*'), fg: k.ok }, k.chipBg);
  const joinW = 3;

  // ---- the state slot: head, then the detail closed up after it (`● done 6/6 · ended 18s`), padded to the slot's one width ----
  const head: Run[] = [];
  if (a.kind === 'idle') {
    head.push(on(ascii ? '.' : '◌', k.dim, { tone: 'sub' }), dim(' idle'), ...(h.upSecs !== undefined ? [dim(` up ${elapsedClock(h.upSecs)}`)] : []));
  } else if (a.kind === 'done') {
    head.push(on(ascii ? '*' : '●', k.ok, { tone: 'ok' }), txt(' done'), dim(` ${a.phase.of}/${a.phase.of}`));
  } else {
    head.push(on(a.spin, k.work, { tone: 'accent' }), txt(` ${a.phase.word || 'working'}`, { bold: true }), ...(a.phase.word ? [dim(` ${a.phase.n}/${a.phase.of}`)] : []));
  }
  const widthOf = (runs: readonly Run[]): number => runs.reduce((n, x) => n + textWidth(x.t), 0);
  /** The runs that fit `w` cells: a run that does not fit whole is dropped from the end (the `3/6` before the word), the last one left is cut with `…`; padded to `w`. */
  const fitHead = (runs: Run[], w: number): Run[] => {
    const kept = [...runs];
    while (kept.length > 2 && widthOf(kept) > w) kept.pop();
    let left = w;
    const out: Run[] = [];
    for (const x of kept) {
      if (left <= 0) break;
      const t = fitText(x.t, left);
      out.push(t === x.t ? x : { ...x, t });
      left -= textWidth(t);
    }
    return [...out, ...pad(left)];
  };
  const detailText = a.kind === 'working' ? (h.hooks?.runTool ?? '').replace(/^mcp__.*__/, '') : a.kind === 'done' && a.restSecs !== undefined ? `ended ${agoText(a.restSecs)}` : '';
  const detailRoom = stateW - widthOf(head);
  const detailRun: Run[] = detailOn && detailText && detailRoom >= 5 ? [dim(fitText(` · ${detailText}`, detailRoom))] : [];
  const state: Run[] = fitHead([...head, ...detailRun], stateW);
  const lead: Run[] = [...cap, ...pad(1), ...state];
  const used0 = capW + 1 + stateW;
  if (cols < capW + 1 + Math.min(stateW, widthOf(head))) return [...a.cap, ...(cols > capW + 1 ? [...pad(1), ...fitHead(head, cols - capW - 1)] : [])];
  if (cols < used0) return [...a.cap, ...pad(1), ...fitHead(head, cols - capW - 1)];

  const out: Run[] = [...lead];
  let w = used0;
  const gatesW = widthOf(gates);
  if (w + joinW + gatesW <= cols) { out.push(...join(), ...gates); w += joinW + gatesW; }

  // ---- the figures: spark, peak, hook p50, ctx (AA1: all from metricsOf) ----
  const m = metricsOf(h);
  const healthChip = h.button === true && h.panel !== true;
  const limit = cols - (healthChip ? HEALTH_CHIP_W : 0); // the pane-closed health chip keeps its own cells at the right edge
  const slots: { w: number; runs: () => Run[]; glue?: boolean }[] = [];
  const events = m.activity.vals.slice(-SPARK_W);
  const sparkRuns = (): Run[] => {
    const cells = [...blockSpark(events, SPARK_W, { ascii, min: m.scale })];
    const first = cells.length - events.length;
    const runs: Run[] = [];
    cells.forEach((ch, i) => {
      const v = i < first ? 0 : events[i - first]!;
      const fg = v <= 0 ? k.rule : k.ramp[Math.min(2, Math.floor((i * 3) / cells.length))]!;
      const prev = runs.at(-1);
      if (prev && prev.fg === fg) prev.t += ch;
      else runs.push(on(ch, fg, { tone: v <= 0 ? 'dim' : 'sub' }));
    });
    return runs;
  };
  const inkOf = (lv: 'ok' | 'warn' | 'bad'): Partial<Run> => (lv === 'bad' ? { fg: k.bad, tone: 'bad' } : lv === 'warn' ? { fg: k.warn, tone: 'warn' } : { fg: k.ok, tone: 'ok' });
  slots.push({ w: SPARK_W, runs: sparkRuns });
  slots.push({ w: 1 + PEAK_W, glue: false, runs: () => [txt(' '), dim(fitText((m.activity.total > 0 ? (m.peakText.length > PEAK_W ? m.peakText.replace(' / ', '/') : m.peakText) : 'peak —').padEnd(PEAK_W), PEAK_W))] });
  slots.push({ w: HOOK_W, runs: () => (m.hook ? [dim('hook p50 '), txt(`${String(m.hook.p50).padStart(3)}ms`, inkOf(latencyLevel(m.hook.p50)))] : [dim(`hook p50 ${'—'.padStart(3)}${'  '}`.slice(0, HOOK_W))]) });
  slots.push({ w: CTX_W, runs: () => (m.ctx ? [dim('ctx '), m.ctx.prev ? dim(`${String(m.ctx.pct).padStart(3)}%`) : txt(`${String(m.ctx.pct).padStart(3)}%`, inkOf(ctxLevel(m.ctx.pct)))] : [dim(`ctx ${'—'.padStart(3)}${' '}`)]) });
  // a slot joins the row only when it and every slot before it fit (ctx goes first, then hook, then the peak figure, then the spark); the peak figure rides the spark's join, the others get their own
  let blocked = false;
  slots.forEach((sl, i) => {
    if (blocked) return;
    const need = i === 1 ? sl.w : joinW + sl.w;
    if (w + need > limit) { blocked = true; return; }
    out.push(...(i === 1 ? [] : join()), ...sl.runs());
    w += need;
  });

  // ---- the health chip, right-anchored ----
  if (healthChip && w + HEALTH_CHIP_W <= cols) {
    out.push(...pad(cols - w - HEALTH_CHIP_W), ...chip([{ t: ` ${h.open ? (ascii ? 'v' : '▾') : ascii ? '>' : '▸'} health `, fg: h.open ? k.litFg : k.chipFg, ...(h.open ? { bold: true } : {}) }], BAND_HEALTH_KEY, h.open ? k.litBg : k.chipBg));
    return out;
  }
  out.push(...pad(cols - w));
  return out;
}
