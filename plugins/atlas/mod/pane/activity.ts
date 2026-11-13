// activity.ts: the small pure helpers the wave 30 surfaces share (board timeline, team tab, channel tab, finish cards): the one failure word, a relative age,
// an activity sparkline over a worker's own run, and the team's totals. Host free; nothing here draws.
import type { UiState } from '../atlas-ui';

/** The one word for a worker that did not finish (critique 28: `closed`, `worker killed`, `failed` and `killed` named one fact four ways). It reads `killed`, with the `■` mark, in error 203. */
export const KILLED = 'killed';
/** The word a surface of this wave draws for a state: `failed` reads `killed`, every other state is its own word. */
export const wordOf = (s: string): string => (s === 'failed' ? KILLED : s);

/** `20s`, `3m`, `2h`: how long ago, one figure. */
export function ageWord(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

const BLOCKS = '▁▂▃▄▅▆▇█';
const BLOCKS_ASCII = "_.-~'";

/** `n` cells of the tool calls a worker made over its own run (`startMs` to `endMs`): one bucket per cell, scaled to the busiest one; an empty bucket is the lowest bar, so a quiet stretch reads as a floor. */
export function sparkOf(calls: readonly number[] | undefined, startMs: number | undefined, endMs: number | undefined, n: number, ascii = false): string {
  const chars = ascii ? BLOCKS_ASCII : BLOCKS;
  const top = chars.length - 1;
  const buckets = new Array<number>(Math.max(1, n)).fill(0);
  if (calls && calls.length && startMs !== undefined && endMs !== undefined) {
    const span = Math.max(1000, endMs - startMs);
    for (const t of calls) {
      if (t < startMs || t > endMs + 1) continue;
      buckets[Math.min(buckets.length - 1, Math.floor(((t - startMs) / span) * buckets.length))]! += 1;
    }
  }
  const peak = Math.max(1, ...buckets);
  return buckets.map((v) => (v === 0 ? chars[0]! : chars[Math.max(1, Math.min(top, Math.round((v / peak) * top)))]!)).join('');
}

/** Wave 32 (critique 30: each team sparkline was stretched over its own agent's span, so the shapes lined up with nothing): `n` cells over the RUN's window (`from` to `to`), one axis for every row. A cell outside the agent's own
 * run (`startMs` to `endMs`) is blank; inside it an empty bucket is the lowest bar. */
export function sparkOver(calls: readonly number[] | undefined, from: number, to: number, startMs: number | undefined, endMs: number | undefined, n: number, ascii = false): string {
  const chars = ascii ? BLOCKS_ASCII : BLOCKS;
  const top = chars.length - 1;
  const cells = Math.max(1, n);
  const span = Math.max(1000, to - from);
  const buckets = new Array<number>(cells).fill(0);
  for (const t of calls ?? []) {
    if (t < from || t > to + 1) continue;
    buckets[Math.min(cells - 1, Math.floor(((t - from) / span) * cells))]! += 1;
  }
  const peak = Math.max(1, ...buckets);
  const first = startMs === undefined ? 0 : Math.max(0, Math.min(cells - 1, Math.floor(((startMs - from) / span) * cells)));
  const last = endMs === undefined ? cells - 1 : Math.max(first, Math.min(cells - 1, Math.floor(((endMs - from) / span) * cells)));
  return buckets.map((v, i) => (i < first || i > last ? ' ' : v === 0 ? chars[0]! : chars[Math.max(1, Math.min(top, Math.round((v / peak) * top)))]!)).join('');
}

/** What the team did: a count per state and the run's length from the first start to the last end. */
export type Totals = { running: number; done: number; killed: number; waiting: number; queued: number; blocked: number; secs: number; calls: number };
export function totalsOf(workers: readonly { state: UiState; startMs?: number | undefined; endMs?: number | undefined; tools?: number | undefined }[], lead?: { startMs?: number | undefined; endMs?: number | undefined } | undefined): Totals {
  const n = (s: UiState): number => workers.filter((w) => w.state === s).length;
  const all = [...workers, ...(lead ? [lead] : [])];
  const starts = all.map((w) => w.startMs).filter((x): x is number => typeof x === 'number');
  const ends = all.map((w) => w.endMs).filter((x): x is number => typeof x === 'number');
  const secs = starts.length && ends.length ? Math.max(0, Math.floor((Math.max(...ends) - Math.min(...starts)) / 1000)) : 0;
  return { running: n('running'), done: n('done'), killed: n('failed'), waiting: n('waiting'), queued: n('queued'), blocked: n('blocked'), secs, calls: workers.reduce((a, w) => a + (w.tools ?? 0), 0) };
}
