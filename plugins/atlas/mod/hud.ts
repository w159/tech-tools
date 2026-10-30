// omp-format HUD for the Claude Code band: the TODO phase tree, the "Subagents · N running" block and the
// "Waiting on ..." line, drawn above Mission Control. Pure: todos and agents in, Segment rows out. The text
// layout follows omp's own widgets (modes/interactive-mode.ts: the TODO HUD and renderSubagentHudLines):
// spine glyphs, progress fill, active-phase rule, collapse caps and the subagent line format.
import type { SquadAgent, TodoItem } from './contract';
import type { LiveWorker } from './data/live';
import { isPlanItem } from './data/todos';
import type { Segment } from './runs';
import { fitText, MOCHA as M, textWidth } from './theme';

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
};

/** Band workers plus the squad's spawn model and task, in the HUD's shape. */
export function hudAgents(live: readonly LiveWorker[], squad: readonly SquadAgent[]): HudAgent[] {
  return live.map((w) => {
    const s = squad.find((a) => a.name === w.name);
    return { name: w.name, role: w.role, state: w.state, tool: w.tool, target: w.target, detail: w.detail, lastTool: w.lastTool, lastLine: w.lastLine, ...(s?.model ? { model: s.model } : {}), ...(s?.task ? { task: s.task } : {}) };
  });
}

/** `root` (the project root) makes paths in a tool preview project-relative. */
export type HudInput = { todos: TodoItem[]; agents: HudAgent[]; root?: string | null };
export type HudOpts = { cols: number; maxRows: number };

const C = { accent: M.violet, muted: M.muted, dim: M.grey, done: M.muted, ok: M.green, warn: M.yellow, bad: M.red } as const;

const TREE = { branch: '├─', last: '└─', vertical: '│', hook: '└', horizontal: '─' } as const;
const TAIL_LEN = 6;
const BOX = '☐';
const CHECKED = '☑';
const THINK = '◑';
const MODEL_BADGE_WIDTH = 30;
const AGENT_LIMIT = 3;

const seg = (t: string, color?: string, extra?: Partial<Segment>): Segment => ({ t, ...(color ? { color } : {}), ...extra });
const isClosed = (t: TodoItem): boolean => t.status === 'completed' || t.status === 'abandoned';
export const isRunning = (a: HudAgent): boolean => a.state === 'working' || a.state === 'blocked';

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
/** One-based roman numeral (I, II, III, IV ...). */
export function roman(n: number): string {
  let out = '';
  let rem = n;
  for (const [v, s] of ROMAN) while (rem >= v) { out += s; rem -= v; }
  return out;
}

const capitalize = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));

/** Keep both ends of a label (omp's truncateMiddleToWidth). */
export function truncateMiddle(text: string, width: number): string {
  if (textWidth(text) <= width) return text;
  if (width <= 1) return width === 1 ? '…' : '';
  const tail = Math.ceil((width - 1) / 2);
  const head = width - 1 - tail;
  const chars = [...text];
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

// ---- TODO tree --------------------------------------------------------------------------------------

type Group = { id: string; label: string; tasks: TodoItem[] };

const LABEL_PREFIX = /^\[([A-Za-z][\w-]*)\]\s+/;
/** The item's phase: its stamped contract phase, else a `[label] ` content prefix (a label that is not a contract phase, e.g. `[docs]`). */
const phaseOf = (t: TodoItem): string | undefined => t.phase ?? LABEL_PREFIX.exec(t.content)?.[1]?.toLowerCase();

/** Phases (contract or `[label]` ones) in order of first appearance in the plan; items with no label go under a final "Other". */
function groupsOf(todos: TodoItem[]): Group[] {
  const groups: Group[] = [];
  const other: TodoItem[] = [];
  for (const t of todos) {
    const phase = phaseOf(t);
    if (!phase) { other.push(t); continue; }
    let g = groups.find((x) => x.id === phase);
    if (!g) groups.push((g = { id: phase, label: capitalize(phase), tasks: [] }));
    g.tasks.push(t);
  }
  if (other.length > 0) groups.push({ id: 'other', label: 'Other', tasks: other });
  return groups;
}

/** The phase holding the in_progress item, else the first with an open item, else the last. */
function activeIndex(groups: Group[]): number {
  const working = groups.findIndex((g) => g.tasks.some((t) => t.status === 'in_progress'));
  if (working >= 0) return working;
  const open = groups.findIndex((g) => g.tasks.some((t) => !isClosed(t)));
  return open >= 0 ? open : groups.length - 1;
}

const pluralTodo = (n: number): string => `… ${n} more ${n === 1 ? 'todo' : 'todos'}`;

/** omp's walking-viewport policy for a collapsed phase: the last closed item as context, active work at the head, then the pending items that follow, capped; a summary counts the rest. */
export function selectCollapsed(tasks: TodoItem[], isActive: (t: TodoItem) => boolean, cap: number, context = true): { items: TodoItem[]; summary: string } {
  const open = tasks.filter((t) => !isClosed(t));
  const within = (base: TodoItem[]): { items: TodoItem[]; summary: string } => {
    if (base.length <= cap + 1) return { items: base, summary: '' };
    const active = base.filter(isActive);
    if (active.length > cap) return { items: active.slice(0, cap), summary: `… ${active.length - cap} more active ${active.length - cap === 1 ? 'todo' : 'todos'}` };
    const first = active.length > 0 ? base.indexOf(active[0]!) : 0;
    const fill: TodoItem[] = [];
    for (let i = first; i < base.length && active.length + fill.length < cap; i++) if (!isActive(base[i]!)) fill.push(base[i]!);
    const items = [...active, ...fill];
    return { items, summary: base.length > items.length ? pluralTodo(base.length - items.length) : '' };
  };
  if (open.length === 0) return within(tasks);
  const lead = context ? tasks.filter(isClosed).slice(-1) : [];
  const sel = within(open);
  return { items: [...lead, ...sel.items], summary: sel.summary };
}

function itemRun(t: TodoItem, matched: boolean): Segment[] {
  const phase = phaseOf(t);
  const text = phase ? t.content.replace(new RegExp(`^\\[${phase}\\]\\s*`, 'i'), '') : t.content;
  switch (t.status) {
    case 'completed': return [seg(`${CHECKED} `, C.done), seg(text, C.done, { strike: true })];
    case 'abandoned': return [seg(`${BOX} `, C.bad), seg(text, C.bad, { strike: true })];
    case 'in_progress': return [seg(`${BOX} ${text}`, C.accent)];
    case 'blocked': return [seg(`${BOX} ${text} (blocked)`, C.warn)];
    default: return [seg(`${BOX} ${text}`, matched ? C.accent : C.dim)];
  }
}

/** `bare` drops the trailing-stages row and the closing tail: just the header, the active phase and its items. */
type TodoCaps = { taskCap: number; stageCap: number; bare?: boolean };

function todoBlock(todos: TodoItem[], agents: HudAgent[], caps: TodoCaps): Segment[][] {
  const groups = groupsOf(todos);
  if (groups.length === 0) return [];
  const multi = groups.length > 1;
  const activeIdx = activeIndex(groups);
  const owners = new Set(agents.filter(isRunning).map((a) => a.name));
  const matched = (t: TodoItem): boolean => t.status === 'pending' && t.owner !== undefined && owners.has(t.owner);
  const isActive = (t: TodoItem): boolean => t.status === 'in_progress' || matched(t);

  const slice = groups.slice(activeIdx, activeIdx + 1 + caps.stageCap);
  const hidden = groups.length - activeIdx - slice.length;

  const spines: string[] = [];
  const lines: Segment[][] = [];
  const push = (rows: Segment[][]): void => {
    rows.forEach((r, i) => { spines.push(i === 0 ? `${TREE.branch} ` : `${TREE.vertical}  `); lines.push(r); });
  };

  slice.forEach((g, i) => {
    const idx = activeIdx + i;
    const label = multi ? `${roman(idx + 1)}. ${g.label}` : g.label;
    const done = g.tasks.filter(isClosed).length;
    const progress = seg(` · ${done}/${g.tasks.length}`, C.dim);
    if (idx !== activeIdx) { push([[seg(label, C.muted), progress]]); return; }
    const sel = selectCollapsed(g.tasks, isActive, caps.taskCap, caps.taskCap > 1);
    const kids: Segment[][] = sel.items.map((t, k) => {
      const lastKid = k === sel.items.length - 1 && sel.summary === '';
      return [seg(`${lastKid ? TREE.last : TREE.branch} `, C.dim), ...itemRun(t, matched(t))];
    });
    if (sel.summary !== '') kids.push([seg(`${TREE.last} `, C.dim), seg(sel.summary, C.muted)]);
    push([[seg(label, C.accent, { bold: true }), progress], ...kids]);
  });
  if (hidden > 0 && !caps.bare) push([[seg(`… ${hidden} more ${hidden === 1 ? 'stage' : 'stages'}`, C.muted)]]);

  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  const closed = groups.reduce((n, g) => n + g.tasks.filter(isClosed).length, 0);
  const pathLen = lines.length + TAIL_LEN;
  let filled = Math.round((closed / total) * pathLen);
  if (closed > 0) filled = Math.max(filled, 1);
  if (closed < total) filled = Math.min(filled, pathLen - 1);

  const rows: Segment[][] = [[seg('TODO', C.accent, { bold: true })]];
  lines.forEach((line, i) => rows.push([seg(' '), seg(spines[i]!, i < filled ? C.accent : C.dim), ...line]));
  if (caps.bare) return rows;
  const tail = TREE.hook + TREE.horizontal.repeat(TAIL_LEN - 1);
  const lit = Math.max(0, Math.min(filled - lines.length, tail.length));
  rows.push([seg(' '), ...(lit > 0 ? [seg(tail.slice(0, lit), C.accent)] : []), ...(lit < tail.length ? [seg(tail.slice(lit), C.dim)] : [])]);
  return rows;
}

// ---- Subagents --------------------------------------------------------------------------------------

type AgentCaps = { limit: number; preview: boolean; noMore?: boolean };

/** omp's `provider/model` badge: a bare alias or id is an Anthropic model (`sonnet` -> `anthropic/sonnet`); never a guessed version. */
export function modelLabel(model: string): string {
  const m = model.replace(/\s+/g, ' ').trim();
  return m === '' || m.includes('/') ? m : `anthropic/${m}`;
}

function agentRows(running: HudAgent[], caps: AgentCaps, root?: string | null): Segment[][] {
  const shown = running.slice(0, caps.limit);
  const rows: Segment[][] = [[seg('Subagents', C.accent, { bold: true }), seg(` · ${running.length} running`, C.dim)]];
  const more = running.length - shown.length;
  const showMore = more > 0 && !caps.noMore;
  shown.forEach((a, i) => {
    const last = i === shown.length - 1 && !showMore;
    const head: Segment[] = [seg(' '), seg(`${last ? TREE.last : TREE.branch} `, C.dim), seg('• ', C.accent)];
    if (a.model) head.push(seg(`${THINK} `, C.accent), seg(`${truncateMiddle(modelLabel(a.model), MODEL_BADGE_WIDTH - 2)} `, C.dim));
    head.push(seg(a.name, C.accent, { bold: true }));
    if (a.role && a.role !== a.name && a.role !== 'unknown') head.push(seg(` [${a.role}]`, C.dim));
    const task = (a.task ?? '').replace(/\s*[\r\n]+\s*/g, ' ↵ ').trim();
    if (task && task !== a.name) head.push(seg(': ', C.accent), seg(task, C.accent));
    rows.push(head);
    const preview = caps.preview ? previewOf(a, root) : undefined;
    if (preview) rows.push([seg(' '), seg(`${last ? '   ' : `${TREE.vertical}  `}${TREE.hook} `, C.dim), ...preview]);
  });
  if (showMore) rows.push([seg(' '), seg(`${TREE.last} `, C.dim), seg(`… ${more} more`, C.dim)]);
  return rows;
}

/** The agent's current tool call, or between calls its last one marked done. */
function previewOf(a: HudAgent, root?: string | null): Segment[] | undefined {
  const base = root ? `${root.replace(/\/+$/, '')}/` : '';
  const flat = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const rel = (s: string): string => (base ? s.split(base).join('') : s);
  // omp: the call's own intent (lower-case tool name, then its description), else the args.
  const detail = rel(flat(a.detail) || flat(a.lastLine) || flat(a.target));
  const current = rel(flat(a.detail) || flat(a.target));
  if (a.tool) return [seg(a.tool.toLowerCase(), C.muted), ...(current ? [seg(`: ${current}`, C.dim)] : [])];
  if (a.lastTool) return [seg('✓ ', C.ok), seg(a.lastTool.toLowerCase(), C.dim), ...(detail ? [seg(`: ${detail}`, C.dim)] : [])];
  return undefined;
}

const GENERIC = new Set(['unknown', 'general-purpose', 'task', '']);

/** "explorer", "a and b", "a, b and c": the distinct roles of the running agents. */
export function waitingText(running: HudAgent[]): string {
  const names = [...new Set(running.map((a) => (GENERIC.has(a.role) ? a.name : a.role)))];
  const list = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Waiting on ${list} ${running.length === 1 ? 'agent' : 'agents'}`;
}

// ---- assembly ---------------------------------------------------------------------------------------

type Plan = { todo: TodoCaps | null; agents: AgentCaps | null; waiting: boolean };

const BLANK = (): Segment[] => [seg('')];

/** The compact form the HUD always keeps: TODO header, the active phase with its items, the Subagents header and one row per running agent. */
const COMPACT: Plan = { todo: { taskCap: 2, stageCap: 0, bare: true }, agents: { limit: AGENT_LIMIT, preview: false }, waiting: false };

/** Fidelity ladder: collapse first (previews, task caps, stage caps), then shed the tree's tail and stage rows down to the compact form, then fewer tasks and agents, then drop the tree, last the Subagents. */
const LADDER: Plan[] = [
  { todo: { taskCap: 5, stageCap: 4 }, agents: { limit: AGENT_LIMIT, preview: true }, waiting: true },
  { todo: { taskCap: 5, stageCap: 4 }, agents: { limit: AGENT_LIMIT, preview: false }, waiting: true },
  { todo: { taskCap: 3, stageCap: 4 }, agents: { limit: AGENT_LIMIT, preview: false }, waiting: true },
  { todo: { taskCap: 2, stageCap: 2 }, agents: { limit: AGENT_LIMIT, preview: false }, waiting: true },
  { todo: { taskCap: 2, stageCap: 0 }, agents: { limit: AGENT_LIMIT, preview: false }, waiting: false },
  COMPACT,
  { todo: { taskCap: 1, stageCap: 0, bare: true }, agents: { limit: AGENT_LIMIT, preview: false }, waiting: false },
  { todo: { taskCap: 1, stageCap: 0, bare: true }, agents: { limit: 1, preview: false, noMore: true }, waiting: false },
  { todo: { taskCap: 1, stageCap: 0, bare: true }, agents: null, waiting: false },
  { todo: null, agents: { limit: 1, preview: false }, waiting: false },
];

/** `blanks` adds omp's spacer rows: one above the first block, two between the TODO tail and Subagents, one above the Waiting line and one below it. */
const planRows = ({ todos, agents, root }: HudInput, plan: Plan, blanks = false): Segment[][] => {
  const running = agents.filter(isRunning);
  const rows: Segment[][] = [];
  const todoRows = plan.todo && todos.length > 0 ? todoBlock(todos, agents, plan.todo) : [];
  const agentBlock = plan.agents && running.length > 0 ? agentRows(running, plan.agents, root) : [];
  if (blanks && (todoRows.length > 0 || agentBlock.length > 0)) rows.push(BLANK());
  rows.push(...todoRows);
  if (blanks && todoRows.length > 0 && agentBlock.length > 0) rows.push(BLANK(), BLANK());
  rows.push(...agentBlock);
  if (plan.waiting && running.length > 0) {
    if (blanks) rows.push(BLANK());
    rows.push([seg('⏳ ', C.warn), seg(waitingText(running), C.muted)]);
    if (blanks) rows.push(BLANK());
  }
  return rows;
};

/** Rows of the compact form: what the HUD keeps whatever the band is given. */
export const hudCompactRows = (input: HudInput): number => planRows({ ...input, todos: input.todos.filter(isPlanItem) }, COMPACT).length;

/** Rows the HUD may take of `maxRows`. Normally what leaves the band `bandRows`; never less than the compact form, so the band gives up rows first: down to 3 (title, rail, one lane), then to 1. */
export const hudBudget = (maxRows: number, compact: number, bandRows = 7): number => {
  if (maxRows <= 0) return 0;
  const room = maxRows - bandRows;
  return compact <= maxRows - 3 ? Math.max(room, compact) : Math.max(room, Math.min(compact, maxRows - 1));
};

const clip = (row: Segment[], cols: number): Segment[] => {
  const out: Segment[] = [];
  let left = Math.max(1, cols);
  for (const s of row) {
    if (left <= 0) break;
    const t = fitText(s.t, left);
    left -= textWidth(t);
    out.push({ ...s, t });
  }
  return out;
};

/** The HUD rows above the band: TODO tree, Subagents block, Waiting line; [] when there is nothing to show. */
export function hudRows(input: HudInput, { cols, maxRows }: HudOpts): Segment[][] {
  // Only the lead's plan: hook-added dispatch rows are not plan items.
  const { agents, root } = input;
  const todos = input.todos.filter(isPlanItem);
  const running = agents.filter(isRunning);
  if (maxRows <= 0 || (todos.length === 0 && running.length === 0)) return [];
  const fit = (plan: Plan, blanks: boolean): Segment[][] | undefined => {
    const rows = planRows({ todos, agents, root }, plan, blanks);
    return rows.length <= maxRows ? rows.map((r) => clip(r, cols)) : undefined;
  };
  // Spacer rows go first under budget pressure: the full form without them before any other shrink step.
  const full = fit(LADDER[0]!, true) ?? fit(LADDER[0]!, false);
  if (full) return full;
  for (const plan of LADDER.slice(1)) {
    const rows = fit(plan, false);
    if (rows) return rows;
  }
  return [];
}
