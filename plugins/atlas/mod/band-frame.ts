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
import { RATE_BUCKETS } from './pulse';
import { ctxLevel, latencyLevel } from './status-frame';
import { fitText, textWidth } from './theme';

/** Cells of the state head (`◌ idle up 0:41`); the detail slot adds a gap and DETAIL_W after it. */
export const HEAD_W = 17;
export const DETAIL_W = 10;
/** The detail slot shows from this band width. */
export const DETAIL_FROM = 85;
/** The gates chip and the health chip, in cells, padding included. */
export const GATES_CHIP_W = 16;
export const HEALTH_CHIP_W = 10;
/** Press keys: the gates chip opens the pane on its gates tab, the health chip toggles the card. A `#n` suffix keeps the pieces of one chip apart; hover scopes read what is before it. */
export const BAND_GATES_KEY = 'band:gates';
export const BAND_HEALTH_KEY = 'band:health';
/** The spark's scale floor: one event in the window is `▂`, seven fill it. */
const SPARK_SCALE = 7;
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

export const bandLook = (ui: Ui) => ui.theme === 'latte'
  ? { fill: PALETTES.latte.base, text: PALETTES.latte.text, dim: xtermHex(241), rule: xtermHex(250), chipBg: xtermHex(253), chipFg: xtermHex(54), litBg: xtermHex(147), litFg: xtermHex(54), alertBg: xtermHex(224), alertFg: xtermHex(124), ok: PALETTES.latte.ok, warn: PALETTES.latte.warn, bad: PALETTES.latte.bad, work: xtermHex(54), ramp: [xtermHex(97), xtermHex(98), xtermHex(54)] as const }
  : { fill: xtermHex(235), text: xtermHex(252), dim: xtermHex(244), rule: xtermHex(238), chipBg: xtermHex(239), chipFg: xtermHex(183), litBg: xtermHex(60), litFg: xtermHex(255), alertBg: xtermHex(52), alertFg: xtermHex(210), ok: ui.color === '256' ? PALETTES.mocha.ok : xtermHex(78), warn: xtermHex(214), bad: xtermHex(203), work: xtermHex(183), ramp: [xtermHex(97), xtermHex(141), xtermHex(183)] as const };

const pad3 = (n: number): string => String(Math.max(0, Math.min(999, Math.round(n)))).padStart(3, ' ');

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

  // Z6: an idle band beside the open pane has no detail text, so its empty slot is the health figure's room
  const idleOpen = a.kind === 'idle' && h.panel === true && (h.hooks?.latency !== undefined || h.ctxPct !== undefined);
  const detailOn = cols >= DETAIL_FROM && !idleOpen;
  const narrow = !detailOn; // K: with the pane open at 110 the band is about 58 cells: the state slot and the gates chip keep their own width (no padding) so the spark keeps its unit
  // ---- the gates chip ----
  const g = gatesSummary(h);
  const denied = g.deny > 0 || (h.gates.denied ?? 0) > 0 ? Math.max(1, Math.min(99, h.gates.denied ?? g.deny)) : 0;
  const chip = (pieces: { t: string; fg: string; bold?: boolean }[], key: string, bg: string): Run[] => pieces.map((p, i): Run => ({ t: p.t, tone: 'accent', fg: p.fg, bgHex: bg, bold: p.bold ?? true, press: pieces.length > 1 ? `${key}#${i}` : key, hover: true }));
  const glyph = (full: string, plain: string): string => (ascii ? plain : full);
  // One idiom (F): the gates chip is clickable (it opens the gates tab), so it is a raised chip with a trailing ` ›`; the dot is the panel's own colour (green once checks passed, grey while armed, red on a denial).
  const tail = glyph('›', '>');
  const body = (text: string, fg: string, dot: { t: string; fg: string }, bg: string): Run[] => chip([{ t: ` ${dot.t} `, fg: dot.fg }, { t: (`${text} ${tail}`).padEnd(narrow ? 0 : GATES_CHIP_W - 3), fg }], BAND_GATES_KEY, bg);
  let gates: Run[];
  if (denied > 0) {
    const fresh = a.kind === 'working' || h.denyAgeSecs === undefined || h.denyAgeSecs < DENY_RED_SECS;
    gates = fresh
      ? body(`${denied} denied`, k.alertFg, { t: glyph('■', 'x'), fg: k.alertFg }, k.alertBg)
      : body(`${denied} denied`, k.warn, { t: glyph('■', 'x'), fg: k.warn }, k.chipBg);
  } else if (g.fired === 0 || !promptedOf(a.kind, h)) gates = body('gates armed', k.chipFg, { t: glyph('○', 'o'), fg: k.dim }, k.chipBg);
  else gates = body('gates ok', k.chipFg, { t: glyph('●', '*'), fg: k.ok }, k.chipBg);
  const joinW = 3;
  const gatesW = gates.reduce((n, x) => n + textWidth(x.t), 0);

  // ---- the state slot ----
  const head: Run[] = [];
  if (a.kind === 'idle') {
    head.push(on(ascii ? '.' : '◌', k.dim, { tone: 'sub' }), dim(' idle'), ...(h.upSecs !== undefined ? [dim(` up ${elapsedClock(h.upSecs)}`)] : []));
  } else if (a.kind === 'done') {
    head.push(on(ascii ? '*' : '●', k.ok, { tone: 'ok' }), txt(' done'), dim(` ${a.phase.of}/${a.phase.of}`));
  } else {
    head.push(on(a.spin, k.work, { tone: 'accent' }), txt(` ${a.phase.word || 'working'}`, { bold: true }), ...(a.phase.word ? [dim(` ${a.phase.n}/${a.phase.of}`)] : []));
  }
  const fitHead = (runs: Run[], w: number): Run[] => {
    let left = w;
    const out: Run[] = [];
    for (const x of runs) {
      if (left <= 0) break;
      const t = fitText(x.t, left);
      out.push(t === x.t ? x : { ...x, t });
      left -= textWidth(t);
    }
    return [...out, ...pad(left)];
  };
  const detailText = a.kind === 'working' ? (h.hooks?.runTool ?? '').replace(/^mcp__.*__/, '') : a.kind === 'done' && a.restSecs !== undefined ? `ended ${agoText(a.restSecs)}` : '';
  // X5: with the pane open at 110 the band is about 57 cells: the idle uptime gives way before the spark loses its unit (state, gates chip and `ev/5m` stay)
  const eventsAll = h.pulse?.events;
  if (narrow && h.panel === true && a.kind === 'idle' && h.upSecs !== undefined && eventsAll) {
    const sparkNeed = joinW + 3 + 1 + String(Math.max(0, Math.min(999, Math.round(eventsAll.slice(-RATE_BUCKETS).reduce((n, x) => n + x, 0))))).length + 6;
    const withUp = capW + 1 + head.reduce((n, x) => n + textWidth(x.t), 0) + joinW + gatesW + sparkNeed;
    if (withUp > cols) head.splice(2, 1);
  }
  const headW = narrow ? Math.min(HEAD_W, head.reduce((n, x) => n + textWidth(x.t), 0)) : HEAD_W;
  const state: Run[] = [...fitHead(head, headW), ...(detailOn ? [...pad(1), ...fitHead(detailText ? [dim(detailText)] : [], DETAIL_W)] : [])];
  const used0 = capW + 1 + (detailOn ? HEAD_W + 1 + DETAIL_W : headW);
  const lead: Run[] = [...cap, ...pad(1), ...state];
  if (cols < capW + 1 + headW) return [...a.cap, ...(cols > capW + 1 ? [...pad(1), ...fitHead(head, cols - capW - 1)] : [])];

  const out: Run[] = [...lead];
  let w = used0;

  if (w + joinW + gatesW <= cols) { out.push(...join(), ...gates); w += joinW + gatesW; }

  // ---- the events spark and rate, or the bare count ----
  const events = h.pulse?.events;
  const healthChip = h.button === true && h.panel !== true;
  const chipRoom = h.button === true ? HEALTH_CHIP_W : 0; // reserved with the pane open too, so the open row is the closed row minus the chip
  if (events) {
    const n = events.slice(-RATE_BUCKETS).reduce((s, x) => s + x, 0);
    const sparkMax = cols >= 120 ? 20 : cols >= 110 ? 10 : 5;
    const countText = narrow ? String(Math.max(0, Math.min(999, Math.round(n)))) : pad3(n);
    const room = cols - (healthChip ? chipRoom : 0) - w; // X5: with the pane open the health chip is not drawn, so its cells are the spark's
    const sparkW = [sparkMax, 3].find((sw) => sw <= sparkMax && joinW + sw + 1 + textWidth(countText) + 6 <= room);
    if (sparkW !== undefined) {
      const vals = events.slice(-sparkW);
      const cells = [...blockSpark(vals, sparkW, { ascii, min: SPARK_SCALE })];
      const body: Run[] = [];
      const first = cells.length - vals.length;
      cells.forEach((ch, i) => {
        const v = i < first ? 0 : vals[i - first]!;
        const fg = v <= 0 ? k.rule : k.ramp[Math.min(2, Math.floor((i * 3) / cells.length))]!;
        const prev = body.at(-1);
        if (prev && prev.fg === fg) prev.t += ch;
        else body.push(on(ch, fg, { tone: v <= 0 ? 'dim' : 'sub' }));
      });
      out.push(...join(), ...body, txt(` ${countText}`), dim(' ev/5m'));
      w += joinW + sparkW + 1 + textWidth(countText) + 6;
    } else if (w + joinW + 6 <= cols - chipRoom) {
      out.push(...join(), txt(`${pad3(n)}`), dim('/5m'));
      w += joinW + 6;
    }
  }

  // ---- the extras, dropped from the end ----
  const extras: Run[][] = [];
  const inkOf = (lv: 'ok' | 'warn' | 'bad'): Partial<Run> => (lv === 'bad' ? { fg: k.bad, tone: 'bad' } : lv === 'warn' ? { fg: k.warn, tone: 'warn' } : { fg: k.ok, tone: 'ok' });
  const ctxExtra = (): Run[] => [dim('ctx '), txt(`${pad3(h.ctxPct!)}%`, inkOf(ctxLevel(h.ctxPct!)))];
  const hookExtra = (long: boolean): Run[] => [dim(long ? 'hook p50 ' : 'hook '), txt(`${long && narrow ? String(Math.round(h.hooks!.latency!.p50)) : pad3(h.hooks!.latency!.p50)}ms`, inkOf(latencyLevel(h.hooks!.latency!.p50)))];
  if (idleOpen) {
    // Z6: at idle beside the open pane, one live health figure after the spark, shed before the spark loses its unit: the hook median in the latency colours, else the context
    if (h.hooks?.latency) extras.push(hookExtra(true));
    if (h.ctxPct !== undefined) extras.push(ctxExtra()); // the context stands in when the median does not fit
  } else {
    if (h.ctxPct !== undefined) extras.push(ctxExtra());
    if (h.hooks?.latency) extras.push(hookExtra(false));
  }
  // Y1c: one age per state: a finished run's `ended 12s` already says when the last event came, so `last 12s` beside it is left out while the two are the same instant
  const stateAge = a.kind === 'done' ? a.restSecs : undefined;
  const lastAge = h.hooks?.lastEventSecs;
  if (!idleOpen && lastAge !== undefined && !(stateAge !== undefined && Math.abs(stateAge - lastAge) <= 2)) extras.push([dim('last '), txt(agoText(lastAge).padEnd(3))]);
  if (!idleOpen && h.pulse?.cost) extras.push([txt(`$${h.pulse.cost.usd.toFixed(2)}`)]);
  const limit = cols - chipRoom; // the chip carries its own leading cell
  for (const ex of extras) {
    const width = ex.reduce((s, x) => s + textWidth(x.t), 0);
    if (w + joinW + width > limit) { if (idleOpen) continue; break; }
    out.push(...join(), ...ex);
    w += joinW + width;
    if (idleOpen) break; // one figure
  }

  // ---- the health chip, right-anchored ----
  if (healthChip && w + HEALTH_CHIP_W <= cols) {
    out.push(...pad(cols - w - HEALTH_CHIP_W), ...chip([{ t: ` ${h.open ? (ascii ? 'v' : '▾') : ascii ? '>' : '▸'} health `, fg: h.open ? k.litFg : k.chipFg, ...(h.open ? { bold: true } : {}) }], BAND_HEALTH_KEY, h.open ? k.litBg : k.chipBg));
    return out;
  }
  out.push(...pad(cols - w));
  return out;
}
