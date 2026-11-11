// The TODO and SUBAGENTS surfaces of the rev 4 ATLAS design (round2/design/atlas-design-system-rev4.md, sections 3f/3g).
// Pure and host free: design rows in, tone-tagged Runs out. mod/hud.ts adapts board and squad data to these rows and
// paints Runs for Claude Code; omp/hud-paint.ts paints the same Runs as ANSI, so the two hosts draw identical rows.
// Layout grid (cell columns): focus 0, glyph 2, label 4; state and meta columns follow the tier below.
import { clip, gauge, percent, ribbon, runsCells, stateChip, stateGlyph, stateRun, type Run, type Ui, type UiState } from './atlas-ui';

export type TodoRow = { label: string; state: UiState; detail: string; focus: boolean };
/** `tasks`: the 1-based plan positions of every item the agent owns (`T1`, `T2`); none for an agent that owns no row. */
export type AgentRow = { name: string; state: UiState; model: string; tasks: readonly number[]; tool: string; ctx: number | null; focus: boolean };
export type SurfaceOpts = {
  cols: number;
  ui: Ui;
  /** Spinner frame for running glyphs. */
  tick?: number;
  /** Rich form: state chips, the phase rail, a ctx gauge per agent (120 columns and up). */
  rich?: boolean;
  /** Phase ids and the 0-based lit phase for the rich rail. */
  phases?: { ids: readonly string[]; active: number };
};
/** `spacers`: the blank rows of the mocks. `extras`: the rail and the progress gauge. `cap`: row slots for the rows (the overflow row takes one); undefined shows all, 0 only the ribbon. */
export type BlockOpts = { spacers: boolean; extras: boolean; cap?: number };

const t = (text: string, tone: Run['tone'] = 'text', extra: Partial<Run> = {}): Run => ({ t: text, tone, ...extra });
const BLANK: Run[] = [];

export type Tier = 'full' | 'mid' | 'min';
/** 120 form from 100 columns, the 80 form from 80, the 40 form below (60 uses the 40 form). */
export const tierOf = (cols: number): Tier => (cols >= 100 ? 'full' : cols >= 80 ? 'mid' : 'min');
export const isRich = (o: SurfaceOpts): boolean => !!o.rich && o.cols >= 120;

const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
const toCol = (runs: Run[], col: number): Run[] => (runsCells(runs) >= col ? runs : [...runs, t(' '.repeat(col - runsCells(runs)))]);
const maxLen = (xs: readonly string[]): number => xs.reduce((n, x) => Math.max(n, [...x].length), 0);
const focusMark = (focus: boolean, ui: Ui): Run => (focus ? t(ui.ascii ? '>' : '▸', 'accent', { bold: true }) : t(' '));

const COUNT_ORDER: readonly UiState[] = ['queued', 'running', 'done', 'failed', 'blocked', 'waiting'];
/** `1 queued · 1 running · 2 done · 1 failed`: only states that occur, so the header always equals the row sums. */
export function stateCounts(states: readonly UiState[]): string {
  return COUNT_ORDER.map((s) => [s, states.filter((x) => x === s).length] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(' · ');
}

/** Row slots by priority when the rows do not all fit: open work first (running, blocked, failed, waiting), then queued, then the newest done. */
const PRIORITY: Record<UiState, number> = { running: 0, blocked: 1, failed: 2, waiting: 3, queued: 4, done: 5 };

/** The `slots` rows to draw, in their own order, and how many were left out. `slots` includes the overflow row when something is hidden. */
export function windowRows<T extends { state: UiState }>(rows: readonly T[], slots: number | undefined): { shown: T[]; hidden: number } {
  if (slots === undefined || slots >= rows.length) return { shown: [...rows], hidden: 0 };
  const keep = Math.max(0, slots - 1);
  const ranked = rows.map((row, i) => ({ row, i })).sort((a, b) => PRIORITY[a.row.state] - PRIORITY[b.row.state] || (a.row.state === 'done' ? b.i - a.i : a.i - b.i));
  const picked = new Set(ranked.slice(0, keep).map((x) => x.i));
  return { shown: rows.filter((_, i) => picked.has(i)), hidden: rows.length - picked.size };
}

const more = (n: number, what: string): Run[] => [t(`  ... ${n} more ${what}`, 'sub')];

// ---- TODO ------------------------------------------------------------------------------------------------

export function todoRows(rows: readonly TodoRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0) return [];
  const { ui, cols } = o;
  const tier = tierOf(cols);
  const rich = isRich(o);
  const done = rows.filter((r) => r.state === 'done').length;
  const out: Run[][] = [ribbon(cols, 'TODO', tier === 'full' ? `${done} of ${rows.length} done` : `${done}/${rows.length}`, ui)];
  if (b.cap === 0) return out;
  const frac = done / rows.length;
  if (b.spacers) out.push(BLANK);
  if (tier === 'full' && b.extras) {
    if (rich && o.phases && o.phases.ids.length > 0) {
      out.push(railRow(o.phases.ids, o.phases.active, ui));
      if (b.spacers) out.push(BLANK);
    }
    out.push([t('progress ', 'muted'), ...gauge(16, frac, ui), t(` ${done} of ${rows.length} · ${percent(frac)}`, 'sub')]);
    if (b.spacers) out.push(BLANK);
  }
  const stateAt = tier === 'full' ? Math.max(26, Math.min(maxLen(rows.map((r) => r.label)) + 1, 50)) + 4 : 26;
  const metaAt = stateAt + 14;
  const { shown, hidden } = windowRows(rows, b.cap);
  for (const r of shown) out.push(todoRow(r, o, tier, rich, stateAt, metaAt));
  if (hidden > 0) out.push(more(hidden, hidden === 1 ? 'todo' : 'todos'));
  return out;
}

function todoRow(r: TodoRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, metaAt: number): Run[] {
  const { ui } = o;
  const head: Run[] = [focusMark(r.focus, ui), t(' '), stateRun(r.state, ui, o.tick ?? 0), t(' ')];
  const labelW = tier === 'min' ? Math.max(1, o.cols - 4) : stateAt - 5;
  const text = clip(flat(r.label), labelW);
  const label = r.state === 'done' ? t(text, 'sub', { strike: true }) : t(text, 'text', { bold: r.focus });
  if (tier === 'min') return [...head, label];
  const row = [...toCol([...head, label], stateAt), rich ? stateChip(r.state, ui) : t(r.state)];
  if (tier === 'mid' || r.detail === '') return row;
  return [...toCol(row, metaAt), t(clip(flat(r.detail), Math.max(1, o.cols - metaAt)), 'sub')];
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

/** Agents in the order the mocks show them: running first, then blocked, failed, waiting, queued and done; stable inside a state. */
export const sortAgents = <T extends { state: UiState }>(rows: readonly T[]): T[] =>
  rows.map((row, i) => ({ row, i })).sort((a, b) => PRIORITY[a.row.state] - PRIORITY[b.row.state] || a.i - b.i).map((x) => x.row);

/** Nothing below 80 columns: the band's counts carry the running agents there (design 3g). */
export function agentRows(rows: readonly AgentRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0 || tierOf(o.cols) === 'min') return [];
  const { ui, cols } = o;
  const tier = tierOf(cols);
  const rich = isRich(o);
  const out: Run[][] = [ribbon(cols, 'SUBAGENTS', rich ? '' : stateCounts(rows.map((r) => r.state)), ui)];
  if (b.cap === 0) return out;
  const stateAt = Math.max(20, Math.min(maxLen(rows.map((r) => r.name)) + 1, 29)) + 4;
  const taskW = taskWidth(rows);
  if (b.spacers) out.push(tier === 'full' ? agentHeader(o, rich, stateAt, taskW) : BLANK); // the spacer row names the columns at 100 columns and up
  const { shown, hidden } = windowRows(rows, b.cap);
  for (const r of shown) out.push(agentRow(r, o, tier, rich, stateAt, taskW));
  if (hidden > 0) out.push(more(hidden, hidden === 1 ? 'agent' : 'agents'));
  return out;
}

const TASK_W = 5; // `T1,T2`: the task column's width when every agent's ids fit
/** Every owned id (`T1,T2`) when they fit `width`, else the count (`3 tasks`); an agent that owns none shows nothing. */
export const taskCell = (tasks: readonly number[], width: number = TASK_W): string => {
  const ids = tasks.map((n) => `T${n}`).join(',');
  return tasks.length === 0 ? '' : ids.length <= width ? ids : `${tasks.length} tasks`;
};
/** The task column's width: wide enough for the longest cell (a count when an agent's ids do not fit). */
const taskWidth = (rows: readonly AgentRow[]): number => rows.reduce((n, r) => Math.max(n, taskCell(r.tasks).length), TASK_W);

/** `AGENT  STATE  MODEL  TASK  LAST`: the column words of the full form, in the spacer row under the ribbon. */
function agentHeader(o: SurfaceOpts, rich: boolean, stateAt: number, taskW: number): Run[] {
  const h = (text: string, at: number): void => { if (at < o.cols) row = [...toCol(row, at), t(text, 'muted')]; };
  let row: Run[] = [t(' ', 'muted')];
  h('AGENT', 4);
  h('STATE', stateAt);
  if (rich) { h('CTX', stateAt + 14); h('MODEL', stateAt + 34); h('LAST', stateAt + 42); } else { h('MODEL', stateAt + 12); h('TASK', stateAt + 22); h('LAST', stateAt + 23 + taskW); }
  return row;
}

function agentRow(r: AgentRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, taskW: number): Run[] {
  const { ui, cols } = o;
  const head: Run[] = [focusMark(r.focus, ui), t(' '), stateRun(r.state, ui, o.tick ?? 0), t(' '), t(clip(flat(r.name), stateAt - 5), 'text', { bold: true })];
  let row = [...toCol(head, stateAt), rich ? stateChip(r.state, ui) : t(r.state)];
  if (tier === 'mid') return row;
  const cell = (text: string, at: number, width: number): void => {
    if (text !== '' && at < cols) row = [...toCol(row, at), t(clip(flat(text), Math.max(1, Math.min(width, cols - at))), 'sub')];
  };
  if (rich) {
    if (r.ctx !== null) row = [...toCol(row, stateAt + 14), t('ctx ', 'muted'), ...gauge(8, r.ctx, ui), t(` ${percent(r.ctx)}`, 'sub')];
    cell(r.model, stateAt + 34, 8);
    cell(r.tool, stateAt + 42, cols);
  } else {
    cell(r.model, stateAt + 12, 9);
    cell(taskCell(r.tasks, TASK_W), stateAt + 22, taskW);
    cell(r.tool, stateAt + 23 + taskW, cols);
  }
  return row;
}

// ---- assembly --------------------------------------------------------------------------------------------

export type Surfaces = { todos: readonly TodoRow[]; agents: readonly AgentRow[] };

/** Both blocks stacked (a blank between them when `spacers`). */
export function stack(s: Surfaces, o: SurfaceOpts, b: { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number }): Run[][] {
  const todo = todoRows(s.todos, o, { spacers: b.spacers, extras: b.extras, cap: b.todoCap });
  const agents = agentRows(s.agents, o, { spacers: b.spacers, extras: b.extras, cap: b.agentCap });
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
  if (maxRows <= 0) return [];
  const n = s.todos.length;
  const m = tierOf(o.cols) === 'min' ? 0 : s.agents.length;
  type Try = { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; hideTodo?: boolean };
  const tries: Try[] = [{ spacers: true, extras: true }, { spacers: false, extras: true }, { spacers: false, extras: false }];
  for (let cap = n - 1; cap >= 0; cap--) if (cap !== 1) tries.push({ spacers: false, extras: false, todoCap: cap });
  // The plan gives way before the last running agent does: its ribbon goes, then agents are windowed (two slots at least show one agent and the count of the rest).
  tries.push({ spacers: false, extras: false, hideTodo: true });
  for (let cap = m - 1; cap >= 2; cap--) tries.push({ spacers: false, extras: false, hideTodo: true, agentCap: cap });
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
