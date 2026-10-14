// band.tsx — the AbovePrompt "Mission Control" panel: a framed multi-row band (header rail, one lane per
// live worker, channel ticker, footer). Pure: `register.ts` hands it the snapshot, live workers, gate
// groups, columns, the row budget and the spinner tick. Tiers: >=120 full, 80-119 no role/target,
// <80 header row only; maxRows collapses lanes first, then the ticker, then the footer.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot } from './orchestra-types';
import { activeCount, type LiveWorker } from './data/live';
import { routeCounts } from './data/todos';
import { groupOpenCount, openGateCount } from './gates';
import type { GateGroup } from './pane/sidebar-types';
import { rowOf, type Segment } from './runs';
import { barParts, chartRoom as C, fitText, meterColor, spin, textWidth } from './theme';

export type BandModel = { snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number; maxRows?: number };

const FULL = 120;
const MID = 80;
const REF_MS = 120_000; // an elapsed bar fills over two minutes
const TICKER_ROWS = 2;
const RAIL_SKIP = new Set(['validate', 'blocked']);
const BRAND_CHIP: Segment = { t: ' ATLAS ', color: C.focus, inverse: true, bold: true };
const DOT: Segment = { t: ' · ', color: C.muted };
const RAIL_SEP: Segment = { t: ' ─ ', color: C.faint };

type Ctx = { s: LiveSnapshot; inner: number; tick: number; full: boolean; now: number; done: number; total: number; open: number; gates: GateGroup[] };

const seg = (t: string, color?: string, bold?: boolean): Segment => ({ t, color, bold });
const width = (parts: Segment[]): number => parts.reduce((n, p) => n + textWidth(p.t), 0);
const padTo = (t: string, n: number): string => { const f = fitText(t, n); return f + ' '.repeat(Math.max(0, n - textWidth(f))); };
const age = (ms: number): string => (ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m`);

/** left parts, then right parts pushed to the far edge; the right side is dropped when there is no room. */
function spread(left: Segment[], right: Segment[], cols: number): Segment[] {
  const gap = cols - width(left) - width(right);
  return gap >= 1 ? [...left, seg(' '.repeat(gap)), ...right] : left;
}

/** Phase rail: past phases check, the current one animated, future ones hollow. Compact drops past/future names. */
function phaseRail(s: LiveSnapshot, tick: number, compact: boolean, animate = true): Segment[] {
  const ids = s.contract.phases.map((p) => p.id as string).filter((id) => !RAIL_SKIP.has(id));
  const at = ids.indexOf(s.phase);
  const out: Segment[] = [];
  ids.forEach((id, i) => {
    if (i > 0) out.push(RAIL_SEP);
    if (i === at) out.push(seg(`${animate ? spin(tick, id) : '◉'} ${id}`, animate ? C.live : C.focus, true));
    else if (i < at) out.push(seg(compact ? '✓' : `✓ ${id}`, C.ok));
    else out.push(seg(compact ? '○' : `○ ${id}`, C.muted));
  });
  return out;
}

const gateWord = (open: number): string => `gates ${open ? `✗${open}` : '✓'}`;

function headerRow(c: Ctx): Segment[] {
  const stats = [seg(`${c.done}/${c.total} tasks`, C.muted), DOT, seg(gateWord(c.open), c.open ? C.warn : C.ok)];
  return spread([BRAND_CHIP, seg(' '), ...phaseRail(c.s, c.tick, !c.full)], stats, c.inner);
}

const laneColor = (w: LiveWorker): string => (w.state === 'blocked' ? C.warn : w.state === 'failed' ? C.fail : C.live);

function laneGlyph(w: LiveWorker, c: Ctx): string {
  if (w.state === 'blocked') return '⏸';
  return w.state === 'failed' ? '✗' : spin(c.tick, c.s.phase);
}

function laneTool(w: LiveWorker): string {
  if (w.tool) return w.tool;
  return w.state === 'blocked' ? 'queued' : '-';
}

/** One worker lane: accent, name, role, glyph+tool, target, elapsed bar, age, state word. */
function lane(w: LiveWorker, c: Ctx): Segment[] {
  const color = laneColor(w);
  const elapsed = c.now - w.startedAt;
  const [fill, rest] = barParts((elapsed / REF_MS) * 100, 10);
  const parts: Segment[] = [seg('▌', color), seg(` ${padTo(w.name, 18)} `, undefined, true)];
  if (c.full) parts.push(seg(`${padTo(w.role, 12)} `, C.muted));
  parts.push(seg(`${laneGlyph(w, c)} ${padTo(laneTool(w), 12)} `, color));
  if (c.full) parts.push(seg(`${padTo(w.target ?? '', 24)} `, C.muted));
  parts.push(seg('▕', C.faint), seg(fill, meterColor((elapsed / REF_MS) * 100)), seg(rest, C.muted), seg('▏', C.faint));
  parts.push(seg(` ${age(elapsed).padStart(4)} `, C.muted), seg(w.state, color));
  return parts;
}

/** Last two channel messages as `from > to: text`, led by the channel name. */
function ticker(c: Ctx): Segment[] {
  const channel = c.s.channel?.split('/').pop() ?? 'lead';
  const msgs = c.s.comms.slice(-TICKER_ROWS).map((m) => `${m.from} > ${m.to}: ${m.text.replace(/\s+/g, ' ')}`);
  const parts: Segment[] = [seg(`#${channel}  `, C.focus)];
  msgs.forEach((m, i) => parts.push(...(i ? [DOT] : []), seg(m, C.muted)));
  return parts;
}

function footer(c: Ctx): Segment[] {
  const [fill, rest] = barParts((c.done / Math.max(1, c.total)) * 100, 9);
  const left: Segment[] = [seg('todos ', C.muted), seg(fill, c.total ? meterColor((c.done / c.total) * 100) : C.focus), seg(rest, C.muted), seg(` ${c.done}/${c.total}`, C.muted)];
  for (const g of c.gates.filter((x) => x.lines.length || x.error)) left.push(seg(groupOpenCount(g) ? ` ✗ ${g.id}` : ` ✓ ${g.id}`, groupOpenCount(g) ? C.warn : C.ok));
  return spread(left, [seg('/atlas-cc pane · r t c g tabs', C.faint)], c.inner);
}

/** How many lanes, ticker and footer rows fit `maxRows` (border 2 + header 1 are fixed). */
export function planRows(maxRows: number, nLanes: number, hasTicker: boolean): { lanes: number; ticker: boolean; footer: boolean; more: boolean } {
  const room = Math.max(0, maxRows - 3);
  let ticker = hasTicker;
  let footer = true;
  const need = Math.min(1, nLanes);
  while (room - (ticker ? 1 : 0) - (footer ? 1 : 0) < need && (ticker || footer)) {
    if (ticker) ticker = false;
    else footer = false;
  }
  let slots = room - (ticker ? 1 : 0) - (footer ? 1 : 0);
  if (nLanes > slots && slots < 2 && ticker) { // hidden workers beat the ticker: trade it for the "+N more" row
    ticker = false;
    slots += 1;
  }
  const more = nLanes > slots && slots >= 2;
  return { lanes: more ? slots - 1 : Math.min(nLanes, slots), ticker, footer, more };
}

const frame = (els: ClientElements, rows: Segment[][], inner: number, color: string): RenderElement =>
  els.Box({
    flexDirection: 'column', flexShrink: 0, borderStyle: 'round', borderColor: color,
    children: rows.map((r) => rowOf(els, r, inner)),
  });

/** Idle panel body: brand, compact rail, and what the last run did. */
function idleRow(c: Ctx, live: LiveWorker[]): Segment[] {
  const word = c.open ? 'blocked' : 'idle';
  const wcolor = c.open ? C.warn : C.muted;
  const n = live.length;
  const mins = n ? Math.max(1, Math.round((c.now - Math.min(...live.map((w) => w.startedAt))) / 60_000)) : 0;
  const failed = live.filter((w) => w.state === 'failed').length;
  const last = n ? ` · last run: ${n} workers, ${mins} min, ${failed ? `${failed} failed` : 'ok'}` : '';
  const left: Segment[] = [BRAND_CHIP, seg(' '), ...(c.inner >= MID ? [...phaseRail(c.s, c.tick, true, false), seg(' ')] : []), seg(word, wcolor, true)];
  return [...left, seg(c.inner >= MID ? last : '', C.muted), ...(c.open ? [seg(` · gates ✗${c.open}`, C.warn)] : [])];
}

export function bandTree(els: ClientElements, { snapshot: s, live, gates, columns, tick, maxRows = 12 }: BandModel): RenderElement {
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const open = openGateCount(gates);
  const all = live.filter((w) => w.state !== 'parked'); // parked workers are resting
  const shown = all.filter((w) => w.state !== 'done');
  const c: Ctx = { s, inner: Math.max(1, columns - 2), tick, full: columns >= FULL, now: s.now, done, total, open, gates };
  if (maxRows < 3) return rowOf(els, [BRAND_CHIP, seg(` ${s.phase} ${done}/${total}`, C.focus), ...(open ? [seg(` ✗${open}`, C.warn)] : [])], columns);
  if (!shown.length) return frame(els, [idleRow(c, all)], c.inner, open ? C.warn : C.muted);
  const color = open || shown.some((w) => w.state === 'blocked') ? C.warn : C.live;
  if (columns < MID) {
    const left = [BRAND_CHIP, seg(` ${s.phase} ${done}/${total}`, C.focus, true), DOT, seg(`${activeCount(shown)} working`, C.live)];
    return frame(els, [open ? [...left, DOT, seg(`✗${open}`, C.warn)] : left], c.inner, color);
  }
  const plan = planRows(maxRows, shown.length, s.comms.length > 0);
  const rows: Segment[][] = [headerRow(c), ...shown.slice(0, plan.lanes).map((w) => lane(w, c))];
  if (plan.more) rows.push([seg(`  +${shown.length - plan.lanes} more`, C.muted)]);
  if (plan.ticker) rows.push(ticker(c));
  if (plan.footer) rows.push(footer(c));
  return frame(els, rows, c.inner, color);
}
