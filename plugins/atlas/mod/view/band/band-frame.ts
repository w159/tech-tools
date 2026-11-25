// band-frame.ts: the status ribbon of the redesigned band (SPEC "Band", band.png), as runs. Pure: the model hands it the pill, the state and the health figures.
//
// Row grammar: the `◆ ATLAS` pill, one space, the state slot (head: braille spinner, the phase word, `n/m` and the segmented phase bar; idle `◌ idle up 0:41`, done `✓ done 6/6 ▰▰▰▰▰▰`; from W >= 121 a detail
// slot after it: the newest tool while working, `ended 12s` once done), then slots joined by a thin ` │ `: the gates pill (16 cells, fixed: `■ 2 denied ›`), the tool rate (`tools ▁▂▃▅▇▆▃▂ 17/m`, 20 cells), the hook
// median (`hook p50 7ms`), the context (`ctx ━━━━━━━ 27%`: a thin bar, `━` filled and faint), then (pane closed) the 10-cell `▸ health` chip, right-anchored. Every figure is fixed width so the dividers never
// move when digits change. Narrowing order: state slot, gates pill, tool rate, health chip, detail slot, hook, context.
// Colour: text on the panel (no band fill), faint rules, green only on the done head and a healthy figure, amber for ctx >= 70 % and hook p50 >= 100 ms, red for the denial mark. Motion (a MotionCtx-free
// render is the resting one): the spinner turns, the tool-rate window slides with the clock, a new denial pulses its pill once.
import { contrast, elapsedClock, PALETTES, xtermHex, type Run, type Ui } from '../../design/atlas-ui';
import { idleRamp } from './band-motion';
import { blockSpark } from '../../design/chart';
import { agoText, gatesSummary, promptedOf, type Health } from '../../data/idle-health';
import { callBuckets } from '../../data/live';
import { metricsOf } from '../../data/metrics';
import { fitText, textWidth } from '../../design/theme';

/** Cells of the state head (`⠋ implement 5/6 ▰▰▰▰▰▱`); the detail slot adds a gap and DETAIL_W after it. */
const HEAD_W = 22;
const DETAIL_W = 10;
/** The head's width below NARROW_BELOW cells of band (the pane open at 110 columns). */
const HEAD_NARROW = 11;
const NARROW_BELOW = 75;
/** The detail rides the state slot from this band width, while the pane is closed (the pane's NOW row says it otherwise). */
export const DETAIL_FROM = 129;
/** The figure slots' widths: the tool rate (label, spark, figure), `hook p50 7ms`, `ctx ━━━━━━━ 27%`. */
export const SPARK_W = 8;
const TOOLS_W = 6 + SPARK_W + 5;
export const HOOK_W = 14;
const CTX_BAR_W = 7;
export const CTX_W = 4 + CTX_BAR_W + 1 + 4;
/** Kept for the panel's own layout (peak text); the ribbon no longer draws a peak slot. */
export const PEAK_W = 12;
/** The gates pill and the health chip, in cells, padding included. */
export const GATES_CHIP_W = 15;
export const HEALTH_CHIP_W = 10;
/** Press keys: the gates pill opens the pane on its gates tab, the health chip toggles the card. A `#n` suffix keeps the pieces of one chip apart; hover scopes read what is before it. */
export const BAND_GATES_KEY = 'band:gates';
export const BAND_HEALTH_KEY = 'band:health';
/** A denial reads red for this long after it was raised (and for as long as the run works). */
export const DENY_RED_SECS = 300;
/** The braille phase spinner of the ribbon, ten frames of SPIN_MS. */
const BRAILLE = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const SPIN_MS = 100;
/** The tool-rate window: eight cells of this many ms (a minute); the window slides with the clock. */
const RATE_BUCKET_MS = 7500;
/** A new denial pulses its pill this long. */
export const PULSE_MS = 400;

export type BandFrameIn = {
  cols: number;
  ui: Ui;
  /** The wordmark pill runs (`◆ ATLAS`). */
  cap: Run[];
  kind: 'idle' | 'working' | 'done';
  /** The shared spinner clock in ms: the spinner frame and the rate window read it. */
  clockMs: number;
  /** The working spinner glyph for the ASCII form (`|/-\`). */
  spin: string;
  /** Reduced motion: the spinner holds one glyph and one colour. */
  still: boolean;
  /** The phase word (`test`) and its place `n` of `of`; an empty word reads `working`. */
  phase: { word: string; n: number; of: number };
  /** Seconds since the last run ended (the done detail `ended 12s`). */
  restSecs?: number;
  /** Ms since the denied count last rose, while a MotionCtx watches it: the pill pulses for PULSE_MS. */
  denyPulseMs?: number;
  health: Health;
};

/** The context figure's colour (Y2d): green below 70 %, amber from 70 %, red from 90 %. */
export const ctxLevel = (pct: number): 'ok' | 'warn' | 'bad' => (pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : 'ok');

/** The latency colour on every surface (Z3): green up to 100 ms, amber above 100, red above 500. */
export const latencyLevel = (ms: number): 'ok' | 'warn' | 'bad' => (ms > 500 ? 'bad' : ms > 100 ? 'warn' : 'ok');

/** The denied-call count the gates pill shows: 0 when none, else 1..99. The one reading the pill and the motion feed share. */
export function deniedOf(h: Health): number {
  const g = gatesSummary(h);
  return g.deny > 0 || (h.gates.denied ?? 0) > 0 ? Math.max(1, Math.min(99, h.gates.denied ?? g.deny)) : 0;
}

export const bandLook = (ui: Ui) => ui.theme === 'latte'
  ? { fill: PALETTES.latte.base, text: PALETTES.latte.text, dim: xtermHex(241), rule: xtermHex(250), chipBg: xtermHex(253), chipFg: xtermHex(54), litBg: xtermHex(147), litFg: xtermHex(54), alertBg: xtermHex(224), alertFg: xtermHex(124), ok: PALETTES.latte.ok, warn: PALETTES.latte.warn, bad: PALETTES.latte.bad, work: xtermHex(54), ramp: [xtermHex(97), xtermHex(98), xtermHex(54)] as const }
  : { fill: xtermHex(235), text: xtermHex(252), dim: xtermHex(244), rule: xtermHex(238), chipBg: xtermHex(239), chipFg: xtermHex(183), litBg: xtermHex(60), litFg: xtermHex(255), alertBg: xtermHex(52), alertFg: xtermHex(210), ok: ui.color === '256' ? PALETTES.mocha.ok : xtermHex(78), warn: xtermHex(214), bad: xtermHex(203), work: xtermHex(183), ramp: [xtermHex(97), xtermHex(141), xtermHex(183)] as const };

/** The frame's text pieces: `fg` the colour, `dim`/`text` shorthand; every piece sits on the panel unless it is a chip. */
export function bandFrameRuns(a: BandFrameIn): Run[] {
  const { ui, cols, health: h } = a;
  const k = bandLook(ui);
  const ascii = ui.ascii;
  const capW = a.cap.reduce((n, x) => n + textWidth(x.t), 0);
  // The wordmark pill: at rest its fill breathes (2.4 s, 13 tones in truecolor, 8 in 256 colours, none without colour or with reduced motion).
  const breath = a.kind === 'idle' && !ascii ? idleRamp(a.clockMs, ui, undefined, a.still).hex : undefined;
  const cap: Run[] = ui.color === 'none' || ascii ? a.cap : a.cap.map((x): Run => {
    if (!breath || !x.chip) return x;
    const ink = contrast(xtermHex(234), breath) >= contrast(xtermHex(255), breath) ? xtermHex(234) : xtermHex(255);
    const { bg: _bg, ...rest } = x;
    return { ...rest, bgHex: breath, fg: ink };
  });
  const on = (t: string, fg: string, o: Partial<Run> = {}): Run => ({ t, tone: 'text', fg, bgHex: k.fill, ...o });
  const dim = (t: string): Run => on(t, k.dim, { tone: 'sub' });
  const txt = (t: string, o: Partial<Run> = {}): Run => on(t, k.text, o);
  const pad = (n: number): Run[] => (n > 0 ? [on(' '.repeat(n), k.text)] : []);
  const join = (): Run[] => [on(' ', k.text), on(ascii ? '|' : '│', k.rule, { tone: 'dim' }), on(' ', k.text)];
  const glyph = (full: string, plain: string): string => (ascii ? plain : full);

  // Fixed geometry: every slot has one width per band width, whatever the state or the data, so a separator sits at the same column in idle, working and done; a slot is shed whole, from the end, when it does not fit:
  // state slot (head, and the detail packed after it from DETAIL_FROM when the pane is closed), gates pill, tool rate, hook p50, ctx, then the health chip right-anchored.
  const detailOn = cols >= DETAIL_FROM && h.panel !== true;
  const stateW = detailOn ? HEAD_W + 1 + DETAIL_W : cols >= NARROW_BELOW ? HEAD_W : HEAD_NARROW;
  // ---- the gates pill ----
  const denied = deniedOf(h);
  const g = gatesSummary(h);
  const chip = (pieces: { t: string; fg: string; bold?: boolean }[], key: string, bg?: string): Run[] => pieces.map((p, i): Run => ({ t: p.t, tone: 'accent', fg: p.fg, bgHex: bg ?? k.fill, bold: p.bold ?? true, press: pieces.length > 1 ? `${key}#${i}` : key, hover: true }));
  const tail = glyph('›', '>');
  const body = (text: string, fg: string, dot: { t: string; fg: string }, o: { bg?: string; tailFg?: string } = {}): Run[] => chip([{ t: `${dot.t} `, fg: dot.fg }, { t: text, fg }, { t: ` ${tail}`.padEnd(GATES_CHIP_W - 2 - cellsOf(text)), fg: o.tailFg ?? k.dim, bold: false }], BAND_GATES_KEY, o.bg);
  let gates: Run[];
  if (denied > 0) {
    const fresh = a.kind === 'working' || h.denyAgeSecs === undefined || h.denyAgeSecs < DENY_RED_SECS;
    const pulsing = a.denyPulseMs !== undefined && a.denyPulseMs >= 0 && a.denyPulseMs < PULSE_MS && ui.color !== 'none';
    gates = pulsing
      ? body(`${denied} denied`, k.alertFg, { t: glyph('■', 'x'), fg: k.alertFg }, { bg: k.alertBg, tailFg: k.alertFg })
      : fresh
        ? body(`${denied} denied`, k.bad, { t: glyph('■', 'x'), fg: k.bad })
        : body(`${denied} denied`, k.warn, { t: glyph('■', 'x'), fg: k.warn });
  } else if (g.fired === 0 || !promptedOf(a.kind, h)) gates = body('gates armed', k.dim, { t: glyph('○', 'o'), fg: k.dim });
  else gates = body('gates ok', k.ok, { t: glyph('\u2713', '*'), fg: k.ok });
  const joinW = 3;

  // ---- the state slot: head, then the detail closed up after it (`✓ done 6/6 · ended 18s`), padded to the slot's one width ----
  const head: Run[] = [];
  const bar = (n: number, of: number, fg: string): Run[] => {
    const cellsN = Math.min(8, Math.max(0, of));
    if (cellsN === 0) return [];
    const lit = Math.min(cellsN, Math.round((Math.min(of, Math.max(0, n)) / of) * cellsN));
    return [txt(' '), on(glyph('▰', '#').repeat(lit), fg), on(glyph('▱', '-').repeat(cellsN - lit), k.rule, { tone: 'dim' })];
  };
  if (a.kind === 'idle') {
    head.push(on(ascii ? '.' : '◌', k.dim, { tone: 'sub' }), dim(' idle'), ...(h.upSecs !== undefined ? [dim(` up ${elapsedClock(h.upSecs)}`)] : []));
  } else if (a.kind === 'done') {
    head.push(on(glyph('\u2713', '*'), k.ok, { tone: 'ok' }), txt(' done'), dim(` ${a.phase.of}/${a.phase.of}`), ...bar(a.phase.of, a.phase.of, k.ok));
  } else {
    const spin = ascii ? a.spin : BRAILLE[a.still ? 0 : Math.floor(a.clockMs / SPIN_MS) % BRAILLE.length]!;
    head.push(on(spin, k.work, { tone: 'accent' }), txt(` ${a.phase.word || 'working'}`, { bold: true }), ...(a.phase.word ? [dim(` ${a.phase.n}/${a.phase.of}`), ...bar(a.phase.n, a.phase.of, k.work)] : []));
  }
  const widthOf = (runs: readonly Run[]): number => runs.reduce((n, x) => n + textWidth(x.t), 0);
  /** The runs that fit `w` cells: a run that does not fit whole is dropped from the end (the bar, then the `3/6`, before the word), the last one left is cut with `…`; padded to `w`. */
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

  // ---- the figures: tool rate, hook p50, ctx (all from metricsOf) ----
  const m = metricsOf(h);
  const healthChip = h.button === true && h.panel !== true;
  const limit = cols - (healthChip ? HEALTH_CHIP_W : 0); // the pane-closed health chip keeps its own cells at the right edge
  const slots: { w: number; runs: () => Run[]; alts?: { w: number; runs: () => Run[] }[] }[] = [];
  // The window slides with the clock: eight cells of RATE_BUCKET_MS ending now, from the raw event stamps; a pulse that kept only its 15 s buckets draws the newest eight of them.
  const stamps = h.pulse?.stamps;
  const nowMs = Math.max(a.clockMs, h.pulse?.at ?? 0);
  const events = stamps ? callBuckets(stamps, nowMs, SPARK_W, RATE_BUCKET_MS) : m.activity.vals.slice(-SPARK_W);
  const perMin = stamps ? events.reduce((n, x) => n + x, 0) : m.activity.vals.slice(-Math.max(1, Math.round(60 / m.activity.bucketSecs))).reduce((n, x) => n + x, 0);
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
  const rate = (): Run => txt(perMin > 99 ? '99+/m' : `${perMin > 0 || m.activity.total > 0 ? perMin : '—'}/m`.padStart(5));
  // The tool rate gives way in steps before it goes: the label first (`▄▁▁█▁▁▂▁ 17/m`), then the figure (the bare spark), so a narrow band keeps its eight-cell spark.
  slots.push({ w: TOOLS_W, runs: () => [dim('tools '), ...sparkRuns(), rate()], alts: [{ w: SPARK_W + 5, runs: () => [...sparkRuns(), rate()] }, { w: SPARK_W, runs: () => sparkRuns() }] });
  slots.push({ w: HOOK_W, runs: () => (m.hook ? [dim('hook p50 '), txt(`${String(m.hook.p50).padStart(3)}ms`, inkOf(latencyLevel(m.hook.p50)))] : [dim(`hook p50 ${'—'.padStart(3)}${'  '}`.slice(0, HOOK_W))]) });
  slots.push({
    w: CTX_W,
    runs: () => {
      if (!m.ctx) return [dim(`ctx ${(ascii ? '-' : '━').repeat(CTX_BAR_W)} ${'—'.padStart(3)} `)];
      const lit = Math.min(CTX_BAR_W, Math.round((CTX_BAR_W * m.ctx.pct) / 100));
      const ink = m.ctx.prev ? { fg: k.dim, tone: 'sub' as const } : inkOf(ctxLevel(m.ctx.pct));
      return [dim('ctx '), on((ascii ? '=' : '━').repeat(lit), ink.fg!, { tone: ink.tone }), on((ascii ? '-' : '━').repeat(CTX_BAR_W - lit), k.rule, { tone: 'dim' }), m.ctx.prev ? dim(` ${String(m.ctx.pct).padStart(3)}%`) : txt(` ${String(m.ctx.pct).padStart(3)}%`, inkOf(ctxLevel(m.ctx.pct)))];
    },
  });
  // a slot joins the row only when it and every slot before it fit (ctx goes first, then hook, then the tool rate)
  let blocked = false;
  for (const sl of slots) {
    if (blocked) break;
    const form = [{ w: sl.w, runs: sl.runs }, ...(sl.alts ?? [])].find((f) => w + joinW + f.w <= limit);
    if (!form) { blocked = true; break; }
    out.push(...join(), ...form.runs());
    w += joinW + form.w;
  }

  // ---- the health chip, right-anchored ----
  if (healthChip && w + HEALTH_CHIP_W <= cols) {
    out.push(...pad(cols - w - HEALTH_CHIP_W), ...chip([{ t: ` ${h.open ? (ascii ? 'v' : '▾') : ascii ? '>' : '▸'} health `, fg: h.open ? k.litFg : k.chipFg, ...(h.open ? { bold: true } : {}) }], BAND_HEALTH_KEY, h.open ? k.litBg : k.chipBg));
    return out;
  }
  out.push(...pad(cols - w));
  return out;
}

const cellsOf = (s: string): number => textWidth(s);
