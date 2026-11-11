// The TODO tree and Subagents block above the Mission Control band, drawn to the rev 4 ATLAS design (mod/hud-surface.ts holds
// the host-free layout; omp/hud-paint.ts paints the same rows for omp). This file adapts the board and the squad to those
// rows, fits them to the row budget and paints Runs as Claude Code Segments. Pure: todos and agents in, Segment rows out.
import type { SquadAgent, TodoItem } from './contract';
import { descriptionName } from './data/orchestration';
import { liveState, workerUiState, type LiveWorker } from './data/live';
import { isPlanItem } from './data/todos';
import { itemState } from './board-model';
import { hostEnv, PALETTES, toneHex, uiFromEnv, type Run, type Ui, type UiState } from './atlas-ui';
import { fitStack, padRows, sortAgents, stack, tierOf, type AgentRow, type SurfaceOpts, type TodoRow } from './hud-surface';
import type { Segment } from './runs';

/** One subagent as the HUD shows it. `state` is the LiveWorker state; only working/blocked count as running. */
export type HudAgent = {
  name: string;
  role: string;
  model?: string;
  task?: string;
  state: string;
  tool?: string | null;
  target?: string | null;
  /** The current (else last) call's intent: omp's tool-preview detail. */
  detail?: string | null;
  lastTool?: string | null;
  lastLine?: string;
  /** Context used, 0..1, when the host knows it (the rich form draws a gauge). */
  ctx?: number | null;
  /** The state word every surface shares (liveState), when the adapter knows the worker's age; else it is derived from `state`. */
  ui?: UiState;
};

const GENERIC = new Set(['unknown', 'general-purpose', 'task', '']);
/** A host agent id (`a6839f49ee72a2b14`) or a bare hash: never a name. */
const HOST_ID = /^[a-z]?[0-9a-f]{8,}$/i;

/** The name the panel shows: the dispatch name, else the prefix of the Agent description (`readme-explorer: compare ...`), else the role. */
export function agentName(name: string, role: string, task?: string): string {
  if (name !== '' && !HOST_ID.test(name)) return name;
  return descriptionName(task) ?? (GENERIC.has(role) ? name.slice(0, 6) : role);
}

/** Band workers plus the squad's spawn model and task, in the HUD's shape; `queued` names dispatched workers the host does not list yet (data/live.ts queuedMembers). */
export function hudAgents(live: readonly LiveWorker[], squad: readonly SquadAgent[], queued: readonly string[] = []): HudAgent[] {
  const listed = live.map((w) => {
    const s = squad.find((a) => a.name === w.name);
    return { name: agentName(w.name, w.role, s?.task), role: w.role, state: w.state, ui: liveState(w), tool: w.tool, target: w.target, detail: w.detail, lastTool: w.lastTool, lastLine: w.lastLine, ...(s?.model ? { model: s.model } : {}), ...(s?.task ? { task: s.task } : {}) };
  });
  return [...listed, ...queued.filter((n) => !live.some((w) => w.name === n)).map((name): HudAgent => ({ name, role: '', state: 'queued', ui: 'queued' }))];
}

/** `root` (the project root) makes paths in a tool preview project-relative. `phases` feeds the rich rail. */
export type HudInput = { todos: TodoItem[]; agents: HudAgent[]; root?: string | null; phases?: { ids: readonly string[]; active: number } };
export type HudOpts = { cols: number; maxRows: number; ui?: Ui; rich?: boolean; tick?: number; now?: number };

export const isRunning = (a: HudAgent): boolean => a.state === 'working' || a.state === 'blocked' || a.state === 'running' || a.state === 'queued';

// ---- adapters ---------------------------------------------------------------------------------------

const flat = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const LABEL_PREFIX = /^\[([A-Za-z][\w-]*)\]\s+/;
const WORD_PREFIX = /^(research|theory|plan|design|test|implement|build|fix|verify|review|validate|docs|ship)(?::\s+|\s+-\s+)/i;
/** The item's text without a `[phase] ` or `Phase: ` prefix (the rail names the phase). */
const labelOf = (t: TodoItem): string => flat(t.content).replace(LABEL_PREFIX, '').replace(WORD_PREFIX, '');
const mmss = (ms: number): string => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Plan rows in plan order. Every row is shown with its own state; the focus mark sits on the running row, else the first open one. */
export function todoModel(todos: readonly TodoItem[], now: number, owners: ReadonlyMap<string, UiState> = new Map()): TodoRow[] {
  const rows = todos.map((t): TodoRow => {
    const state = itemState(t.status, t.owner ? owners.get(t.owner) : undefined); // the board's rule: a failed owner fails the item
    const claimed = typeof t.claimed_at === 'number' && t.claimed_at > 0 ? now - t.claimed_at * 1000 : undefined;
    const est = typeof t.estimate_s === 'number' && t.estimate_s > 0 ? ` of ${mmss(t.estimate_s * 1000)}` : ''; // the estimate only when the item carries one
    const own = t.owner ? owners.get(t.owner) : undefined;
    const ownerWord = state !== 'done' && (own === 'failed' || own === 'waiting' || own === 'blocked') && own !== state ? `owner ${own}` : ''; // as on the board: a failed owner already fails the item, a waiting owner blocks it and is named
    const ev = flat(t.evidence);
    const base = ev || (state === 'running' && claimed !== undefined && claimed >= 0 ? `elapsed ${mmss(claimed)}${est}` : '') || flat(t.owner);
    const detail = ownerWord ? (ev ? `${ownerWord} · ${ev}` : ownerWord) : base;
    return { label: labelOf(t), state, detail, focus: false };
  });
  const at = rows.findIndex((r) => r.state === 'running');
  const focus = at >= 0 ? at : rows.findIndex((r) => r.state !== 'done');
  if (focus >= 0) rows[focus] = { ...rows[focus]!, focus: true };
  return rows;
}

/** `opus`, `sonnet-5`: the model without its provider and the `claude-` prefix; nothing is guessed. */
export const shortModel = (model: string | undefined): string => flat(model).replace(/^.*\//, '').replace(/^claude-/, '');

/** The agent's current call (`read runs.ts:17`), else its last line, else its last call. */
function lastAction(a: HudAgent, root?: string | null): string {
  const base = root ? `${root.replace(/\/+$/, '')}/` : '';
  const rel = (s: string): string => (base ? s.split(base).join('') : s);
  const target = rel(flat(a.target));
  if (a.tool) return `${a.tool.toLowerCase()}${target ? ` ${target}` : ''}`;
  return rel(flat(a.lastLine)) || (a.lastTool ? `${a.lastTool.toLowerCase()}${flat(a.detail) ? ` ${rel(flat(a.detail))}` : ''}` : '');
}

/** Agent rows, in the mocks' order. `T4` is the 1-based position of a plan row the agent owns; an agent owning several lists all of them. */
export function agentModel(agents: readonly HudAgent[], todos: readonly TodoItem[], root?: string | null): AgentRow[] {
  const rows = agents.map((a): AgentRow => {
    const tasks = todos.flatMap((t, i) => (t.owner === a.name ? [i + 1] : []));
    return { name: a.name, state: a.ui ?? workerUiState(a.state), model: shortModel(a.model), tasks, tool: lastAction(a, root), ctx: a.ctx ?? null, focus: false };
  });
  const sorted = sortAgents(rows);
  const at = sorted.findIndex((r) => r.state === 'running');
  if (at >= 0) sorted[at] = { ...sorted[at]!, focus: true };
  return sorted;
}

function surfaces(input: HudInput, opts: HudOpts): { s: { todos: TodoRow[]; agents: AgentRow[] }; o: SurfaceOpts } {
  const plan = input.todos.filter(isPlanItem);
  // A finished agent shows only while a wave runs (the band's rule); with nothing running the block is gone.
  const agents = input.agents.some(isRunning) ? agentModel(input.agents, plan, input.root) : [];
  const ui = opts.ui ?? uiFromEnv();
  return {
    s: { todos: todoModel(plan, opts.now ?? Date.now(), new Map(input.agents.map((a): [string, UiState] => [a.name, a.ui ?? workerUiState(a.state)]))), agents },
    o: { cols: Math.max(1, opts.cols), ui, rich: opts.rich ?? hostEnv().ATLAS_BAND_RICH === '1', tick: opts.tick ?? 0, ...(input.phases ? { phases: input.phases } : {}) },
  };
}

// ---- rows -------------------------------------------------------------------------------------------

/** The HUD as design Runs, each row padded to the width: [] when there is nothing to show. */
export function hudLines(input: HudInput, opts: HudOpts): Run[][] {
  const { s, o } = surfaces(input, opts);
  if (opts.maxRows <= 0 || (s.todos.length === 0 && s.agents.length === 0)) return [];
  return padRows(fitStack(s, o, opts.maxRows), o.cols);
}

/** A run as a Segment: the theme's tone colour on the run's own fill or the rev 4 panel; with NO_COLOR only bold and strike remain. */
export function segmentOf(x: Run, ui: Ui): Segment {
  const p = PALETTES[ui.theme];
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  return ui.color === 'none' ? { t: x.t, ...style } : { t: x.t, color: toneHex(x.tone, ui.theme), bg: x.bg ? p[x.bg] : p.panel, ...style };
}

/** The HUD rows above the band: TODO tree and Subagents block; [] when there is nothing to show. */
export function hudRows(input: HudInput, opts: HudOpts): Segment[][] {
  const ui = opts.ui ?? uiFromEnv();
  return hudLines(input, { ...opts, ui }).map((r) => r.filter((x) => x.t !== '').map((x) => segmentOf(x, ui)));
}

/** Rows of the compact form: the plan's ribbon with up to five rows, the Subagents ribbon with up to two agents. What the HUD keeps whatever the band is given. */
export const hudCompactRows = (input: HudInput, cols = 120): number => {
  const { s, o } = surfaces(input, { cols, maxRows: 0, ui: { theme: 'mocha', ascii: false, color: 'truecolor' } });
  const m = tierOf(o.cols) === 'min' ? 0 : s.agents.length;
  return stack({ todos: s.todos, agents: m > 0 ? s.agents : [] }, o, { spacers: false, extras: false, todoCap: s.todos.length > 5 ? 5 : undefined, agentCap: m > 3 ? 3 : undefined }).length;
};

/** Rows the HUD may take of `maxRows`. Normally what leaves the band `bandRows`; never less than the compact form, so the band gives up rows first: down to 3 (title, rail, one lane), then to none when the compact form needs every row; with an agent running the HUD keeps at least 2. */
export const hudBudget = (maxRows: number, compact: number, bandRows = 7, running = false): number => {
  if (maxRows <= 0) return 0;
  const room = maxRows - bandRows;
  const budget = compact <= maxRows - 3 ? Math.max(room, compact) : Math.max(room, Math.min(compact, maxRows));
  return running ? Math.max(budget, Math.min(2, maxRows)) : budget; // a running agent keeps its Subagents header and one row: the band gives up rows first
};

/** Whether the rows list agents: the Subagents ribbon with at least one row under it. A ribbon alone (a starved slot) carries
 * the counts only, and then the band must list the workers itself. */
export const hudListsAgents = (rows: readonly (readonly Segment[])[]): boolean => {
  const at = rows.findIndex((r) => r.some((x) => x.t === 'SUBAGENTS'));
  return at >= 0 && at < rows.length - 1;
};
