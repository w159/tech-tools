// band.tsx: the AbovePrompt "Mission Control" panel, a filled truecolor band: a gradient title bar,
// the phase rail as chevron pills, one lane per live worker (state chip, spinner, tool chip, eighth-block
// elapsed bar, tool-call sparkline), an IRC ticker and a footer of task bar + gate chips. Pure: `register.ts`
// hands it the snapshot, live workers, gate groups, columns, the row budget, the spinner tick and the cost.
// Tiers: >=120 full, 80-119 no role/target, <80 title row only; maxRows collapses lanes first, then the
// ticker, then the footer (planRows).
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot } from './orchestra-types';
import { activeCount, callBuckets, type LiveWorker } from './data/live';
import { routeCounts } from './data/todos';
import { groupOpenCount, openGateCount } from './gates';
import type { GateGroup } from './pane/sidebar-types';
import { chip, eighthBar, gradientBar, merge, nickColor, padRow, seg, sparkline, spread } from './paint';
import { rowOf, type Segment } from './runs';
import { fitText, formatDuration, MOCHA as M, mix, phaseHue, spin, textWidth } from './theme';

/** `lastPhase`: the last rail phase the caller rendered, lit while the snapshot phase is `blocked`. */
export type BandModel = { snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number; maxRows?: number; costUsd?: number | null; lastPhase?: string | null };

const FULL = 120;
const MID = 80;
const REF_MS = 120_000; // an elapsed bar fills over two minutes
const TICKER_ROWS = 2;
const BAR_W = 28; // elapsed bar cells at most
const TARGET_W = 24; // target column at its narrowest (full tier)
const WAVE_GAP_MS = 10_000; // spawns further apart than this start a new wave
const RAIL_SKIP = new Set(['validate', 'blocked']);
/** Brand mark: one cell (the U+25E2 triangles of the mockup draw 2 cells in Ghostty; theme.test.ts). */
export const MARK = '◆';

type Ctx = { s: LiveSnapshot; rail: string; cols: number; tick: number; full: boolean; now: number; done: number; total: number; open: number; gates: GateGroup[]; cost: number | null };

const padTo = (t: string, n: number): string => { const f = fitText(t, n); return f + ' '.repeat(Math.max(0, n - textWidth(f))); };
const clock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 3600 ? formatDuration(ms) : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// ---- title bar ---------------------------------------------------------------------

/** Spawn clusters among the run's workers, oldest first. ponytail: a 10 s gap heuristic, swap for the dispatch
 * batch id once the host exposes one. */
function waves(ws: readonly LiveWorker[]): LiveWorker[][] {
  const sorted = [...ws].sort((a, b) => a.startedAt - b.startedAt);
  return sorted.reduce<LiveWorker[][]>((acc, w, i) => {
    if (i === 0 || w.startedAt - sorted[i - 1]!.startedAt > WAVE_GAP_MS) acc.push([]);
    acc[acc.length - 1]!.push(w);
    return acc;
  }, []);
}
const waveOf = (ws: readonly LiveWorker[]): number => waves(ws).length;

/** `<folder>@<branch>` of the board channel; without a board, the project folder. */
const boardOf = (s: LiveSnapshot): string => (s.channel ? s.channel.split('/')[0]! : (s.root ?? '').replace(/\/+$/, '').split('/').pop() || 'atlas');
const statsOf = (c: Ctx, shown: LiveWorker[]): string => {
  const since = Math.min(...shown.map((w) => w.startedAt));
  const parts = [`◷ ${clock(c.now - since)}`, `${activeCount(shown)} live`, c.s.contextPct > 0 ? `ctx ${c.s.contextPct}%` : '', c.cost != null ? `$${c.cost.toFixed(2)}` : ''];
  return `${parts.filter(Boolean).join('   ')} `;
};

function titleRow(c: Ctx, all: LiveWorker[], shown: LiveWorker[]): Segment[] {
  const scope = shown.find((w) => w.scope)?.scope;
  const left = [`${MARK} ATLAS`, ...(c.full ? ['mission control'] : []), boardOf(c.s), `wave ${waveOf(all)}`, ...(scope ? [scope] : [])].join('  ·  ');
  return withChips(c, titleChips(c), (w) => gradientBar(left, statsOf(c, shown), w, M.violet, M.sky));
}

// ---- phase rail ----------------------------------------------------------------------

const pastPill = (id: string, compact: boolean): Segment => ({ t: compact ? ' ✓ ' : ` ✓ ${id} `, color: M.base, bg: mix(phaseHue(id), M.panel, 0.45) });
const futurePill = (id: string, compact: boolean): Segment => ({ t: compact ? ' · ' : ` ${id} `, color: M.muted, bg: M.panel2 });
/** The current phase: bright hue, its white mix cycling with the tick while workers run. */
const nowPill = (id: string, tick: number, animate: boolean): Segment => {
  const shimmer = animate ? 0.25 + 0.25 * ((tick % 4) / 3) : 0.15;
  return { t: ` ◆ ${id.toUpperCase()} `, color: M.base, bg: mix(phaseHue(id), M.white, shimmer), bold: true };
};

/** Pill for one phase; `rel` is its position against the current phase (0 current, <0 past, >0 future). */
function pill(id: string, rel: number, tick: number, compact: boolean, animate: boolean): Segment {
  if (rel < 0) return pastPill(id, compact);
  return rel > 0 ? futurePill(id, compact) : nowPill(id, tick, animate);
}

const railIds = (s: LiveSnapshot): string[] => s.contract.phases.map((p) => p.id as string).filter((id) => !RAIL_SKIP.has(id));

/** The lit pill: the snapshot phase when it is on the rail; for `blocked` (or any off-rail phase) the last rail phase
 * the caller saw, else the first, so a blocked reply never leaves the rail with nothing lit. */
export function railPhase(s: LiveSnapshot, lastPhase?: string | null): string {
  const ids = railIds(s);
  return ids.includes(s.phase) ? s.phase : lastPhase && ids.includes(lastPhase) ? lastPhase : ids[0] ?? s.phase;
}

function railRow(s: LiveSnapshot, phase: string, tick: number, compact: boolean, animate: boolean): Segment[] {
  const ids = railIds(s);
  const at = ids.indexOf(phase);
  const cells = ids.flatMap((id, i) => [pill(id, i - at, tick, compact, animate), seg(i < ids.length - 1 ? '▶' : ' ', i < at ? phaseHue(id) : M.dim)]);
  return [seg(' '), ...cells];
}

// ---- lanes -------------------------------------------------------------------------

const STATE_CHIP: Record<LiveWorker['state'], [string, string]> = {
  working: ['RUN', M.green], blocked: ['WAIT', M.yellow], failed: ['FAIL', M.red], done: ['DONE', M.teal], parked: ['PARK', M.muted],
};

function laneGlyph(w: LiveWorker, c: Ctx): string {
  if (w.state === 'working') return spin(c.tick, c.s.phase);
  return w.state === 'blocked' ? '◷' : w.state === 'failed' ? '✖' : '✔';
}

/** `mcp__lean-ctx__ctx_shell` and `mcp__plugin_x_srv__tool` both read as the bare tool name. */
export const shortTool = (tool: string): string => tool.replace(/^mcp__.*__/, '');

/** The tool in flight; between calls the last one, dimmed, so the cell never blanks out. */
function laneTool(w: LiveWorker): string {
  const tool = w.tool ?? w.lastTool;
  if (tool) return shortTool(tool);
  return w.state === 'blocked' ? 'queued' : 'starting';
}

const roleCell = (w: LiveWorker, c: Ctx): Segment[] => (c.full ? [seg(padTo(w.role, 12), M.muted)] : []);
const targetCell = (w: LiveWorker, c: Ctx, width: number): Segment => (c.full ? seg(` ${padTo(w.target ?? '', width)} `, M.text) : seg(' '));

/** Lane head: state chip, spinner, name, role, tool chip (dim between calls), target. */
function laneHead(w: LiveWorker, c: Ctx, color: string, targetWidth = TARGET_W): Segment[] {
  const [word, hue] = STATE_CHIP[w.state];
  const tool = seg(` ${padTo(laneTool(w), 10)} `, w.tool ? color : M.muted, M.panel2, true);
  return [seg(' '), chip(word.padEnd(4), hue), seg(` ${laneGlyph(w, c)} `, color), seg(`${padTo(w.name, c.full ? 24 : 18)} `, M.text, M.panel, true), ...roleCell(w, c), tool, targetCell(w, c, targetWidth)];
}

const runsWidth = (parts: Segment[]): number => textWidth(parts.map((p) => p.t).join(''));

/** One worker lane: head, elapsed bar sized to the room left (28 cells at most, the target takes the rest),
 * sparkline of its tool calls, age. */
function lane(w: LiveWorker, c: Ctx): Segment[] {
  const color = STATE_CHIP[w.state][1];
  const elapsed = c.now - w.startedAt;
  const tail = [seg('  '), ...sparkline(callBuckets(w.calls, c.now), color), seg(`  ${formatDuration(elapsed).padStart(6)}`, M.muted)];
  let head = laneHead(w, c, color);
  let room = c.cols - runsWidth(head) - runsWidth(tail) - 1;
  if (c.full && room > BAR_W) [head, room] = [laneHead(w, c, color, TARGET_W + room - BAR_W), BAR_W];
  const bar = room >= 5 ? eighthBar(elapsed / REF_MS, Math.min(BAR_W, room), mix(color, M.panel, 0.1), mix(color, M.white, 0.35)) : [];
  return padRow([...head, ...bar, ...tail], c.cols);
}

// ---- ticker and footer -------------------------------------------------------------

const hhmm = (ts: number): string => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const nick = (name: string): Segment => seg(name, nickColor(name), M.panel, true);

/** Last two channel messages as `hh:mm from → to: text`, led by the channel chip. */
function ticker(c: Ctx): Segment[] {
  const channel = c.s.channel?.split('/').pop() ?? 'lead';
  const msgs = c.s.comms.slice(-TICKER_ROWS).flatMap((m, i) => [
    seg(`${i ? '   ' : ''}${hhmm(m.ts)} `, M.dim), nick(m.from), seg(' → ', M.muted), nick(m.to), seg(`: ${m.text.replace(/\s+/g, ' ')}`, M.text),
  ]);
  return padRow([seg(' '), chip(`#${channel}`, M.violet), seg(' '), ...msgs], c.cols);
}

const gateChip = (g: GateGroup): Segment[] => [groupOpenCount(g) || g.error ? chip(`✖ ${g.id}`, M.red) : chip(`✔ ${g.id}`, M.green), seg(' ')];
const hasGateData = (g: GateGroup): boolean => g.lines.length > 0 || !!g.error;

function footer(c: Ctx): Segment[] {
  const tasks = [seg(' '), seg('tasks ', M.muted), ...eighthBar(c.done / Math.max(1, c.total), 18, M.green, M.teal), seg(` ${c.done}/${c.total}  `, M.text)];
  return spread([...tasks, ...c.gates.filter(hasGateData).flatMap(gateChip)], [seg('ctrl+x tab  r t c g  /atlas-cc ', M.muted)], c.cols);
}

// ---- row budget --------------------------------------------------------------------

/** Whether the ticker and footer stay: drop the ticker first, then the footer, until `need` lane rows fit. */
function chrome(room: number, need: number, hasTicker: boolean): [boolean, boolean] {
  for (const [t, f] of [[hasTicker, true], [false, true], [false, false]] as const) if (room - +t - +f >= need) return [t, f];
  return [false, false];
}

/** Hidden workers beat the ticker: trade it for the "+N more" row. */
const tradesTicker = (kept: boolean, nLanes: number, slots: number): boolean => kept && nLanes > slots && slots < 2;
const needsMore = (nLanes: number, slots: number): boolean => nLanes > slots && slots >= 2;

/** How many lanes, ticker and footer rows fit `maxRows` (title + rail are fixed). */
export function planRows(maxRows: number, nLanes: number, hasTicker: boolean): { lanes: number; ticker: boolean; footer: boolean; more: boolean } {
  const room = Math.max(0, maxRows - 2);
  const [kept, footer] = chrome(room, Math.min(1, nLanes), hasTicker);
  const ticker = kept && !tradesTicker(kept, nLanes, room - 1 - +footer);
  const slots = room - +ticker - +footer;
  const more = needsMore(nLanes, slots);
  return { lanes: more ? slots - 1 : Math.min(nLanes, slots), ticker, footer, more };
}

// ---- assembly ----------------------------------------------------------------------

const panel = (els: ClientElements, rows: Segment[][], cols: number): RenderElement =>
  els.Box({ flexDirection: 'column', flexShrink: 0, backgroundColor: M.panel, children: rows.map((r) => rowOf(els, r, cols)) });

/** `last wave: N workers · 4m12s · ✔ ok` over the most recent spawn burst only, empty when no worker ever ran. */
function lastWave(c: Ctx, all: LiveWorker[]): string {
  const wave = waves(all).pop();
  if (!wave) return '';
  const failed = wave.filter((w) => w.state === 'failed').length;
  const parts = [`last wave: ${wave.length} worker${wave.length === 1 ? '' : 's'}`, formatDuration(c.now - Math.min(...wave.map((w) => w.startedAt))), failed ? `✖ ${failed} failed` : '✔ ok', c.cost != null ? `$${c.cost.toFixed(2)}` : ''];
  return parts.filter(Boolean).join(' · ');
}

/** Title chips on the right: a red `BLOCKED` when the last reply declared the blocked phase, then `extra`. */
const titleChips = (c: Ctx, extra: Segment[] = []): Segment[] => [...(c.s.phase === 'blocked' ? [chip('BLOCKED', M.red)] : []), ...extra];

/** A gradient bar `make(width)` narrowed so `chips` and one trailing cell fit after it; bar alone when they would not. */
function withChips(c: Ctx, chips: Segment[], make: (width: number) => Segment[]): Segment[] {
  const room = c.cols - runsWidth(chips) - 1;
  return chips.length && room >= 40 ? [...make(room), ...chips, seg(' ')] : make(c.cols);
}

/** Idle title: always calm (grey into teal), `idle · last wave ...` when wide. Open gates are one amber chip, never
 * "blocked": gates.ts reports what is open, not whether the next Stop is refused. */
function idleTitle(c: Ctx, all: LiveWorker[]): Segment[] {
  const wave = c.cols >= MID ? lastWave(c, all) : '';
  const chips = titleChips(c, c.open ? [chip(`gates ✖${c.open}`, M.peach)] : []);
  return withChips(c, chips, (w) => gradientBar(`${MARK} ATLAS  ·  ${['idle', wave].filter(Boolean).join('  ·  ')}`, '', w, M.grey, mix(M.teal, M.panel, 0.55), M.text));
}

/** Idle: the dim title and the settled rail. */
function idleRows(c: Ctx, all: LiveWorker[], maxRows: number): Segment[][] {
  const title = idleTitle(c, all);
  return maxRows >= 2 ? [title, padRow(railRow(c.s, c.rail, c.tick, c.cols < 100, false), c.cols)] : [title];
}

/** <80 columns or <3 rows: the title row alone, phase and counts in it. */
function narrowRow(c: Ctx, shown: LiveWorker[]): Segment[] {
  const left = [`${MARK} ATLAS`, `${c.s.phase} ${c.done}/${c.total}`, `${activeCount(shown)} working`, ...(c.open ? [`✖${c.open}`] : [])].join(' · ');
  return gradientBar(left, '', c.cols, M.violet, M.sky);
}

/** Title, rail, as many lanes as fit, then "+N more", ticker and footer per `planRows`. */
function fullRows(c: Ctx, all: LiveWorker[], shown: LiveWorker[], maxRows: number): Segment[][] {
  const plan = planRows(maxRows, shown.length, c.s.comms.length > 0);
  const rows: Segment[][] = [titleRow(c, all, shown), padRow(railRow(c.s, c.rail, c.tick, c.cols < 100, true), c.cols), ...shown.slice(0, plan.lanes).map((w) => lane(w, c))];
  if (plan.more) rows.push(padRow([seg(`   +${shown.length - plan.lanes} more`, M.muted)], c.cols));
  if (plan.ticker) rows.push(ticker(c));
  if (plan.footer) rows.push(footer(c));
  return rows;
}

export function bandTree(els: ClientElements, { snapshot: s, live, gates, columns, tick, maxRows = 12, costUsd = null, lastPhase = null }: BandModel): RenderElement {
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const all = live.filter((w) => w.state !== 'parked'); // parked workers are resting
  const shown = all.filter((w) => w.state !== 'done');
  const cols = Math.max(1, columns);
  const c: Ctx = { s, rail: railPhase(s, lastPhase), cols, tick, full: cols >= FULL, now: s.now, done, total, open: openGateCount(gates), gates, cost: costUsd };
  if (!shown.length) return panel(els, idleRows(c, all, maxRows), cols);
  if (cols < MID || maxRows < 3) return panel(els, [narrowRow(c, shown)], cols);
  return panel(els, fullRows(c, all, shown, maxRows).map(merge), cols);
}
