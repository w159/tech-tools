// The TODO and SUBAGENTS surfaces of the rev 4 ATLAS design (round2/design/atlas-design-system-rev4.md, sections 3f/3g).
// Pure and host free: design rows in, tone-tagged Runs out. mod/hud.ts adapts board and squad data to these rows and
// paints Runs for Claude Code; omp/hud-paint.ts paints the same Runs as ANSI, so the two hosts draw identical rows.
// Layout grid (cell columns): focus 0, glyph 2, label 4; state and meta columns follow the tier below.
import { animateRow, type MotionCtx } from './motion';
import { clipWords, lastText } from './data/lasttext';
import { cells, CHIP_W, COUNT_ORDER, LINGER_MS, clip, gauge, markOf, markToken, percent, ribbon, rowWordTone, runsCells, spinClock, spinFrameOf, chip, stateChip, stateGlyph, stateRun, type Run, type Ui, type UiState } from './atlas-ui';

export type TodoRow = { label: string; /** The plan item's id (T1): its spinner phase when no agent owns it, the same key the side panel turns. */ id?: string; /** The agent that owns the item: its spinner turns the owner's frame, as on the board. */ owner?: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`returned`: the owner agent ended, the store row is still open). */ word?: string; detail: string; focus: boolean; /** Motion key (hud.ts sets it); absent: the row never animates. */ key?: string; /** Epoch ms the item completed, when the board records it: a fresh one outranks the queue when rows fold. */ doneAt?: number };
/** `tasks`: the 1-based plan positions of every item the agent owns (`T1`, `T2`); none for an agent that owns no row. */
export type AgentRow = { name: string; state: UiState; model: string; tasks: readonly number[]; tool: string; ctx: number | null; focus: boolean; key?: string; /** The squad name (the side panel's row id): its spinner phase, which the display `name` would change. */ id?: string; /** The agent's own task text (its dispatch description): the TASK column shows it when the agent owns no plan row. */ task?: string };
/** The spinner frame of row `id` (the agent's squad name): the shared clock's frame (spinFrameOf of spinClock, as the side panel turns it)
 * when the snapshot's `now` is known, else the caller's tick. */
const spinOf = (o: Pick<SurfaceOpts, 'now' | 'tick'>, id: string): number => (o.now !== undefined ? spinFrameOf(spinClock(o.now, o.tick), id) : o.tick ?? 0);
export type SurfaceOpts = {
  cols: number;
  ui: Ui;
  /** Spinner frame for running glyphs. */
  tick?: number;
  /** Rich form: state chips, the phase rail, a ctx gauge per agent (120 columns and up). */
  rich?: boolean;
  /** Phase ids and the 0-based lit phase for the rich rail. */
  phases?: { ids: readonly string[]; active: number };
  /** Motion view (mod/motion.ts): a row with a key and an entry is drawn mid-transition. Absent: the resting render. */
  motion?: MotionCtx | undefined;
  /** The snapshot clock in epoch ms: a done row that completed within LINGER_MS of it ranks with running rows when the plan folds. */
  now?: number | undefined;
};
/** `spacers`: the blank rows of the mocks. `extras`: the rail and the progress gauge. `cap`: row slots for the rows (the overflow row takes one); undefined shows all, 0 only the ribbon. */
/** `header`: the SUBAGENTS column-name row (default: with `spacers`); `stack` always asks for it, so it outlives the blank rows. */
export type BlockOpts = { spacers: boolean; extras: boolean; cap?: number; header?: boolean };

const t = (text: string, tone: Run['tone'] = 'text', extra: Partial<Run> = {}): Run => ({ t: text, tone, ...extra });
const BLANK: Run[] = [];

export type Tier = 'full' | 'mid' | 'min';
/** 120 form from 100 columns, the 80 form from 80, the 40 form below (60 uses the 40 form). */
export const tierOf = (cols: number): Tier => (cols >= 100 ? 'full' : cols >= 80 ? 'mid' : 'min');
export const isRich = (o: SurfaceOpts): boolean => !!o.rich && o.cols >= 120;

/** The leftmost the TODO state column may start at (a title of one cell, its glyph and gaps). */
const MIN_STATE_AT = 6;
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
/** A row's detail column text: empty when the title already says it (`T1 read alpha.py (alpha-explorer)` with the owner `alpha-explorer` printed again beside it). */
const detailOf = (r: Pick<TodoRow, 'label' | 'detail'>): string => (r.detail !== '' && flat(r.label).toLowerCase().includes(flat(r.detail).toLowerCase()) ? '' : r.detail);
const toCol = (runs: Run[], col: number): Run[] => (runsCells(runs) >= col ? runs : [...runs, t(' '.repeat(col - runsCells(runs)))]);
const maxLen = (xs: readonly string[]): number => xs.reduce((n, x) => Math.max(n, cells(x)), 0);
const focusMark = (focus: boolean, ui: Ui): Run => (focus ? t(ui.ascii ? '>' : '▸', 'accent', { bold: true }) : t(' '));

/** `1 queued · 1 running · 2 done · 1 failed`: only states that occur, so the header always equals the row sums. */
export function stateCounts(states: readonly UiState[]): string {
  return COUNT_ORDER.map((s) => [s, states.filter((x) => x === s).length] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(' · ');
}

/** Row slots by priority when the rows do not all fit: open work first (running, blocked, failed, waiting), then queued, then the newest done.
 * A row that completed within LINGER_MS of `now` ranks with running rows, so a task that just finished is not hidden behind the queue. */
const PRIORITY = Object.fromEntries(COUNT_ORDER.map((s, i) => [s, i])) as Record<UiState, number>;

/** The `slots` rows to draw, in their own order, and how many were left out. `slots` includes the overflow row when something is hidden. */
export function windowRows<T extends { state: UiState; doneAt?: number }>(rows: readonly T[], slots: number | undefined, now?: number): { shown: T[]; hidden: number } {
  if (slots === undefined || slots >= rows.length) return { shown: [...rows], hidden: 0 };
  const keep = Math.max(0, slots - 1);
  const fresh = (r: T): boolean => r.state === 'done' && now !== undefined && r.doneAt !== undefined && now - r.doneAt <= LINGER_MS;
  const rank = (r: T): number => (fresh(r) ? PRIORITY.running : PRIORITY[r.state]);
  const ranked = rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || (a.row.state === 'done' ? (b.row.doneAt ?? 0) - (a.row.doneAt ?? 0) || b.i - a.i : a.i - b.i));
  const picked = new Set(ranked.slice(0, keep).map((x) => x.i));
  return { shown: rows.filter((_, i) => picked.has(i)), hidden: rows.length - picked.size };
}

/** The overflow row, in plain words: `  2 more todos not shown`. */
const more = (n: number, what: string): Run[] => [t(`  ${n} more ${what} not shown`, 'sub')];

// ---- TODO ------------------------------------------------------------------------------------------------

export function todoRows(rows: readonly TodoRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0) return [];
  const { ui, cols } = o;
  const tier = tierOf(cols);
  const rich = isRich(o);
  const done = rows.filter((r) => r.state === 'done').length;
  const out: Run[][] = [ribbon(cols, 'TODO', `${done} of ${rows.length} done`, ui)]; // one count format at every width (the band, board and panel say `N of M`)
  if (b.cap === 0) return out;
  // One layout at every width: ribbon (the one count), (rail), then a row per item with its state column. No blank rows, no second count.
  if (tier === 'full' && b.extras && rich && o.phases && o.phases.ids.length > 0) out.push(railRow(o.phases.ids, o.phases.active, ui));
  const stateAt = todoStateAt(rows, o, tier, rich);
  const metaAt = stateAt + 14;
  const { shown, hidden } = windowRows(rows, b.cap, o.now);
  for (const r of shown) out.push(todoRow(r, o, tier, rich, stateAt, metaAt));
  if (hidden > 0) out.push(more(hidden, hidden === 1 ? 'todo' : 'todos'));
  return out;
}

/** The state column: just past the longest title, so every title shows whole; never past the last cell a state word (or chip) still fits,
 * and, where a detail column follows (100 columns and up), never so far that the detail has under 16 cells. Every width has it; only a
 * pane under 13 cells (no room for a title and a word) drops it (0). */
/** The plain state column's width: 7 (`running`), 8 while a row reads `returned`. */
const todoWordW = (rows: readonly TodoRow[]): number => rows.reduce((n, r) => Math.max(n, cells(r.word ?? r.state)), 7);

function todoStateAt(rows: readonly TodoRow[], o: SurfaceOpts, tier: Tier, rich: boolean): number {
  const wordW = rich ? CHIP_W : todoWordW(rows); // `running` and `blocked` are the longest of the six words
  if (tier === 'min') return o.cols < MIN_STATE_AT + wordW ? 0 : Math.min(maxLen(rows.map((r) => flat(r.label))) + 2 + 4, o.cols - wordW);
  const detail = tier === 'full' && rows.some((r) => detailOf(r) !== '');
  const last = o.cols - wordW - (detail ? 14 + 16 : 0); // the leftmost the column may start at
  return Math.min(Math.max(tier === 'full' ? 30 : 26, maxLen(rows.map((r) => flat(r.label))) + 1 + 4), Math.max(last, 12));
}

function todoRow(r: TodoRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, metaAt: number): Run[] {
  const runs = todoRowResting(r, o, tier, rich, stateAt, metaAt);
  return r.key === undefined ? runs : animateRow(runs, r.key, markOf(r.state, r.word), o.motion, o.ui);
}

function todoRowResting(r: TodoRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, metaAt: number): Run[] {
  const { ui } = o;
  const head: Run[] = [focusMark(r.focus && r.state !== 'queued', ui), t(' '), stateRun(markOf(r.state, r.word), ui, spinOf(o, r.owner || r.id || r.label)), t(' ')]; // the cursor marks work in hand, never a queued row; the spinner turns the owner's (else the item's id) phase, as the side panel does
  const labelW = stateAt === 0 ? Math.max(1, o.cols - 4) : stateAt - 5;
  const text = clip(flat(r.label), labelW);
  const label = r.state === 'done' ? t(text, 'sub', { strike: true }) : t(text, 'text', { bold: r.focus });
  if (stateAt === 0) return [...head, label];
  const row = [...toCol([...head, label], stateAt), rich ? (r.word ? chip(r.word, markToken(markOf(r.state, r.word)), ui) : stateChip(r.state, ui)) : t(r.word ?? r.state, rowWordTone(r.state, r.word))];
  const detail = detailOf(r);
  if (tier !== 'full' || detail === '') return row;
  return [...toCol(row, metaAt), t(clip(flat(detail), Math.max(1, o.cols - metaAt)), 'sub')];
}

/** The numbered phase rail as one row: `● 1 plan  ──  ▸ 2 research  ──  ◇ 3 build`. */
function railRow(ids: readonly string[], active: number, ui: Ui): Run[] {
  const sep: Run = ui.ascii ? t('  --  ', 'muted') : t('  ──  ', 'line');
  return ids.flatMap((id, i): Run[] => {
    const label = `${i + 1} ${id}`;
    const g: Run[] =
      i < active ? [{ ...stateRun('done', ui), t: `${stateGlyph('done', ui)} ` }, t(label, 'sub')]
      : i === active ? [t(ui.ascii ? '> ' : '▸ ', 'accent', { bold: true }), t(label, 'text', { bold: true })]
      : [{ ...stateRun('queued', ui), t: `${stateGlyph('queued', ui)} `, tone: 'muted' }, t(label, 'muted')];
    return i < ids.length - 1 ? [...g, sep] : g;
  });
}

// ---- SUBAGENTS -------------------------------------------------------------------------------------------

/** Agents in one stable order: by the first plan row (T row) each owns (T1 before T2), whatever its state, so a row never moves when a worker finishes; agents that own
 * none follow the tasked ones in the order given (start order). The state is the row's word, not its place. */
export const sortAgents = <T extends { tasks?: readonly number[] }>(rows: readonly T[]): T[] => {
  const first = (r: T): number => (r.tasks && r.tasks.length ? Math.min(...r.tasks) : Infinity);
  return rows.map((row, i) => ({ row, i })).sort((a, b) => (first(a.row) === first(b.row) ? 0 : first(a.row) < first(b.row) ? -1 : 1) || a.i - b.i).map((x) => x.row);
};

/** Nothing below 80 columns: the band's counts carry the running agents there (design 3g). */
export function agentRows(rows: readonly AgentRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0 || tierOf(o.cols) === 'min') return [];
  const { ui, cols } = o;
  const rich = isRich(o);
  const out: Run[][] = [ribbon(cols, 'SUBAGENTS', rich ? '' : stateCounts(rows.map((r) => r.state)), ui)];
  if (b.cap === 0) return out;
  const wordW = rich ? CHIP_W : 7;
  // The name column holds the longest name whole (19 cells at least, for alignment); only a name that alone overflows the row is end-clipped.
  const nameW = Math.max(1, Math.min(Math.max(19, maxLen(rows.map((r) => flat(r.name)))), cols - 5 - wordW));
  const stateAt = nameW + 5;
  const plan = agentCols(rows, o, rich, stateAt);
  if (b.header ?? b.spacers) out.push(agentHeader(o, rich, stateAt, plan)); // the spacer row names the columns (80 columns and up: a wide terminal with the pane docked gets fewer columns, never fewer cells)
  const { shown, hidden } = windowRows(rows, b.cap);
  for (const r of shown) out.push(agentRow(r, o, rich, stateAt, nameW, plan));
  if (hidden > 0) out.push(more(hidden, hidden === 1 ? 'agent' : 'agents'));
  return out;
}

const TASK_W = 5; // `T1,T2`: the task column's width when every agent's ids fit
/** Every owned id (`T1,T2`) when they fit `width`, else the count (`3 tasks`); an agent that owns none shows nothing. */
export const taskCell = (tasks: readonly number[], width: number = TASK_W): string => {
  const ids = tasks.map((n) => `T${n}`).join(',');
  return tasks.length === 0 ? '' : ids.length <= width ? ids : `${tasks.length} tasks`;
};
/** The TASK cell of a row: its plan ids, else the agent's own task text (the dispatch description). */
const taskText = (r: AgentRow): string => (r.tasks.length > 0 ? taskCell(r.tasks) : flat(r.task ?? ''));
/** The task column's width: wide enough for the longest cell (a dispatch description is shown whole while any room is left, see agentCols). */
const taskWidth = (rows: readonly AgentRow[]): number => rows.reduce((n, r) => Math.max(n, cells(taskText(r))), TASK_W);

/** Which optional columns fit, and where they start. A narrow row drops LAST first, then MODEL, before a TASK is cut (the model gives its cells to the task);
 * only when the task alone still does not fit is it ended on a whole word. A name is never cut here. The last text ends on a whole word from LAST_MIN cells. */
type AgentCols = { model?: number; modelW: number; task?: number; taskW: number; last?: number; ctx?: number };
const LAST_MIN = 8;
function agentCols(rows: readonly AgentRow[], o: SurfaceOpts, rich: boolean, stateAt: number): AgentCols {
  const loose = agentColsAt(rows, o, rich, stateAt, rich ? 8 : 9);
  // Spare columns first: a LAST text that does not fit takes the model column's slack (down to the header word) before it is cut.
  const clipped = rows.some((r) => { const w = cells(lastText(r.tool)); return w > 0 && (loose.last === undefined || w > o.cols - loose.last); });
  return clipped ? agentColsAt(rows, o, rich, stateAt, rich ? 6 : 5) : loose;
}
function agentColsAt(rows: readonly AgentRow[], o: SurfaceOpts, rich: boolean, stateAt: number, modelMin: number): AgentCols {
  const { cols } = o;
  const modelW = Math.max(modelMin, ...rows.map((r) => cells(r.model) + (rich ? 1 : 0))); // rich: the cell includes its gap
  const plan: AgentCols = { modelW, taskW: taskWidth(rows) };
  if (rich) {
    if (stateAt + 14 + 4 + 8 + 5 <= cols) plan.ctx = stateAt + 14;
    const modelAt = stateAt + 34;
    if (modelAt + modelW - 1 <= cols) {
      plan.model = modelAt;
      if (modelAt + modelW + LAST_MIN <= cols) plan.last = modelAt + modelW;
    }
    return plan;
  }
  const modelAt = stateAt + 12;
  const taskAt = modelAt + modelW + 1;
  const fullTask = taskAt + plan.taskW <= cols;
  if (fullTask) { // model, whole task, and the last text when it has LAST_MIN cells left
    plan.model = modelAt;
    plan.task = taskAt;
    const lastAt = taskAt + plan.taskW + 1;
    if (lastAt + LAST_MIN <= cols) plan.last = lastAt;
    return plan;
  }
  // The task does not fit beside the model: the model goes (LAST went already), the task takes its place, whole when it fits there.
  if (modelAt + TASK_W <= cols) { plan.task = modelAt; plan.taskW = Math.min(plan.taskW, cols - modelAt); }
  return plan;
}

/** `AGENT  STATE  MODEL  TASK  LAST`: the column words of the full form, in the spacer row under the ribbon; only the columns the rows show. */
function agentHeader(o: SurfaceOpts, rich: boolean, stateAt: number, plan: AgentCols): Run[] {
  const h = (text: string, at: number | undefined): void => { if (at !== undefined && at < o.cols) row = [...toCol(row, at), t(text, 'muted')]; };
  let row: Run[] = [t(' ', 'muted')];
  h('AGENT', 4);
  h('STATE', stateAt);
  if (rich) { h('CTX', plan.ctx); h('MODEL', plan.model); h('LAST', plan.last); } else { h('MODEL', plan.model); h('TASK', plan.task); h('LAST', plan.last); }
  return row;
}

function agentRow(r: AgentRow, o: SurfaceOpts, rich: boolean, stateAt: number, nameW: number, plan: AgentCols): Run[] {
  const runs = agentRowResting(r, o, rich, stateAt, nameW, plan);
  return r.key === undefined ? runs : animateRow(runs, r.key, r.state, o.motion, o.ui);
}

function agentRowResting(r: AgentRow, o: SurfaceOpts, rich: boolean, stateAt: number, nameW: number, plan: AgentCols): Run[] {
  const { ui, cols } = o;
  const head: Run[] = [focusMark(r.focus, ui), t(' '), stateRun(r.state, ui, spinOf(o, r.id ?? r.name)), t(' '), t(clip(flat(r.name), nameW), 'text', { bold: true })];
  let row = [...toCol(head, stateAt), rich ? stateChip(r.state, ui) : t(r.state, rowWordTone(r.state))];
  /** `words`: the text is ended on a whole word when it does not fit (task and last text); a model is a token and is only clipped. */
  const cell = (text: string, at: number | undefined, width: number, words = false): void => {
    if (text === '' || at === undefined) return;
    const room = Math.max(1, Math.min(width, cols - at));
    const shown = words ? clipWords(flat(text), room) : clip(flat(text), room);
    if (shown !== '') row = [...toCol(row, at), t(shown, 'sub')];
  };
  if (rich && plan.ctx !== undefined && r.ctx !== null) row = [...toCol(row, plan.ctx), t('ctx ', 'muted'), ...gauge(8, r.ctx, ui), t(` ${percent(r.ctx)}`, 'sub')];
  cell(r.model, plan.model, plan.modelW);
  if (!rich) cell(taskText(r), plan.task, plan.taskW, true);
  cell(lastText(r.tool), plan.last, cols, true);
  return row;
}

// ---- assembly --------------------------------------------------------------------------------------------

export type Surfaces = { todos: readonly TodoRow[]; agents: readonly AgentRow[] };

/** Both blocks stacked (a blank between them when `spacers`). */
export function stack(s: Surfaces, o: SurfaceOpts, b: { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; header?: boolean }): Run[][] {
  const todo = todoRows(s.todos, o, { spacers: b.spacers, extras: b.extras, cap: b.todoCap });
  const agents = agentRows(s.agents, o, { spacers: b.spacers, extras: b.extras, cap: b.agentCap, header: b.header ?? true }); // the column names stay while the agents do: columns drop (LAST, then MODEL) before the header does
  return [...todo, ...(b.spacers && todo.length > 0 && agents.length > 0 ? [BLANK] : []), ...agents];
}

/** Every row padded to `cols` cells so a painter can fill the panel. */
export const padRows = (rows: readonly Run[][], cols: number): Run[][] =>
  rows.map((r) => {
    const w = runsCells(r);
    return w >= cols ? r : [...r, t(' '.repeat(cols - w))];
  });

/** The design rows for `maxRows`: the full form, then no spacers, no rail or progress, then the tree windowed down to its ribbon, then the agents. A running agent keeps its row before the plan keeps its last. */
export function fitStack(s: Surfaces, o: SurfaceOpts, maxRows: number): Run[][] {
  const rows = fitRows(s, o, maxRows);
  return rows.length > 0 ? [ruleToEdge(rows[0]!, o.ui), ...rows.slice(1)] : rows;
}

/** The first row is a ribbon whose right end the host draws its `[-]` fold marker beside (outside the cells the mod owns). The rule runs on
 * to the last cell, 3 cells past the count, so the marker reads as the end of the rule, not a stray token after a gap (critique 11). Width kept. */
function ruleToEdge(row: Run[], ui: Ui): Run[] {
  const ch = ui.ascii ? '-' : '━';
  const last = row.at(-1);
  const at = row.findIndex((x) => x.t.length >= 6 && [...x.t].every((c) => c === ch));
  if (at < 0 || !last || last.t !== ' ') return row;
  const fill = row[at]!;
  return row.map((x, i) => (i === at ? { ...fill, t: ch.repeat(fill.t.length - 2) } : i === row.length - 1 ? { ...fill, t: ch.repeat(3) } : x));
}

function fitRows(s: Surfaces, o: SurfaceOpts, maxRows: number): Run[][] {
  if (maxRows <= 0) return [];
  const n = s.todos.length;
  const m = tierOf(o.cols) === 'min' ? 0 : s.agents.length;
  type Try = { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; hideTodo?: boolean; header?: boolean };
  // The blank between TODO and SUBAGENTS outlives the rail and the column names (critique 11: at 110 columns the blocks butted together).
  const tries: Try[] = [{ spacers: true, extras: true }, { spacers: true, extras: false }, { spacers: true, extras: false, header: false }, { spacers: false, extras: true }, { spacers: false, extras: false }];
  tries.push({ spacers: false, extras: false, header: false }); // the column-name row is the first row dropped: it never costs the plan a row or the band its summary row
  for (let cap = n - 1; cap >= 0; cap--) if (cap !== 1) tries.push({ spacers: false, extras: false, todoCap: cap, header: false });
  // The plan gives way before the last running agent does: its ribbon goes, then agents are windowed (two slots at least show one agent and the count of the rest).
  tries.push({ spacers: false, extras: false, hideTodo: true });
  for (let cap = m - 1; cap >= 2; cap--) tries.push({ spacers: false, extras: false, hideTodo: true, agentCap: cap });
  // Only a budget too small for the column names and a running agent's row drops the names: the agent keeps its row.
  tries.push({ spacers: false, extras: false, hideTodo: true, header: false });
  for (let cap = m - 1; cap >= 2; cap--) tries.push({ spacers: false, extras: false, hideTodo: true, header: false, agentCap: cap });
  tries.push({ spacers: false, extras: false, todoCap: 0, agentCap: 0 });
  const ss = { todos: s.todos, agents: m > 0 ? s.agents : [] };
  for (const tr of tries) {
    const rows = stack(tr.hideTodo ? { ...ss, todos: [] } : ss, o, tr);
    if (rows.length <= maxRows) return rows;
  }
  // One row: the agents' ribbon when any run, else the plan's.
  const agents = agentRows(ss.agents, o, { spacers: false, extras: false, cap: 0 });
  return agents.length > 0 ? agents.slice(0, 1) : todoRows(ss.todos, o, { spacers: false, extras: false, cap: 0 }).slice(0, 1);
}
