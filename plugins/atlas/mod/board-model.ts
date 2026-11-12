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
import { cells, chip, DONE_DOUBT, DONE_KILLED, markOf, markToken, meter, motionState, RETURNED, ribbon, rowWordTone, runsCells, spinFrameOf, stateChip, stateRun, WORKER_FAILED, type MarkState, type Run, type Ui, type UiState } from './atlas-ui';
import { animateRow, keysOf, type MotionCtx, type MotionItem } from './motion';

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
  // The lead's own `blocked` is its word for the row (critique 16: T2 blocked read failed); the killed agent keeps its own failed row. A row the store still holds
  // `pending` stays queued (critique 18 B3: T3 read failed over a pending store row): the failed owner is named beside it (`owner failed`), the lead has not closed the row.
  if (ownerState === 'failed') return status === 'blocked' ? 'blocked' : own === 'queued' ? 'queued' : 'failed';
  if (ownerState === 'waiting' || ownerState === 'blocked') return 'blocked';
  return own;
}

/** A completed row whose first worker was killed and whose re-dispatch (`name #2`) succeeded (critique 19 A3: it read `done · worker killed`). */
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
  const detail = doubt ? WORKER_FAILED : retried ? `retried${ev ? ` · ${ev}` : ''}` : ended ? `agent ended, row still open${ev ? ` · ${ev}` : ''}` : ownerState ? `owner ${ownerState}${ev ? ` · ${ev}` : ''}` : ev;
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
export type BoardOpts = { cols: number; ui: Ui; rich?: boolean; tick?: number; /** The snapshot clock in epoch ms: the spinner turns the shared frame (spinFrameOf) of the row's owner, else of its label. Absent: `tick`. */ nowMs?: number; stateCol?: number; /** `boardLines`: how many dispatch rows were folded into plan rows; its footer names them. */ folded?: number; /** `boardLines`: how many of those folded dispatch rows are still open in the store; the footer then reads `N items · K dispatch open`. */ openFolded?: number; /** `boardLines`: draw the `ATLAS ▸ BOARD` ribbon and its blank row (default true). Off inside the side panel, which already has its own header: the footer then carries the one count. */ ribbon?: boolean; /** `boardLines`, ribbon off: false draws no title row either (the host's own ribbon names the board). */ title?: boolean; /** The label as drawn (already cut so rows with one shared head stay apart); absent: the row's own label. */ shown?: string; /** Compact form: the owner column's width (0 or absent: none). */ ownerW?: number; /** Compact form: the state column's width (the longest word on the board; absent: 7). */ wordW?: number; /** `boardLines`: the owner that does not fit beside its row is named in the notes under the rows, not on a line of its own. */ notes?: boolean; /** Compact form: a doubted done is drawn `done · worker killed` in its state cell (boardBody sets it when the label still shows whole beside it). */ doubtWord?: boolean; /** Motion view (mod/motion.ts): a changed or new row is drawn mid-transition. Absent: the resting render. */ motion?: MotionCtx | undefined; /** The row's motion key (boardBody sets it from the row's position among its twins). */ key?: string; /** The side panel's board (wave 24): a summary row (`5 items · 3 dispatches` and a meter), every row's owner in one fixed right column that never wraps, a footer that records how the run closed. */ pane?: boolean; /** `pane`: every dispatch row of the store (folded or standing alone): the summary says it once. Absent: the folded count. */ dispatches?: number; /** `pane`: the last Stop verdict refused the stop: a closed dispatch row says `after Stop refusal`. */ stopRefused?: boolean };

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
  return o.key === undefined ? runs : animateRow(runs, o.key, accentOf(row), o.motion, o.ui);
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

/** The state cell's text where the pane has room to spell a long word (`done · worker killed`, `retried · done`, `worker failed`), and where it does not (the row's own state word; the detail and the notes say the rest). */
const spelledWord = (row: BoardRow): string => (markOf(row.state, row.word) === 'doubt' ? DONE_KILLED : row.word ?? row.state);
const plainWord = (row: BoardRow): string => (row.word === DONE_RETRIED ? 'done' : row.word === WORKER_DOWN ? row.state : row.word ?? row.state);
const isSpelled = (row: BoardRow): boolean => markOf(row.state, row.word) === 'doubt' || row.word === DONE_RETRIED || row.word === WORKER_DOWN;

/** One row at rest. `focus` marks the row the marker `▸` points at. */
function boardRowResting(row: BoardRow, focus: boolean, o: BoardOpts): Run[] {
  const f = form(o.cols);
  const head: Run[] = [focus ? r(o.ui.ascii ? '>' : '▸', 'accent', { bold: true }) : r(' '), r(' '), stateRun(markOf(row.state, row.word), o.ui, o.nowMs !== undefined ? spinFrameOf(o.nowMs, row.owner || row.label) : o.tick ?? 0), r(' ')];
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
  const stateCell = o.rich ? (row.word ? chip(word, row.word === RETURNED ? 'text' : markToken(markOf(row.state, row.word)), o.ui) : stateChip(row.state, o.ui)) : r(word, markOf(row.state, row.word) === 'doubt' ? 'warn' : row.word === RETURNED ? 'dim' : 'text');
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
export const lightRibbon = (runs: Run[], ui: Pick<Ui, 'ascii'>): Run[] => (ui.ascii ? runs : runs.map((x) => (/^━+$/.test(x.t) ? { ...x, t: '─'.repeat(x.t.length), tone: 'line' as Run['tone'] } : x)));

/** Column geometry of the compact and narrow forms for `rows` at `o.cols`: the state column, the owner column beside the rows (0: it does not fit) and whether a doubted done spells its words in the state cell. */
function geometry(rows: readonly BoardRow[], o: BoardOpts): { compact: boolean; ownerAll: number; ownerW: number; wordW: number; stateColC: number | undefined; labelW: number; doubtWord: boolean } {
  const compact = form(o.cols) === 'compact';
  const ownerAll = compact ? Math.min(OWNER_W, Math.max(0, ...rows.map((x) => cells(x.owner)))) : 0;
  // The owner column drops before any title is cut (critique 8: `T4 combine th...` beside `alpha...`): it stays only while the widest title still shows
  // whole beside it (head 4 + title + gap, the state word, a gap), and so a title keeps at least LABEL_MIN cells before any owner cell shows.
  const widest = Math.max(0, ...rows.map((x) => cells(x.label)));
  // The state column is as wide as the longest word on this board (a board of `done` rows needs 4 cells, not the 7 of `running`), so a title keeps those cells.
  const plainW = Math.min(STATE_W, Math.max(4, ...rows.map((x) => cells(x.word ?? x.state))));
  // Critique 18 B2: a doubted done says `done · worker killed` in its state cell where the title still shows whole beside it; narrower panes say it in the notes under the rows.
  const spelledW = Math.max(0, ...rows.filter(isSpelled).map((x) => cells(spelledWord(x))));
  const doubtWord = compact && spelledW > 0 && o.cols - spelledW >= widest + 7;
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

/** The one summary every count on the board reads from: plan items (never a dispatch row that stands alone) and every dispatch row of the store. */
export function boardSummary(rows: readonly BoardRow[], dispatches?: number): { items: number; dispatches: number; done: number } {
  const plan = rows.filter((x) => !x.dispatch);
  return { items: plan.length, dispatches: dispatches ?? rows.filter((x) => x.dispatch).length, done: plan.filter((x) => x.state === 'done').length };
}

/** Column geometry of the pane's rows: the title column, the state word column and the owner column, one set for every row. The owner is cut with `…`, never wrapped onto a second line.
 * A narrow pane whose rows are all done drops the word column (the mark, the dim title and the meter say it); an owner column gives cells up only until the title keeps 16. */
function paneGeometry(rows: readonly BoardRow[], cols: number): { labelW: number; wordW: number; ownerW: number } {
  const widest = Math.max(1, ...rows.map((x) => cells(x.label)));
  const quiet = cols < 46 && rows.every((x) => x.state === 'done');
  const wordW = quiet ? 0 : Math.min(STATE_W, Math.max(4, ...rows.map((x) => cells(plainWord(x)))));
  const ownerAll = Math.min(OWNER_W, Math.max(0, ...rows.map((x) => cells(x.owner))));
  const budget = cols - 1 - 4 - (wordW ? PANE_GUTTER + wordW : 0); // right margin, head, the gutter and the word column: what titles and owners share
  // Titles first: the owner column is dropped before a title is cut, and gets only the cells left once the widest title shows whole (critique 22: `T4 combine the r...` beside an owner).
  const left = budget - widest - PANE_GUTTER;
  if (!ownerAll || left < PANE_OWNER_MIN) return { labelW: Math.max(1, Math.min(widest, budget)), wordW, ownerW: 0 };
  return { labelW: widest, wordW, ownerW: Math.min(ownerAll, left) };
}

function paneRow(row: BoardRow, focus: boolean, o: BoardOpts, g: ReturnType<typeof paneGeometry>): Run[] {
  const doubt = markOf(row.state, row.word) === 'doubt';
  const head: Run[] = [focus ? r(o.ui.ascii ? '>' : '▸', 'accent', { bold: true }) : r(' '), r(' '), stateRun(markOf(row.state, row.word), o.ui, o.nowMs !== undefined ? spinFrameOf(o.nowMs, row.owner || row.label) : o.tick ?? 0), r(' ')];
  const title = clipE(row.label, g.labelW);
  const gutter = r(' '.repeat(PANE_GUTTER));
  const out: Run[] = [...head, r(title + ' '.repeat(Math.max(0, g.labelW - cells(title))), row.state === 'done' && !doubt ? 'sub' : 'text', { bold: focus })];
  if (g.wordW) { const word = clipE(doubt ? 'done' : plainWord(row), g.wordW); out.push(gutter, r(word + ' '.repeat(Math.max(0, g.wordW - cells(word))), rowWordTone(row.state, row.word))); }
  // The reason (`owner failed`, `worker killed`) and the age ride the same row as a dim suffix, cut with `…` to the room left: never a row of its own (critique 22: `owner failed` wrapped under T2).
  // Where the owner column leaves no room for it, the reason takes the owner's cell: why a row is open says more than who holds it.
  const suffix = noteOf(row, false);
  const used = (): number => out.reduce((n, x) => n + cells(x.t), 0);
  if (g.ownerW) {
    const owner = clipE(row.owner, g.ownerW);
    const roomAfter = o.cols - 1 - (used() + PANE_GUTTER + g.ownerW) - PANE_GUTTER;
    if (suffix && roomAfter < Math.min(cells(suffix), PANE_SUFFIX_MIN + 8)) {
      const w = g.ownerW;
      const reason = clipE(suffix.split(' · ')[0]!, w);
      out.push(gutter, r(reason + ' '.repeat(Math.max(0, w - cells(reason))), 'dim'));
      return out;
    }
    out.push(gutter, r(owner + ' '.repeat(Math.max(0, g.ownerW - cells(owner))), 'dim'));
  }
  const room = o.cols - 1 - used() - PANE_GUTTER;
  if (suffix && room >= PANE_SUFFIX_MIN) out.push(gutter, r(clipE(suffix, room), 'dim'));
  return out;
}

/** The pane's rows: one line per item: the title, a 2-cell gutter, the state word, the owner dim, and the reason as a dim suffix. */
function paneBody(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  const g = paneGeometry(rows, o.cols);
  const focus = rows.findIndex((x) => x.focus ?? x.state === 'running');
  const keys = o.motion ? boardKeys(rows) : [];
  return rows.map((row, i): BoardLine => ({ runs: boardRowKeyed(paneRow(row, i === focus, o, g), row, o, keys[i]) }));
}
const boardRowKeyed = (runs: Run[], row: BoardRow, o: BoardOpts, key?: string): Run[] => (key === undefined ? runs : animateRow(runs, key, accentOf(row), o.motion, o.ui));

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

/** The summary row: `5 items · 3 dispatches` and a `▰▱` meter of the items done, the meter on the right edge when it fits. */
function paneSummary(rows: readonly BoardRow[], o: BoardOpts): BoardLine {
  const s = boardSummary(rows, o.dispatches ?? o.folded);
  const dot = o.ui.ascii ? '|' : '·';
  const text = `  ${s.items} item${s.items === 1 ? '' : 's'}${s.dispatches > 0 ? ` ${dot} ${s.dispatches} dispatch${s.dispatches === 1 ? '' : 'es'}` : ''}`;
  const w = Math.min(10, o.cols - 1 - cells(text) - 2);
  const bar = w >= 4 ? [r(' '.repeat(o.cols - 1 - cells(text) - w)), ...meter(w, s.items ? s.done / s.items : 0, o.ui)] : [];
  return { runs: [r(text, 'text', { bold: true }), ...bar] };
}

/** How the run closed, one line per closed dispatch (a plan row whose worker failed and whose row the lead closed): `T2 dispatch closed after Stop refusal · ghost-explorer`; a plan that is all done and nothing open says `closed · 5 of 5 items done`. Nothing while work is still open. */
function paneFooter(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  const dot = o.ui.ascii ? '|' : '·';
  // Whole on one row where it fits; else wrapped on its words (a continuation indented), never cut mid-word.
  const closed = rows.filter((x) => markOf(x.state, x.word) === 'doubt' && x.owner).flatMap((x): BoardLine[] =>
    wordRows(`${rowId(x.label)} dispatch closed${o.stopRefused ? ' after Stop refusal' : ''} ${dot} ${x.owner}`, o.cols - 1, '  ', '    ').map((t, i): BoardLine => ({ runs: [r(t, i === 0 ? 'warn' : 'sub')] })));
  if (closed.length) return closed;
  const s = boardSummary(rows, o.dispatches ?? o.folded);
  const settled = rows.length > 0 && rows.every((x) => x.state === 'done') && !(o.openFolded && o.openFolded > 0);
  return settled ? [{ runs: [r(clipE(`  closed ${dot} ${s.done} of ${s.items} items done`, Math.max(1, o.cols - 1)), 'muted')] }] : [];
}

/** One agent on the board's timeline: its name, state and how long it has run. */
export type TimelineAgent = { name: string; state: UiState; secs?: number | undefined };

const clock = (secs: number): string => (secs < 60 ? `${Math.max(0, Math.floor(secs))}s` : `${Math.floor(secs / 60)}m${String(Math.floor(secs % 60)).padStart(2, '0')}s`);

/** The pane under the rows: one row per agent, `alpha-explorer ━━━━━━━━ 14s ●`: the bar as long as the agent ran (the longest run fills the room), the glyph its state. A queued agent has no run to draw
 * and is left off. `max` caps the rows (the pane's spare height); none when there is no room for a name and a bar. */
export function boardTimeline(agents: readonly TimelineAgent[], o: Pick<BoardOpts, 'cols' | 'ui' | 'nowMs' | 'tick'>, max = 8): BoardLine[] {
  const ran = agents.filter((a) => a.state !== 'queued').slice(0, Math.max(0, max));
  if (!ran.length) return [];
  const nameW = Math.min(18, Math.max(...ran.map((a) => cells(a.name))));
  const longest = Math.max(1, ...ran.map((a) => a.secs ?? 0));
  const timeW = Math.max(...ran.map((a) => cells(clock(a.secs ?? 0))));
  const barMax = o.cols - 1 - 2 - nameW - 1 - 1 - timeW - 1 - 1; // margin, lead, name, gap, (bar), gap, time, gap, glyph
  if (barMax < 3) return [];
  const bar = o.ui.ascii ? '=' : '━';
  return ran.map((a): BoardLine => {
    const secs = a.secs ?? 0;
    const len = Math.max(1, Math.round((barMax * secs) / longest));
    const name = clipE(a.name, nameW);
    const tone: Run['tone'] = a.state === 'done' ? 'dim' : rowWordTone(a.state);
    return { runs: [
      r('  '), r(name + ' '.repeat(nameW - cells(name)), 'sub'), r(' '),
      r(bar.repeat(len), tone), r(' '.repeat(barMax - len + 1)),
      r(clock(secs).padStart(timeW), 'dim'), r(' '), stateRun(a.state, o.ui, o.nowMs !== undefined ? spinFrameOf(o.nowMs, a.name) : o.tick ?? 0),
    ] };
  });
}

/** What a row says beside its state, for the sub-line (critique 19 C1): its reason (`worker failed`, `owner failed`) and how long it has been open. A done row says nothing
 * (`ran 03:10` is not a reason), and a doubted done that already spells `worker killed` in its state cell does not say it twice. */
function noteOf(x: BoardRow, doubtWord: boolean): string {
  const doubt = markOf(x.state, x.word) === 'doubt';
  const reason = x.state === 'done' && !doubt ? '' : doubt && doubtWord ? '' : x.detail;
  return [reason, x.state === 'done' || x.ageSecs === undefined ? '' : `open ${mmss(x.ageSecs)}`].filter(Boolean).join(' · ');
}

/** The lines directly under a row: `    ghost-explorer  owner failed · open 02:15`. The owner (when it does not fit beside the row) and the note share one line; a note too long for it goes on the next. */
function subLines(owner: string, note: string, row: BoardRow, cols: number): BoardLine[] {
  const room = Math.max(1, cols - 4);
  const doubt = markOf(row.state, row.word) === 'doubt';
  const tone: Run['tone'] = doubt ? 'warn' : rowWordTone(row.state, row.word);
  if (owner && note && cells(owner) + 2 + cells(note) > room) return [{ runs: [r('    '), r(clipE(owner, room), 'sub')] }, { runs: [r('      '), r(clipE(note, Math.max(1, room - 2)), tone)] }];
  return [{ runs: [r('    '), ...(owner ? [r(clipE(owner, room), 'sub')] : []), ...(note ? [r(`${owner ? '  ' : ''}${clipE(note, Math.max(1, room - (owner ? cells(owner) + 2 : 0)))}`, tone)] : [])] }];
}

/** The whole surface: ribbon (`N items` on the right in the plain form), a blank row, then the body. Without the ribbon (the side panel, which has
 * its own header) the surface opens with one title row, `▸ BOARD  5 items` (the ribbon's own marker, so one search finds the board in either form): the only mark that says which view this is (critique 12: with the chrome gone,
 * nothing named the board and the capture script could not find it). That row says the count, so the footer carries only the folds. */
export function boardLines(rows: readonly BoardRow[], o: BoardOpts): BoardLine[] {
  if (o.pane) return rows.length ? [paneSummary(rows, o), { runs: [r(' ')] }, ...paneBody(rows, o), ...(() => { const f = paneFooter(rows, o); return f.length ? [{ runs: [r(' ')] }, ...f] : []; })()] : [];
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
