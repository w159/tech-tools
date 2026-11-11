// board-model.ts: the Atlas Board (design rev 4, section 5 and mock-board-*.png) as pure data and runs, shared by the Claude
// Code pane (mod/todo-panel.tsx) and the omp widget (omp/todo-panel.ts) so both hosts draw the same strings. Host free:
// todo rows in, tone-tagged Run lines out; each host paints a Run.
//
// Columns ITEM / STATE / OWNER / DETAIL at 100+ cells (header row; state at 30, owner at 42 and 18 wide, detail at 62);
// ITEM / STATE at 60..99 (state at 26, no header); ITEM alone below that. Rows are `marker glyph label`, the marker `▸` on
// the focused (first running) row. Plain form: state word in text. Rich form: a fixed 11-cell chip (one per row) and an
// elapsed gauge on the running row.
//
// Ribbon width: `ribbon()` fills exactly `cols` cells (its last cell is a blank). The design's golden files are the same
// rows with trailing blanks trimmed, which is why board-120.txt is 118 characters wide (120 less the two blanks after
// "7 items"). The code keeps the exact-fill ribbon and the goldens are compared trimmed (see BOARD_GOLDEN in tests).
import { clip, gauge, ribbon, runsCells, stateChip, stateRun, type Run, type Ui, type UiState } from './atlas-ui';

/** One board row. `elapsed` is the running item's time; `of` is its estimate and is present only when the item carries one, so
 * the `of mm:ss` and the gauge are drawn from data, never from a default. `ownerState`: the owner's failed, waiting or blocked word, shown beside the item. */
export type BoardRow = { label: string; state: UiState; owner: string; detail: string; elapsed?: { secs: number; of?: number }; ownerState?: UiState; focus?: boolean };

/** Column starts of the full form, and the compact form's state column. */
export const COL = { state: 30, owner: 42, detail: 62, stateCompact: 26 } as const;
export const OWNER_W = 18;
export const FULL_MIN = 100;
export const COMPACT_MIN = 60;

// ---- data: todo rows to board rows --------------------------------------------------------------------------------

/** `estimate_s`: the item's own estimate in seconds, when the board records one. `ownerState`: the state word of the item's
 * owner when the caller knows the worker (data/live.ts); a failed or waiting owner shows on the item. */
export type BoardSource = { content: string; status: string; owner?: string; evidence?: string; claimed_at?: number | null; completed_at?: number | null; origin?: string; estimate_s?: number | null; ownerState?: UiState };

/** The six-word vocabulary for a todo status; an unknown status reads as queued. */
export function stateOfStatus(status: string): UiState {
  switch (status) {
    case 'completed': case 'done': return 'done';
    case 'in_progress': case 'running': return 'running';
    case 'blocked': return 'blocked';
    case 'failed': case 'abandoned': return 'failed';
    case 'waiting': return 'waiting';
    default: return 'queued';
  }
}

export const mmss = (secs: number): string => {
  const s = Math.max(0, Math.round(secs));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Board text without the contract's `[phase] ` / `[label] ` prefix. */
const bare = (content: string): string => content.replace(/^\s*\[[^\]]+\]\s*/, '');
const cleanEvidence = (e: string | undefined): string => (e ?? '').replace(/^\s*\d+[.)]\s*/, '').replace(/\s+/g, ' ').trim();

/** An item's state word: its status, except that a failed owner fails the item and a waiting owner blocks it (a finished item stays done).
 * One rule for every surface that lists plan items (board, TODO tree, side panel). */
export function itemState(status: string, ownerState?: UiState): UiState {
  const own = stateOfStatus(status);
  if (own === 'done') return own;
  if (ownerState === 'failed') return 'failed';
  if (ownerState === 'waiting' || ownerState === 'blocked') return 'blocked';
  return own;
}

/** Items whose state word is `blocked` under `itemState`, given each owner's state word. */
export const blockedCount = (items: readonly { status: string; owner?: string }[], owners: ReadonlyMap<string, UiState>): number =>
  items.filter((it) => itemState(it.status, it.owner ? owners.get(it.owner) : undefined) === 'blocked').length;

/** `ran 03:10` for a finished item with both stamps, `elapsed` data for a running one with a claim time (its `of` only when the
 * item carries an estimate), else the evidence. An owner that failed or waits is named in front of the detail. */
export function toBoardRow(it: BoardSource, nowSecs?: number): BoardRow {
  const state = itemState(it.status, it.ownerState);
  // Named only when it adds to the item's own word (a failed owner already reads `failed`; a waiting owner reads `blocked` and is named).
  const ownerState = state !== 'done' && (it.ownerState === 'failed' || it.ownerState === 'waiting' || it.ownerState === 'blocked') && it.ownerState !== state ? it.ownerState : undefined;
  const base = { label: bare(it.content), state, owner: it.owner ?? '', ...(ownerState ? { ownerState } : {}) };
  const ev = cleanEvidence(it.evidence);
  const detail = ownerState ? `owner ${ownerState}${ev ? ` · ${ev}` : ''}` : ev;
  if (state === 'done' && it.claimed_at && it.completed_at && it.completed_at >= it.claimed_at) return { ...base, detail: `ran ${mmss(it.completed_at - it.claimed_at)}` };
  if (state === 'running' && it.claimed_at && nowSecs !== undefined && nowSecs >= it.claimed_at) {
    const est = typeof it.estimate_s === 'number' && it.estimate_s > 0 ? it.estimate_s : undefined;
    return { ...base, detail, elapsed: { secs: nowSecs - it.claimed_at, ...(est ? { of: est } : {}) } };
  }
  return { ...base, detail };
}

/** Rows of `items` in board order (plan rows first, then the per-subagent dispatch rows). */
export const boardRowsOf = (items: readonly BoardSource[], nowSecs?: number): BoardRow[] => {
  const plan = items.filter((i) => i.origin !== 'dispatch');
  const dispatch = items.filter((i) => i.origin === 'dispatch');
  return [...plan, ...dispatch].map((i) => toBoardRow(i, nowSecs));
};

/** Counts of a board by state, plus done and total: the numbers the ribbon and the band both state. */
export function boardCounts(rows: readonly BoardRow[]): Record<UiState, number> & { total: number } {
  const out = { queued: 0, running: 0, done: 0, failed: 0, blocked: 0, waiting: 0, total: rows.length };
  for (const r of rows) out[r.state]++;
  return out;
}

// ---- layout: runs ------------------------------------------------------------------------------------------------------

const r = (t: string, tone: Run['tone'] = 'text', extra: Partial<Run> = {}): Run => ({ t, tone, ...extra });
/** Pad `runs` with spaces to reach cell `col` (a single space when the cursor is already past it). */
const to = (runs: Run[], col: number): Run[] => [...runs, r(' '.repeat(Math.max(1, col - runsCells(runs))))];

export type BoardOpts = { cols: number; ui: Ui; rich?: boolean; tick?: number };

const form = (cols: number): 'full' | 'compact' | 'narrow' => (cols >= FULL_MIN ? 'full' : cols >= COMPACT_MIN ? 'compact' : 'narrow');

function detailRuns(row: BoardRow, o: BoardOpts, room: number): Run[] {
  if (row.elapsed) {
    const { secs, of } = row.elapsed;
    // The gauge and `of mm:ss` need a real estimate; without one the row says `elapsed 00:42` and draws no gauge.
    const tail = of === undefined ? mmss(secs) : `${mmss(secs)} of ${mmss(of)}`;
    if (of !== undefined && o.rich && !o.ui.ascii && room >= 8 + 10 + 1 + tail.length) return [r('elapsed ', 'muted'), ...gauge(10, Math.min(1, secs / Math.max(1, of)), o.ui), r(` ${tail}`, 'sub')];
    return [r(clip(`elapsed ${tail}${row.detail ? `  ${row.detail}` : ''}`, room), 'sub')];
  }
  return row.detail ? [r(clip(row.detail, room), 'sub')] : [];
}

/** One row. `focus` marks the row the marker `▸` points at. */
export function boardRow(row: BoardRow, focus: boolean, o: BoardOpts): Run[] {
  const f = form(o.cols);
  const head: Run[] = [focus ? r(o.ui.ascii ? '>' : '▸', 'accent', { bold: true }) : r(' '), r(' '), stateRun(row.state, o.ui, o.tick ?? 0), r(' ')];
  // Full form: done struck in sub, the focus bold. The 80 mock draws labels plain (text), the 40 mock dims a done one (sub).
  const labelRun = (w: number): Run =>
    f === 'full' ? (row.state === 'done' ? r(clip(row.label, w), 'sub', { strike: true }) : r(clip(row.label, w), 'text', { bold: focus }))
      : r(clip(row.label, w), f === 'narrow' && row.state === 'done' ? 'sub' : 'text');
  if (f === 'narrow') return [...head, labelRun(Math.max(1, o.cols - 4))];
  const stateCol = f === 'full' ? COL.state : COL.stateCompact;
  const withLabel = to([...head, labelRun(stateCol - 5)], stateCol);
  if (f === 'compact') return [...withLabel, r(row.state)];
  const stateCell = o.rich ? stateChip(row.state, o.ui) : r(row.state);
  const withState = to([...withLabel, stateCell], COL.owner);
  const owner = to([...withState, ...(row.owner ? [r(clip(row.owner, OWNER_W), 'sub')] : [])], COL.detail);
  return [...owner, ...detailRuns(row, o, Math.max(0, o.cols - COL.detail - 1))];
}

/** `ITEM  STATE  OWNER  DETAIL`, full form only. */
export function boardHeader(): Run[] {
  const h = (t: string): Run => r(t, 'muted');
  return [...to([...to([...to([h('ITEM')], COL.state), h('STATE')], COL.owner), h('OWNER')], COL.detail), h('DETAIL')];
}

export type BoardLine = { runs: Run[] };

/** The rows alone: the header (full form) and one line per item. The band's inline board slot draws these. */
export function boardBody(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  const focus = rows.findIndex((x) => x.focus ?? x.state === 'running');
  const lines = rows.map((row, i) => ({ runs: boardRow(row, i === focus, o) }));
  return form(o.cols) === 'full' ? [{ runs: boardHeader() }, ...lines] : lines;
}

/** The whole surface: ribbon (`N items` on the right in the plain form), a blank row, then the body. */
export function boardLines(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  const rib = ribbon(o.cols, 'BOARD', o.rich ? '' : `${rows.length} items`, o.ui);
  return [{ runs: rib }, { runs: [r(' ')] }, ...boardBody(rows, o)];
}

/** Plain text of lines, trailing blanks trimmed: what the goldens compare. */
export const boardText = (lines: readonly BoardLine[]): string[] => lines.map((l) => l.runs.map((x) => x.t).join('').trimEnd());
