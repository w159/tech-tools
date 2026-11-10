// Shared-board panel for the band: collapsed it is one row, `N of M tasks` with a thin single-tone bar (accent while
// work is running, ok when complete) and the in-progress item; expanded it is one row per item with the same marks as
// the sidebar route view (✓ done, ◉ in progress, ⏸ blocked with the word, ○ pending), capped by the row budget with a
// `+N more` row. Colour is state only (TONE_HEX, defined once in mission-layout). Pure: rows in, Segment rows out.
import type { TodoItem } from './contract';
import { isPlanItem } from './data/todos';
import { PANEL_BG, TONE_HEX as T } from './mission-layout';
import { padRow } from './paint';
import type { Segment } from './runs';
import { DONE_GLYPH, fitText, textWidth } from './theme';

/** `tick` is accepted for the band's call signature; nothing here moves, because nothing on the board is a spinner. */
export type TodoPanelOpts = { cols: number; tick: number; expanded: boolean; maxRows: number };

const seg = (t: string, color: string = T.text, bold?: boolean): Segment => ({ t, color, bg: PANEL_BG, bold });
const pad = (parts: Segment[], cols: number): Segment[] => padRow(parts, cols, PANEL_BG);

/** Status mark and its tone. Unknown statuses read as pending. */
const MARK: Record<string, [string, string]> = { completed: [DONE_GLYPH, T.ok], in_progress: ['◉', T.accent], blocked: ['⏸', T.warn], pending: ['○', T.muted] };
const markOf = (status: string): Segment => {
  const [g, color] = MARK[status] ?? MARK.pending!;
  return seg(g, color);
};

/** Board text without the contract's `[phase] ` / `[label] ` prefix (omp shows the bare title; the phase groups already name it). */
const bare = (content: string): string => content.replace(/^\s*\[[^\]]+\]\s*/, '');

const FILLED = '━';
const EMPTY = '─';

/** `width` cells: `━` filled in `tone` for the done share, dim `─` for the rest. */
function bar(frac: number, width: number, tone: string): Segment[] {
  const whole = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return [seg(FILLED.repeat(whole), tone), seg(EMPTY.repeat(width - whole), T.dim)].filter((s) => s.t);
}

const runsWidth = (parts: Segment[]): number => textWidth(parts.map((p) => p.t).join(''));

const taskWord = (done: number, total: number): string => `${done} of ${total} task${total === 1 ? '' : 's'}`;

function collapsed(items: TodoItem[], o: TodoPanelOpts): Segment[] {
  const plan = items.filter(isPlanItem); // the lead's plan only: per-subagent dispatch rows stay out of the count and the bar
  const done = plan.filter((i) => i.status === 'completed').length;
  const cur = items.find((i) => i.status === 'in_progress');
  const complete = plan.length > 0 && done === plan.length;
  const tone = complete ? T.ok : cur ? T.accent : T.muted;
  const barW = Math.max(6, Math.min(24, Math.floor(o.cols / 4)));
  const head = [seg(' '), seg(taskWord(done, plan.length), T.text, true), seg(' '), ...bar(done / Math.max(1, plan.length), barW, tone), seg(' ')];
  const room = o.cols - runsWidth(head) - 1;
  const tail = cur && room > 6
    ? [markOf('in_progress'), seg(` ${fitText(`${cur.owner ? `${cur.owner}: ` : ''}${bare(cur.content)}`, room - 2)}`)]
    : [];
  return pad(fitRow([...head, ...tail], o.cols), o.cols);
}

/** Cut a row to `cols` cells (narrow widths); runs are never split mid-run, so shorten the last ones. */
function fitRow(parts: Segment[], cols: number): Segment[] {
  const out: Segment[] = [];
  let used = 0;
  for (const p of parts) {
    const w = textWidth(p.t);
    if (used + w <= cols) { out.push(p); used += w; continue; }
    const left = cols - used;
    if (left > 0) out.push({ ...p, t: fitText(p.t, left) });
    break;
  }
  return out;
}

const cleanEvidence = (i: TodoItem): string => (i.evidence ?? '').replace(/^\s*\d+[.)]\s*/, '').replace(/\s+/g, ' ');

/** `✓ map the auth flow · explorer-1  rg auth -> 3 hits`; a blocked item says `blocked` before its evidence. */
function itemRow(i: TodoItem, o: TodoPanelOpts, indent = ''): Segment[] {
  const head = [seg(` ${indent}`), markOf(i.status), seg(' ')];
  const owner = i.owner ? ` · ${fitText(i.owner, 14)}` : '';
  const blocked = i.status === 'blocked' ? '  blocked' : '';
  const ev = cleanEvidence(i);
  const evText = ev ? `  ${ev}` : '';
  const room = o.cols - runsWidth(head) - 1;
  const title = fitText(bare(i.content), Math.max(1, Math.max(10, ev ? Math.floor(room * 0.6) : room) - textWidth(owner) - textWidth(blocked)));
  const used = textWidth(title) + textWidth(owner) + textWidth(blocked);
  return pad(fitRow([
    ...head,
    seg(title, i.status === 'completed' ? T.muted : T.text),
    ...(owner ? [seg(owner, T.muted)] : []),
    ...(blocked ? [seg(blocked, T.warn)] : []),
    ...(evText ? [seg(fitText(evText, Math.max(0, room - used)), T.muted)] : []),
  ], o.cols), o.cols);
}

// Phase order of the operating contract (contracts/operating-contract.json); twin of omp/todo-panel.ts.
const PHASE_ORDER = ['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done'];

/** One heading per phase (`research  1 of 2`) followed by its items nested; items without a phase go last under `other`. */
function treeRows(items: TodoItem[], o: TodoPanelOpts): Segment[][] {
  const groups: Array<[string, TodoItem[]]> = [...PHASE_ORDER.map((p): [string, TodoItem[]] => [p, items.filter((i) => i.phase === p)]), ['other', items.filter((i) => !i.phase || !PHASE_ORDER.includes(i.phase))]];
  return groups.filter(([, g]) => g.length).flatMap(([name, g]) => {
    const done = g.filter((i) => i.status === 'completed').length;
    return [pad([seg(` ${name}`, T.text, true), seg(`  ${done} of ${g.length}`, T.muted)], o.cols), ...g.map((i) => itemRow(i, o, '  '))];
  });
}

function expandedRows(items: TodoItem[], o: TodoPanelOpts): Segment[][] {
  const rows = items.some((i) => i.phase) ? treeRows(items, o) : items.map((i) => itemRow(i, o));
  if (rows.length <= o.maxRows) return rows;
  const shown = rows.slice(0, Math.max(0, o.maxRows - 1));
  return [...shown, pad([seg(`   +${rows.length - shown.length} more`, T.muted)], o.cols)];
}

/** Panel rows for the board: [] without items, one row collapsed, else <= `maxRows` item rows. */
export function todoRows(items: TodoItem[], o: TodoPanelOpts): Segment[][] {
  if (!items.length || o.maxRows < 1) return [];
  return o.expanded ? expandedRows(items, o) : [collapsed(items, o)];
}
