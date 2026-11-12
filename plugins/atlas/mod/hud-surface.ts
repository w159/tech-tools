// The TODO and SUBAGENTS surfaces of the rev 4 ATLAS design (round2/design/atlas-design-system-rev4.md, sections 3f/3g).
// Pure and host free: design rows in, tone-tagged Runs out. mod/hud.ts adapts board and squad data to these rows and
// paints Runs for Claude Code; omp/hud-paint.ts paints the same Runs as ANSI, so the two hosts draw identical rows.
// Layout grid (cell columns): focus 0, glyph 2, label 4; state and meta columns follow the tier below.
import { animateRow, calmRun, revealProgress, revealRuns, type MotionCtx } from './motion';
import { clipWords, lastText } from './data/lasttext';
import { planFigure } from './board-model';
import { cells, CHIP_W, COUNT_ORDER, DONE_KILLED, LINGER_MS, clip, gauge, markOf, markToken, percent, RETURNED, ribbon, rowWordTone, runsCells, spinClock, spinFrameOf, chip, stateChip, stateGlyph, stateRun, type Run, type Ui, type UiState } from './atlas-ui';

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
export type BlockOpts = { spacers: boolean; extras: boolean; cap?: number; header?: boolean; /** Fold the finished rows into a `3 done` count on the ribbon and draw every open row (never folds an open one). */ foldDone?: boolean };

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
const detailOf = (r: Pick<TodoRow, 'label' | 'detail' | 'state' | 'word'>, rich = false): string => (r.detail !== '' && (flat(r.label).toLowerCase().includes(flat(r.detail).toLowerCase()) || (!rich && isDoubt(r))) ? '' : r.detail); // a doubted done says `worker killed` in its state cell (non-rich), so the detail column does not say it again
/** A completed row whose worker failed or was killed (critique 17 A1). */
const isDoubt = (r: Pick<TodoRow, 'state' | 'word'>): boolean => markOf(r.state, r.word) === 'doubt';
/** The state cell's text: the row's word, and for a doubted done in the plain form `done · worker killed` (critique 18 B2: the amber tone alone certified a killed worker; the chip form keeps its 11-cell chip and the detail column). */
const wordOf = (r: Pick<TodoRow, 'state' | 'word'>, rich: boolean): string => (!rich && isDoubt(r) ? DONE_KILLED : r.word ?? r.state);
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

/** A done row that completed within LINGER_MS of `now`. */
const isFresh = (r: { state: UiState; doneAt?: number }, now?: number): boolean => r.state === 'done' && now !== undefined && r.doneAt !== undefined && now - r.doneAt <= LINGER_MS;

/** The `slots` rows to draw, in their own order, and how many were left out. `slots` includes the overflow row when something is hidden. */
export function windowRows<T extends { state: UiState; doneAt?: number }>(rows: readonly T[], slots: number | undefined, now?: number, overflowRow = true): { shown: T[]; hidden: number } {
  if (slots === undefined || slots >= rows.length) return { shown: [...rows], hidden: 0 };
  const keep = overflowRow ? Math.max(0, slots - 1) : slots; // `overflowRow` false: the count of the rest rides the ribbon, so every slot holds a row
  const rank = (r: T): number => (isFresh(r, now) ? PRIORITY.running : PRIORITY[r.state]);
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
  const figure = planFigure(done, rows.length, rows.filter((r) => r.word === RETURNED).length); // one count format at every width: `n/m`, like the band, the board and the panel (critique 14: `5 of 5 done`)
  if (b.cap === 0) return [ribbon(cols, 'TODO', figure, ui)];
  // Every slot holds a row: what does not fit is counted on the ribbon, not on a row of its own (critique 16: `3 more todos not shown` under 2 drawn rows, with room for a third).
  // A short budget folds the finished rows first: the ribbon counts them (`3/5 · 3 done`) and every open row keeps its place (critique 17: the 110 slot lost its band row and its blank to rows already done).
  const stays = (r: TodoRow): boolean => r.state !== 'done' || isFresh(r, o.now); // a row that completed within LINGER_MS keeps its place, as when the plan windows
  const foldable = rows.filter((r) => !stays(r)).length;
  const fold = b.foldDone === true && foldable > 0 && foldable < rows.length; // a plan that is all done keeps its rows
  const { shown, hidden } = fold ? { shown: rows.filter(stays), hidden: foldable } : windowRows(rows, b.cap, o.now, false);
  const forms = hidden > 0 ? [fold ? `${figure} · ${hidden} done` : `${figure} · ${hidden} more ${hidden === 1 ? 'todo' : 'todos'} not shown`, ...(fold ? [] : [`${figure} · +${hidden} more`]), figure] : [figure];
  const out: Run[][] = [forms.map((f) => ribbon(cols, 'TODO', f, ui)).find((r) => runsCells(r) <= cols) ?? ribbon(cols, 'TODO', '', ui)];
  // One layout at every width: ribbon (the one count), (rail), then a row per item with its state column. No blank rows, no second count.
  if (tier === 'full' && b.extras && rich && o.phases && o.phases.ids.length > 0) out.push(railRow(o.phases.ids, o.phases.active, ui));
  const stateAt = todoStateAt(rows, o, tier, rich);
  const metaAt = stateAt + Math.max(14, todoWordW(rows, rich) + 2);
  for (const r of shown) out.push(todoRow(r, o, tier, rich, stateAt, metaAt));
  return out;
}

/** The state column: just past the longest title, so every title shows whole; never past the last cell a state word (or chip) still fits,
 * and, where a detail column follows (100 columns and up), never so far that the detail has under 16 cells. Every width has it; only a
 * pane under 13 cells (no room for a title and a word) drops it (0). */
/** The plain state column's width: 7 (`running`), 8 while a row reads `returned`. */
const todoWordW = (rows: readonly TodoRow[], rich = false): number => rows.reduce((n, r) => Math.max(n, cells(wordOf(r, rich))), 7);

function todoStateAt(rows: readonly TodoRow[], o: SurfaceOpts, tier: Tier, rich: boolean): number {
  const wordW = rich ? CHIP_W : todoWordW(rows, rich); // `running` and `blocked` are the longest of the six words
  if (tier === 'min') return o.cols < MIN_STATE_AT + wordW ? 0 : Math.min(maxLen(rows.map((r) => flat(r.label))) + 2 + 4, o.cols - wordW);
  const detail = tier === 'full' && rows.some((r) => detailOf(r, rich) !== '');
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
  const label = r.state === 'done' && markOf(r.state, r.word) !== 'doubt' ? t(text, 'sub', { strike: true }) : t(text, 'text', { bold: r.focus });
  if (stateAt === 0) return [...head, label];
  const row = [...toCol([...head, label], stateAt), rich ? (r.word ? chip(r.word, markToken(markOf(r.state, r.word)), ui) : stateChip(r.state, ui)) : t(wordOf(r, rich), rowWordTone(r.state, r.word))];
  const detail = detailOf(r, rich);
  if (tier !== 'full' || detail === '') return row;
  const meta = t(clip(flat(detail), Math.max(1, o.cols - metaAt)), 'sub');
  return [...toCol(row, metaAt), flat(detail) === flat(r.owner ?? '') ? calmRun(meta) : meta]; // the owner never changes with the row's state: the motion leaves it be (critique 18: it flashed 231 at 0 ms)
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

/** The Subagents block at every width: a docked side pane leaves the transcript about 61 cells at 110 columns, and the block still shows there with its ribbon and a row per agent (the columns drop first). */
export function agentRows(rows: readonly AgentRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0) return [];
  const { ui, cols } = o;
  const rich = isRich(o);
  // The counts give way to the running count, then to nothing, where the full line would overflow the row (a narrow transcript beside the docked pane).
  const counts = rich ? [''] : [stateCounts(rows.map((r) => r.state)), stateCounts(rows.map((r) => r.state)).split(' · ')[0] ?? '', ''];
  const head = counts.map((c) => ribbon(cols, 'SUBAGENTS', c, ui)).find((r) => runsCells(r) <= cols) ?? ribbon(cols, 'SUBAGENTS', '', ui);
  const out: Run[][] = [head];
  if (b.cap === 0) return out;
  const wordW = rich ? CHIP_W : 7;
  // The name column holds the longest name whole (19 cells at least, for alignment); only a name that alone overflows the row is end-clipped.
  // Under 80 columns (the 110-column transcript is 61) the column is as wide as the longest name: 5 cells more for LAST (critique 17: LAST was dropped there).
  const nameW = Math.max(1, Math.min(Math.max(cols >= 80 ? 19 : 8, maxLen(rows.map((r) => flat(r.name)))), cols - 5 - wordW));
  const stateAt = nameW + 5;
  const plan = agentCols(rows, o, rich, stateAt);
  if (b.header ?? b.spacers) out.push(agentHeader(o, rich, stateAt, plan)); // the spacer row names the columns (80 columns and up: a wide terminal with the pane docked gets fewer columns, never fewer cells)
  const { shown, hidden } = windowRows(rows, b.cap);
  for (const r of shown) out.push(agentRow(r, o, rich, stateAt, nameW, plan));
  if (hidden > 0) out.push(more(hidden, hidden === 1 ? 'agent' : 'agents'));
  return out;
}

/** The LAST text as the column can hold it. One form at every width (critique 19 B1: `1 found` at 110, `1 function found` at 150): the outcome is already the short form (hud.ts outcomeOf),
 * and one that does not fit is ended on a whole word by the cell, never swapped for another wording (`returned` said nothing). */
const lastFor = (text: string): string => text;

const TASK_W = 7; // `T1,T2` or `3 tasks`: the TASK column is this wide in every frame (critique 19 B2: 5 cells in one frame, 12 in the next, as the agents' task texts came and went)
/** Every owned id (`T1,T2`) when they fit `width`, else the count (`3 tasks`); an agent that owns none shows nothing. */
export const taskCell = (tasks: readonly number[], width: number = TASK_W): string => {
  const ids = tasks.map((n) => `T${n}`).join(',');
  return tasks.length === 0 ? '' : ids.length <= width ? ids : `${tasks.length} tasks`;
};
/** The TASK cell of a row: its plan ids and nothing else. A dispatch description (`read beta.py`) is the item's title on the TODO row above, not a second TASK. */
const taskText = (r: AgentRow): string => taskCell(r.tasks);
/** The task column's width: constant. */
const taskWidth = (_rows: readonly AgentRow[]): number => TASK_W;

/** Which optional columns fit, and where they start. A narrow row drops LAST first, then MODEL, before a TASK is cut (the model gives its cells to the task);
 * only when the task alone still does not fit is it ended on a whole word. A name is never cut here. The last text ends on a whole word from LAST_MIN cells. */
type AgentCols = { model?: number; modelW: number; task?: number; taskW: number; last?: number; ctx?: number };
const LAST_MIN = 8;
function agentCols(rows: readonly AgentRow[], o: SurfaceOpts, rich: boolean, stateAt: number): AgentCols {
  // Critique 19 B2: one grid. The MODEL column was 10 cells wide in one frame and 7 in the next (a long LAST text took its slack); its width now depends on the models only.
  return agentColsAt(rows, o, rich, stateAt, rich ? 8 : 7);
}
function agentColsAt(rows: readonly AgentRow[], o: SurfaceOpts, rich: boolean, stateAt: number, modelMin: number): AgentCols {
  const { cols } = o;
  const modelW = Math.max(modelMin, ...rows.map((r) => cells(r.model) + 1)); // the cell includes one blank, and the column after it starts one more cell on: MODEL and TASK never run together (critique 18: `haiku T1`)
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

/** The name run of an agent row: after the focus mark, a blank, the state glyph and a blank. */
const NAME_AT = 4;
function agentRow(r: AgentRow, o: SurfaceOpts, rich: boolean, stateAt: number, nameW: number, plan: AgentCols): Run[] {
  const runs = agentRowResting(r, o, rich, stateAt, nameW, plan);
  if (r.key === undefined) return runs;
  // A new row reveals its NAME only: MODEL, TASK and LAST are whole on every frame (critique 17: `gamma-explor` with both columns blank).
  const moved = animateRow(runs, r.key, r.state, o.motion, o.ui, { reveal: false });
  const entry = o.motion?.entry(r.key);
  const pr = entry && o.motion ? revealProgress(entry, o.motion.now) : 1;
  const name = moved[NAME_AT];
  if (pr >= 1 || !name) return moved;
  return moved.map((x, i) => (i === NAME_AT ? revealRuns([x], Math.ceil(pr * cells(name.t)))[0]! : x));
}

function agentRowResting(r: AgentRow, o: SurfaceOpts, rich: boolean, stateAt: number, nameW: number, plan: AgentCols): Run[] {
  const { ui, cols } = o;
  const head: Run[] = [focusMark(r.focus, ui), t(' '), stateRun(r.state, ui, spinOf(o, r.id ?? r.name)), t(' '), t(clip(flat(r.name), nameW), 'text', { bold: true })];
  let row = [...toCol(head, stateAt), rich ? stateChip(r.state, ui) : t(r.state, rowWordTone(r.state))];
  /** `words`: the text is ended on a whole word when it does not fit (task and last text); a model is a token and is only clipped. */
  const cell = (text: string, at: number | undefined, width: number, words = false, still = false): void => {
    if (text === '' || at === undefined) return;
    const room = Math.max(1, Math.min(width, cols - at));
    const cut = words ? clipWords(flat(text), room) : clip(flat(text), room);
    const shown = words && /^\S{1,6}\.\.\.$/.test(cut) && /\s/.test(flat(text)) ? '' : cut; // a short bare verb and `...` of a longer text (`read...`, `report...`) is no information: draw nothing
    if (shown !== '') row = [...toCol(row, at), still ? calmRun(t(shown, 'sub')) : t(shown, 'sub')]; // MODEL and TASK never change with the state: the motion leaves them be
  };
  if (rich && plan.ctx !== undefined && r.ctx !== null) row = [...toCol(row, plan.ctx), t('ctx ', 'muted'), ...gauge(8, r.ctx, ui), t(` ${percent(r.ctx)}`, 'sub')];
  cell(r.model, plan.model, plan.modelW, false, true);
  if (!rich) cell(taskText(r), plan.task, plan.taskW, true, true);
  cell(lastFor(lastText(r.tool)), plan.last, cols, true);
  return row;
}

// ---- assembly --------------------------------------------------------------------------------------------

export type Surfaces = { todos: readonly TodoRow[]; agents: readonly AgentRow[] };

/** Both blocks stacked (a blank between them when `spacers`). */
export function stack(s: Surfaces, o: SurfaceOpts, b: { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; header?: boolean; foldDone?: boolean }): Run[][] {
  const todo = todoRows(s.todos, o, { spacers: b.spacers, extras: b.extras, cap: b.todoCap, ...(b.foldDone ? { foldDone: true } : {}) });
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
  const m = s.agents.length;
  type Try = { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; hideTodo?: boolean; header?: boolean; foldDone?: boolean };
  // The blank between TODO and SUBAGENTS outlives the rail and the column names (critique 11: at 110 columns the blocks butted together).
  // Every plan row is drawn while the rows fit at all: the blank and the column names go before a finished row does (critique 18 B1: T1 left the block under `1/5 · 1 done`
  // although ribbon, five rows and three agents fit in the same ten rows). Only when even that does not fit do the finished rows fold into a count (critique 17, B4).
  // While an agent runs the column names outlive both the blank and a finished row (critique 18 C1, stoprun-150-562576ed-1/f0080.ans lost them while beta ran): the header-keeping folds come before any try that drops the header.
  const running = s.agents.some((a) => a.state === 'running');
  const tries: Try[] = [{ spacers: true, extras: true }, { spacers: true, extras: false }, { spacers: false, extras: true }, { spacers: false, extras: false }];
  if (running) tries.push({ spacers: true, extras: false, foldDone: true }, { spacers: false, extras: false, foldDone: true });
  tries.push({ spacers: true, extras: false, header: false }, { spacers: false, extras: false, header: false });
  tries.push({ spacers: true, extras: false, foldDone: true }, { spacers: true, extras: false, header: false, foldDone: true });
  for (let cap = n - 1; cap >= 0; cap--) tries.push({ spacers: false, extras: false, todoCap: cap, header: false }); // a cap is a count of rows: the rest is counted on the ribbon
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
