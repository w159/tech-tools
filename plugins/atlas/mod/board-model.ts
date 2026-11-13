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
import { cells, chip, DONE_DOUBT, elapsedClock, GLYPH5, GLYPH5_ASCII, TODO_METER_W, markOf, markToken, meter, motionState, RETURNED, ribbon, rowWordTone, runsCells, spinFrameOf, stateChip, stateRun, type MarkState, type Run, type Ui, type UiState } from './atlas-ui';
import { animateRow, keysOf, sharedSpinFrame, type MotionCtx, type MotionItem } from './motion';
import { KILLED, wordOf } from './pane/activity';

/** One board row. `elapsed` is the running item's time; `of` is its estimate and is present only when the item carries one, so
 * the `of mm:ss` and the gauge are drawn from data, never from a default. `ownerState`: the owner's failed, waiting or blocked word, shown beside the item. */
export type BoardRow = { label: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`ended`: the agent is gone, the store row is still open). */ word?: string; owner: string; detail: string; elapsed?: { secs: number; of?: number }; ownerState?: UiState; /** Seconds since the item was claimed, for a row that is not done: the pane's notes say how long a row has been open. */ ageSecs?: number; focus?: boolean; /** The open dispatch rows folded into this plan row (critique 17 A3): the board footer names each one (the plan row's title and its worker). */ openDispatch?: OpenDispatch[]; /** A dispatch row no plan row owns (it stands on the board as its own row): the summary counts it as a dispatch, never as an item. */ dispatch?: boolean };
export type OpenDispatch = { title: string; owner: string };

/** Column starts of the full form, and the compact form's state column. */
export const COL = { state: 30, owner: 42, detail: 62, stateCompact: 26 } as const;
export const OWNER_W = 18;
const STATE_W = 7; // the longest state word (running, waiting)
export const FULL_MIN = 100;
export const COMPACT_MIN = 60;
/** Below this the board is the label alone; from here to COMPACT_MIN the state (and, when it fits, the owner) still sit right of the label. */
export const NARROW_MIN = 30;
const LABEL_MIN = 16; // the least label room the narrow form keeps before it drops the owner column
/** The one-cell ellipsis (written as an escape: the glyph guard bans the literal in source). */
export const ELLIPSIS = '\u2026';

/** Cut to `n` cells with one `…` marking the cut (the panel's truncation: never the ASCII `...`). */
export function clipE(text: string, n: number): string {
  if (n <= 0) return '';
  if (cells(text) <= n) return text;
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = cells(ch);
    if (w + cw > n - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}${ELLIPSIS}`;
}

// ---- data: todo rows to board rows --------------------------------------------------------------------------------

/** `estimate_s`: the item's own estimate in seconds, when the board records one. `ownerState`: the state word of the item's
 * owner when the caller knows the worker (data/live.ts); a failed or waiting owner shows on the item. */
export type BoardSource = { content: string; status: string; owner?: string; evidence?: string; claimed_at?: number | null; completed_at?: number | null; origin?: string; estimate_s?: number | null; ownerState?: UiState; /** The owner's first worker failed and its re-dispatch did not (withOwnerStates). */ retried?: boolean; openDispatch?: OpenDispatch[] };

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
  // Wave 35: a non-completed item whose owner failed reads `failed` (the TODO HUD's word, data/todos.ts todoState): the board never shows queued/blocked over a dead worker.
  if (ownerState === 'failed') return 'failed';
  if (ownerState === 'waiting' || ownerState === 'blocked') return 'blocked';
  return own;
}

/** A completed row whose first worker was killed and whose re-dispatch (`name #2`) succeeded (critique 19 A3: it read `closed · worker killed`). */
export const DONE_RETRIED = 'retried · done';
/** The word of a row the store still holds open (pending) while its worker failed: the glyph stays the store's, the word says why (critique 19 A3: it read `queued`). */
export const WORKER_DOWN = 'worker failed';
const INSTANCE = /^(.*\S) #(\d+)$/;

/** An owner's state across re-dispatches (critique 19 A3): the host names a second worker of one label `name #2`, so the row's owner `name` is judged by its LATEST
 * instance, not the killed first one. `retried`: the latest instance did not fail but an earlier one did. `as`: the latest instance's name (`name #2`). */
export function ownerOutcome(states: ReadonlyMap<string, UiState>, owner: string): { state?: UiState; retried: boolean; as: string } {
  let best: { n: number; name: string; state: UiState } | undefined;
  let earlierFailed = false;
  const own = states.get(owner);
  if (own) best = { n: 1, name: owner, state: own };
  for (const [name, state] of states) {
    const m = INSTANCE.exec(name);
    if (!m || m[1] !== owner) continue;
    const n = Number(m[2]);
    if (!best || n > best.n) { if (best?.state === 'failed') earlierFailed = true; best = { n, name, state }; } else if (n < best.n && state === 'failed') earlierFailed = true;
  }
  if (!best) return { retried: false, as: owner };
  return { state: best.state, retried: best.state !== 'failed' && earlierFailed, as: best.name };
}

/** Items whose state word is `blocked` under `itemState`, given each owner's state word. */
export const blockedCount = (items: readonly { status: string; owner?: string }[], owners: ReadonlyMap<string, UiState>): number =>
  items.filter((it) => itemState(it.status, it.owner ? ownerOutcome(owners, it.owner).state : undefined) === 'blocked').length;

/** `ran 03:10` for a finished item with both stamps, `elapsed` data for a running one with a claim time (its `of` only when the
 * item carries an estimate), else the evidence. An owner that failed or waits is named in front of the detail. */
export function toBoardRow(it: BoardSource, nowSecs?: number): BoardRow {
  const state = itemState(it.status, it.ownerState);
  // Named only when it adds to the item's own word (a failed owner already reads `failed`; a waiting owner reads `blocked` and is named).
  const ownerState = state !== 'done' && (it.ownerState === 'failed' || it.ownerState === 'waiting' || it.ownerState === 'blocked') && it.ownerState !== state ? it.ownerState : undefined;
  const ended = it.status === 'ended';
  // Critique 17 A1: a completed row whose worker failed or was killed reads `done` in the amber tone (the lead may have finished it), with the detail `worker failed`.
  const doubt = state === 'done' && it.ownerState === 'failed';
  const age = state !== 'done' && it.claimed_at && nowSecs !== undefined && nowSecs >= it.claimed_at ? { ageSecs: Math.round(nowSecs - it.claimed_at) } : {};
  // Critique 19 A3: a done row whose killed worker was re-dispatched and finished reads `retried · done`; a row the store still holds pending while its worker failed keeps the queued glyph and says `worker failed`.
  const retried = state === 'done' && !doubt && it.retried === true;
  const down = state === 'queued' && it.ownerState === 'failed';
  const base = { label: bare(it.content), state, ...age, ...(it.origin === 'dispatch' ? { dispatch: true as const } : {}), ...(ended ? { word: RETURNED } : doubt ? { word: DONE_DOUBT } : retried ? { word: DONE_RETRIED } : down ? { word: WORKER_DOWN } : {}), owner: it.owner ?? '', ...(ownerState ? { ownerState } : {}), ...(it.openDispatch?.length ? { openDispatch: it.openDispatch } : {}) };
  const ev = cleanEvidence(it.evidence);
  const detail = doubt ? '' : retried ? `retried${ev ? ` · ${ev}` : ''}` : ended ? `agent ended, row still open${ev ? ` · ${ev}` : ''}` : ownerState ? `owner ${ownerState}${ev ? ` · ${ev}` : ''}` : ev;
  if (state === 'done' && !doubt && !retried && it.claimed_at && it.completed_at && it.completed_at >= it.claimed_at) return { ...base, detail: `ran ${mmss(it.completed_at - it.claimed_at)}` };
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
  const opens: OpenDispatch[][] = []; // plan row index -> its open folded dispatch rows (named by the footer)
  for (const d of dispatch) {
    const at = d.owner ? firstOf.get(d.owner) : undefined;
    if (at === undefined) { alone.push(d); continue; }
    const p = folded[at]!;
    // An open dispatch row under a plan row that already reads done is the row Stop counts (critique 15 B5, stoprun f0090: the fold hid `tc9cd5be6` and the lead had to list the
    // board on the command line): it is never folded away, it is its own row with its owner, and the plan row stays as the lead closed it.
    if (finished(p.status) && !finished(d.status)) { if (d.ownerState === 'failed' && p.ownerState === undefined) folded[at] = { ...p, ownerState: 'failed' }; alone.push(d); continue; }
    count++;
    if (!finished(d.status)) { open++; (opens[at] ??= []).push({ title: bare(p.content), owner: d.owner! }); }
    if (finished(p.status)) { if (d.ownerState === 'failed' && p.ownerState === undefined) folded[at] = { ...p, ownerState: 'failed' }; continue; } // a finished row keeps its worker's failure: it reads `done`, amber
    const pick = p.status !== 'blocked' && !(p.status === 'pending' && d.status === 'failed') && (FOLD_RANK[d.status] ?? 0) > (FOLD_RANK[p.status] ?? 1) ? foldStatus(d.status) : p.status; // a plan row the lead marked blocked stays blocked under a failed dispatch row, and a pending one stays pending (its failed owner rides in ownerState)
    folded[at] = { ...p, status: pick, claimed_at: p.claimed_at ?? d.claimed_at, estimate_s: p.estimate_s ?? d.estimate_s, evidence: p.evidence || d.evidence, ownerState: p.ownerState ?? d.ownerState ?? (p.status === 'pending' && d.status === 'failed' ? 'failed' : undefined) };
  }
  opens.forEach((o, at) => { folded[at] = { ...folded[at]!, openDispatch: o }; });
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
export type BoardOpts = { cols: number; ui: Ui; rich?: boolean; tick?: number; /** The snapshot clock in epoch ms: the spinner turns the shared frame (spinFrameOf) of the row's owner, else of its label. Absent: `tick`. */ nowMs?: number; stateCol?: number; /** `boardLines`: how many dispatch rows were folded into plan rows; its footer names them. */ folded?: number; /** `boardLines`: how many of those folded dispatch rows are still open in the store; the footer then reads `N items · K dispatch open`. */ openFolded?: number; /** `boardLines`: draw the `ATLAS ▸ BOARD` ribbon and its blank row (default true). Off inside the side panel, which already has its own header: the footer then carries the one count. */ ribbon?: boolean; /** `boardLines`, ribbon off: false draws no title row either (the host's own ribbon names the board). */ title?: boolean; /** The label as drawn (already cut so rows with one shared head stay apart); absent: the row's own label. */ shown?: string; /** Compact form: the owner column's width (0 or absent: none). */ ownerW?: number; /** Compact form: the state column's width (the longest word on the board; absent: 7). */ wordW?: number; /** `boardLines`: the owner that does not fit beside its row is named in the notes under the rows, not on a line of its own. */ notes?: boolean; /** Compact form: a doubted done is drawn `closed · worker killed` in its state cell (boardBody sets it when the label still shows whole beside it). */ doubtWord?: boolean; /** Motion view (mod/motion.ts): a changed or new row is drawn mid-transition. Absent: the resting render. */ motion?: MotionCtx | undefined; /** The row's motion key (boardBody sets it from the row's position among its twins). */ key?: string; /** The side panel's board (wave 24): a summary row (`5 items · 3 dispatches` and a meter), every row's owner in one fixed right column that never wraps, a footer that records how the run closed. */ pane?: boolean; /** `pane`: every dispatch row of the store (folded or standing alone): the summary says it once. Absent: the folded count. */ dispatches?: number; /** `pane`: the last Stop verdict refused the stop: a closed dispatch row says `after Stop refusal`. */ stopRefused?: boolean };

const form = (cols: number): 'full' | 'compact' | 'narrow' => (cols >= FULL_MIN ? 'full' : cols >= NARROW_MIN ? 'compact' : 'narrow');

function detailRuns(row: BoardRow, o: BoardOpts, room: number): Run[] {
  if (row.elapsed) {
    const { secs, of } = row.elapsed;
    // The gauge and `of mm:ss` need a real estimate; without one the row says `elapsed 00:42` and draws no gauge.
    const tail = of === undefined ? mmss(secs) : `${mmss(secs)} of ${mmss(of)}`;
    if (of !== undefined && o.rich && !o.ui.ascii && room >= 8 + 10 + 1 + tail.length) return [r('elapsed ', 'muted'), ...meter(10, Math.min(1, secs / Math.max(1, of)), o.ui), r(` ${tail}`, 'sub')];
    return [r(clipE(`elapsed ${tail}${row.detail ? `  ${row.detail}` : ''}`, room), 'sub')];
  }
  return row.detail ? [r(clipE(row.detail, room), 'sub')] : [];
}

/** One row, mid-transition when `o.motion` holds an entry for `o.key`. */
export function boardRow(row: BoardRow, focus: boolean, o: BoardOpts): Run[] {
  const runs = boardRowResting(row, focus, o);
  return o.key === undefined ? runs : animateRow(runs, o.key, accentOf(row), o.motion, o.ui, { reveal: false });
}

/** The accent a row's motion leads with: its state, except a doubted done (critique 17 A1), which leads amber and never pops the done disc. */
const accentOf = (row: BoardRow): MarkState => (markOf(row.state, row.word) === 'doubt' ? 'doubt' : row.state);
/** The motion keys of `rows`, one per row, a repeated label numbered. */
const boardKeys = (rows: readonly BoardRow[]): string[] => keysOf('board', rows.map((x) => x.label));
/** What the Motion observes of a board: each row's key and state word. */
export const boardMotionItems = (rows: readonly BoardRow[]): MotionItem[] => boardKeys(rows).map((key, i) => ({ key, state: motionState(rows[i]!.state, rows[i]!.word) }));

/** Labels cut to `w` cells for one list: a label that fits stays whole, a longer one loses its end (`clip` ends in `…`). Never the front, never the
 * middle: rows with one shared head stay apart by their owner column, not by a different cut. */
export function labelCut(labels: readonly string[], w: number): string[] {
  return labels.map((l) => clipE(l, w));
}

/** The state cell's text where the pane has room to spell a long word (`closed · worker killed`, `retried · done`, `worker failed`), and where it does not (the row's own state word; the detail and the notes say the rest). */
const spelledWord = (row: BoardRow): string => (markOf(row.state, row.word) === 'doubt' ? KILLED : row.word ?? row.state);
// Wave 30 (critique 28): one word for a worker that did not finish, `killed`: a closed row, a failed one and its owner read the same.
// The Board shared with the HUD keeps its item word (`failed`); the side panel's board pane (`pane`) says `killed`.
/** Wave 34 (critique 33: T2 `blocked` over a bar and a recent post that said `failed`): a row that is not done and whose worker failed reads `failed` on the side panel's board, whatever word the lead gave the row. */
export const ownerDown = (row: BoardRow): boolean => row.ownerState === 'failed' && row.state !== 'done';
const plainWord = (row: BoardRow, pane = false): string => {
  if (pane && ownerDown(row)) return KILLED;
  const w = markOf(row.state, row.word) === 'doubt' ? KILLED : row.word === DONE_RETRIED ? 'done' : row.word === WORKER_DOWN ? row.state : row.word ?? row.state;
  return pane ? wordOf(w) : w;
};
const isSpelled = (row: BoardRow): boolean => markOf(row.state, row.word) === 'doubt' || row.word === DONE_RETRIED || row.word === WORKER_DOWN;

/** A row's state mark: the `■` in error 203 for a killed worker's row (wave 30: it was the done disc, and read `closed`), the state's own glyph otherwise; a working mark is the accent. */
function markRun(row: BoardRow, o: BoardOpts): Run {
  const doubt = markOf(row.state, row.word) === 'doubt' || (!!o.pane && ownerDown(row));
  const frame = o.nowMs !== undefined ? (o.pane ? sharedSpinFrame(o.nowMs) : spinFrameOf(o.nowMs, row.owner || row.label)) : o.tick ?? 0; // the pane's braille is the band's frame (motion.sharedSpinFrame)
  const g = stateRun(doubt ? 'failed' : markOf(row.state, row.word), o.ui, frame, !!o.pane); // the side panel's spinner is the braille family
  return row.state === 'running' && !o.ui.ascii ? { ...g, tone: 'accent' } : g;
}

/** One row at rest. `focus` marks the row the marker `▸` points at. */
function boardRowResting(row: BoardRow, focus: boolean, o: BoardOpts): Run[] {
  const f = form(o.cols);
  const doubt = markOf(row.state, row.word) === 'doubt';
  // Critique 25: a killed worker's row reads `closed` in error red (203) on every surface, glyph and word alike (the ● disc stays: the scorer's truth for the closed dispatch row is completed).
  const mark = stateRun(markOf(row.state, row.word), o.ui, o.nowMs !== undefined ? spinFrameOf(o.nowMs, row.owner || row.label) : o.tick ?? 0);
  const head: Run[] = [focus ? r(o.ui.ascii ? '>' : '▸', 'accent', { bold: true }) : r(' '), r(' '), doubt && !o.ui.ascii ? { ...mark, tone: 'bad' } : mark, r(' ')];
  // Full form: done dim (never struck through: the HUD draws none), the focus bold. The 80 mock draws labels plain (text), the 40 mock dims a done one (sub).
  const text = o.shown ?? row.label;
  const labelRun = (w: number): Run =>
    f === 'full' ? (row.state === 'done' && markOf(row.state, row.word) !== 'doubt' ? r(clipE(text, w), 'sub') : r(clipE(text, w), 'text', { bold: focus }))
      : r(clipE(text, w), f === 'narrow' && row.state === 'done' ? 'sub' : 'text');
  if (f === 'narrow') return [...head, labelRun(Math.max(1, o.cols - 4))];
  const stateCol = f === 'full' ? COL.state : (o.stateCol ?? COL.stateCompact);
  const withLabel = to([...head, labelRun(stateCol - 5)], stateCol);
  const word = o.doubtWord ? spelledWord(row) : plainWord(row);
  if (f === 'compact') return o.ownerW && row.owner ? [...to([...withLabel, r(word)], stateCol + (o.wordW ?? STATE_W) + 2), r(clipE(row.owner, o.ownerW), 'sub')] : [...withLabel, r(word)];
  const stateCell = o.rich ? (row.word ? chip(word, row.word === RETURNED ? 'text' : markToken(markOf(row.state, row.word)), o.ui) : stateChip(row.state, o.ui)) : r(word, doubt ? 'bad' : row.word === RETURNED ? 'sub' : 'text');
  const withState = to([...withLabel, stateCell], COL.owner);
  const owner = to([...withState, ...(row.owner ? [r(clipE(row.owner, OWNER_W), 'sub')] : [])], COL.detail);
  return [...owner, ...detailRuns(row, o, Math.max(0, o.cols - COL.detail - 1))];
}

/** `ITEM  STATE  OWNER  DETAIL`, full form only. */
export function boardHeader(): Run[] {
  const h = (t: string): Run => r(t, 'muted');
  return [...to([...to([...to([h('ITEM')], COL.state), h('STATE')], COL.owner), h('OWNER')], COL.detail), h('DETAIL')];
}

export type BoardLine = { runs: Run[] };

/** The HUD's title rule is the light `─` in the line tone; atlas-ui's ribbon() fills with the heavy `━`. Every ribbon the board and the side panel draw swaps its fill for the HUD's (critique 22: two rule weights on one screen). */
export const lightRibbon = (runs: Run[], ui: Pick<Ui, 'ascii'>): Run[] => (ui.ascii ? runs : runs.map((x) => (/^━+$/.test(x.t) ? { ...x, t: '─'.repeat(x.t.length), tone: 'line' as Run['tone'], fg: '#303030' } : x))); // wave 32 (critique 30): the divider is the 236 grey in every run state

/** Column geometry of the compact and narrow forms for `rows` at `o.cols`: the state column, the owner column beside the rows (0: it does not fit) and whether a doubted done spells its words in the state cell. */
function geometry(rows: readonly BoardRow[], o: BoardOpts): { compact: boolean; ownerAll: number; ownerW: number; wordW: number; stateColC: number | undefined; labelW: number; doubtWord: boolean } {
  const compact = form(o.cols) === 'compact';
  const ownerAll = compact ? Math.min(OWNER_W, Math.max(0, ...rows.map((x) => cells(x.owner)))) : 0;
  // The owner column drops before any title is cut (critique 8: `T4 combine th...` beside `alpha...`): it stays only while the widest title still shows
  // whole beside it (head 4 + title + gap, the state word, a gap), and so a title keeps at least LABEL_MIN cells before any owner cell shows.
  const widest = Math.max(0, ...rows.map((x) => cells(x.label)));
  // The state column is as wide as the longest word on this board (a board of `done` rows needs 4 cells, not the 7 of `running`), so a title keeps those cells.
  const plainW = Math.min(STATE_W, Math.max(4, ...rows.map((x) => cells(x.word ?? x.state))));
  // Critique 18 B2: a doubted done says `closed · worker killed` in its state cell where the title still shows whole beside it; narrower panes say it in the notes under the rows.
  const spelledW = Math.max(0, ...rows.filter(isSpelled).map((x) => cells(spelledWord(x))));
  const doubtWord = compact && spelledW > 0 && o.cols - spelledW >= widest + 5; // +5 since the spelled word grew two cells (`closed`, critique 25) and the 60 pane must still say it
  const wordW = doubtWord ? spelledW : plainW;
  const ownerFit = Math.min(ownerAll, o.cols - Math.max(widest, LABEL_MIN) - 5 - wordW - 1 - 1);
  // Titles the row cuts anyway keep the owner only when, without it, the cut titles would read the same (one shared head): the owner then tells the rows apart,
  // and the title keeps LABEL_MIN cells beside it (the old rule). Cut titles that stay distinct on their own never trade cells for an owner.
  const cutBare = rows.map((x) => clipE(x.label, o.cols - 13));
  const apart = new Set(cutBare).size === cutBare.length;
  const sharedHead = o.cols >= COMPACT_MIN ? ownerAll : Math.min(ownerAll, o.cols - (LABEL_MIN + 5) - wordW - 2);
  // Critique 19 C1: the owner column holds a whole name or nothing (`alpha-exp...` with 15 blank cells before it): where the widest owner does not fit, every owner stands on the sub-line under its row.
  const ownerW = ownerFit >= ownerAll ? ownerAll : compact && !apart && sharedHead >= ownerAll ? ownerAll : 0;
  // Compact: the owner column takes its width from the right, the state column slides left to make room (never under 26 at 60+, never past the widest label).
  // The state word ends on the panel's last cell, as a value column does (or the owner does, two cells after the word): a title that fills the column keeps two blank cells before it.
  const avail = o.cols - wordW - (ownerW ? ownerW + 2 : 0);
  const stateColC = compact ? Math.max(Math.min(COL.stateCompact, avail), Math.min(avail, widest + 7)) : undefined;
  const labelW = form(o.cols) === 'narrow' ? Math.max(1, o.cols - 4) : (stateColC ?? COL.state) - 5;
  return { compact, ownerAll, ownerW, wordW, stateColC, labelW, doubtWord };
}

/** The rows alone: the header (full form) and one line per item. The band's inline board slot draws these. An owner that does not fit beside its row (the 110 pane is 36 cells) stands
 * under its row, indented, so every row that has one names it (critique 15 B5); the board pane (`o.notes`) never wraps it onto a line of its own (critique 18 B5): `boardNotes` names it under the rows. */
export function boardBody(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  if (o.pane) return paneBody(rows, o);
  const focus = rows.findIndex((x) => x.focus ?? x.state === 'running');
  const keys = o.motion ? boardKeys(rows) : [];
  const g = geometry(rows, o);
  const shown = labelCut(rows.map((x) => x.label), g.labelW);
  const stacked = g.compact && g.ownerAll > 0 && g.ownerW === 0;
  const lines = rows.flatMap((row, i): BoardLine[] => {
    const own = { runs: boardRow(row, i === focus, { ...o, stateCol: g.stateColC, shown: shown[i]!, wordW: g.wordW, ...(g.doubtWord ? { doubtWord: true } : {}), ...(g.ownerW ? { ownerW: g.ownerW } : {}), ...(o.motion ? { key: keys[i]! } : {}) }) };
    if (!g.compact) return [own];
    const owner = stacked ? row.owner : '';
    // The board pane (`o.notes`) puts the row's reason and age on that sub-line too (critique 19 C1): the pane's room says why a row is open, beside the owner that holds it.
    const note = o.notes === true && stacked ? noteOf(row, g.doubtWord) : '';
    return owner || note ? [own, ...subLines(owner, note, row, o.cols)] : [own];
  });
  return form(o.cols) === 'full' ? [{ runs: boardHeader() }, ...lines] : lines;
}


// ---- the side panel's board (wave 24) ------------------------------------------------------------------------------------

const PANE_OWNER_MIN = 8; // an owner column narrower than this names nobody: it is dropped
const PANE_SUFFIX_MIN = 5; // a suffix shorter than this says nothing: it is dropped, not cut to `o…`
const PANE_GUTTER = 2; // cells between the title, the state word and the owner
/** Wave 36 (critique 35: lead-owned items drew no owner): a plan item no worker holds is the lead's, said in the owner column in the secondary grey; a dispatch row that stands alone names its own owner or none. */
const LEAD = 'lead';
const paneOwner = (x: BoardRow): string => x.owner || (x.dispatch ? '' : LEAD);

/** The one summary every count on the board reads from: plan items (never a dispatch row that stands alone) and every dispatch row of the store. */
export function boardSummary(rows: readonly BoardRow[], dispatches?: number): { items: number; dispatches: number; done: number } {
  const plan = rows.filter((x) => !x.dispatch);
  return { items: plan.length, dispatches: dispatches ?? rows.filter((x) => x.dispatch).length, done: plan.filter((x) => x.state === 'done').length };
}

/** Column geometry of the pane's rows: the title column, the state word column and the owner column, one set for every row. The owner is cut with `…`, never wrapped onto a second line.
 * A narrow pane whose rows are all done drops the word column (the mark, the dim title and the meter say it); an owner column gives cells up only until the title keeps 16. */
function paneGeometry(rows: readonly BoardRow[], cols: number): { labelW: number; wordW: number; ownerW: number } {
  // Wave 36 (critique 35): the plan titles set the column; a long dispatch prompt is cut to it, so it never takes the owner column from the items it names.
  const widest = Math.max(1, ...(rows.some((x) => !x.dispatch) ? rows.filter((x) => !x.dispatch) : rows).map((x) => cells(x.label)));
  const quiet = cols < 46 && rows.every((x) => x.state === 'done');
  const wordW = quiet ? 0 : Math.min(STATE_W, Math.max(4, ...rows.map((x) => cells(plainWord(x, true)))));
  const ownerAll = Math.min(OWNER_W, Math.max(0, ...rows.map((x) => cells(paneOwner(x)))));
  const budget = cols - 1 - 4 - (wordW ? PANE_GUTTER + wordW : 0); // right margin, head, the gutter and the word column: what titles and owners share
  // Titles first: the owner column is dropped before a title is cut, and gets only the cells left once the widest title shows whole (critique 22: `T4 combine the r...` beside an owner).
  const left = budget - widest - PANE_GUTTER;
  if (!ownerAll || left < PANE_OWNER_MIN) return { labelW: Math.max(1, Math.min(widest, budget)), wordW, ownerW: 0 };
  return { labelW: widest, wordW, ownerW: Math.min(ownerAll, left) };
}

function paneRow(row: BoardRow, focus: boolean, o: BoardOpts, g: ReturnType<typeof paneGeometry>): Run[] {
  const doubt = markOf(row.state, row.word) === 'doubt' || ownerDown(row);
  // Critique 25: a killed worker's row reads `closed` in error red (203) on every surface, glyph and word alike (the ● disc stays: the scorer's truth for the closed dispatch row is completed).
  const mark = markRun(row, o);
  const head: Run[] = [focus ? r(o.ui.ascii ? '>' : '▸', 'accent', { bold: true }) : r(' '), r(' '), mark, r(' ')];
  const title = clipE(row.label, g.labelW);
  const gutter = r(' '.repeat(PANE_GUTTER));
  const out: Run[] = [...head, r(title + ' '.repeat(Math.max(0, g.labelW - cells(title))), row.state === 'done' && !doubt ? 'sub' : 'text', { bold: focus })];
  if (g.wordW) { const word = clipE(plainWord(row, true), g.wordW); out.push(gutter, r(word + ' '.repeat(Math.max(0, g.wordW - cells(word))), doubt ? 'bad' : rowWordTone(row.state, row.word))); }
  // The reason (`owner failed`, `worker killed`) and the age ride the same row as a dim suffix, cut with `…` to the room left: never a row of its own (critique 22: `owner failed` wrapped under T2).
  // Where the owner column leaves no room for it, the reason takes the owner's cell: why a row is open says more than who holds it.
  const suffix = noteOf(row, false).replace(ownerDown(row) ? /^owner failed( · )?/ : /^$/, ''); // the word says it: no `owner failed` after `failed`
  const used = (): number => out.reduce((n, x) => n + cells(x.t), 0);
  if (g.ownerW) {
    const who = paneOwner(row);
    const owner = clipE(who, g.ownerW);
    const roomAfter = o.cols - 1 - (used() + PANE_GUTTER + g.ownerW) - PANE_GUTTER;
    if (suffix && !ownerDown(row) && row.state !== 'failed' && !!row.owner && roomAfter < Math.min(cells(suffix), PANE_SUFFIX_MIN + 8)) { // a failed worker's name stays: who failed says more than how long the row has been open (wave 36: a failed row says `failed`, so its owner is the one fact left); the lead's rows keep `lead`
      const w = g.ownerW;
      const reason = clipE(suffix.split(' · ')[0]!, w);
      out.push(gutter, r(reason + ' '.repeat(Math.max(0, w - cells(reason))), 'dim'));
      return out;
    }
    out.push(gutter, r(owner + ' '.repeat(Math.max(0, g.ownerW - cells(owner))), who === LEAD && !row.owner ? 'sub' : 'dim'));
  }
  const room = o.cols - 1 - used() - PANE_GUTTER;
  if (suffix && room >= (cells(suffix) <= room ? 1 : PANE_SUFFIX_MIN + 3)) out.push(gutter, r(clipE(suffix, room), 'dim'));
  return out;
}

/** The pane's rows: one line per item: the title, a 2-cell gutter, the state word, the owner dim, and the reason as a dim suffix. */
function paneBody(rows0: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  // Wave 35 (critique 34: `T1 read alpha.py (alpha…` at 110): a title loses its `(owner)` tail whole before any title is cut. Wave 36: always, in this pane: the owner column (or the status and team views, where it does not fit) names the worker once.
  // Wave 37 (critique 36: `T5 write the final summ…` at 110): the tail also goes when it names the lead or an agent by its role (`(lead)`, `(gamma-explorer)`), and the name it carried moves to the owner column.
  const tailOf = (x: BoardRow): string => { const m = /\s+\(([a-z][a-z0-9]*(?:-[a-z0-9]+)*(?: #\d+)?)\)$/.exec(x.label); return m && (m[1] === x.owner || m[1] === LEAD || /-(?:explorer|implementer|verifier|planner|runner|reviewer|critic|engineer|curator|auditor|tester|writer|researcher)(?: #\d+)?$/.test(m[1]!)) ? m[1]! : ''; };
  const rows = rows0.some((x) => tailOf(x)) ? rows0.map((x) => { const t = tailOf(x); return t ? { ...x, label: x.label.slice(0, x.label.lastIndexOf(` (${t})`)).trimEnd(), owner: x.owner || (t === LEAD ? '' : t) } : x; }) : rows0;
  const g = paneGeometry(rows, o.cols);
  const focus = rows.findIndex((x) => x.focus ?? x.state === 'running');
  const keys = o.motion ? boardKeys(rows) : [];
  return rows.map((row, i): BoardLine => ({ runs: boardRowKeyed(paneRow(row, i === focus, o, g), row, o, keys[i]) }));
}
/** Wave 34 (critique 33: a dispatch row stood in the item list under `5 items · 3 dispatches`): the items, then a `dispatches` group of its own for the rows no plan row owns. One column set for both. */
function paneGroups(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  const lines = paneBody(rows, o);
  const first = rows.findIndex((x) => x.dispatch);
  if (first < 0) return lines;
  return [...lines.slice(0, first), { runs: [r(' ')] }, { runs: [r('  dispatches', 'muted', { bold: true })] }, ...lines.slice(first)];
}
const boardRowKeyed = (runs: Run[], row: BoardRow, o: BoardOpts, key?: string): Run[] => (key === undefined ? runs : animateRow(runs, key, accentOf(row), o.motion, o.ui, { reveal: false }));

/** `text` on rows of at most `width` cells, broken on spaces (a word wider than a row is cut with `…`); `first` leads the first row, `rest` every later one. */
function wordRows(text: string, width: number, first: string, rest: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(' ').filter(Boolean)) {
    const lead = out.length ? rest : first;
    const next = cur ? `${cur} ${w}` : w;
    if (cells(lead + next) <= width) { cur = next; continue; }
    if (cur) out.push((out.length ? rest : first) + cur);
    cur = w;
  }
  if (cur) out.push((out.length ? rest : first) + cur);
  return out.map((t) => clipE(t, Math.max(1, width)));
}

/** `T2` of `T2 read ghost.py`: the plan row's own id, else its whole title. */
const rowId = (label: string): string => /^T\d+\b/i.exec(label.trim())?.[0] ?? label.trim();

/** The HUD's plan meter (hud-surface meterRuns, which cannot be imported here): 8 cells, 114 for the items done, one 203 cell per failed item, the rest muted. A failed item never reads as a full green meter. */
function planMeter(done: number, total: number, failed: number, ui: Pick<Ui, 'ascii'>): Run[] {
  const w = TODO_METER_W;
  const bad = Math.min(w, Math.max(0, failed));
  const full = total > 0 && done + bad >= total;
  const on = total <= 0 ? 0 : full ? w - bad : Math.min(w - 1 - bad, Math.max(done > 0 ? 1 : 0, Math.round((w * done) / total)));
  const [a, b] = ui.ascii ? [GLYPH5_ASCII.meterOn, GLYPH5_ASCII.meterOff] : [GLYPH5.meterOn, GLYPH5.meterOff];
  const fill = (t: string, tone: Run['tone']): Run => ({ t, tone });
  return [fill(a.repeat(Math.max(0, on)), 'ok'), ...(bad > 0 ? [fill((ui.ascii ? '!' : a).repeat(bad), 'bad')] : []), fill(b.repeat(Math.max(0, w - Math.max(0, on) - bad)), 'muted')].filter((x) => x.t !== '');
}

/** The summary row: `5 items · 3 dispatches` and a `▰▱` meter of the items done, the meter on the right edge when it fits. */
function paneSummary(rows: readonly BoardRow[], o: BoardOpts): BoardLine {
  // Wave 37 (critique 36: `2 dispatches` over one listed row): the count is the rows the pane lists, a folded dispatch row is not one of them.
  const s = boardSummary(rows, o.dispatches);
  const dot = o.ui.ascii ? '|' : '·';
  const text = `  ${s.items} item${s.items === 1 ? '' : 's'}${s.dispatches > 0 ? ` ${dot} ${s.dispatches} dispatch${s.dispatches === 1 ? '' : 'es'}` : ''}`;
  const w = TODO_METER_W; // the HUD's meter: 8 cells, ok green (atlas-ui todoMeter)
  const failed = rows.filter((x) => !x.dispatch && x.state !== 'done' && (x.state === 'failed' || ownerDown(x))).length;
  const bar = o.cols - 1 - cells(text) - 2 >= w ? [r(' '.repeat(o.cols - 1 - cells(text) - w)), ...planMeter(s.done, s.items, failed, o.ui)] : [];
  return { runs: [r(text, 'text', { bold: true }), ...bar] };
}

/** One agent on the board's timeline: its name, state, how long it has run, and (for the Gantt) when it started and ended, in the snapshot clock's ms; `calls` are its tool-call times (the activity row under its bar). */
export type TimelineAgent = { name: string; state: UiState; secs?: number | undefined; startMs?: number | undefined; endMs?: number | undefined; calls?: readonly number[] | undefined };

const clock = (secs: number): string => elapsedClock(secs); // `0:14`, the HUD's LAST figure

/** The bar's tone: running in the accent (141), done in ok (114), failed in error (203), blocked in warn (179). */
const barTone = (s: UiState): Run['tone'] => (s === 'running' ? 'accent' : s === 'done' ? 'ok' : s === 'failed' ? 'bad' : s === 'blocked' || s === 'waiting' ? 'warn' : 'sub');

const PARTIAL = ' ▏▎▍▌▋▊▉'; // eighths of a cell, left aligned: the end of a bar is exact to 1/8 cell, so a running bar grows smoothly
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const RULE_FG = '#303030'; // 236: the divider grey (PALETTE5.rule), never the 240 text grey

/** Wave 30 (critique 28: 45% of the pane blank under the axis, hairline bars with no fill or ticks, nothing moving). The board's timeline is a chart:
 * one row per agent with a SOLID bar (`█`, the end exact to an eighth of a cell) in the state colour, a time axis with tick marks and labels, and, with room, the agent's activity (a sparkline of its tool calls
 * over the same axis) on the row under its bar. A running agent's bar ends at the clock (`nowMs`) and carries a pulsing leading edge, so it grows and moves while its worker runs.
 * Every bar starts where its agent started (the run's first start is the left edge). A queued agent has no run to draw and is left off. `max` caps the rows; none when there is no room for a name and a bar.
 * A row's `motion` key is `worker:<name>` (the panel's own), so a new or changed agent fades in with the rest of the pane (motion.ts). `spark: false` leaves the activity rows off; `spacers` puts a blank row between agents. */
export function boardTimeline(agents: readonly TimelineAgent[], o: Pick<BoardOpts, 'cols' | 'ui' | 'nowMs' | 'tick' | 'motion'> & { spark?: boolean; spacers?: boolean; /** Wave 36 (critique 35: ~25% of the live board blank above the footer): each bar is two rows tall where the pane has the rows for it. */ tall?: boolean; /** Agents whose failure a plan row already says: their bar keeps its colour and draws no `■` at its end. */ quiet?: ReadonlySet<string>; /** Wave 37 (critique 36: beta's bar missing while the footer counted its calls): draw every agent or nothing, so the caller can pick a denser layout than one that drops a bar. */ all?: boolean; /** Wave 37 (critique 36: the axis stopped at 0:30 under a 0:36 total): the run's length on the band's clock; the axis runs one tick past it. */ runSecs?: number }, max = 12): BoardLine[] {
  const ran = agents.filter((a) => a.state !== 'queued').map((a, i) => ({ a, i })).sort((x, y) => (x.a.startMs ?? 0) - (y.a.startMs ?? 0) || x.i - y.i).map((x) => x.a); // start order (alpha, beta, ghost), never reversed
  if (!ran.length || max < 3) return [];
  const live = (a: TimelineAgent): boolean => a.state === 'running' && o.nowMs !== undefined;
  const spanOf = (a: TimelineAgent): { from: number; to: number } => {
    const from = a.startMs ?? 0;
    const to = live(a) ? Math.max(from, o.nowMs!) : a.endMs !== undefined && a.endMs >= from ? a.endMs : a.startMs !== undefined ? from + (a.secs ?? 0) * 1000 : (a.secs ?? 0) * 1000;
    return { from, to };
  };
  const spans = ran.map(spanOf);
  const t0 = Math.min(...spans.map((x) => x.from));
  const spanMs = Math.max(1000, Math.max(...spans.map((x) => x.to)) - t0, o.runSecs !== undefined && Number.isFinite(o.runSecs) ? o.runSecs * 1000 : 0);
  const nameW = Math.min(o.cols >= 50 ? 20 : 14, Math.max(...ran.map((a) => cells(a.name))));
  const callsLabel = (a: TimelineAgent): string => { const n = (a.calls ?? []).length; return n ? `${n} ${n === 1 ? 'call' : 'calls'}` : ''; }; // the count says what it counts (critique 29: a bare `2 3 4`)
  const timeW = Math.max(4, ...spans.map((x) => cells(clock((x.to - x.from) / 1000))));
  const barW = o.cols - 1 - 2 - nameW - 1 - 1 - timeW - 1 - 1; // margin, lead, name, gap, (bars), gap, time, gap, glyph
  if (barW < 8) return [];
  const ascii = o.ui.ascii;
  const frame = o.nowMs !== undefined ? spinFrameOf(o.nowMs) : o.tick ?? 0;
  // The axis: ticks at a round step, as many as the labels have room for (a label is at most 4 cells and a gap).
  const spanSecs = spanMs / 1000;
  const labelW = cells(clock(Math.ceil(spanSecs) + 5));
  const step = TICK_STEPS.find((t) => t >= 5 && Math.floor(spanSecs / t) + 1 <= Math.max(2, Math.floor(barW / (labelW + 2)))) ?? TICK_STEPS[TICK_STEPS.length - 1]!; // a tick every 5 s while a label and a two-cell gap fit
  // While a worker runs the axis ends at the next tick past the clock, so its bar grows inside a steady scale and the leading edge has a cell to pulse in; a finished run's axis is exactly its length.
  const total = (Math.floor(spanSecs / step) + 1) * step * 1000; // the axis always runs past the longest bar (critique 29: it stopped at 0:10 under bars to 0:13)
  const totalSecs = total / 1000;
  // Wave 33 (critique 31: `┬────────┬─────────┬`, ticks 9 and 10 cells apart): the axis is an integer number of cells per step, so every tick sits the same distance from the one before it; the bars draw over the same `plotW` cells.
  const pitch = Math.max(1, Math.floor(barW / (total / (step * 1000))));
  const plotW = pitch * (total / (step * 1000));
  const tickCols = new Set<number>();
  // Wave 32 (critique 30: `0:15 0:20` collided, dotted columns ran past the bars): a tick sits only where a bar has run (at or before the longest bar's end), never past it.
  // Wave 36 (critique 35: the 110 axis stopped at `0:15` under a 0:26 bar): the axis runs one tick past the longest bar and every tick up to that last one is drawn, so the labels cover the whole span.
  for (let k = 0; k * step <= totalSecs; k++) tickCols.add(k * pitch);
  const lead = ' '.repeat(2 + nameW + 1);
  const rows = Math.min(ran.length, Math.max(1, Math.floor((max - 2) / ((o.spark ? 2 : 1) + (o.tall ? 1 : 0) + (o.spacers ? 1 : 0)))));
  if (o.all && rows < ran.length) return [];
  const out: BoardLine[] = [];
  ran.slice(0, rows).forEach((a, i) => {
    const { from, to } = spans[i]!;
    const startCell = Math.min(plotW - 1, Math.floor((plotW * (from - t0)) / total));
    const endE = Math.max(startCell * 8 + 1, Math.round((8 * plotW * (to - t0)) / total)); // end in eighths of a cell
    const tone = barTone(a.state);
    const grid: Run[] = [];
    for (let c = 0; c < barW; c++) {
      const covered = Math.max(0, Math.min(8, endE - c * 8));
      if (c >= startCell && covered > 0) {
        const full = covered === 8;
        grid.push({ t: ascii ? '#' : full ? '█' : PARTIAL[covered]!, tone });
      } else if (live(a) && c === Math.ceil(endE / 8) && c >= startCell) grid.push({ t: ascii ? '+' : Math.floor(frame / 3) % 2 === 0 ? '▓' : '▒', tone }); // the leading edge: a pulsing shade just ahead of the fill
      else grid.push({ t: ' ', tone: 'text' }); // no dotted tick column: the axis row carries the ticks, each with its label
    }
    // One run per colour: adjacent cells of one tone join.
    const bar = grid.reduce<Run[]>((acc, x) => { const l = acc[acc.length - 1]; if (l && l.tone === x.tone && l.fg === x.fg) l.t += x.t; else acc.push({ ...x }); return acc; }, []);
    const name = clipE(a.name, nameW);
    const runs: Run[] = [
      r('  '), r(name + ' '.repeat(nameW - cells(name)), 'sub'), r(' '), ...bar, r(' '),
      r(clock((to - from) / 1000).padStart(timeW), 'dim'), r(' '), a.state === 'failed' && o.quiet?.has(a.name) ? r(' ') : stateRun(a.state, o.ui, o.nowMs !== undefined ? sharedSpinFrame(o.nowMs) : frame, true),
    ];
    if (o.spacers && i > 0) out.push({ runs: [r(' ')] });
    out.push({ runs: o.motion ? animateRow(runs, `worker:${a.name}`, a.state === 'done' ? 'done' : a.state === 'failed' ? 'failed' : 'running', o.motion, o.ui, { reveal: false }) : runs });
    if (o.tall) out.push({ runs: [r(' '.repeat(2 + nameW + 1)), ...bar] }); // the same bar again under the first row: a solid two-row block
    if (o.spark) out.push({ runs: [r(lead), r(' '.repeat(startCell)), r(callsLabel(a), 'dim')] }); // wave 34 (critique 33: tick stems hung under every bar): the calls are a caption under the bar's start, no sparkline
  });
  // The axis: a rule with a tick (`┬`) at every labelled second, the labels under it.
  // Every tick has its label and every label two clear cells after the one before it; a tick whose label would not fit is not drawn (a stub with no legend is left off).
  const labelW2 = barW + 1 + timeW + 1; // the last label may run on into the time column: the axis is the row's width, not the bar's
  const labels = new Array<string>(labelW2).fill(' ');
  const labelled = new Set<number>();
  let free = 0;
  for (const c of [...tickCols].sort((x, y) => x - y)) {
    const k = Math.round(c / pitch);
    const text = clock(k * step);
    if (c < free || c + text.length > labelW2) continue;
    [...text].forEach((ch, j) => { labels[c + j] = ch; });
    labelled.add(c);
    free = c + text.length + 2;
  }
  const rule = Array.from({ length: Math.max(barW, plotW + 1) }, (_, c) => (labelled.has(c) ? (ascii ? '+' : '┬') : ascii ? '-' : '─')).join('');
  out.push({ runs: [r(lead), { t: rule, tone: 'line', fg: RULE_FG }] });
  out.push({ runs: [r(lead), r(labels.join('').trimEnd(), 'dim')] });
  return out;
}

/** The board's totals line under the chart: a count per state and the run's length, `● 2 done  ■ 1 failed  ◐ 0 running · total 0:27`. */
export function boardTotals(agents: readonly TimelineAgent[], o: Pick<BoardOpts, 'cols' | 'ui' | 'nowMs' | 'tick'> & { runSecs?: number; /** A plan row on the board already says `failed`: the totals do not count it again. */ hideFailed?: boolean }): BoardLine[] {
  const ran = agents.filter((a) => a.state !== 'queued');
  if (!ran.length) return [];
  const n = (s: UiState): number => ran.filter((a) => a.state === s).length;
  const frame = o.nowMs !== undefined ? sharedSpinFrame(o.nowMs) : o.tick ?? 0;
  const parts: Run[] = [];
  for (const s of ['running', 'done', 'failed', 'blocked', 'waiting'] as const) {
    if (!n(s) || (s === 'failed' && o.hideFailed)) continue;
    const g = stateRun(s, o.ui, frame, true); // a working mark is the band's braille (wave 32)
    parts.push(...(parts.length ? [r('  ')] : []), { ...g, tone: s === 'running' && !o.ui.ascii ? 'accent' : g.tone }, r(` ${n(s)} ${s}`, n(s) ? 'text' : 'muted'));
  }
  const starts = ran.map((a) => a.startMs).filter((x): x is number => typeof x === 'number');
  const ends = ran.map((a) => (a.state === 'running' && o.nowMs !== undefined ? o.nowMs : a.endMs)).filter((x): x is number => typeof x === 'number');
  const own = starts.length && ends.length ? Math.max(0, Math.floor((Math.max(...ends) - Math.min(...starts)) / 1000)) : 0;
  const secs = o.runSecs ?? own; // the band's run clock when the caller has it: one total on every surface (critique 29)
  const calls = ran.reduce((k, a) => k + (a.calls?.length ?? 0), 0);
  const dot = o.ui.ascii ? '|' : '·';
  const total: Run[] = secs > 0 ? [r(`  ${dot} `, 'muted'), r('total ', 'muted'), r(clock(secs), 'text', { bold: true }), ...(calls ? [r(` ${dot} ${calls} worker calls`, 'muted')] : [])] : [];
  return [{ runs: [r('  '), ...parts, ...total] }];
}

/** Wave 35 (critique 34: `● 2   ■ 1   ·total0:3 · 8 tool` at 110): the board's one footer row, a count per state (failed ones too), the run's time and its calls, in the longest of five forms that fits `cols - 1` cells:
 * `● 2 done  ■ 1 failed  · total 0:31 · 8 tool calls`, the same with `0:31 · 8 calls`, then glyph and count alone (`● 2 ■ 1 · 0:31 · 8 calls`), then without the calls, then the counts. Fixed gutters: two cells between counts in the
 * word forms, one in the short ones. */
export function boardFootLine(agents: readonly TimelineAgent[], o: Pick<BoardOpts, 'cols' | 'ui' | 'nowMs' | 'tick'> & { runSecs?: number }): BoardLine | null {
  const ran = agents.filter((a) => a.state !== 'queued');
  if (!ran.length) return null;
  const frame = o.nowMs !== undefined ? sharedSpinFrame(o.nowMs) : o.tick ?? 0;
  const dot = o.ui.ascii ? '|' : '·';
  const counts = (['running', 'done', 'failed', 'blocked', 'waiting'] as const).map((s) => ({ s, n: ran.filter((a) => a.state === s).length })).filter((x) => x.n > 0);
  const starts = ran.map((a) => a.startMs).filter((x): x is number => typeof x === 'number');
  const ends = ran.map((a) => (a.state === 'running' && o.nowMs !== undefined ? o.nowMs : a.endMs)).filter((x): x is number => typeof x === 'number');
  const own = starts.length && ends.length ? Math.max(0, Math.floor((Math.max(...ends) - Math.min(...starts)) / 1000)) : 0;
  const secs = o.runSecs ?? own;
  const calls = ran.reduce((k, a) => k + (a.calls?.length ?? 0), 0);
  const make = (words: boolean, time: 'total' | 'bare' | 'none', callWord: 'worker calls' | ''): Run[] => {
    const parts = counts.flatMap((x, i): Run[] => {
      const g = stateRun(x.s, o.ui, frame, true);
      return [...(i ? [r(words ? '  ' : ' ')] : []), { ...g, tone: x.s === 'running' && !o.ui.ascii ? 'accent' : g.tone }, r(words ? ` ${x.n} ${x.s}` : ` ${x.n}`, 'text')];
    });
    const tail: Run[] = secs > 0 && time !== 'none'
      ? [r(` ${dot} `, 'muted'), ...(time === 'total' ? [r('total ', 'muted')] : []), r(clock(secs), 'text', { bold: true }), ...(calls && callWord ? [r(` ${dot} ${calls} ${callWord}`, 'muted')] : [])]
      : [];
    return [r('  '), ...parts, ...tail];
  };
  const forms = [make(true, 'total', 'worker calls'), make(true, 'bare', 'worker calls'), make(false, 'bare', 'worker calls'), make(false, 'bare', ''), make(false, 'none', '')];
  const fit = forms.find((f) => runsCells(f) <= o.cols - 1) ?? forms[forms.length - 1]!;
  return { runs: fit };
}

/** What a row says beside its state, for the sub-line (critique 19 C1): its reason (`worker failed`, `owner failed`) and how long it has been open. A done row says nothing
 * (`ran 03:10` is not a reason), and a doubted done that already spells `worker killed` in its state cell does not say it twice. */
function noteOf(x: BoardRow, _doubtWord: boolean): string {
  const doubt = markOf(x.state, x.word) === 'doubt';
  const reason = x.state === 'done' || doubt ? '' : x.detail; // wave 30: a killed worker's row says `killed` once, in its state word
  return [reason, x.state === 'done' || x.ageSecs === undefined ? '' : `open ${mmss(x.ageSecs)}`].filter(Boolean).join(' · ');
}

/** The lines directly under a row: `    ghost-explorer  owner failed · open 02:15`. The owner (when it does not fit beside the row) and the note share one line; a note too long for it goes on the next. */
function subLines(owner: string, note: string, row: BoardRow, cols: number): BoardLine[] {
  const room = Math.max(1, cols - 4);
  const doubt = markOf(row.state, row.word) === 'doubt';
  const tone: Run['tone'] = doubt ? 'bad' : rowWordTone(row.state, row.word);
  if (owner && note && cells(owner) + 2 + cells(note) > room) return [{ runs: [r('    '), r(clipE(owner, room), 'sub')] }, { runs: [r('      '), r(clipE(note, Math.max(1, room - 2)), tone)] }];
  return [{ runs: [r('    '), ...(owner ? [r(clipE(owner, room), 'sub')] : []), ...(note ? [r(`${owner ? '  ' : ''}${clipE(note, Math.max(1, room - (owner ? cells(owner) + 2 : 0)))}`, tone)] : [])] }];
}

/** The whole surface: ribbon (`N items` on the right in the plain form), a blank row, then the body. Without the ribbon (the side panel, which has
 * its own header) the surface opens with one title row, `▸ BOARD  5 items` (the ribbon's own marker, so one search finds the board in either form): the only mark that says which view this is (critique 12: with the chrome gone,
 * nothing named the board and the capture script could not find it). That row says the count, so the footer carries only the folds. */
export function boardLines(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  // Wave 33 (critique 31: one kill stood four times in one board pane): the pane has no closure line under its rows. A failed worker's plan row says `failed` and names its agent, once; the totals, the chart and the recent posts do not repeat it.
  if (o.pane) return rows.length ? [paneSummary(rows, o), { runs: [r(' ')] }, ...paneGroups(rows, o)] : [];
  const withRibbon = o.ribbon !== false;
  const rib = lightRibbon(ribbon(o.cols, 'BOARD', o.rich ? '' : `${rows.length} items`, o.ui), o.ui);
  const n = o.folded ?? 0;
  const k = o.openFolded ?? 0;
  // The count is said once (critique 11: `5 items` in the ribbon and again in the footer): by the ribbon or the title row, else by the footer.
  const count = !withRibbon || !o.rich ? '' : `${rows.length} items · `;
  // An open folded dispatch row is what Stop counts: the footer names it instead of the quiet fold count.
  const note = k > 0 ? r(`  ${count}${k} dispatch${k === 1 ? '' : 'es'} open`, 'warn') : r(`  ${count}${n} dispatch${n === 1 ? '' : 'es'} folded`, 'muted');
  // Critique 17 A3: the open row is unfolded and named (the plan row's title and its worker), never only counted.
  const named: BoardLine[] = k > 0 ? rows.flatMap((x) => (x.openDispatch ?? []).map((d): BoardLine => ({ runs: [r(clipE(`    open: ${d.title}${d.owner ? ` · ${d.owner}` : ''}`, Math.max(1, o.cols - 1)), 'warn')] }))) : [];
  const footer: BoardLine[] = (n > 0 || k > 0) && rows.length > 0 ? [{ runs: [note] }, ...named] : [];
  // `title: false`: the side panel's own ribbon already reads `▸ BOARD  5 items` (critique 15 B5: the live scorer finds the board by the capsule beside `▸ BOARD`), so no second title row.
  const title: BoardLine[] = withRibbon || o.title === false ? [] : [{ runs: [r(o.ui.ascii ? '  > ' : '  ▸ ', 'muted'), r('BOARD', 'text', { bold: true }), ...(rows.length > 0 ? [r(`  ${rows.length} items`, 'muted')] : [])] }];
  return [...(withRibbon ? [{ runs: rib }, { runs: [r(' ')] }] : title), ...boardBody(rows, { ...o, notes: true }), ...footer];
}

/** The side panel's ribbon words for the board view: the title and its `5 items` figure. */
export function boardRibbon(rows: readonly BoardRow[]): { title: string; right: string } {
  const n = boardSummary(rows).items;
  return { title: 'BOARD', right: n ? `${n} items` : '' };
}

/** Plain text of lines, trailing blanks trimmed: what the goldens compare. */
export const boardText = (lines: readonly BoardLine[]): string[] => lines.map((l) => l.runs.map((x) => x.t).join('').trimEnd());
