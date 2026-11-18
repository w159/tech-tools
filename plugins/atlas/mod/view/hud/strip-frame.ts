// strip-frame.ts: Y1d, the narrow idle health strip. Below 144 columns the host does not place the side pane at rest, so an idle session would show only the band. The strip is two rows drawn directly
// above the band, on the band's own fill, from the same figures the health card shows:
//   ◌ idle · last run 0:05 ok · 12 runs · med 0:41                               ▸ details
//   gates 4 armed · hooks p95 13ms · ctx 6% · ▁▁▂▁ 1 ev/5m
// The whole strip is one clickable area: every run carries the card's press key (the band's `▸ health` toggle), so a press anywhere on it opens the card, and `▸ details` is the visible chip.
// A figure from an earlier session is labelled `prev`. Values wear the semantic colours (green ok, amber warn, red fail); labels are grey. Pure.
import { elapsedClock, type Run, type Ui } from '../../design/atlas-ui';
import { blockSpark } from '../../design/chart';
import { CARD_KEY } from './card-frame';
import { fitFields, gatesSummary, promptedOf, type Health, type HealthField } from '../../data/idle-health';
import { metricsOf, runFigures, runsOf } from '../../data/metrics';
import { frameKit, latencyLevel } from './status-frame';
import { textWidth } from '../../design/theme';
import { WIRED_HOOKS } from '../../host/hook-log';

/** The side pane docks at rest from this width (register.ts DOCK_MIN_COLUMNS); below it the strip stands in for it. */
export const STRIP_BELOW_COLS = 144;
/** Rows the strip takes above the band. */
export const STRIP_ROWS = 2;

/** Whether the strip is drawn: idle, narrower than the pane's rest width, with neither the pane nor the card open. */
export const stripWanted = (o: { cols: number; kind: string; panel: boolean; open: boolean }): boolean => o.kind === 'idle' && o.cols < STRIP_BELOW_COLS && !o.panel && !o.open;

const GLUE = ' · ';

/** The two strip rows at `cols` cells, each exactly `cols` wide on the band's fill, every run pressing the card's toggle. */
export function healthStripRows(h: Health, o: { cols: number; ui: Ui }): Run[][] {
  const cols = Math.max(8, o.cols);
  const kit = frameKit(o.ui, cols);
  const { k, g, ascii } = kit;
  const on = (t: string, fg: string, x: Partial<Run> = {}): Run => ({ t, tone: 'text', fg, bgHex: k.fill, press: CARD_KEY, ...x });
  const dim = (t: string): Run => on(t, k.dim, { tone: 'sub' });
  const txt = (t: string): Run => on(t, k.text);
  const green = (t: string): Run => on(t, k.ok, { tone: 'ok' });
  const amber = (t: string): Run => on(t, k.warn, { tone: 'warn' });
  const red = (t: string): Run => on(t, k.bad, { tone: 'bad' });
  const fill = (n: number): Run[] => (n > 0 ? [on(' '.repeat(n), k.text)] : []);
  const field = (runs: Run[], keep: number): HealthField => ({ runs, keep });
  const line = (fields: HealthField[], right: Run[]): Run[] => {
    const room = cols - 2 - (right.length ? right.reduce((n, x) => n + textWidth(x.t), 0) + 1 : 0); // one cell of margin each side
    const body = fitFields(fields, room).map((x) => (x.t === ' · ' ? on(GLUE, k.rule, { tone: 'dim' }) : { ...x, fg: x.fg ?? k.text, bgHex: k.fill, press: CARD_KEY }));
    const used = 1 + body.reduce((n, x) => n + textWidth(x.t), 0) + (right.length ? right.reduce((n, x) => n + textWidth(x.t), 0) : 0);
    return [...fill(1), ...body, ...fill(Math.max(0, cols - used - (right.length ? 1 : 0))), ...right, ...fill(right.length ? 1 : 0)];
  };

  // ---- row 1: the state and the runs ----
  const m = metricsOf(h);
  const runs = runsOf(h);
  const last = m.run;
  const heart = on(g('◌', '.'), k.dim, { tone: 'sub' });
  const state = field([heart, dim(' idle')], 9);
  const lastRun = field(last ? [dim(`${last.prev ? 'prev' : 'last'} run `), txt(last.text), dim(' '), last.ok ? green('ok') : red('failed')] : [dim('no runs yet')], 8);
  const count = runs.length;
  const figs = field(count ? [txt(`${count}`), dim(` ${count === 1 ? 'run' : 'runs'}`), ...(count >= 2 ? [dim(' · med '), txt(elapsedClock(runFigures(runs.map((x) => x.secs)).med))] : []), ...(runs.some((x) => !x.ok) ? [dim(' · '), red(`${runs.filter((x) => !x.ok).length} failed`)] : [])] : [], 5);
  const chipText = ` ${ascii ? '>' : '▸'} details `;
  const chip: Run = { t: chipText, tone: 'accent', fg: k.chipFg, bgHex: k.chipBg, bold: true, press: CARD_KEY, hover: true };
  const row1 = line([state, lastRun, figs], cols >= 40 ? [chip] : []);

  // ---- row 2: gates, hooks, context, the events spark ----
  const sum = gatesSummary(h);
  const denied = Math.max(sum.deny, h.gates.denied ?? 0);
  const armed = sum.fired === 0 || !promptedOf('idle', h);
  const gatesField = field(denied > 0 ? [dim('gates '), red(`${denied} denied`)] : armed ? [dim('gates '), txt(`${h.gates.checks.length || sum.fired} armed`)] : [dim('gates '), green('ok')], 9);
  // Z2, Z3: the p95 only from 5 samples (else the median, named p50), in the one latency colour
  const lat = m.hook;
  const paint = (ms: number): Run => ({ ok: green, warn: amber, bad: red }[latencyLevel(ms)])(`${ms}ms`);
  const hooksField = field(lat ? [dim('hooks p50 '), paint(lat.p50)] : [dim('hooks '), txt(`${WIRED_HOOKS.length} armed`)], 6);
  const ctxVal = m.ctx?.pct;
  const ctxField = field(ctxVal === undefined ? [] : [dim('ctx '), (ctxVal >= 90 ? red : ctxVal >= 70 ? amber : green)(m.ctx!.text), ...(m.ctx!.prev ? [dim(' prev')] : [])], 7);
  const ev = m.activity.vals.slice(-8);
  const evField = field(h.pulse ? [on(blockSpark(ev, 8, { ascii, min: m.scale }), k.ramp[1]!, { tone: 'accent' }), txt(` ${m.activity.total}`), dim(` ev · ${m.peakText}`)] : [], 5);
  const row2 = line([gatesField, hooksField, ctxField, evField], []);

  return [row1, row2];
}
