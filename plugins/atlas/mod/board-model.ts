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
import { cells, chip, clip, gauge, markOf, markToken, RETURNED, ribbon, runsCells, spinFrameOf, stateChip, stateRun, type Run, type Ui, type UiState } from './atlas-ui';
import { animateRow, keysOf, type MotionCtx, type MotionItem } from './motion';

/** One board row. `elapsed` is the running item's time; `of` is its estimate and is present only when the item carries one, so
 * the `of mm:ss` and the gauge are drawn from data, never from a default. `ownerState`: the owner's failed, waiting or blocked word, shown beside the item. */
export type BoardRow = { label: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`ended`: the agent is gone, the store row is still open). */ word?: string; owner: string; detail: string; elapsed?: { secs: number; of?: number }; ownerState?: UiState; focus?: boolean };

/** Column starts of the full form, and the compact form's state column. */
export const COL = { state: 30, owner: 42, detail: 62, stateCompact: 26 } as const;
export const OWNER_W = 18;
const STATE_W = 7; // the longest state word (running, waiting)
export const FULL_MIN = 100;
export const COMPACT_MIN = 60;
/** Below this the board is the label alone; from here to COMPACT_MIN the state (and, when it fits, the owner) still sit right of the label. */
export const NARROW_MIN = 30;
const LABEL_MIN = 16; // the least label room the narrow form keeps before it drops the owner column
// ---- data: todo rows to board rows --------------------------------------------------------------------------------

/** `estimate_s`: the item's own estimate in seconds, when the board records one. `ownerState`: the state word of the item's
 * owner when the caller knows the worker (data/live.ts); a failed or waiting owner shows on the item. */
export type BoardSource = { content: string; status: string; owner?: string; evidence?: string; claimed_at?: number | null; completed_at?: number | null; origin?: string; estimate_s?: number | null; ownerState?: UiState };

/** The six-word vocabulary for a todo status; an unknown status reads as queued. */
export function stateOfStatus(status: string): UiState {
  switch (status) {
    case 'completed': case 'done': return 'done';
    case 'in_progress': case 'running': return 'running';
    case 'blocked': case 'ended': return 'blocked'; // `ended`: the agent finished but the store still holds its row open (attention, never done)
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
  if (own === 'queued' && ownerState === 'running') return 'running'; // the owner is at work: a row still reading queued says running
  if (ownerState === 'failed') return status === 'blocked' ? 'blocked' : 'failed'; // the lead's own `blocked` is its word for the row (critique 16: T2 blocked read failed); the killed agent keeps its own failed row
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
  const ended = it.status === 'ended';
  const base = { label: bare(it.content), state, ...(ended ? { word: RETURNED } : {}), owner: it.owner ?? '', ...(ownerState ? { ownerState } : {}) };
  const ev = cleanEvidence(it.evidence);
  const detail = ended ? `agent ended, row still open${ev ? ` · ${ev}` : ''}` : ownerState ? `owner ${ownerState}${ev ? ` · ${ev}` : ''}` : ev;
  if (state === 'done' && it.claimed_at && it.completed_at && it.completed_at >= it.claimed_at) return { ...base, detail: `ran ${mmss(it.completed_at - it.claimed_at)}` };
  if (state === 'running' && it.claimed_at && nowSecs !== undefined && nowSecs >= it.claimed_at) {
    const est = typeof it.estimate_s === 'number' && it.estimate_s > 0 ? it.estimate_s : undefined;
    return { ...base, detail, elapsed: { secs: nowSecs - it.claimed_at, ...(est ? { of: est } : {}) } };
  }
  return { ...base, detail };
}

/** How far a dispatch row's status says its worker got; the highest one of an owner's rows is folded into the plan row. A finished
 * worker (`completed`) leaves the open plan row `ended`: the agent is gone, the lead has not closed the row. */
const FOLD_RANK: Readonly<Record<string, number>> = { failed: 5, in_progress: 4, blocked: 3, waiting: 3, ended: 2, completed: 2, pending: 1 };
const foldStatus = (s: string): string => (s === 'completed' ? 'ended' : s);

/** Rows of `items` in board order: the plan rows, then the dispatch rows that no plan row owns. A dispatch row whose owner owns a plan
 * row is that row's worker, not a second item: it is folded into the plan row (its state, claim time, estimate and evidence fill what the
 * plan row lacks), so the board lists exactly the plan (5 items, 3 of them owned: 5 rows). */
export const boardRowsOf = (items: readonly BoardSource[], nowSecs?: number): BoardRow[] => foldBoard(items).rows.map((i) => toBoardRow(i, nowSecs));

/** How many dispatch rows `boardRowsOf` folded into plan rows: the footer names them (`5 items · 3 dispatches folded`), so the tab and the helper's
 * `needed 5 plan items, 3 dispatches` agree. */
export const boardFolded = (items: readonly BoardSource[]): number => foldBoard(items).folded;

/** How many of the folded dispatch rows the store still holds open (not completed). The fold never hides an open row: the footer names them
 * (`5 items · 1 dispatch open`) and the plan row they fold into does not read done. */
export const boardOpenFolded = (items: readonly BoardSource[]): number => foldBoard(items).open;

const finished = (s: string): boolean => s === 'completed' || s === 'done';

function foldBoard(items: readonly BoardSource[]): { rows: BoardSource[]; folded: number; open: number } {
  const plan = items.filter((i) => i.origin !== 'dispatch');
  const dispatch = items.filter((i) => i.origin === 'dispatch');
  const names = new Set(dispatch.map((i) => i.owner).filter((n): n is string => !!n));
  const owned = plan.map((i) => withTitleOwner(i, names));
  const firstOf = new Map<string, number>(); // owner -> the first plan row that names it
  owned.forEach((i, n) => { if (i.owner && !firstOf.has(i.owner)) firstOf.set(i.owner, n); });
  const folded = owned.slice();
  const alone: BoardSource[] = [];
  let count = 0;
  let open = 0;
  for (const d of dispatch) {
    const at = d.owner ? firstOf.get(d.owner) : undefined;
    if (at === undefined) { alone.push(d); continue; }
    const p = folded[at]!;
    // An open dispatch row under a plan row that already reads done is the row Stop counts (critique 15 B5, stoprun f0090: the fold hid `tc9cd5be6` and the lead had to list the
    // board on the command line): it is never folded away, it is its own row with its owner, and the plan row stays as the lead closed it.
    if (finished(p.status) && !finished(d.status)) { alone.push(d); continue; }
    count++;
    if (!finished(d.status)) open++;
    if (finished(p.status)) continue;
    const pick = p.status !== 'blocked' && (FOLD_RANK[d.status] ?? 0) > (FOLD_RANK[p.status] ?? 1) ? foldStatus(d.status) : p.status; // a plan row the lead marked blocked stays blocked under a failed dispatch row
    folded[at] = { ...p, status: pick, claimed_at: p.claimed_at ?? d.claimed_at, estimate_s: p.estimate_s ?? d.estimate_s, evidence: p.evidence || d.evidence, ownerState: p.ownerState ?? d.ownerState };
  }
  return { rows: [...folded, ...alone], folded: count, open };
}

/** A plan row names its worker in the title (`T1 read alpha.py (alpha-explorer)`) while the store holds no owner: when that
 * trailing parenthesis is one of the dispatched workers, the name moves to the owner column and leaves the label. */
function withTitleOwner(it: BoardSource, workers: ReadonlySet<string>): BoardSource {
  if (workers.size === 0) return it;
  const m = titleOwner(it.content, workers);
  return m && (!it.owner || it.owner === m.name) ? { ...it, content: it.content.slice(0, m.at), owner: m.name } : it; // an owner already set from the title (ownTodos) still leaves the label
}

/** The worker named by a title's trailing parenthesis (`T1 read alpha.py (alpha-explorer)`) when it is one of `workers`, and where that parenthesis starts.
 * The one rule every surface uses to match a plan row to its agent: the Board fold, the HUD TODO rows. */
export function titleOwner(content: string, workers: { has(name: string): boolean }): { name: string; at: number } | undefined {
  const m = /\s*\(([^()\s]+)\)\s*$/.exec(content);
  return m && workers.has(m[1]!) ? { name: m[1]!, at: m.index } : undefined;
}

/** The one plan figure: `done/total`, and when owners have handed rows back that the lead has not closed, ` · n returned` beside it (critique 15 B6: `0/5` over a row that reads
 * `returned` looked like a contradiction). A returned row is not done, so it never joins `done`; it is named. HUD header, band and side panel all say it this way. */
export const planFigure = (done: number, total: number, returned = 0): string => `${done}/${total}${returned > 0 ? ` · ${returned} returned` : ''}`;

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

/** `stateCol`: the compact form's state column, set by `boardBody` from the widest label so a label is not cut at the fixed 26. */
export type BoardOpts = { cols: number; ui: Ui; rich?: boolean; tick?: number; /** The snapshot clock in epoch ms: the spinner turns the shared frame (spinFrameOf) of the row's owner, else of its label. Absent: `tick`. */ nowMs?: number; stateCol?: number; /** `boardLines`: how many dispatch rows were folded into plan rows; its footer names them. */ folded?: number; /** `boardLines`: how many of those folded dispatch rows are still open in the store; the footer then reads `N items · K dispatch open`. */ openFolded?: number; /** `boardLines`: draw the `ATLAS ▸ BOARD` ribbon and its blank row (default true). Off inside the side panel, which already has its own header: the footer then carries the one count. */ ribbon?: boolean; /** `boardLines`, ribbon off: false draws no title row either (the host's own ribbon names the board). */ title?: boolean; /** The label as drawn (already cut so rows with one shared head stay apart); absent: the row's own label. */ shown?: string; /** Compact form: the owner column's width (0 or absent: none). */ ownerW?: number; /** Compact form: the state column's width (the longest word on the board; absent: 7). */ wordW?: number; /** Motion view (mod/motion.ts): a changed or new row is drawn mid-transition. Absent: the resting render. */ motion?: MotionCtx | undefined; /** The row's motion key (boardBody sets it from the row's position among its twins). */ key?: string };

const form = (cols: number): 'full' | 'compact' | 'narrow' => (cols >= FULL_MIN ? 'full' : cols >= NARROW_MIN ? 'compact' : 'narrow');

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

/** One row, mid-transition when `o.motion` holds an entry for `o.key`. */
export function boardRow(row: BoardRow, focus: boolean, o: BoardOpts): Run[] {
  const runs = boardRowResting(row, focus, o);
  return o.key === undefined ? runs : animateRow(runs, o.key, row.state, o.motion, o.ui);
}

/** The motion keys of `rows`, one per row, a repeated label numbered. */
const boardKeys = (rows: readonly BoardRow[]): string[] => keysOf('board', rows.map((x) => x.label));
/** What the Motion observes of a board: each row's key and state word. */
export const boardMotionItems = (rows: readonly BoardRow[]): MotionItem[] => boardKeys(rows).map((key, i) => ({ key, state: rows[i]!.state }));

/** Labels cut to `w` cells for one list: a label that fits stays whole, a longer one loses its end (`clip` ends in `…`). Never the front, never the
 * middle: rows with one shared head stay apart by their owner column, not by a different cut. */
export function labelCut(labels: readonly string[], w: number): string[] {
  return labels.map((l) => clip(l, w));
}

/** One row at rest. `focus` marks the row the marker `▸` points at. */
function boardRowResting(row: BoardRow, focus: boolean, o: BoardOpts): Run[] {
  const f = form(o.cols);
  const head: Run[] = [focus ? r(o.ui.ascii ? '>' : '▸', 'accent', { bold: true }) : r(' '), r(' '), stateRun(markOf(row.state, row.word), o.ui, o.nowMs !== undefined ? spinFrameOf(o.nowMs, row.owner || row.label) : o.tick ?? 0), r(' ')];
  // Full form: done struck in sub, the focus bold. The 80 mock draws labels plain (text), the 40 mock dims a done one (sub).
  const text = o.shown ?? row.label;
  const labelRun = (w: number): Run =>
    f === 'full' ? (row.state === 'done' ? r(clip(text, w), 'sub', { strike: true }) : r(clip(text, w), 'text', { bold: focus }))
      : r(clip(text, w), f === 'narrow' && row.state === 'done' ? 'sub' : 'text');
  if (f === 'narrow') return [...head, labelRun(Math.max(1, o.cols - 4))];
  const stateCol = f === 'full' ? COL.state : (o.stateCol ?? COL.stateCompact);
  const withLabel = to([...head, labelRun(stateCol - 5)], stateCol);
  const word = row.word ?? row.state;
  if (f === 'compact') return o.ownerW && row.owner ? [...to([...withLabel, r(word)], stateCol + (o.wordW ?? STATE_W) + 2), r(clip(row.owner, o.ownerW), 'sub')] : [...withLabel, r(word)];
  const stateCell = o.rich ? (row.word ? chip(word, markToken(markOf(row.state, row.word)), o.ui) : stateChip(row.state, o.ui)) : r(word);
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
  // Compact form: the state column slides right to fit the widest label, never past the room the longest state word needs.
  const keys = o.motion ? boardKeys(rows) : [];
  const compact = form(o.cols) === 'compact';
  const ownerAll = compact ? Math.min(OWNER_W, Math.max(0, ...rows.map((x) => cells(x.owner)))) : 0;
  // The owner column drops before any title is cut (critique 8: `T4 combine th...` beside `alpha...`): it stays only while the widest title still shows
  // whole beside it (head 4 + title + gap, the state word, a gap), and so a title keeps at least LABEL_MIN cells before any owner cell shows.
  const widest = Math.max(0, ...rows.map((x) => cells(x.label)));
  // The state column is as wide as the longest word on this board (a board of `done` rows needs 4 cells, not the 7 of `running`), so a title keeps those cells.
  const wordW = Math.min(STATE_W, Math.max(4, ...rows.map((x) => cells(x.word ?? x.state))));
  const ownerFit = Math.min(ownerAll, o.cols - Math.max(widest, LABEL_MIN) - 5 - wordW - 1 - 1);
  // Titles the row cuts anyway keep the owner only when, without it, the cut titles would read the same (one shared head): the owner then tells the rows apart,
  // and the title keeps LABEL_MIN cells beside it (the old rule). Cut titles that stay distinct on their own never trade cells for an owner.
  const cutBare = rows.map((x) => clip(x.label, o.cols - 13));
  const apart = new Set(cutBare).size === cutBare.length;
  const sharedHead = o.cols >= COMPACT_MIN ? ownerAll : Math.min(ownerAll, o.cols - (LABEL_MIN + 5) - wordW - 2);
  const ownerW = ownerFit >= 5 ? ownerFit : compact && !apart && sharedHead >= 5 ? sharedHead : 0; // a sliver of a name tells nothing
  // Compact: the owner column takes its width from the right, the state column slides left to make room (never under 26 at 60+, never past the widest label).
  // The state word ends on the panel's last cell, as a value column does (or the owner does, two cells after the word): a title that fills the column keeps two blank cells before it.
  const avail = o.cols - wordW - (ownerW ? ownerW + 2 : 0);
  const stateColC = compact ? Math.max(Math.min(COL.stateCompact, avail), Math.min(avail, widest + 7)) : undefined;
  const labelW = form(o.cols) === 'narrow' ? Math.max(1, o.cols - 4) : (stateColC ?? COL.state) - 5;
  const shown = labelCut(rows.map((x) => x.label), labelW);
  // Critique 15 B5: when the owner column does not fit beside the titles (the 110 pane is 36 cells), the owner is not dropped: it stands under its row, indented, so every row that has one names it.
  const stacked = compact && ownerAll > 0 && ownerW === 0;
  const lines = rows.flatMap((row, i): BoardLine[] => {
    const own = { runs: boardRow(row, i === focus, { ...o, stateCol: stateColC, shown: shown[i]!, wordW, ...(ownerW ? { ownerW } : {}), ...(o.motion ? { key: keys[i]! } : {}) }) };
    return stacked && row.owner ? [own, { runs: [r('    '), r(clip(row.owner, Math.max(1, o.cols - 4)), 'sub')] }] : [own];
  });
  return form(o.cols) === 'full' ? [{ runs: boardHeader() }, ...lines] : lines;
}

/** The whole surface: ribbon (`N items` on the right in the plain form), a blank row, then the body. Without the ribbon (the side panel, which has
 * its own header) the surface opens with one title row, `▸ BOARD  5 items` (the ribbon's own marker, so one search finds the board in either form): the only mark that says which view this is (critique 12: with the chrome gone,
 * nothing named the board and the capture script could not find it). That row says the count, so the footer carries only the folds. */
export function boardLines(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  const withRibbon = o.ribbon !== false;
  const rib = ribbon(o.cols, 'BOARD', o.rich ? '' : `${rows.length} items`, o.ui);
  const n = o.folded ?? 0;
  const k = o.openFolded ?? 0;
  // The count is said once (critique 11: `5 items` in the ribbon and again in the footer): by the ribbon or the title row, else by the footer.
  const count = !withRibbon || !o.rich ? '' : `${rows.length} items · `;
  // An open folded dispatch row is what Stop counts: the footer names it instead of the quiet fold count.
  const note = k > 0 ? r(`  ${count}${k} dispatch${k === 1 ? '' : 'es'} open`, 'warn') : r(`  ${count}${n} dispatch${n === 1 ? '' : 'es'} folded`, 'muted');
  const footer: BoardLine[] = (n > 0 || k > 0) && rows.length > 0 ? [{ runs: [note] }] : [];
  // `title: false`: the side panel's own ribbon already reads `▸ BOARD  5 items` (critique 15 B5: the live scorer finds the board by the capsule beside `▸ BOARD`), so no second title row.
  const title: BoardLine[] = withRibbon || o.title === false ? [] : [{ runs: [r(o.ui.ascii ? '  > ' : '  ▸ ', 'muted'), r('BOARD', 'text', { bold: true }), ...(rows.length > 0 ? [r(`  ${rows.length} items`, 'muted')] : [])] }];
  return [...(withRibbon ? [{ runs: rib }, { runs: [r(' ')] }] : title), ...boardBody(rows, o), ...footer];
}

/** The side panel's ribbon words for the board view: the title and its `5 items` figure. */
export function boardRibbon(rows: readonly BoardRow[]): { title: string; right: string } {
  return { title: 'BOARD', right: rows.length ? `${rows.length} items` : '' };
}

/** Plain text of lines, trailing blanks trimmed: what the goldens compare. */
export const boardText = (lines: readonly BoardLine[]): string[] => lines.map((l) => l.runs.map((x) => x.t).join('').trimEnd());
