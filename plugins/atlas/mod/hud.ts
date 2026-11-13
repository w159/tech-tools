// The TODO tree and Subagents block above the Mission Control band, drawn to the rev 4 ATLAS design (mod/hud-surface.ts holds
// the host-free layout; omp/hud-paint.ts paints the same rows for omp). This file adapts the board and the squad to those
// rows, fits them to the row budget and paints Runs as Claude Code Segments. Pure: todos and agents in, Segment rows out.
import type { SquadAgent, TodoItem } from './contract';
import { descriptionName } from './data/orchestration';
import { liveState, workerUiState, type LiveWorker } from './data/live';
import { isPlanItem } from './data/todos';
import { todoState } from './data/todos';
import { ownerOutcome } from './board-model';
import { DONE_DOUBT, RETURNED, cells, elapsedClock, motionState, hostEnv, fillHex, uiFromEnv, type Run, type Ui, type UiState, runHex } from './atlas-ui';
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
  /** Epoch ms the worker started, and (with `since`, frozen at the end) the clock LAST reads. */
  startedAt?: number;
  /** Context used, 0..1, when the host knows it (the rich form draws a gauge). */
  ctx?: number | null;
  /** The state word every surface shares (liveState), when the adapter knows the worker's age; else it is derived from `state`. */
  ui?: UiState;
  /** The name the worker is listed under when it differs from `name` (a hash id shown by its description): plan owners and board notes use this one. */
  key?: string;
  /** When the worker last changed state (ms epoch; a finished worker's end time), so a done row can linger. */
  since?: number;
  /** Tool calls the host counted for the worker (wave 35): the CALLS column of the done table. Absent when none were seen. */
  calls?: number;
};

const GENERIC = new Set(['unknown', 'general-purpose', 'task', '']);
/** A host agent id (`a6839f49ee72a2b14`) or a bare hash: never a name. */
/** The one failure word on every HUD row (wave 33): a stopped or failed worker is `failed`, never `killed`. */
export const FAILED = 'failed';
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
    return { name, ...(name !== w.name ? { key: w.name } : {}), role: w.role, state: w.state, ui: liveState(w), since: w.since, startedAt: w.startedAt, tool: w.tool, target: w.target, detail: w.detail, lastTool: w.lastTool, lastLine: w.lastLine, ...(w.calls?.length ? { calls: w.calls.length } : {}), ...(s?.model ? { model: s.model } : {}), ...(s?.task ? { task: s.task } : {}) };
  });
  return [...listed, ...queued.filter((n) => !live.some((w) => w.name === n)).map((name): HudAgent => ({ name, role: '', state: 'queued', ui: 'queued' }))];
}

/** `root` (the project root) makes paths in a tool preview project-relative. `phases` feeds the rich rail. */
export type HudInput = { todos: TodoItem[]; agents: HudAgent[]; root?: string | null; phases?: { ids: readonly string[]; active: number } };
export type HudOpts = { cols: number; maxRows: number; /** The run's fixed shape (slot.ts): an empty TODO or SUBAGENTS block still draws its closed box. */ reserve?: boolean; ui?: Ui; rich?: boolean; /** False: never merge running agents into the TODO rows (row counters ask for the roomiest form). */ merge?: boolean; /** The live slot (slot.ts composeFixed, wave 32): a row whose agent has ended reads done on the event that ends it, not when the lead closes the store row. */ settled?: boolean; /** Atlas is at rest (the band reads idle): the block draws in 240 rules and 245 text. */ idle?: boolean; tick?: number; now?: number; /** Motion view (mod/motion.ts); absent: the resting render. */ motion?: MotionCtx | undefined };

export const isRunning = (a: HudAgent): boolean => a.state === 'working' || a.state === 'blocked' || a.state === 'running' || a.state === 'queued';
/** An agent that does work right now (wave 34): running, working or blocked. A queued one (dispatched, the host never listed it) is drawn but is not work: it never holds the band `working` nor turns the SUBAGENTS spinner. */
export const isAlive = (a: HudAgent): boolean => a.state === 'working' || a.state === 'blocked' || a.state === 'running';

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
export function todoModel(todos: readonly TodoItem[], now: number, owners: ReadonlyMap<string, UiState> = new Map(), handedBackDone = false): TodoRow[] {
  // A plan row whose text names a running agent (`T1 read alpha.py (alpha-explorer)`) before the lead has stamped an owner on it is that agent's row: it reads running, not queued (critique 29: T1 `queued` while alpha-explorer ran).
  const inferred = (t: TodoItem): string | undefined => {
    if (t.owner) return undefined;
    const label = flat(t.content);
    for (const [name] of owners) if (label.includes(`(${name})`)) return name; // wave 34: any state, so a closed row over a failed worker reads `■ failed` and a finished one keeps its agent and clock
    return undefined;
  };
  const rows = todos.map((raw): TodoRow => {
    const guess = inferred(raw);
    const t = guess ? { ...raw, owner: guess } : raw;
    const oc = t.owner ? ownerOutcome(owners, t.owner) : undefined; // the owner's latest instance (`beta-explorer #2` after a kill), critique 19 A3
    const own = oc?.state;
    const ruled = todoState(t.status, own, oc?.retried); // the one rule (data/todos todoState): a failed owner fails the item, a returned one reads `returned`
    // Wave 32: in the merged block the row flips to done on the event that ends its agent (the subagent stop that also places the finish card), not 4-5 s later when the lead closes the store row.
    const handed = handedBackDone && ruled.word === RETURNED;
    const { state, word } = handed ? { state: 'done' as UiState, word: undefined } : ruled;
    const claimed = typeof t.claimed_at === 'number' && t.claimed_at > 0 ? now - t.claimed_at * 1000 : undefined;
    const est = typeof t.estimate_s === 'number' && t.estimate_s > 0 ? ` of ${mmss(t.estimate_s * 1000)}` : ''; // the estimate only when the item carries one
    const ownerWord = state !== 'done' && (own === 'failed' || own === 'waiting' || own === 'blocked') && own !== state ? `owner ${own}` : ''; // as on the board: a failed owner already fails the item, a waiting owner blocks it and is named
    const ev = flat(t.evidence);
    const shownOwner = flat(t.owner) ? (oc?.state !== undefined && oc.state !== 'failed' && oc.as !== t.owner ? oc.as : flat(t.owner)) : ''; // a retry names its live instance (`beta-explorer #2`)
    const base = ev || (state === 'running' && claimed !== undefined && claimed >= 0 ? `elapsed ${mmss(claimed)}${est}` : '') || shownOwner;
    const detail = word === DONE_DOUBT && state === 'done' ? `worker ${FAILED}` : ownerWord ? (ev ? `${ownerWord} · ${ev}` : ownerWord) : base; // critique 17 A1: a done row whose worker failed says so
    return { label: labelOf(t), ...(t.id ? { id: String(t.id) } : {}), state, ...(word ? { word } : {}), detail, focus: false, ...(shownOwner ? { owner: shownOwner } : {}), ...(state === 'done' && typeof t.completed_at === 'number' && t.completed_at > 0 ? { doneAt: t.completed_at * 1000 } : {}) };
  });
  const at = rows.findIndex((r) => r.state === 'running');
  const focus = at >= 0 ? at : rows.findIndex((r) => r.state !== 'done');
  if (focus >= 0) rows[focus] = { ...rows[focus]!, focus: true };
  return rows;
}

/** The TODO title's `done/total`, from the very rows the block draws (todoModel over the HUD's own agents, a row whose agent has ended settled to done as the live slot draws it): the band's `todo n/m` reads this,
 * so the two can never disagree (wave 35; critique 34: `0/5` under a TODO title of `1/5`). `todos` are this session's rows (ownTodos). */
export function planProgress(todos: readonly TodoItem[], live: readonly LiveWorker[], squad: readonly SquadAgent[], queued: readonly string[], now: number): { done: number; total: number } {
  const rows = todoModel(todos.filter(isPlanItem), now, ownerStatesOf(hudAgents(live, squad, queued)), true);
  return { done: rows.filter((r) => r.state === 'done').length, total: rows.length };
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
/** Calls that set the agent up, not work on its task: a LAST of `toolsearch...` or `todowrite` says nothing. */
const isPlumbing = (tool: string | null | undefined): boolean => /^(toolsearch|todowrite|todoread)$/i.test(tool ?? '');
const PREPARING = 'preparing';
/** A finished agent whose report holds no outcome LAST can state. */
const FINISHED = 'finished';
/** Text that is a tool's failure or an empty search, not an outcome (critique 19 B1: `No matching deferred tools found.`, `no match`). */
const JUNK = /\bno\s+match(?:es|ing)?\b|not\s+found|\bno\s+such\b|unavailable|\berrors?\b|denied|refused|\bcannot\b|\bcould\s+not\b|\bunable\s+to\b|timed?\s*out|permission|traceback|exception|proxy|\b40[0-9]\b|\b50[0-9]\b/i;

/** The agent's current call (`read runs.ts:17`), else its last line, else its last call. */
export function lastAction(a: Pick<HudAgent, 'tool' | 'target' | 'detail' | 'lastTool' | 'lastLine'>, root?: string | null): string {
  const base = root ? `${root.replace(/\/+$/, '')}/` : '';
  const rel = (s: string): string => (base ? s.split(base).join('') : s);
  const target = rel(flat(a.target));
  const command = wholeCommand(target, a.detail != null ? rel(flat(a.detail)) : a.detail);
  if (isPlumbing(a.tool) || (!a.tool && isPlumbing(a.lastTool))) return PREPARING; // loading tools is no step of the task (critique 19 B1: `toolsearch...`)
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
  // Critique 17: a failed agent's LAST said `read ghost.py`, the call it was making when it was stopped: that is what happened to it, `killed`. A failure that left only a closing line keeps the line (`tests red 3`).
  if (state === 'failed' && (a.tool || a.lastTool)) return FAILED;
  if (state !== 'done') return lastAction(a, root);
  // Critique 19 B1: a finished agent's LAST is an outcome and only that: the first evidence row that states one, else its closing line, else `finished`. Never a tool error, a tool name,
  // `<file> read` or `returned`; the same words at every width.
  for (const e of evidence) {
    if (!flat(e) || /^ran\s+[\d:]+$/.test(flat(e))) continue;
    const o = outcomeOf(flat(e));
    if (o) return o;
  }
  // The closing line is a stored, clipped tool echo more often than a report: only a line that is not an echo can state an outcome (a clipped dump would count wrong).
  const closing = flat(root ? flat(a.lastLine).split(`${root.replace(/\/+$/, '')}/`).join('') : a.lastLine);
  return (ECHO.test(closing.replace(LIST_NUMBER, '')) ? '' : outcomeOf(closing)) || FINISHED;
}

/** A tool echo as the evidence rows hold it: `1. Read `/p/alpha.py` -> first 3 lines: ...` (tool, one target token and an optional `(note)`, `->`, what came back). */
const ECHO = /^([A-Za-z][\w-]*)\s+(`[^`]+`|\S+)(?:\s+\([^)]*\))?\s+->\s+(.*)$/;
const LIST_NUMBER = /^\d{1,3}[.)]\s+/;
/** What came back is a dump of the file's lines (`first 3 lines:`, `line 1 `def ...``, `full file is 7 lines`, `1 def f():`): content, not an outcome. */
const DUMP = /^(?:first|last)\s+\d+\s+lines?\b|^lines?\s+\d|^(?:the\s+)?(?:full\s+)?file\s+is\s+\d+\s+lines?\b|^\d{1,4}\s+(?:(?:def|function|func|fn|class|import|from|const|let|var|return)\b|#|\/\/)/i;
const FUNCTION = /\b(?:def|function|func|fn)\s+\w/g;
/** The longest outcome LAST is given: a sentence past it is cut to a clause, else replaced by a plain phrase (critique 18: no `1.`, no cut sentence). */
const OUTCOME_MAX = 40;

/** The short outcome of a finished agent's report or evidence (critique 17: LAST read `Read alpha.py -> first 3 lines: 1 def...`): a STATUS word, a count of what a file dump
 * holds (`2 functions found`, else `alpha.py read`), the result of a tool echo, else the first sentence; critique 18: the list number is dropped, a result past
 * OUTCOME_MAX cells loses its parenthetical, then is cut to a clause. Critique 19 B1: '' (no outcome stated) when the text is a tool's failure or empty search, a file dump with no
 * function in it, or a sentence too long to cut; a count reads `2 functions` (11 cells, so the 110-column LAST holds the same words as the 150). */
export function outcomeOf(text: string): string {
  const status = /\bSTATUS:\s*([A-Za-z]+)/.exec(text)?.[1]?.toLowerCase();
  if (status && status !== 'done') return status;
  const deliverable = status ? /\bDELIVERABLE:\s*(.+)$/.exec(text)?.[1] : undefined;
  if (status && !deliverable) return 'done';
  const body = flat(deliverable ?? text).replace(LIST_NUMBER, '');
  if (body === '') return '';
  const echo = ECHO.exec(body);
  if (echo) {
    const result = echo[3]!.replace(/`/g, '').replace(/^["']+|["']+$/g, '');
    if (!DUMP.test(result)) return JUNK.test(result) ? '' : plain(result, '');
    const n = (result.match(FUNCTION) ?? []).length;
    return n > 0 ? `${n} ${n === 1 ? 'function' : 'functions'}` : '';
  }
  return JUNK.test(body) ? '' : plain(body, '');
}
/** The text to its first full stop (a stop followed by a space: `alpha.py` is no sentence end). */
const sentence = (s: string): string => { const at = s.search(/[.!?](?:\s|$)/); return at >= 0 ? s.slice(0, at + 1) : s; };
/** One sentence of `s` that fits OUTCOME_MAX: whole, else without its parentheticals, else its first clause, else `fallback`. */
function plain(s: string, fallback: string): string {
  const fits = (x: string): boolean => x !== '' && cells(x) <= OUTCOME_MAX && !/^\d{1,3}[.)]?$/.test(x);
  const first = sentence(s);
  if (fits(first)) return first;
  const bare = sentence(first.replace(/\s*\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim());
  if (fits(bare)) return bare;
  const clause = bare.split(/[;:,]\s/)[0]!.replace(/[\s,;:-]+$/, '');
  return fits(clause) ? clause : fallback;
}

/** The one word of an agent's last tool (`read`, `bash`): what RESULT reads when the agent has no outcome or call to state, so the cell is never blank and never the state word again (critique 22: it repeated `done`). */
const lastFallback = (a: Pick<HudAgent, 'tool' | 'lastTool'>): string => {
  const tool = flat(a.tool || a.lastTool).toLowerCase();
  return tool !== '' && !isPlumbing(tool) ? tool : '';
};

/** The LAST column: the clock since the agent started (`0:13`), frozen at the instant it ended (`since`, stamped by the builder when the worker finished or failed); `-` when the worker's start is not known. */
export const elapsedOf = (a: Pick<HudAgent, 'state' | 'since' | 'startedAt'>, state: UiState, now?: number): string => {
  if (typeof a.startedAt !== 'number' || !Number.isFinite(a.startedAt) || now === undefined) return state === 'queued' ? '0:00' : '-';
  const ended = (state === 'done' || state === 'failed') && typeof a.since === 'number' && a.since > a.startedAt && a.since <= now;
  return elapsedClock((Math.max(a.startedAt, ended ? a.since! : now) - a.startedAt) / 1000);
};

/** Agent rows, in the mocks' order. `T4` is the 1-based position of a plan row the agent owns; an agent owning several lists all of them. `now` (epoch ms) times a running agent's LAST fallback.
 * An agent the host listed with no name takes the key, the dispatch description's name, the owner of a dispatch row no other agent holds, else its role: a row never has a blank AGENT cell (critique 22). */
export function agentModel(agents: readonly HudAgent[], todos: readonly TodoItem[], root?: string | null, now?: number): AgentRow[] {
  const plan = todos.filter(isPlanItem); // T-numbers count plan rows; the hook's dispatch row of a worker holds its report, which is the outcome a finished row shows
  const held = (n: string): boolean => agents.some((x) => flat(x.name) === n || flat(x.key) === n);
  const spare = [...new Set(todos.filter((t) => (t as { origin?: string }).origin === 'dispatch').map((t) => flat(t.owner)).filter((n) => n !== '' && n !== 'lead' && !held(n)))];
  let spareAt = 0;
  const rows = agents.map((a): AgentRow => {
    const shown = flat(a.name) || flat(a.key) || descriptionName(a.task) || spare[spareAt++] || flat(a.role) || 'agent';
    // A retry (`beta-explorer #2`) takes over the item its first run owned: the plan row names `beta-explorer`, so TASK reads `T3` for the retry too (critique 19 B2).
    const first = shown.replace(/\s+#\d+$/, '');
    const mine = (t: TodoItem): boolean => t.owner === shown || t.owner === a.name || (a.key !== undefined && t.owner === a.key) || (first !== shown && t.owner === first);
    const owned = [...plan.filter(mine), ...todos.filter((t) => !isPlanItem(t) && mine(t))];
    const tasks = plan.flatMap((t, i) => (mine(t) ? [i + 1] : []));
    const state = a.ui ?? workerUiState(a.state);
    const last = lastOf(a, state, owned.map((t) => t.evidence), root);
    const fallback = lastFallback(a);
    const task = taskOf(a.task) || taskOf(owned.find((t) => (t as { origin?: string }).origin === 'dispatch')?.content); // the dispatch row's text when the squad has none
    return { name: shown, id: a.key ?? shown, state, model: shortModel(a.model) || '-' /* critique 18: MODEL is never blank; a dispatch that named none reads `-` */, tasks, tool: last, ctx: a.ctx ?? null, focus: false, elapsed: elapsedOf(a, state, now), ...(a.calls ? { calls: a.calls } : {}), ...(task ? { task } : {}), ...(fallback ? { fallback } : {}) };
  });
  const sorted = sortAgents(rows);
  const at = sorted.findIndex((r) => r.state === 'running');
  if (at >= 0) sorted[at] = { ...sorted[at]!, focus: true };
  return sorted;
}

/** Workers a dispatch row names that no list holds yet: a queued row on the first snapshot that names the worker, before its first event (critique 21: SUBAGENTS rows appeared 89.5% of
 * the time at 150). The dispatch hook writes the row (origin `dispatch`) when the lead launches the worker, before the squad or the members record lists it. Only an open row counts
 * (a finished one's worker has been listed and is gone), `lead` never does, and a retry (`beta-explorer #2`) is its first run's row. */
export function namedAgents(todos: readonly TodoItem[], agents: readonly HudAgent[]): HudAgent[] {
  const listed = (name: string): boolean => agents.some((a) => a.name === name || a.key === name || a.name.replace(/\s+#\d+$/, '') === name);
  const open = (t: TodoItem): boolean => t.origin === 'dispatch' && (t.status === 'in_progress' || t.status === 'pending');
  const names = todos.filter(open).map((t) => flat(t.owner)).filter((n) => n !== '' && n !== 'lead' && !n.startsWith('lead-') && !listed(n));
  return [...new Set(names)].map((name): HudAgent => ({ name, role: '', state: 'queued', ui: 'queued' }));
}

function surfaces(input: HudInput, opts: HudOpts): { s: { todos: TodoRow[]; agents: AgentRow[] }; o: SurfaceOpts } {
  const plan = input.todos.filter(isPlanItem);
  // The block stays after the wave: a clean finish keeps its done rows as a stop run keeps its failed one, until the roster is cleared (critique 17: live-150-a4fad2f9-3/tab-team.png
  // lost the block after DONE while the stop runs kept all three rows). Only an agent that is neither running, done nor failed (parked) is left out.
  const all = [...input.agents, ...namedAgents(input.todos, input.agents)];
  const running = all.some(isRunning);
  const shown = running ? all : all.filter((a) => a.state === 'failed' || a.state === 'done');
  const agents = shown.length > 0 ? agentModel(shown, input.todos, input.root, opts.now) : [];
  const ui = opts.ui ?? uiFromEnv();
  const keyed = <R extends { key?: string }>(surface: string, rows: R[], name: (r: R) => string): R[] => { const k = keysOf(surface, rows.map(name)); return rows.map((r, i) => ({ ...r, key: k[i]! })); };
  return {
    s: { todos: keyed('todo', todoModel(plan, opts.now ?? Date.now(), ownerStatesOf(input.agents), opts.settled === true && opts.merge !== false), (r) => r.label), agents: keyed('agent', agents, (r) => r.name) },
    o: { cols: Math.max(1, opts.cols), ui, rich: opts.rich ?? hostEnv().ATLAS_BAND_RICH === '1', tick: opts.tick ?? 0, ...(input.phases ? { phases: input.phases } : {}), ...(opts.now !== undefined ? { now: opts.now } : {}), ...(opts.motion ? { motion: opts.motion } : {}), ...(opts.reserve ? { reserve: true } : {}), ...(opts.merge === false ? { merge: false } : {}) },
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
  if (opts.maxRows <= 0 || (s.todos.length === 0 && s.agents.length === 0 && !opts.reserve)) return [];
  const rows = padRows(fitStack(s, o, opts.maxRows), o.cols);
  return opts.idle === true ? rows.map(idleRow) : rows;
}

/** At rest the block is quiet (critique 29: idle and done drew the same green boxes): every run but the 240 rules reads 245, no weight, no fill. */
const idleRow = (row: Run[]): Run[] => row.map((x) => (x.tone === 'dim' ? x : { t: x.t, tone: 'sub' as const, ...(x.strike ? { strike: true } : {}) }));

/** A run as a Segment: the theme's tone colour on the run's own fill or the rev 4 panel; with NO_COLOR only bold and strike remain. */
export function segmentOf(x: Run, ui: Ui): Segment {
  const style = { ...(x.bold ? { bold: true } : {}), ...(x.strike ? { strike: true } : {}) };
  return ui.color === 'none' ? { t: x.t, ...style } : { t: x.t, color: runHex(x, ui.theme, ui.color), bg: fillHex(x, ui), ...style };
}

/** The HUD rows above the band: TODO tree and Subagents block; [] when there is nothing to show. */
export function hudRows(input: HudInput, opts: HudOpts): Segment[][] {
  const ui = opts.ui ?? uiFromEnv();
  return hudLines(input, { ...opts, ui }).map((r) => r.filter((x) => x.t !== '').map((x) => segmentOf(x, ui)));
}

/** Rows of the compact form: the plan's ribbon with up to five rows, the Subagents ribbon with up to two agents, the column names and both closing rules (the box keeps its shape). What the HUD keeps whatever the band is given. */
export const hudCompactRows = (input: HudInput, cols = 120): number => {
  const { s, o } = surfaces(input, { cols, maxRows: 0, merge: false, ui: { theme: 'mocha', ascii: false, color: 'truecolor' } });
  const m = s.agents.length;
  return stack({ todos: s.todos, agents: m > 0 ? s.agents : [] }, o, { spacers: false, extras: false, todoCap: s.todos.length > 5 ? 5 : undefined, agentCap: m > 3 ? 3 : undefined, header: true, close: true }).length; // critique 18: the column names are part of the floor, so the slot never drops them while the block shows (fitRows still drops them in a slot with no room)
};

/** Rows of the compact form WITH the blank between the blocks: what the register gives the HUD when the slot can hold it
 * and the band still keeps its title row (register.ts hudSlotCap). `now`: the draw's clock, so a lingering finished wave counts (hudCompactRows has none and leaves it out). */
export const hudFloorRows = (input: HudInput, cols = 120, now?: number): number => {
  const { s, o } = surfaces(input, { cols, maxRows: 0, merge: false, ...(now !== undefined ? { now } : {}), ui: { theme: 'mocha', ascii: false, color: 'truecolor' } });
  const m = s.agents.length;
  return stack({ todos: s.todos, agents: m > 0 ? s.agents : [] }, o, { spacers: true, extras: false, todoCap: s.todos.length > 5 ? 5 : undefined, agentCap: m > 3 ? 3 : undefined, header: true, close: true }).length;
};

/** Rows of the roomy form: every plan row and every agent row, the blank between the blocks, the column names and both closing rules (no rail). What the HUD asks of the slot: the register gives it
 * this many whenever the band can keep its title row, so a slot that fits the plan never prints `N more todos not shown` (critique 23: `live-150-1/f0060:24`). `now`: the draw's clock. */
export const hudWantRows = (input: HudInput, cols = 120, now?: number): number => {
  const { s, o } = surfaces(input, { cols, maxRows: 0, merge: false, ...(now !== undefined ? { now } : {}), ui: { theme: 'mocha', ascii: false, color: 'truecolor' } });
  return stack({ todos: s.todos, agents: s.agents }, o, { spacers: true, extras: false, header: true, close: true }).length;
};

/** Rows the HUD asks for over a whole run (register.ts slotHold): `hudWantRows` of the plan with the SUBAGENTS block it will gain. A plan of two rows or more is assumed to dispatch, so the block is counted
 * with up to three agents before the first one is listed, and the slot (and so the band above it) is the height it keeps to the run's end instead of growing when the agents arrive. */
export const hudRunRows = (input: HudInput, cols = 120, now?: number): number => {
  const expected = input.todos.length >= 2 ? Math.min(3, input.todos.length) : 0;
  const pad = Math.max(0, expected - input.agents.length);
  const agents = pad > 0 ? [...input.agents, ...Array.from({ length: pad }, (_, i): HudAgent => ({ name: `agent-${i + 1}`, role: 'agent', state: 'working', model: '', ui: 'running' }))] : input.agents;
  return hudWantRows({ ...input, agents }, cols, now);
};

/** The plan an orchestrated run is expected to write: five rows and three agents (the contract's own example). */
const TYPICAL_PLAN = 5;
/** Rows the HUD holds from the first frame of a run (register.ts slotHold). `orchestrated`: the lead has declared a phase, or a plan or an agent exists, so a plan is coming. Such a run reserves the
 * typical plan's height before the plan is written, because the slot grows by it at the first frame that has rows and the band, the top of a bottom-anchored slot, jumped from row 38 to row 25
 * (critique 27, live-150-46d4825c-1 f0051 to f0052). A run with no phase and no plan holds only what it draws. A plan longer than the typical one still grows the hold, once. */
export const hudHoldRows = (input: HudInput, cols = 120, now?: number, orchestrated = false): number => {
  const own = hudRunRows(input, cols, now);
  if (!orchestrated) return own;
  const plan: TodoItem[] = Array.from({ length: TYPICAL_PLAN }, (_, i) => ({ id: `typical-${i + 1}`, content: `T${i + 1} step`, status: 'pending' }));
  return Math.max(own, hudRunRows({ ...input, todos: plan }, cols, now));
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
  // wave 31: while agents run the SUBAGENTS title rides the merged block's lower rule; the agents are on the TODO rows above it
  if (at >= 0 && rows[at]!.some((x) => x.t.includes('╰'))) return at >= 2;
  return at >= 0 && at < rows.length - 1;
};
