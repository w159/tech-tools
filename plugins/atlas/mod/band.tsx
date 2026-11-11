// band.tsx: the AbovePrompt "Mission Control" band on Claude Code. A thin adapter over mission-layout.ts, the layout
// the omp mission panel draws too: it turns the snapshot, live workers and gate groups into a MissionModel, paints
// each layout run as a Segment in the shared tone palette, fills the board slot with the todo list and appends the
// key buttons to the footer. Pure: `register.ts` hands it the snapshot, workers, gates, columns, row budget and tick.
import type { ClientElements, RenderElement } from 'claude-code';
import { coreCells } from './core-row';
import type { CoreModel } from './data/core';
import type { LiveSnapshot } from './orchestra-types';
import type { LiveWorker } from './data/live';
import { ownTodos, todoCounts } from './data/todos';
import { groupOpenCount } from './gates';
import { hostEnv, PALETTES, toneHex, uiFromEnv, type Ui } from './atlas-ui';
import { bandLines, isMessageKind, type Line, type MissionModel, type MissionWorker, type Run, type WorkerState, missionLines } from './mission-layout';
import type { GateGroup, SidebarView } from './pane/sidebar-types';
import { fitRuns, rowOf, type Segment } from './runs';
import { todoRows } from './todo-panel';
import { textWidth } from './theme';

export { planRows } from './mission-layout';

/** `lastPhase`: the last rail phase the caller rendered, lit while the snapshot phase is `blocked`. */
export type BandModel = { snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number; maxRows?: number; lastPhase?: string | null; todoExpanded?: boolean; core?: CoreModel | null; team?: string; leadName?: string; ui?: Ui; rich?: boolean };
// `team` (omp: the team record's `<class>/<effort>`) is the header's scope label; `leadName` (omp: `lead-<sid6>`)
// names the lead in the message row. Both absent: not shown / `lead`. `ui` (theme, ASCII, colour depth) defaults to the
// environment; `rich` (ATLAS_BAND_RICH=1) draws the tall band when the rows allow.

const WAVE_GAP_MS = 10_000; // spawns further apart than this start a new wave
const LINGER_MS = 15_000; // a finished worker keeps its row, ticked, this long
const RAIL_SKIP = new Set(['validate', 'blocked']);
/** Brand mark: one cell (the U+25E2 triangles of the mockup draw 2 cells in Ghostty; theme.test.ts). */
export const MARK = '◆';
/** Footer button presses: open (or focus) the Atlas pane on a view, or open the Board pane (`toggleTodos`, the `o` key). Absent in fixtures that wire neither. */
export type BandHandlers = { openView(v: SidebarView): void; toggleTodos(): void };
/** The band's controls: hotkeys press only while the band holds the keyboard (ctrl+x, Tab, or a click), and are unique within it. */
export const BAND_BUTTONS: readonly { id: SidebarView | 'board'; key: string; label: string }[] = [
  { id: 'route', key: 'r', label: 'route' }, { id: 'team', key: 't', label: 'team' }, { id: 'channel', key: 'c', label: 'channel' },
  { id: 'gates', key: 'g', label: 'gates' }, { id: 'board', key: 'o', label: 'board' },
];
/** How to give the band the keyboard; shown after the keys when it fits. */
export const BAND_HINT = 'ctrl+x tab';
const buttonWidth = (b: { label: string }): number => 3 + textWidth(b.label) + 2; // engine draws `k: label`, two cells between buttons
const KEYS_W = BAND_BUTTONS.reduce((n, b) => n + buttonWidth(b), 0);

/** `mcp__lean-ctx__ctx_shell` and `mcp__plugin_x_srv__tool` both read as the bare tool name. */
export const shortTool = (tool: string): string => tool.replace(/^mcp__.*__/, '');

const railIds = (s: LiveSnapshot): string[] => s.contract.phases.map((p) => p.id as string).filter((id) => !RAIL_SKIP.has(id));

/** The lit step: the snapshot phase when it is on the rail; for `blocked` (or any off-rail phase) the last rail phase
 * the caller saw, else the first, so a blocked reply never leaves the rail with nothing lit. */
export function railPhase(s: LiveSnapshot, lastPhase?: string | null): string {
  const ids = railIds(s);
  return ids.includes(s.phase) ? s.phase : lastPhase && ids.includes(lastPhase) ? lastPhase : ids[0] ?? s.phase;
}

// ---- model --------------------------------------------------------------------------

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

/** `<folder>@<branch>` of the board channel; without a board, the project folder. */
const boardOf = (s: LiveSnapshot): string => (s.channel ? s.channel.split('/')[0]! : (s.root ?? '').replace(/\/+$/, '').split('/').pop() || 'atlas');

/** A working worker reads running with a tool in flight, thinking between calls, starting before its first tool. */
function workerState(w: LiveWorker): WorkerState {
  if (w.state === 'working') return w.tool ? 'running' : w.lastTool ? 'thinking' : 'starting';
  return w.state === 'blocked' ? 'waiting' : w.state === 'failed' ? 'failed' : 'done';
}

function missionWorker(w: LiveWorker, now: number): MissionWorker {
  const state = workerState(w);
  const tool = w.tool ?? w.lastTool;
  const end = state === 'done' || state === 'failed' ? w.since : now;
  return { name: w.name, role: w.role, state, tool: tool ? shortTool(tool) : undefined, target: w.target ?? undefined, secs: Math.max(0, Math.round((end - w.startedAt) / 1000)) };
}

const hhmm = (ts: number): string => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const hasGateData = (g: GateGroup): boolean => g.lines.length > 0 || !!g.error;

function lastRun(all: readonly LiveWorker[], now: number): MissionModel['lastRun'] {
  const wave = waves(all).pop();
  if (!wave) return undefined;
  const end = Math.max(...wave.map((w) => (w.state === 'done' || w.state === 'failed' ? w.since : now)));
  return { workers: wave.length, secs: Math.max(0, Math.round((end - Math.min(...wave.map((w) => w.startedAt))) / 1000)), failed: wave.filter((w) => w.state === 'failed').length };
}

function missionModel(b: BandModel & { maxRows: number }): MissionModel {
  const s = b.snapshot;
  const now = s.now;
  const all = b.live.filter((w) => w.state !== 'parked'); // parked workers are resting
  const active = all.filter((w) => w.state !== 'done');
  const lingering = all.filter((w) => w.state === 'done' && now - w.since <= LINGER_MS);
  const shown = active.length ? [...active, ...lingering] : []; // a finished worker lingers only while the wave runs
  const { done, total } = todoCounts(s); // the one count basis: header, HUD, board and side panel all read the same plan rows
  const gates = b.gates.filter((g) => g.id !== 'header' && hasGateData(g)); // the header check is the mod's own group; omp never shows it
  const named = (n: string): string => (b.leadName && n === 'lead' ? b.leadName : n); // comms collapse the lead's name to `lead`
  const last = [...s.comms].reverse().find((c) => isMessageKind(c.kind)); // joins and leaves are presence, not messages
  const working = active.filter((w) => w.state === 'working' || w.state === 'blocked');
  return {
    cols: Math.max(1, b.columns), maxRows: b.maxRows, tick: b.tick,
    project: boardOf(s), scope: b.team,
    phases: railIds(s), phase: railPhase(s, b.lastPhase), blocked: s.phase === 'blocked',
    done, total,
    workers: shown.map((w) => missionWorker(w, now)),
    note: last ? { from: named(last.from), to: named(last.to), text: last.text, at: hhmm(last.ts) } : undefined,
    checks: gates.length ? gates.map((g) => ({ id: g.id, ok: !groupOpenCount(g) && !g.error })) : null,
    elapsedSecs: working.length ? Math.round((now - Math.min(...working.map((w) => w.startedAt))) / 1000) : undefined,
    lastRun: lastRun(all, now),
    core: coreCells(b.core, Math.max(1, b.columns)),
    boardRows: b.todoExpanded && ownTodos(s.todos, s.sessionId).length ? ownTodos(s.todos, s.sessionId).length + 1 : 0,
    ctx: s.contextPct > 0 ? Math.min(1, s.contextPct / 100) : undefined,
    rich: b.rich ?? hostEnv().ATLAS_BAND_RICH === '1',
    ui: b.ui ?? uiFromEnv(),
  };
}

// ---- paint --------------------------------------------------------------------------

/** A run as a Segment: the live theme's tone colour on the run's own fill or the panel; with NO_COLOR only bold and strike remain. */
const seg = (x: Run, ui: Ui): Segment => {
  const p = PALETTES[ui.theme];
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  return ui.color === 'none' ? { t: x.t, ...style } : { t: x.t, color: toneHex(x.tone, ui.theme), bg: x.bg ? p[x.bg] : p.panel, ...style };
};
const segs = (l: Line, ui: Ui): Segment[] => l.runs.map((x) => seg(x, ui));
const panelBg = (ui: Ui): string | undefined => (ui.color === 'none' ? undefined : PALETTES[ui.theme].panel);

/** The band rows alone (no workers, footer or board), plain text per row: what the tier goldens compare. */
export function bandRows(m: MissionModel): string[] {
  return bandLines(m).map((l) => l.runs.map((x) => x.t).join(''));
}

/** The footer with its key buttons (a row of real clickable keys) and, when it fits, the focus hint after them. */
function keysRow(els: ClientElements, l: Line, cols: number, on: BandHandlers, ui: Ui): RenderElement {
  const bg = panelBg(ui);
  const mutedColor = ui.color === 'none' ? undefined : toneHex('muted', ui.theme);
  const left = segs(l, ui);
  const used = left.reduce((n, x) => n + textWidth(x.t), 0);
  const hint = used + KEYS_W + textWidth(BAND_HINT) + 3 <= cols ? BAND_HINT : '';
  const press = (id: SidebarView | 'board'): (() => void) => (id === 'board' ? on.toggleTodos : () => on.openView(id));
  const buttons = BAND_BUTTONS.map((b) => els.Button({
    key: `band:${b.id}`, plain: true, hotkey: b.key, label: b.label, onPress: press(b.id),
    children: [els.Text({ color: mutedColor, backgroundColor: bg, children: b.label })],
  }));
  const tail = hint ? `  ${hint} ` : ' ';
  const gap = cols - used - KEYS_W - textWidth(tail) + 2; // the last button carries no trailing two-cell gap
  const sep = (i: number): RenderElement => els.Text({ backgroundColor: bg, children: i ? '  ' : '' });
  return els.Box({
    flexDirection: 'row', flexShrink: 0,
    children: [...fitRuns(els, left, cols), els.Text({ backgroundColor: bg, children: ' '.repeat(Math.max(0, gap)) }), ...buttons.flatMap((b, i) => [sep(i), b]), els.Text({ color: mutedColor, backgroundColor: bg, children: tail })],
  });
}

type Row = Segment[] | RenderElement;
const panel = (els: ClientElements, rows: Row[], cols: number, ui: Ui): RenderElement =>
  els.Box({ flexDirection: 'column', flexShrink: 0, backgroundColor: panelBg(ui), children: rows.map((r) => (Array.isArray(r) ? rowOf(els, r, cols) : r)) });

/** Any MissionModel as the band tree (the shared-world goldens and the renderer feed models directly). */
export function missionTree(els: ClientElements, m: MissionModel, todoRows: (rows: number) => Segment[][] = () => [], on?: BandHandlers): RenderElement {
  const ui = m.ui ?? uiFromEnv();
  const rows: Row[] = missionLines(m).flatMap((l): Row[] => (l.board ? todoRows(l.board) : l.keys && on ? [keysRow(els, l, m.cols, on, ui)] : [segs(l, ui)]));
  return panel(els, rows, m.cols, ui);
}

export function bandTree(els: ClientElements, b: BandModel, on?: BandHandlers): RenderElement {
  const cols = Math.max(1, b.columns);
  const maxRows = b.maxRows ?? 12;
  const ui = b.ui ?? uiFromEnv();
  if (maxRows < 1) return panel(els, [], cols, ui); // the HUD can take the whole slot: draw nothing rather than a row past the budget
  const m = missionModel({ ...b, maxRows, ui });
  const idle = !m.workers.some((w) => w.state !== 'done' && w.state !== 'failed');
  const keys = !!on && idle && cols >= 80; // keys while idle; omp has none, a running band keeps its rows for workers
  const lines = missionLines({ ...m, keysWidth: keys ? KEYS_W : 0 });
  const rows: Row[] = lines.flatMap((l): Row[] => {
    if (l.board) return todoRows(ownTodos(b.snapshot.todos, b.snapshot.sessionId), { cols, tick: b.tick, expanded: true, maxRows: l.board, now: Math.floor(b.snapshot.now / 1000), ui, rich: m.rich });
    if (l.keys && on) return [keysRow(els, l, cols, on, ui)];
    return [segs(l, ui)];
  });
  return panel(els, rows, cols, ui);
}
