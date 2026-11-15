// band-segments.ts: the band's health segments, in priority order, as one list every width and pane state reads (spec P2, S-1, S-2).
//
// API
//   SEG_ORDER                         `gates`, `events`, `ctx`, `up`, `health`: the priority (a narrower band drops from the right; state and the chip stay)
//   bandSegments(h, ui, o)            the segments that have something to say, in SEG_ORDER; an empty segment is not in the list (`todo -` and `no agents` never exist)
//       gates   `● gates ok` (green) or `✗ 2 denied` (red): the denials summed over the gates that fired (vocab.gatesTotal; deny = lines not ok); `○ not fired` in grey when no gate has fired. No pass ratio
//       events  8 braille cells of the pulse's hook events (the last 8 of the one fixed-scale series, spark.sparkOf; data-ink blue-grey, peak brighter), `+ N tools` while working; absent while the pulse is not wired (never invented)
//       ctx     `ctx 6%`       grey under 50, amber 50 to 80, red over 80 (spark.ctxTone)
//       up      `up 0:09`      only while the side pane is closed (the panel owns it when open)
//       health  the `▸ health` chip, when handlers are wired
//   `o.ramp`: the idle breathing hex (band-motion idleRamp); the events spark's newest cell wears it. `live` lists the runs (by reference) that keep that colour on the band's fill.
//   bandDetail is gone: the second line of the band at 110 is the tab chips (mission-layout footerLines), and the last run's seconds are the band's state word alone.
import { elapsedClock, type Run, type Ui } from './atlas-ui';
import { clickRun } from './clickable';
import { gatesSummary, type Health } from './idle-health';
import { ctxTone, sparkRuns } from './spark';

export const SEG_ORDER = ['gates', 'events', 'ctx', 'up', 'health'] as const;
export type SegId = (typeof SEG_ORDER)[number];
export type BandSeg = { id: SegId; runs: Run[]; /** Runs of `runs` (same objects) that keep their own colour on the segment fill: the breathing cell. */ live?: Run[] };
export type SegOpts = { working?: boolean; ramp?: string | undefined };

/** The spark's width in the band. */
export const BAND_SPARK_W = 8;

const r = (t: string, tone: Run['tone'] = 'text', o: Partial<Run> = {}): Run => ({ t, tone, ...o });
const toolsOf = (h: Health): number => h.hooks?.runTools ?? 0; // the tool calls of THIS run (hook-log hookStats `since`), never the session's total

export function bandSegments(h: Health, ui: Ui, o: SegOpts = {}): BandSeg[] {
  const out: BandSeg[] = [];
  const g = gatesSummary(h);
  if (g.fired + g.notFired > 0) {
    out.push({ id: 'gates', runs: g.fired === 0 ? [r(ui.ascii ? 'o' : '○', 'sub'), r(' not fired', 'sub')] : g.deny > 0 ? [r(ui.ascii ? 'x' : '✗', 'bad'), r(` ${g.text}`, 'bad')] : [r(ui.ascii ? '*' : '●', 'ok'), r(' gates ok')] });
  }
  if (h.pulse) {
    const cells = sparkRuns(h.pulse.events, BAND_SPARK_W, ui, o.ramp !== undefined ? { newest: { tone: 'accent', fg: o.ramp } } : {});
    const newest = o.ramp !== undefined ? cells.at(-1) : undefined;
    const tools = o.working && toolsOf(h) > 0 ? [r(` ${toolsOf(h)} ${toolsOf(h) === 1 ? 'tool' : 'tools'}`, 'sub')] : [];
    out.push({ id: 'events', runs: [...cells, ...tools], ...(newest ? { live: [newest] } : {}) });
  }
  if (h.ctxPct !== undefined) {
    const tone = ctxTone(h.ctxPct);
    out.push({ id: 'ctx', runs: [r(`ctx ${Math.round(h.ctxPct)}%`, tone === 'ok' ? 'sub' : tone)] });
  }
  if (!h.panel && h.upSecs !== undefined) out.push({ id: 'up', runs: [r(`up ${elapsedClock(h.upSecs)}`, 'sub')] });
  if (h.button) out.push({ id: 'health', runs: [clickRun('health', !!h.open, ui, 'band:health')] });
  return out;
}
