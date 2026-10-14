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
  return ids.flatMap((id, i) => [...(i ? [RAIL_SEP] : []), railStep(id, i - at, tick, compact, animate)]);
}

/** One rail cell; `rel` is its position relative to the current phase (0 current, <0 past, >0 future). */
const railNow = (id: string, tick: number, animate: boolean): Segment => (animate ? seg(`${spin(tick, id)} ${id}`, C.live, true) : seg(`◉ ${id}`, C.focus, true));
const railPast = (id: string, compact: boolean): Segment => seg(compact ? '✓' : `✓ ${id}`, C.ok);
const railFuture = (id: string, compact: boolean): Segment => seg(compact ? '○' : `○ ${id}`, C.muted);
function railStep(id: string, rel: number, tick: number, compact: boolean, animate: boolean): Segment {
  if (rel === 0) return railNow(id, tick, animate);
  return rel < 0 ? railPast(id, compact) : railFuture(id, compact);
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

/** `mcp__lean-ctx__ctx_shell` and `mcp__plugin_x_srv__tool` both read as the bare tool name. */
export const shortTool = (tool: string): string => tool.replace(/^mcp__.*__/, '');

/** The tool in flight; between calls the last one, dimmed, so the cell never blanks out. */
function laneTool(w: LiveWorker): string {
  const tool = w.tool ?? w.lastTool;
  if (tool) return shortTool(tool);
  return w.state === 'blocked' ? 'queued' : 'starting';
}

/** One worker lane: accent, name, role, glyph+tool, target, elapsed bar, age, state word. */
function lane(w: LiveWorker, c: Ctx): Segment[] {
  const color = laneColor(w);
  const elapsed = c.now - w.startedAt;
  const [fill, rest] = barParts((elapsed / REF_MS) * 100, 10);
  const parts: Segment[] = [seg('▌', color), seg(` ${padTo(w.name, 18)} `, undefined, true)];
  if (c.full) parts.push(seg(`${padTo(w.role, 12)} `, C.muted));
  parts.push(seg(`${laneGlyph(w, c)} `, color), seg(`${padTo(laneTool(w), 12)} `, w.tool ? color : C.muted));
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

const gateChip = (g: GateGroup): Segment => (groupOpenCount(g) ? seg(` ✗ ${g.id}`, C.warn) : seg(` ✓ ${g.id}`, C.ok));
const hasGateData = (g: GateGroup): boolean => g.lines.length > 0 || !!g.error;

function todoBar(c: Ctx): Segment[] {
  const pct = (c.done / Math.max(1, c.total)) * 100;
  const [fill, rest] = barParts(pct, 9);
  return [seg('todos ', C.muted), seg(fill, c.total ? meterColor(pct) : C.focus), seg(rest, C.muted), seg(` ${c.done}/${c.total}`, C.muted)];
}

function footer(c: Ctx): Segment[] {
  const left = [...todoBar(c), ...c.gates.filter(hasGateData).map(gateChip)];
  return spread(left, [seg('/atlas-cc pane · r t c g tabs', C.faint)], c.inner);
}

/** Whether the ticker and footer stay: drop the ticker first, then the footer, until `need` lane rows fit. */
function chrome(room: number, need: number, hasTicker: boolean): [boolean, boolean] {
  for (const [t, f] of [[hasTicker, true], [false, true], [false, false]] as const) if (room - +t - +f >= need) return [t, f];
  return [false, false];
}

/** Hidden workers beat the ticker: trade it for the "+N more" row. */
const tradesTicker = (kept: boolean, nLanes: number, slots: number): boolean => kept && nLanes > slots && slots < 2;
const needsMore = (nLanes: number, slots: number): boolean => nLanes > slots && slots >= 2;

/** How many lanes, ticker and footer rows fit `maxRows` (border 2 + header 1 are fixed). */
export function planRows(maxRows: number, nLanes: number, hasTicker: boolean): { lanes: number; ticker: boolean; footer: boolean; more: boolean } {
  const room = Math.max(0, maxRows - 3);
  const [kept, footer] = chrome(room, Math.min(1, nLanes), hasTicker);
  const ticker = kept && !tradesTicker(kept, nLanes, room - 1 - +footer);
  const slots = room - +ticker - +footer;
  const more = needsMore(nLanes, slots);
  return { lanes: more ? slots - 1 : Math.min(nLanes, slots), ticker, footer, more };
}

const frame = (els: ClientElements, rows: Segment[][], inner: number, color: string): RenderElement =>
  els.Box({
    flexDirection: 'column', flexShrink: 0, borderStyle: 'round', borderColor: color,
    children: rows.map((r) => rowOf(els, r, inner)),
  });

/** `· last run: N workers, M min, ok|K failed`, empty when no worker ever ran. */
function lastRun(c: Ctx, live: LiveWorker[]): string {
  if (!live.length) return '';
  const mins = Math.max(1, Math.round((c.now - Math.min(...live.map((w) => w.startedAt))) / 60_000));
  const failed = live.filter((w) => w.state === 'failed').length;
  return ` · last run: ${live.length} workers, ${mins} min, ${failed ? `${failed} failed` : 'ok'}`;
}

/** Idle panel body: brand, compact rail, and what the last run did. */
const idleWord = (c: Ctx): Segment => (c.open ? seg('blocked', C.warn, true) : seg('idle', C.muted, true));
const idleGates = (c: Ctx): Segment[] => (c.open ? [seg(` · gates ✗${c.open}`, C.warn)] : []);
function idleRow(c: Ctx, live: LiveWorker[]): Segment[] {
  const wide = c.inner >= MID;
  return [BRAND_CHIP, seg(' '), ...(wide ? [...phaseRail(c.s, c.tick, true, false), seg(' ')] : []), idleWord(c), seg(wide ? lastRun(c, live) : '', C.muted), ...idleGates(c)];
}

const openChip = (c: Ctx, lead: Segment[]): Segment[] => (c.open ? [...lead, DOT, seg(`✗${c.open}`, C.warn)] : lead);
const bandColor = (c: Ctx, shown: LiveWorker[]): string => (c.open || shown.some((w) => w.state === 'blocked') ? C.warn : C.live);

/** <80 columns: one header row only. */
function narrowRows(c: Ctx, shown: LiveWorker[]): Segment[][] {
  const left = [BRAND_CHIP, seg(` ${c.s.phase} ${c.done}/${c.total}`, C.focus, true), DOT, seg(`${activeCount(shown)} working`, C.live)];
  return [openChip(c, left)];
}

/** Header, as many lanes as fit, then "+N more", ticker and footer per `planRows`. */
function fullRows(c: Ctx, shown: LiveWorker[], maxRows: number): Segment[][] {
  const plan = planRows(maxRows, shown.length, c.s.comms.length > 0);
  const rows: Segment[][] = [headerRow(c), ...shown.slice(0, plan.lanes).map((w) => lane(w, c))];
  if (plan.more) rows.push([seg(`  +${shown.length - plan.lanes} more`, C.muted)]);
  if (plan.ticker) rows.push(ticker(c));
  if (plan.footer) rows.push(footer(c));
  return rows;
}

export function bandTree(els: ClientElements, { snapshot: s, live, gates, columns, tick, maxRows = 12 }: BandModel): RenderElement {
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const open = openGateCount(gates);
  const all = live.filter((w) => w.state !== 'parked'); // parked workers are resting
  const shown = all.filter((w) => w.state !== 'done');
  const c: Ctx = { s, inner: Math.max(1, columns - 2), tick, full: columns >= FULL, now: s.now, done, total, open, gates };
  if (maxRows < 3) return rowOf(els, [BRAND_CHIP, seg(` ${s.phase} ${done}/${total}`, C.focus), ...(open ? [seg(` ✗${open}`, C.warn)] : [])], columns);
  if (!shown.length) return frame(els, [idleRow(c, all)], c.inner, open ? C.warn : C.muted);
  return frame(els, columns < MID ? narrowRows(c, shown) : fullRows(c, shown, maxRows), c.inner, bandColor(c, shown));
}
