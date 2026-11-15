// band-frame.ts: the one-row band of the approved frame spec (critics/mock-final.md frames B1-B10), as runs. Pure: the model hands it the pill, the state and the health figures.
//
// Row grammar (columns 1-based at pill width 11): pill 1-11, one space, the state slot from column 13: head (17 cells, `◌ idle up 0:41`, `◐ test 3/6`, `● done 6/6`) and, from W >= 85, a detail
// slot (1 gap + 10 cells: the newest tool while working, `ended 12s` once done), then segments joined by ` │ `: the gates chip (12 cells, fixed), the events spark (20/10/5 cells by width) with
// `%3d ev/5m`, or the bare `%3d/5m` when the spark does not fit, then the extras `ctx %3d%%`, `hook %3dms`, `last %-4s`, `$0.00` while they fit, then (pane closed) the 10-cell `▸ health` chip,
// right-anchored. Every figure is fixed width so the dividers never move when digits change. Narrowing order (2.7): state slot, gates chip, spark or count, health chip, detail slot, extras from the end.
// Colour (2.4): band bg 235, text 252, dim 244, rules 238, chips bg 239 fg 183, alert chip bg 52 fg 210, ok green 78 only on the done head, amber 214 for ctx >= 70 % and hook p50 >= 50 ms, red 203 for
// the denial mark. The only thing that changes colour with time is the heartbeat glyph (97 to 183).
import { elapsedClock, hostEnv, PALETTES, xtermHex, type Run, type Ui } from './atlas-ui';
import { idleLevel, idlePhase, IDLE_RAMP_256 } from './band-motion';
import { blockSpark } from './chart';
import { agoText, gatesSummary, type Health } from './idle-health';
import { reducedMotion } from './motion';
import { RATE_BUCKETS } from './pulse';
import { fitText, textWidth } from './theme';

/** Cells of the state head (`◌ idle up 0:41`); the detail slot adds a gap and DETAIL_W after it. */
export const HEAD_W = 17;
export const DETAIL_W = 10;
/** The detail slot shows from this band width. */
export const DETAIL_FROM = 85;
/** The gates chip and the health chip, in cells, padding included. */
export const GATES_CHIP_W = 12;
export const HEALTH_CHIP_W = 10;
/** Press keys: the gates chip opens the pane on its gates tab, the health chip toggles the card. A `#n` suffix keeps the pieces of one chip apart; hover scopes read what is before it. */
export const BAND_GATES_KEY = 'band:gates';
export const BAND_HEALTH_KEY = 'band:health';
/** The heartbeat of an idle band: one glyph per 400 ms, `◌ ◎ ◌ ◌`. */
const HEART = ['◌', '◎', '◌', '◌'] as const;
const HEART_ASCII = ['.', 'o', '.', '.'] as const;
const HEART_MS = 400;
/** The spark's scale floor: one event in the window is `▂`, seven fill it. */
const SPARK_SCALE = 7;
/** A denial reads red for this long after it was raised (and for as long as the run works). */
export const DENY_RED_SECS = 60;

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
  ? { fill: PALETTES.latte.base, text: PALETTES.latte.text, dim: xtermHex(241), rule: xtermHex(250), chipBg: xtermHex(253), chipFg: xtermHex(54), alertBg: xtermHex(224), alertFg: xtermHex(124), ok: PALETTES.latte.ok, warn: PALETTES.latte.warn, bad: PALETTES.latte.bad, work: xtermHex(54), ramp: [xtermHex(97), xtermHex(98), xtermHex(54)] as const }
  : { fill: xtermHex(235), text: xtermHex(252), dim: xtermHex(244), rule: xtermHex(238), chipBg: xtermHex(239), chipFg: xtermHex(183), alertBg: xtermHex(52), alertFg: xtermHex(210), ok: xtermHex(78), warn: xtermHex(214), bad: xtermHex(203), work: xtermHex(183), ramp: [xtermHex(97), xtermHex(141), xtermHex(183)] as const };

const lerp = (a: string, b: string, t: number): string => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) + (parseInt(b.slice(i, i + 2), 16) - parseInt(a.slice(i, i + 2), 16)) * t).toString(16).padStart(2, '0')).join('');
const pad3 = (n: number): string => String(Math.max(0, Math.min(999, Math.round(n)))).padStart(3, ' ');

/** The frame's text pieces: `fg` the colour, `dim`/`text` shorthand; every piece sits on the band fill unless it is a chip. */
export function bandFrameRuns(a: BandFrameIn): Run[] {
  const { ui, cols, health: h } = a;
  const k = bandLook(ui);
  const ascii = ui.ascii;
  const capW = a.cap.reduce((n, x) => n + textWidth(x.t), 0);
  const on = (t: string, fg: string, o: Partial<Run> = {}): Run => ({ t, tone: 'text', fg, bgHex: k.fill, ...o });
  const dim = (t: string): Run => on(t, k.dim, { tone: 'sub' });
  const txt = (t: string, o: Partial<Run> = {}): Run => on(t, k.text, o);
  const pad = (n: number): Run[] => (n > 0 ? [on(' '.repeat(n), k.text)] : []);
  const join = (): Run[] => [on(' ', k.text), on(ascii ? '|' : '│', k.rule, { tone: 'dim' }), on(' ', k.text)];

  // ---- the state slot ----
  const detailOn = cols >= DETAIL_FROM;
  const head: Run[] = [];
  if (a.kind === 'idle') {
    const frame = Math.floor(a.clockMs / HEART_MS) % HEART.length;
    const glyph = a.still ? HEART[0] : HEART[frame]!;
    const phase = idlePhase(a.clockMs);
    const level = idleLevel(phase);
    const moving = !a.still && ui.color !== 'none' && hostEnv().TERM !== 'dumb' && !reducedMotion(hostEnv());
    const hex = !moving ? k.dim : ui.color === '256' ? xtermHex(IDLE_RAMP_256[Math.floor(level / 2)]!) : lerp(k.ramp[0], k.ramp[2], level / 7);
    head.push(on(ascii ? HEART_ASCII[a.still ? 0 : frame]! : glyph, hex, { tone: 'sub' }), dim(' idle'), ...(h.upSecs !== undefined ? [dim(` up ${elapsedClock(h.upSecs)}`)] : []));
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
  const state: Run[] = [...fitHead(head, HEAD_W), ...(detailOn ? [...pad(1), ...fitHead(detailText ? [dim(detailText)] : [], DETAIL_W)] : [])];
  const used0 = capW + 1 + (detailOn ? HEAD_W + 1 + DETAIL_W : HEAD_W);
  const lead: Run[] = [...a.cap, ...pad(1), ...state];
  if (cols < capW + 1 + HEAD_W) return [...a.cap, ...(cols > capW + 1 ? [...pad(1), ...fitHead(head, cols - capW - 1)] : [])];

  const out: Run[] = [...lead];
  let w = used0;

  // ---- the gates chip ----
  const g = gatesSummary(h);
  const denied = g.deny > 0 || (h.gates.denied ?? 0) > 0 ? Math.max(1, Math.min(99, h.gates.denied ?? g.deny)) : 0;
  const chip = (pieces: { t: string; fg: string; bold?: boolean }[], key: string, bg: string): Run[] => pieces.map((p, i): Run => ({ t: p.t, tone: 'accent', fg: p.fg, bgHex: bg, bold: p.bold ?? true, press: pieces.length > 1 ? `${key}#${i}` : key, hover: true }));
  const glyph = (full: string, plain: string): string => (ascii ? plain : full);
  let gates: Run[];
  if (denied > 0) {
    const red = a.kind === 'working' || h.denyAgeSecs === undefined || h.denyAgeSecs < DENY_RED_SECS;
    const text = `${glyph('■', 'x')} ${denied} denied`;
    gates = red
      ? chip([{ t: ` ${text}`.padEnd(GATES_CHIP_W), fg: k.alertFg }], BAND_GATES_KEY, k.alertBg)
      : chip([{ t: ' ', fg: k.chipFg }, { t: glyph('■', 'x'), fg: k.bad }, { t: ` ${denied} denied`.padEnd(GATES_CHIP_W - 2), fg: k.chipFg }], BAND_GATES_KEY, k.chipBg);
  } else {
    const text = g.fired === 0 ? `${glyph('○', 'o')} gates` : `${glyph('●', '*')} gates ok`;
    gates = chip([{ t: ` ${text}`.padEnd(GATES_CHIP_W), fg: k.chipFg }], BAND_GATES_KEY, k.chipBg);
  }
  const joinW = 3;
  if (w + joinW + GATES_CHIP_W <= cols) { out.push(...join(), ...gates); w += joinW + GATES_CHIP_W; }

  // ---- the events spark and rate, or the bare count ----
  const events = h.pulse?.events;
  const healthChip = h.button === true && h.panel !== true;
  const chipRoom = healthChip ? HEALTH_CHIP_W : 0;
  if (events) {
    const n = events.slice(-RATE_BUCKETS).reduce((s, x) => s + x, 0);
    const sparkW = cols >= 120 ? 20 : cols >= DETAIL_FROM ? 10 : 5;
    const vals = events.slice(-sparkW);
    const cells = [...blockSpark(vals, sparkW, { ascii, min: SPARK_SCALE })];
    const full = joinW + sparkW + 1 + 9;
    if (w + full <= cols - chipRoom) {
      const body: Run[] = [];
      const first = cells.length - vals.length;
      cells.forEach((ch, i) => {
        const v = i < first ? 0 : vals[i - first]!;
        const fg = v <= 0 ? k.rule : k.ramp[Math.min(2, Math.floor((i * 3) / cells.length))]!;
        const prev = body.at(-1);
        if (prev && prev.fg === fg) prev.t += ch;
        else body.push(on(ch, fg, { tone: v <= 0 ? 'dim' : 'sub' }));
      });
      out.push(...join(), ...body, txt(` ${pad3(n)}`), dim(' ev/5m'));
      w += full;
    } else if (w + joinW + 6 <= cols - chipRoom) {
      out.push(...join(), txt(`${pad3(n)}`), dim('/5m'));
      w += joinW + 6;
    }
  }

  // ---- the extras, dropped from the end ----
  const extras: Run[][] = [];
  if (h.ctxPct !== undefined) extras.push([dim('ctx '), txt(`${pad3(h.ctxPct)}%`, h.ctxPct >= 70 ? { fg: k.warn, tone: 'warn' } : {})]);
  if (h.hooks?.latency) extras.push([dim('hook '), txt(`${pad3(h.hooks.latency.p50)}ms`, h.hooks.latency.p50 >= 50 ? { fg: k.warn, tone: 'warn' } : {})]);
  if (h.hooks?.lastEventSecs !== undefined) extras.push([dim('last '), txt(agoText(h.hooks.lastEventSecs).padEnd(4))]);
  if (h.pulse?.cost) extras.push([txt(`$${h.pulse.cost.usd.toFixed(2)}`)]);
  const limit = healthChip ? cols - chipRoom - 1 : cols;
  for (const ex of extras) {
    const width = ex.reduce((s, x) => s + textWidth(x.t), 0);
    if (w + joinW + width > limit) break;
    out.push(...join(), ...ex);
    w += joinW + width;
  }

  // ---- the health chip, right-anchored ----
  if (healthChip && w + HEALTH_CHIP_W <= cols) {
    out.push(...pad(cols - w - HEALTH_CHIP_W), ...chip([{ t: ` ${h.open ? (ascii ? 'v' : '▾') : ascii ? '>' : '▸'} health `, fg: k.chipFg }], BAND_HEALTH_KEY, k.chipBg));
    return out;
  }
  out.push(...pad(cols - w));
  return out;
}
