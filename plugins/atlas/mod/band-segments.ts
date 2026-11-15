// band-segments.ts: the band's health segments, in priority order, as one list every width and pane state reads (spec P2, S-1, S-2).
//
// API
//   SEG_ORDER                         `gates`, `events`, `ctx`, `health`: the priority (a narrower band drops from the right; state and the chip stay)
//   bandSegments(h, ui, o)            the segments that have something to say, in SEG_ORDER; an empty segment is not in the list (`todo -` and `no agents` never exist)
//       gates   `● gates ok` (green) or `✗ 2 denied` (red): the denials summed over the gates that fired (vocab.gatesTotal; deny = lines not ok); `○ not fired` in grey when no gate has fired. No pass ratio
//       events  8 eighth-block cells `▁▂▃▄▅▆▇█` of the pulse's hook events (round 3 E10: chart.blockSpark, dim `▁` baseline, never braille; data-ink blue-grey, peak brighter) and the rate ` 9/5m`; absent while the pulse is not wired (never invented). The tool count moved to the head (round 2 D2)
//       ctx     `ctx 6%`       grey under 50, amber 50 to 80, red over 80 (spark.ctxTone)
//   Round 2 (D9, D10): each slot is padded to a fixed width (GATES_W, spark + RATE_W, CTX_W); `o.ctx`/`o.rate`/`o.sparkW` are the narrowing steps (ctx, then the rate text, then the spark 8 -> 4). `up` is gone: the card owns it.
//       health  the `▸ health` chip (clickable.chipRun: raised fill, one cell of padding each side, the glyph inside), when handlers are wired: the band's ONLY chip, every other segment is static text on the band fill (round 3 E8)
//   `o.ramp`: the idle breathing hex (band-motion idleRamp); the events spark's newest cell wears it. `live` lists the runs (by reference) that keep that colour on the band's fill.
//   bandDetail is gone: the second line of the band at 110 is the tab chips (mission-layout footerLines), and the last run's seconds are the band's state word alone.
import { type Run, type Ui } from './atlas-ui';
import { blockSparkRuns } from './chart';
import { chevron, chipRun } from './clickable';
import { gatesSummary, recentEvents, type Health } from './idle-health';
import { rateLabel } from './pulse';
import { ctxTone } from './spark';
import { textWidth } from './theme';

export const SEG_ORDER = ['gates', 'events', 'ctx', 'health'] as const;
export type SegId = (typeof SEG_ORDER)[number];
export type BandSeg = { id: SegId; runs: Run[]; /** Runs of `runs` (same objects) that keep their own colour on the segment fill: the breathing cell. */ live?: Run[] };
/** `sparkW`: the spark's cells (8, or 4 on a narrow band); `rate`: the ` 9/5m` text after it (false: the spark alone); `ctx`: false leaves the ctx slot out. */
export type SegOpts = { ramp?: string | undefined; sparkW?: number; rate?: boolean; ctx?: boolean; /** The narrowest forms: the gates slot is its own text, not padded to GATES_W. */ tight?: boolean };

/** Round 2 (D9): every slot has a fixed width and pads its content to it, so a slot changes content, never width. */
export const BAND_SPARK_W = 8;
export const GATES_W = 12;
export const RATE_W = 6;
export const CTX_W = 8;

const r = (t: string, tone: Run['tone'] = 'text', o: Partial<Run> = {}): Run => ({ t, tone, ...o });
const padded = (runs: Run[], w: number): Run[] => {
  const used = runs.reduce((n, x) => n + textWidth(x.t), 0);
  return used < w ? [...runs, r(' '.repeat(w - used), 'sub')] : runs;
};

export function bandSegments(h: Health, ui: Ui, o: SegOpts = {}): BandSeg[] {
  const out: BandSeg[] = [];
  const g = gatesSummary(h);
  if (g.fired + g.notFired > 0) {
    out.push({ id: 'gates', runs: padded(g.fired === 0 ? [r(ui.ascii ? 'o' : '○', 'sub'), r(' not fired', 'sub')] : g.deny > 0 ? [r(ui.ascii ? 'x' : '✗', 'bad'), r(` ${g.text}`, 'bad')] : [r(ui.ascii ? '*' : '●', 'ok'), r(' gates ok')], o.tight ? 0 : GATES_W) });
  }
  if (h.pulse) {
    const sparkW = o.sparkW ?? BAND_SPARK_W;
    const cells = blockSparkRuns(h.pulse.events, sparkW, ui, o.ramp !== undefined ? { newest: { tone: 'accent', fg: o.ramp } } : {});
    const newest = o.ramp !== undefined ? cells.at(-1) : undefined;
    const rate = o.rate === false ? [] : padded([r(` ${rateLabel(h.pulse.events)}`, 'sub')], RATE_W + 1);
    out.push({ id: 'events', runs: [...cells, ...rate], ...(newest ? { live: [newest] } : {}) });
  }
  if (h.ctxPct !== undefined && o.ctx !== false) {
    const tone = ctxTone(h.ctxPct);
    out.push({ id: 'ctx', runs: padded([r(`ctx ${Math.round(h.ctxPct)}%`, tone === 'ok' ? 'sub' : tone)], CTX_W) });
  }
  if (h.button) out.push({ id: 'health', runs: [chipRun(`${chevron(!!h.open, ui)} health`, ui, 'band:health')] });
  return out;
}

/** The band's slack ticker: the newest hook event (`· tool call Bash`, `· turn finished · 3 events`) as one dim run, no age; `[]` when there is no event or it does not fit `room` cells (the caller keeps two cells before it and one after). */
export function tickerRuns(h: Pick<Health, 'hooks'>, room: number): Run[] {
  const e = recentEvents(h.hooks?.recent ?? [], 1)[0];
  if (!e) return [];
  const t = `· ${e.text}`;
  return textWidth(t) + 3 <= room ? [{ t, tone: 'sub' }] : [];
}
