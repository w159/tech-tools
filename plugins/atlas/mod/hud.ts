// The TODO tree and Subagents block above the Mission Control band, drawn to the rev 4 ATLAS design (mod/hud-surface.ts holds
// the host-free layout; omp/hud-paint.ts paints the same rows for omp). This file adapts the board and the squad to those
// rows, fits them to the row budget and paints Runs as Claude Code Segments. Pure: todos and agents in, Segment rows out.
import type { SquadAgent, TodoItem } from './contract';
import { descriptionName } from './data/orchestration';
import { liveState, workerUiState, type LiveWorker } from './data/live';
import { isPlanItem } from './data/todos';
import { todoState } from './data/todos';
import { DONE_DOUBT, WORKER_FAILED, motionState, hostEnv, LINGER_MS, surfaceHex, uiFromEnv, type Run, type Ui, type UiState, runHex } from './atlas-ui';
import { fitStack, padRows, sortAgents, stack, type AgentRow, type SurfaceOpts, type TodoRow } from './hud-surface';
import { keysOf, type MotionCtx, type MotionItem } from './motion';
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
  /** The name the worker is listed under when it differs from `name` (a hash id shown by its description): plan owners and board notes use this one. */
  key?: string;
  /** When the worker last changed state (ms epoch; a finished worker's end time), so a done row can linger. */
  since?: number;
};

const GENERIC = new Set(['unknown', 'general-purpose', 'task', '']);
/** A host agent id (`a6839f49ee72a2b14`) or a bare hash: never a name. */
const HOST_ID = /^[a-z]?[0-9a-f]{8,}$/i;

/** `explorer-3fa9c1`: a type or dispatch stem plus a 6+ hex suffix that mixes digits and letters. `decade` and `2024` are words and years, not hashes. */
const HEX_SUFFIX = /^(.*?)-?([0-9a-f]{6,})$/i;
const hashTail = (name: string): string | undefined => {
  const tail = HEX_SUFFIX.exec(name)?.[2];
  return tail !== undefined && /[0-9]/.test(tail) && /[a-f]/i.test(tail) ? tail : undefined;
};
/** The first `n` words of an Agent description as a slug (`Map band row count` -> `map-band-row`). */
const phrase = (task: string | undefined, n = 3): string => (task ?? '').toLowerCase().match(/[a-z0-9]+/g)?.slice(0, n).join('-') ?? '';

/** The name the panel shows: the dispatch name, else (for a host id or a hash-suffixed name) the prefix of the Agent description
 * (`readme-explorer: compare ...`), else the agent type and a short task phrase, else the type; the id is the last resort. */
export function agentName(name: string, role: string, task?: string): string {
  const said = descriptionName(task);
  // A name built from the task words (`explorer-list-open-atlas`, a type and the first words of `list open Atlas todo items`) is a guess: the requested name wins.
  const derived = said !== undefined && said !== name && name === `${role}-${phrase(taskOf(task))}`;
  const hashed = name === '' || HOST_ID.test(name) || hashTail(name) !== undefined || derived;
  if (!hashed) return name;
  const type = GENERIC.has(role) ? (name.replace(HEX_SUFFIX, '$1').replace(/-$/, '') || '') : role;
  if (said) return said;
  const slug = phrase(task);
  if (type && slug) return `${type}-${slug}`;
  if (type && HOST_ID.test(name)) return type;
  return GENERIC.has(role) && HOST_ID.test(name) ? name.slice(0, 6) : name;
}

/** The one canonical name every surface shows for an agent (HUD rows, both card formats, toasts): `agentName`, and the lead's per-session hash name (`lead-a3a3ab`) reads `lead`. */
export const displayName = (name: string, role = '', task?: string): string => (/^lead-[0-9a-f]{6}$/i.test(name) ? 'lead' : agentName(name, role, task));

/** An agent's task text for the TASK column: its dispatch description without the `name: ` prefix (`read alpha.py`). */
const taskOf = (task: string | undefined): string => flat(task).replace(/^[a-z0-9]+(?:[-_.][a-z0-9]+)+:\s+/i, '');

/** Band workers plus the squad's spawn model and task, in the HUD's shape; `queued` names dispatched workers the host does not list yet (data/live.ts queuedMembers). */
export function hudAgents(live: readonly LiveWorker[], squad: readonly SquadAgent[], queued: readonly string[] = []): HudAgent[] {
  const started = (w: LiveWorker): number => squad.findIndex((a) => a.name === w.name); // the squad lists workers in start order; liveWorkers sorts by urgency, which would move a row when a worker's state changes
  const listed = [...live].sort((a, b) => started(a) - started(b)).map((w) => {
    const s = squad.find((a) => a.name === w.name);
    const name = displayName(w.name, w.role, s?.task);
    return { name, ...(name !== w.name ? { key: w.name } : {}), role: w.role, state: w.state, ui: liveState(w), since: w.since, tool: w.tool, target: w.target, detail: w.detail, lastTool: w.lastTool, lastLine: w.lastLine, ...(s?.model ? { model: s.model } : {}), ...(s?.task ? { task: s.task } : {}) };
  });
  return [...listed, ...queued.filter((n) => !live.some((w) => w.name === n)).map((name): HudAgent => ({ name, role: '', state: 'queued', ui: 'queued' }))];
}

/** `root` (the project root) makes paths in a tool preview project-relative. `phases` feeds the rich rail. */
export type HudInput = { todos: TodoItem[]; agents: HudAgent[]; root?: string | null; phases?: { ids: readonly string[]; active: number } };
export type HudOpts = { cols: number; maxRows: number; ui?: Ui; rich?: boolean; tick?: number; now?: number; /** Motion view (mod/motion.ts); absent: the resting render. */ motion?: MotionCtx | undefined };

export const isRunning = (a: HudAgent): boolean => a.state === 'working' || a.state === 'blocked' || a.state === 'running' || a.state === 'queued';

// ---- adapters ---------------------------------------------------------------------------------------

const flat = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const LABEL_PREFIX = /^\[([A-Za-z][\w-]*)\]\s+/;
const WORD_PREFIX = /^(research|theory|plan|design|test|implement|build|fix|verify|review|validate|docs|ship)(?::\s+|\s+-\s+)/i;
/** The item's text without a `[phase] ` or `Phase: ` prefix (the rail names the phase). */
const labelOf = (t: TodoItem): string => flat(t.content).replace(LABEL_PREFIX, '').replace(WORD_PREFIX, '');
const mmss = (ms: number): string => `${String(Math.floor(ms / 60_000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/** Owner name -> state word, from the HUD's agents (by display name and by host key): the one map the TODO rows and the side panel's route tab read an owner's state from. */
export const ownerStatesOf = (agents: readonly HudAgent[]): Map<string, UiState> =>
  new Map(agents.flatMap((a): [string, UiState][] => { const ui = a.ui ?? workerUiState(a.state); return [[a.name, ui], ...(a.key !== undefined ? [[a.key, ui] as [string, UiState]] : [])]; }));

/** Plan rows in plan order. Every row is shown with its own state; the focus mark sits on the running row, else the first open one. */
export function todoModel(todos: readonly TodoItem[], now: number, owners: ReadonlyMap<string, UiState> = new Map()): TodoRow[] {
  const rows = todos.map((t): TodoRow => {
    const { state, word } = todoState(t.status, t.owner ? owners.get(t.owner) : undefined); // the one rule (data/todos todoState): a failed owner fails the item, a returned one reads `returned`
    const claimed = typeof t.claimed_at === 'number' && t.claimed_at > 0 ? now - t.claimed_at * 1000 : undefined;
    const est = typeof t.estimate_s === 'number' && t.estimate_s > 0 ? ` of ${mmss(t.estimate_s * 1000)}` : ''; // the estimate only when the item carries one
    const own = t.owner ? owners.get(t.owner) : undefined;
    const ownerWord = state !== 'done' && (own === 'failed' || own === 'waiting' || own === 'blocked') && own !== state ? `owner ${own}` : ''; // as on the board: a failed owner already fails the item, a waiting owner blocks it and is named
    const ev = flat(t.evidence);
    const base = ev || (state === 'running' && claimed !== undefined && claimed >= 0 ? `elapsed ${mmss(claimed)}${est}` : '') || flat(t.owner);
    const detail = word === DONE_DOUBT && state === 'done' ? WORKER_FAILED : ownerWord ? (ev ? `${ownerWord} · ${ev}` : ownerWord) : base; // critique 17 A1: a done row whose worker failed says so
    return { label: labelOf(t), ...(t.id ? { id: String(t.id) } : {}), state, ...(word ? { word } : {}), detail, focus: false, ...(flat(t.owner) ? { owner: flat(t.owner) } : {}), ...(state === 'done' && typeof t.completed_at === 'number' && t.completed_at > 0 ? { doneAt: t.completed_at * 1000 } : {}) };
  });
  const at = rows.findIndex((r) => r.state === 'running');
  const focus = at >= 0 ? at : rows.findIndex((r) => r.state !== 'done');
  if (focus >= 0) rows[focus] = { ...rows[focus]!, focus: true };
  return rows;
}

/** `opus`, `sonnet-5`: the model without its provider and the `claude-` prefix; nothing is guessed. */
export const shortModel = (model: string | undefined): string => flat(model).replace(/^.*\//, '').replace(/^claude-/, '');

const INTERPRETERS = new Set(['python', 'python3', 'node', 'bun', 'bash', 'sh', 'zsh', 'uv', 'npx', 'bunx']);
/** A shell call as a person reads it: `run <script>` (the interpreter's first argument, by basename) or `run <command>`, never the raw command line and its temp paths (critique 13). */
const shellCall = (command: string): string => {
  const words = (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ''));
  const first = words[0] ?? '';
  const named = (w: string): boolean => !w.startsWith('-') && !(w.split('/').pop() ?? w).startsWith('-'); // `-home-user-tech-t`: a path cut mid-name is no script
  const word = INTERPRETERS.has(first.split('/').pop() ?? first) ? (words.slice(1).find(named) ?? first) : first;
  return `run ${word.split('/').pop() || 'shell'}`;
};
/** The event keeps 40 chars of a command as `target`; the full command rides in `detail` when the call had no description. */
const wholeCommand = (target: string, detail: string | null | undefined): string => { const d = flat(detail); return target !== '' && d.startsWith(target) ? d : target; };
const isShell = (tool: string | null | undefined): boolean => (tool ?? '').toLowerCase() === 'bash';

/** The agent's current call (`read runs.ts:17`), else its last line, else its last call. */
export function lastAction(a: Pick<HudAgent, 'tool' | 'target' | 'detail' | 'lastTool' | 'lastLine'>, root?: string | null): string {
  const base = root ? `${root.replace(/\/+$/, '')}/` : '';
  const rel = (s: string): string => (base ? s.split(base).join('') : s);
  const target = rel(flat(a.target));
  const command = wholeCommand(target, a.detail != null ? rel(flat(a.detail)) : a.detail);
  if (a.tool) return isShell(a.tool) && target ? shellCall(command) : `${a.tool.toLowerCase()}${target ? ` ${target}` : ''}`;
  // Between calls and after the end: the last call (its target, else its intent), then the free-text report only when there was no call.
  const call = isShell(a.lastTool) && target ? shellCall(command) : a.lastTool ? `${a.lastTool.toLowerCase()}${target ? ` ${target}` : flat(a.detail) ? ` ${rel(flat(a.detail))}` : ''}` : '';
  return call || rel(flat(a.lastLine));
}

/** The one LAST text of an agent, for the HUD row and the team tab: a finished worker's is its outcome (critique 12: `tests green` beside `read runs.ts:17`): the evidence its plan
 * or dispatch row carries (a bare `ran 03:10` is a duration, not an outcome); with none, a finished worker that made calls reports `report returned`, never its last tool call
 * (critique 14), and its closing line stays when it made no call. A live or failed worker's is its current (else last) call, in plain words (critique 16: the HUD said
 * `read util.py` and the team tab `failed` for one agent). `evidence`: the evidence of every row the agent owns, plan rows first. */
export function lastOf(a: Pick<HudAgent, 'tool' | 'target' | 'detail' | 'lastTool' | 'lastLine'>, state: UiState, evidence: readonly (string | null | undefined)[], root?: string | null): string {
  const outcome = state === 'done' ? flat(evidence.find((e) => flat(e) && !/^ran\s+[\d:]+$/.test(flat(e)))) : '';
  return outcome || (state === 'done' && a.lastTool ? 'report returned' : lastAction(a, root));
}

/** Agent rows, in the mocks' order. `T4` is the 1-based position of a plan row the agent owns; an agent owning several lists all of them. */
export function agentModel(agents: readonly HudAgent[], todos: readonly TodoItem[], root?: string | null): AgentRow[] {
  const plan = todos.filter(isPlanItem); // T-numbers count plan rows; the hook's dispatch row of a worker holds its report, which is the outcome a finished row shows
  const rows = agents.map((a): AgentRow => {
    const mine = (t: TodoItem): boolean => t.owner === a.name || (a.key !== undefined && t.owner === a.key);
    const owned = [...plan.filter(mine), ...todos.filter((t) => !isPlanItem(t) && mine(t))];
    const tasks = plan.flatMap((t, i) => (mine(t) ? [i + 1] : []));
    const state = a.ui ?? workerUiState(a.state);
    const last = lastOf(a, state, owned.map((t) => t.evidence), root);
    return { name: a.name, id: a.key ?? a.name, state, model: shortModel(a.model), tasks, tool: last, ctx: a.ctx ?? null, focus: false, ...(taskOf(a.task) ? { task: taskOf(a.task) } : {}) };
  });
  const sorted = sortAgents(rows);
  const at = sorted.findIndex((r) => r.state === 'running');
  if (at >= 0) sorted[at] = { ...sorted[at]!, focus: true };
  return sorted;
}

function surfaces(input: HudInput, opts: HudOpts): { s: { todos: TodoRow[]; agents: AgentRow[] }; o: SurfaceOpts } {
  const plan = input.todos.filter(isPlanItem);
  // A finished agent shows while a wave runs, and with nothing running a done one stays LINGER_MS after it ended while a failed one stays until it is cleared (the band's rule).
  const running = input.agents.some(isRunning);
  // The finished wave lingers as one: while its newest member is within LINGER_MS every done agent shows, so the header count and the rows keep matching the band.
  const newestDone = input.agents.reduce((n, a) => (a.state === 'done' && a.since !== undefined ? Math.max(n, a.since) : n), -Infinity);
  const waveLingers = opts.now !== undefined && opts.now - newestDone <= LINGER_MS;
  // A failed agent is kept until cleared, and the wave it belonged to stays with it: the final block lists the done siblings too, so its count matches the route's (critique 16: `1 failed` over `2 done ■ 1 failed`).
  const anyFailed = input.agents.some((a) => a.state === 'failed');
  const shown = running ? input.agents : input.agents.filter((a) => a.state === 'failed' || (a.state === 'done' && (waveLingers || anyFailed)));
  const agents = shown.length > 0 ? agentModel(shown, input.todos, input.root) : [];
  const ui = opts.ui ?? uiFromEnv();
  const keyed = <R extends { key?: string }>(surface: string, rows: R[], name: (r: R) => string): R[] => { const k = keysOf(surface, rows.map(name)); return rows.map((r, i) => ({ ...r, key: k[i]! })); };
  return {
    s: { todos: keyed('todo', todoModel(plan, opts.now ?? Date.now(), ownerStatesOf(input.agents)), (r) => r.label), agents: keyed('agent', agents, (r) => r.name) },
    o: { cols: Math.max(1, opts.cols), ui, rich: opts.rich ?? hostEnv().ATLAS_BAND_RICH === '1', tick: opts.tick ?? 0, ...(input.phases ? { phases: input.phases } : {}), ...(opts.now !== undefined ? { now: opts.now } : {}), ...(opts.motion ? { motion: opts.motion } : {}) },
  };
}

// ---- rows -------------------------------------------------------------------------------------------

/** What the Motion observes of the HUD: each TODO row's and each agent row's key and state word (the rows `hudLines` can draw). */
export function hudMotionItems(input: HudInput, opts: { now: number }): { todos: MotionItem[]; agents: MotionItem[] } {
  const { s } = surfaces(input, { cols: 120, maxRows: 0, now: opts.now });
  return { todos: s.todos.map((r) => ({ key: r.key!, state: motionState(r.state, r.word) })), agents: s.agents.map((r) => ({ key: r.key!, state: r.state })) };
}

/** The HUD as design Runs, each row padded to the width: [] when there is nothing to show. */
export function hudLines(input: HudInput, opts: HudOpts): Run[][] {
  const { s, o } = surfaces(input, opts);
  if (opts.maxRows <= 0 || (s.todos.length === 0 && s.agents.length === 0)) return [];
  return padRows(fitStack(s, o, opts.maxRows), o.cols);
}

/** A run as a Segment: the theme's tone colour on the run's own fill or the rev 4 panel; with NO_COLOR only bold and strike remain. */
export function segmentOf(x: Run, ui: Ui): Segment {
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  return ui.color === 'none' ? { t: x.t, ...style } : { t: x.t, color: runHex(x, ui.theme, ui.color), bg: surfaceHex(x.bg ?? 'panel', ui), ...style };
}

/** The HUD rows above the band: TODO tree and Subagents block; [] when there is nothing to show. */
export function hudRows(input: HudInput, opts: HudOpts): Segment[][] {
  const ui = opts.ui ?? uiFromEnv();
  return hudLines(input, { ...opts, ui }).map((r) => r.filter((x) => x.t !== '').map((x) => segmentOf(x, ui)));
}

/** Rows of the compact form: the plan's ribbon with up to five rows, the Subagents ribbon with up to two agents. What the HUD keeps whatever the band is given. */
export const hudCompactRows = (input: HudInput, cols = 120): number => {
  const { s, o } = surfaces(input, { cols, maxRows: 0, ui: { theme: 'mocha', ascii: false, color: 'truecolor' } });
  const m = s.agents.length;
  return stack({ todos: s.todos, agents: m > 0 ? s.agents : [] }, o, { spacers: false, extras: false, todoCap: s.todos.length > 5 ? 5 : undefined, agentCap: m > 3 ? 3 : undefined, header: false }).length; // the floor has no column-name row: it is drawn only when the budget also leaves the band its summary row
};

/** Rows of the compact form WITH the Subagents column names and the blank between the blocks: what the register gives the HUD when the slot can hold them
 * and the band still keeps its title row (register.ts hudSlotCap). `now`: the draw's clock, so a lingering finished wave counts (hudCompactRows has none and leaves it out). */
export const hudFloorRows = (input: HudInput, cols = 120, now?: number): number => {
  const { s, o } = surfaces(input, { cols, maxRows: 0, ...(now !== undefined ? { now } : {}), ui: { theme: 'mocha', ascii: false, color: 'truecolor' } });
  const m = s.agents.length;
  return stack({ todos: s.todos, agents: m > 0 ? s.agents : [] }, o, { spacers: true, extras: false, todoCap: s.todos.length > 5 ? 5 : undefined, agentCap: m > 3 ? 3 : undefined, header: true }).length;
};

/** Rows the HUD may take of `maxRows`. Normally what leaves the band `bandRows`; never less than the compact form, so the band gives up rows first: down to 3 (title, rail, one lane), then to none when the compact form needs every row; with an agent running the HUD keeps at least 2. */
export const hudBudget = (maxRows: number, compact: number, bandRows = 7, running = false): number => {
  if (maxRows <= 0) return 0;
  const room = maxRows - bandRows;
  const budget = compact <= maxRows - 3 ? Math.max(room, compact) : Math.max(room, Math.min(compact, maxRows));
  return running ? Math.max(budget, Math.min(2, maxRows)) : budget; // a running agent keeps its Subagents header and one row: the band gives up rows first
};

/** Hands the band's breathing blanks to the HUD: the plan is cut to "N more todos not shown" only when its rows truly do not fit, never while the band spends rows on blanks.
 * `hud`: the rows drawn at `cap`; `spareOf`: the band's blank rows beside those HUD rows; `draw`: the HUD at a given row budget; `budget`: the slot, which the HUD never exceeds. */
export function reclaimBlanks<R>(hud: readonly R[], cap: number, budget: number, spareOf: (hud: readonly R[]) => number, draw: (maxRows: number) => R[]): readonly R[] {
  if (hud.length === 0) return hud;
  const spare = spareOf(hud);
  if (spare <= 0) return hud;
  const grown = draw(Math.min(budget, cap + spare));
  return grown.length > hud.length ? grown : hud;
}

/** Whether the rows list agents: the Subagents ribbon with at least one row under it. A ribbon alone (a starved slot) carries
 * the counts only, and then the band must list the workers itself. */
export const hudListsAgents = (rows: readonly (readonly Segment[])[]): boolean => {
  const at = rows.findIndex((r) => r.some((x) => x.t === 'SUBAGENTS'));
  return at >= 0 && at < rows.length - 1;
};
