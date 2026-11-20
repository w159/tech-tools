import { sharedSpinFrame, type MotionCtx } from '../../motion/motion';
import { DONE_RETRIED, planFigure, WORKER_DOWN } from '../board/board-model';
import { COUNT_ORDER, LINGER_MS, PALETTE5, markOf, RETURNED, runsCells, spinClock, spinFrameOf, spinnerGlyph, stateRun, type MarkState, type Run, type Ui, type UiState } from '../../design/atlas-ui';

export type TodoRow = { label: string; /** The plan item's id (T1): its spinner phase when no agent owns it, the same key the side panel turns. */ id?: string; /** The agent that owns the item: its spinner turns the owner's frame, as on the board. */ owner?: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`returned`: the owner agent ended, the store row is still open). */ word?: string; detail: string; focus: boolean; /** Motion key (hud.ts sets it); absent: the row never animates. */ key?: string; /** Epoch ms the item completed, when the board records it: a fresh one outranks the queue when rows fold. */ doneAt?: number; /** Merged block (wave 31): the agent that works the row and its clock (`alpha-explorer`, `0:08`), drawn right-aligned in 245. */ agent?: string; agentTime?: string; /** Wave 34: dispatches that fold under this plan row and have no row of their own (`explorer-f3da queued 0:00`), each drawn as one 240 child line while it is open. */ children?: readonly string[] };

/** `tasks`: the 1-based plan positions of every item the agent owns (`T1`, `T2`); none for an agent that owns no row. */
export type AgentRow = { /** The worker's persona (`implementer`, `atlas:explorer`; tmux workers carry `unknown`): its role, else the name prefix decides (theme.ts roleOf). */ persona?: string; /** Dispatch order (wave 36): the agent's place in the order it was dispatched; the SUBAGENTS table sorts by it, so a row never moves. */ seq?: number; name: string; state: UiState; model: string; tasks: readonly number[]; tool: string; ctx: number | null; focus: boolean; key?: string; /** The squad name (the side panel's row id): its spinner phase, which the display `name` would change. */ id?: string; /** The agent's own task text (its dispatch description): the TASK column shows it when the agent owns no plan row. */ task?: string; /** What RESULT reads when the agent has no outcome or call to show (its last tool word): never the state word again. */ fallback?: string; /** State 38: the agent's last tool action in plain words (`read gamma.py`): the SUBAGENTS LAST column shows it when the outcome would only restate the FN count. */ action?: string; /** The LAST column: the elapsed clock since the agent started (`0:13`), frozen at its end. */ elapsed?: string; /** Tool calls the host counted for the agent (wave 35, the finish card's own figure): the CALLS column of the done table; absent when none were seen, never guessed. */ calls?: number; /** State 39: the functions the agent's whole report holds, counted over every evidence row and its closing line (hud.ts functionsIn), so the FN column never depends on which row stated the outcome. */ fn?: number; /** Tool calls per interval over the last minute, oldest first (hud.ts agentModel): the ACT sparkline of a live agent. */ act?: readonly number[] };

/** The one spinner frame of the HUD: the shared clock's frame (spinFrameOf of spinClock) when the snapshot's `now` is known, else the caller's tick.
 * Rev 5: ONE phase for every row and title in a frame (no per-row id: out-of-phase spinners read as noise, critique 17.13.0 problem 1). */
const spinOf = (o: Pick<SurfaceOpts, 'now' | 'tick'>): number => (o.now !== undefined ? spinFrameOf(spinClock(o.now, o.tick), '') : o.tick ?? 0);

/** The spinner frame of the SUBAGENTS header and rows: the one shared tick (motion.ts sharedSpinFrame), the same beat and the same glyph spinOf counts for the TODO rows. */
export const titleSpinOf = (o: Pick<SurfaceOpts, 'now' | 'tick'>): number => (o.now !== undefined ? sharedSpinFrame(spinClock(o.now, o.tick)) : o.tick ?? 0);

/** The running mark of a HUD row: the one spinner (atlas-ui spinnerGlyph), the glyph the titles, the band and the side panel turn on the same clock. The capture scorer
 * (round2/tools/live_capture.py GLYPH_STATE4, :467-469) reads a TODO item's state from its glyph alone and a SUBAGENTS row only when its glyph is one of `◐◓◑◒◇■▲◉●`,
 * which is why the one set is the circle quarters and not braille. */
export const rowSpinnerGlyph = spinnerGlyph;

export function markRun(s: MarkState, o: Pick<SurfaceOpts, 'now' | 'tick' | 'ui'>): Run {
  if (s === RETURNED) return stateRun(RETURNED, o.ui); // `returned` is a hand-back, not a finish: the neutral `◉` (one the scorer reads) in body 252 and the word in 245, never the green done mark (critique 27, live-150-46d4825c-1 f0085:26)
  const base = stateRun(s, o.ui, spinOf(o));
  if (s === 'doubt') return { ...stateRun('failed', o.ui), tone: o.ui.ascii ? 'text' : 'bad' }; // a row closed over a killed worker is `■ failed` in the error 203: one glyph and one word for a killed worker everywhere (critique 28)
  return s === 'running' ? { ...base, t: rowSpinnerGlyph(spinOf(o), o.ui.ascii), ...(o.ui.ascii ? {} : { tone: 'accent' as const }) } : base; // wave 31: every running circle is the accent 141, as the band spinner and the side panel's
}

export const RULE = '─';

/** A quiet run of the box chrome: the 240 neutral (PALETTE5.dim), the rule, the corners and the brand. The exact grey rides `fg` except in the light theme, where the tone's own muted grey is already the dark one. */
export const dimRun = (text: string, ui: Pick<Ui, 'theme'>): Run => ({ t: text, tone: 'dim', ...(ui.theme === 'latte' ? {} : { fg: PALETTE5.dim }) });

/** The bottom edge that closes a box: `╰────╯` in exactly `cols` cells in the 240 neutral (ASCII `+---+`), under the last row of a block in every state. The capture scorer skips a row with no space after its first character. */
export const bottomRule = (cols: number, ui: Ui): Run[] => {
  const w = Math.max(3, cols);
  return [dimRun(ui.ascii ? `+${'-'.repeat(w - 2)}+` : `╰${RULE.repeat(w - 2)}╯`, ui)];
};

export type SurfaceOpts = {
  cols: number;
  ui: Ui;
  /** Spinner frame for running glyphs. */
  tick?: number;
  /** Rich form: state chips, the phase rail, a ctx gauge per agent (120 columns and up). */
  rich?: boolean;
  /** Phase ids and the 0-based lit phase for the rich rail. */
  phases?: { ids: readonly string[]; active: number };
  /** Motion view (mod/motion/motion.ts): a row with a key and an entry is drawn mid-transition. Absent: the resting render. */
  motion?: MotionCtx | undefined;
  /** The snapshot clock in epoch ms: a done row that completed within LINGER_MS of it ranks with running rows when the plan folds. */
  now?: number | undefined;
  /** The run's fixed shape (slot.ts): an empty block still draws its closed box with one quiet row (`no tasks yet`, `none running yet`), so the HUD has one shape from the first working frame to idle. */
  reserve?: boolean | undefined;
  /** Wave 42: the live health summary (`● gates 4/4 · ctx 18%`): an empty reserved box says what will appear and this, never an empty-looking box. Absent: the old quiet words. */
  healthLine?: string | undefined;
  /** False: never merge the running agents into the TODO rows (the row counters ask for the roomiest form so the slot holds one height). */
  merge?: boolean | undefined;
};

/** `spacers`: the blank rows of the mocks. `extras`: the rail and the progress gauge. `cap`: row slots for the rows (the overflow row takes one); undefined shows all, 0 only the ribbon. */
/** `header`: the SUBAGENTS column-name row (default: with `spacers`); `stack` always asks for it, so a drawn HUD prints it in every state until a budget too small turns it off. */
export type BlockOpts = { spacers: boolean; extras: boolean; cap?: number; header?: boolean; /** The `╰───╯` rule under the last row (a block with no row under its title has nothing to close); `stack` asks for it in every state. */ close?: boolean; /** Fold the finished rows into a `3 done` count on the ribbon and draw every open row (never folds an open one). */ foldDone?: boolean; /** The merged block (wave 31): each row carries its agent and clock at the right, and the closing rule is `closer`. */ merged?: boolean; closer?: Run[]; /** Agents windowed to `cap` rows with no `n more agents not shown` row: the running count already rides the ribbon, so every slot holds an agent. */ quiet?: boolean; /** The SUBAGENTS box lists a queued dispatch (default) or leaves it to the plan (false, the merged block: a queued dispatch is a child of the plan, not an agent). */ queued?: boolean };

export const t = (text: string, tone: Run['tone'] = 'text', extra: Partial<Run> = {}): Run => ({ t: text, tone, ...extra });

export const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A row's detail column text: empty when the title already says it (`T1 read alpha.py (alpha-explorer)` with the owner `alpha-explorer` printed again beside it). */
export const detailOf = (r: Pick<TodoRow, 'label' | 'detail' | 'state' | 'word'>, rich = false): string => (r.detail !== '' && (flat(r.label).toLowerCase().includes(flat(r.detail).toLowerCase()) || isDoubt(r)) ? '' : r.detail);

 // a doubted done says `worker failed` in its state cell (non-rich), so the detail column does not say it again
/** A completed row whose worker failed or was killed (critique 17 A1). */
export const isDoubt = (r: Pick<TodoRow, 'state' | 'word'>): boolean => markOf(r.state, r.word) === 'doubt';

/** A row the block draws `■ failed`: its state is failed, or the lead closed it over a failed worker (wave 36: one state for it in the title, the meter and the row). */
export const isFailedRow = (r: Pick<TodoRow, 'state' | 'word'>): boolean => r.state === 'failed' || isDoubt(r);

/** The one word for a worker that was stopped mid-call (critique 28), on the TODO row closed over it, the SUBAGENTS row and the band. */
export const KILLED = 'failed';

/** Row slots by priority when the rows do not all fit: open work first (running, blocked, failed, waiting), then queued, then the newest done.
 * A row that completed within LINGER_MS of `now` ranks with running rows, so a task that just finished is not hidden behind the queue. */
const PRIORITY = Object.fromEntries(COUNT_ORDER.map((s, i) => [s, i])) as Record<UiState, number>;

/** A done row that completed within LINGER_MS of `now`. */
const isFresh = (r: { state: UiState; doneAt?: number }, now?: number): boolean => r.state === 'done' && now !== undefined && r.doneAt !== undefined && now - r.doneAt <= LINGER_MS;

/** The `slots` rows to draw, in their own order, and how many were left out. `slots` includes the overflow row when something is hidden. */
export function windowRows<T extends { state: UiState; word?: string; doneAt?: number }>(rows: readonly T[], slots: number | undefined, now?: number, overflowRow = true): { shown: T[]; hidden: number } {
  if (slots === undefined || slots >= rows.length) return { shown: [...rows], hidden: 0 };
  const keep = overflowRow ? Math.max(0, slots - 1) : slots; // `overflowRow` false: the count of the rest rides the ribbon, so every slot holds a row
  const rank = (r: T): number => (isFailedRow(r) ? PRIORITY.failed : isFresh(r, now) ? PRIORITY.queued - 0.5 : PRIORITY[r.state]); // state 40: a row closed over a failed worker ranks as failed, never as a finished one // state 39: a row that just finished ranks after every open row (a running row is never hidden behind it) and before the queue
  const ranked = rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || (a.row.state === 'done' && !isFailedRow(a.row) ? (b.row.doneAt ?? 0) - (a.row.doneAt ?? 0) || b.i - a.i : a.i - b.i));
  const picked = new Set(ranked.slice(0, keep).map((x) => x.i));
  return { shown: rows.filter((_, i) => picked.has(i)), hidden: rows.length - picked.size };
}

/** One overflow idiom for every block (state 39): the rows a block cannot draw are counted on ONE dim summary row, the last row inside its box, never on the title: `● 2 done  ■ 1 failed  ◇ 1 queued`, and a hidden open row is
 * named by its state (`◒ 2 more running`). State 40: every hidden state is counted apart with its own glyph and colour, a failed row is never folded into `done`, and the order is done, failed, queued, then the other open states.
 * Counts by state in, the parts out: each part is the glyph run and the text run that follow it (`''` parts when nothing is hidden). */
const OVERFLOW_ORDER: readonly UiState[] = ['done', 'failed', 'queued', ...COUNT_ORDER.filter((x) => x !== 'done' && x !== 'failed' && x !== 'queued')];

function overflowParts(counts: Partial<Record<UiState, number>>, ui: Ui, spinFrame = 0): Run[][] {
  return OVERFLOW_ORDER.flatMap((st): Run[][] => {
    const n = counts[st] ?? 0;
    if (n <= 0) return [];
    const glyph = st === 'running' ? stateRun('running', ui, spinFrame) : stateRun(st, ui);
    const word = st === 'done' || st === 'queued' || st === 'failed' ? `${n} ${st}` : `${n} more ${st}`;
    return [[glyph, { t: ` ${word}`, tone: st === 'failed' && !ui.ascii ? 'bad' : 'sub' }]];
  });
}

export function overflowText(counts: Partial<Record<UiState, number>>, ui: Ui, spinFrame = 0): string {
  return overflowParts(counts, ui, spinFrame).map((p) => p.map((x) => x.t).join('')).join('  ');
}

/** The summary row: two blank cells, then the parts apart, each glyph in its own colour; whole parts only, the last cell stays empty (a part that does not fit ends the row, so a count is never cut mid-figure). */
export function overflowRow(counts: Partial<Record<UiState, number>>, ui: Ui, cols: number, spinFrame = 0): Run[] {
  const out: Run[] = [dimRun('  ', ui)];
  for (const part of overflowParts(counts, ui, spinFrame)) {
    const sep: Run[] = out.length > 1 ? [dimRun('  ', ui)] : [];
    if (runsCells(out) + runsCells(sep) + runsCells(part) > cols - 1) break;
    out.push(...sep, ...part);
  }
  return out;
}

/** Counts per state for rows left out. A row closed over a failed worker (state `done` with the doubt word) is `failed` here, as in the title, the meter and its own row (state 40: `● 3 done` hid a failed item). */
export const tallyStates = (rows: readonly { state: UiState; word?: string }[]): Partial<Record<UiState, number>> => rows.reduce<Partial<Record<UiState, number>>>((m, r) => { const st: UiState = isFailedRow(r) ? 'failed' : r.state; return { ...m, [st]: (m[st] ?? 0) + 1 }; }, {});

/** State 38/39: which plan rows to draw in `cap` slots, and the one summary row for the rest. Finished rows go first (a fresh one last), then queued rows from the bottom, behind ONE dim summary row that takes a slot:
 * `● 3 done  ◇ 2 queued`. A row that just finished (LINGER_MS) ranks with the open ones. A running, blocked, failed or waiting row is hidden only when nothing else is left to hide, from the bottom, and then the SAME summary row counts it
 * (`◒ 2 more running`), never the title (`hiddenOpen` is the number of such rows). `fold`: the finished rows go regardless of `cap` (a short budget). */
export function planWindow<T extends { state: UiState; word?: string; doneAt?: number }>(rows: readonly T[], cap: number | undefined, now: number | undefined, fold: boolean, ui: Ui, spinFrame = 0): { shown: T[]; summary: string | null; counts: Partial<Record<UiState, number>>; hiddenOpen: number } {
  let hide = new Set<number>();
  const idx = rows.map((r, i) => ({ r, i }));
  const finished = idx.filter((x) => x.r.state === 'done' && !isFailedRow(x.r)); // state 40: a row closed over a failed worker is open work to hide last, never one of the finished rows that go first
  if (fold && finished.length > 0 && finished.length < rows.length) for (const x of finished) if (!isFresh(x.r, now)) hide.add(x.i);
  const isSummed = (i: number): boolean => (rows[i]!.state === 'done' && !isFailedRow(rows[i]!)) || rows[i]!.state === 'queued';
  const slots = (): number => rows.length - hide.size + (hide.size > 0 ? 1 : 0);
  if (cap !== undefined && cap > 0 && slots() > cap) {
    const summed = [
      ...finished.filter((x) => !isFresh(x.r, now)).sort((a, b) => (a.r.doneAt ?? 0) - (b.r.doneAt ?? 0) || a.i - b.i),
      ...idx.filter((x) => x.r.state === 'queued').reverse(),
    ];
    for (const x of summed) { if (slots() <= cap) break; hide.add(x.i); }
    if (slots() > cap) {
      // The open rows alone fill the slots: the summary row still takes the last one and counts every row left out, the open ones by name.
      const w = windowRows(rows, cap, now, true);
      hide = new Set(idx.filter((x) => !w.shown.includes(x.r)).map((x) => x.i));
    }
  }
  if (hide.size === 0) return { shown: [...rows], summary: null, counts: {}, hiddenOpen: 0 };
  const counts = tallyStates([...hide].map((i) => rows[i]!));
  const text = overflowText(counts, ui, spinFrame);
  return { shown: rows.filter((_, i) => !hide.has(i)), summary: text === '' ? null : text, counts, hiddenOpen: [...hide].filter((i) => !isSummed(i)).length };
}

/** The state word as the 8-cell column holds it: `done` too (every row has one), `failed` for a doubted done or a pending row whose worker died, `retried` for a retried done. */
export const gridWord = (r: Pick<TodoRow, 'state' | 'word'>): string => (isDoubt(r) || r.word === WORKER_DOWN ? KILLED : r.word === DONE_RETRIED ? 'retried' : r.word ?? r.state);

/** The fewest cells a row's reason is drawn in past the grid's last column (two blank cells before it); with less room the reason takes the owner and clock cells instead. */
export const REASON_MIN = 16;

const REASON_STATES: ReadonlySet<UiState> = new Set<UiState>(['blocked', 'failed', 'waiting']);

/** Why a blocked, failed or waiting row is stuck (its plan row's evidence or detail: `needs your approval on the schema change`); '' for any other row, a `returned` hand-back, or a detail that only names the row's owner. */
export const reasonOf = (r: Pick<TodoRow, 'label' | 'detail' | 'state' | 'word' | 'agent' | 'owner'>): string => {
  if (!REASON_STATES.has(r.state) || r.word === RETURNED) return '';
  const d = flat(detailOf(r));
  return d === '' || d === flat(r.agent ?? '') || d === flat(r.owner ?? '') ? '' : d;
};

/** What a TASK or LAST cell with nothing to say reads (critique 17.13.0: LAST was blank at 110). */
export const NONE = '-';

/** What LAST reads on a failed row with no outcome of its own. */
export const STOPPED = 'stopped';

/** RESULT: a finished agent's count (`2 functions` -> `2 fn`), else `-`. Never the activity (`preparing`, `read alpha.py`) and never the state word again. `fn` (state 39): the count the whole report holds, which wins over the outcome text. */
export function resultOf(r: Pick<AgentRow, 'state' | 'tool'> & { fn?: number | undefined }): string {
  if (r.state !== 'done') return NONE;
  if (r.fn !== undefined && r.fn > 0) return `${r.fn} fn`;
  const m = /^(\d+)\s+(function|functions|fn|test|tests|file|files|line|lines|check|checks|finding|findings|row|rows)\b/i.exec(flat(r.tool));
  if (!m) return NONE;
  const unit = /^function/i.test(m[2]!) ? 'fn' : m[2]!.toLowerCase();
  return `${m[1]} ${unit}`;
}

// ---- assembly --------------------------------------------------------------------------------------------

export type Surfaces = { todos: readonly TodoRow[]; agents: readonly AgentRow[] };

 // wave 34: only a running agent turns the spinner; queued ones are not counted at all
/** Whether the block is merged: an agent runs, so the SUBAGENTS box gives way to the agent and clock on each TODO row (wave 31, critique 29). */
export const isMerged = (s: Surfaces, o: Pick<SurfaceOpts, 'merge' | 'reserve'>): boolean => o.merge !== false && s.todos.length > 0 && (s.agents.length > 0 || o.reserve === true);

 // wave 32: one block in every state; no plan rows: the agents keep their own SUBAGENTS box

export const ownerBase = (name: string): string => name.replace(/\s+#\d+$/, '');

/** A plan row's `(alpha-explorer)` title suffix: a kebab name with a hyphen, optionally a retry mark. The merged block shows the agent in its own column, so the title drops it. */
const AGENT_SUFFIX = /\s*\(([a-z][a-z0-9]*(?:-[a-z0-9]+)+(?:\s#\d+)?)\)\s*$/i;

/** The TODO rows of the merged block (wave 34): exactly one row per plan item, each naming the agent that owns it with its clock (the title never repeats the name). An agent that owns no plan row has no row of its own:
 * a queued one (a dispatch whose worker the host never listed) folds into the plan row its prompt is about while that row is open, otherwise (and for any other orphan agent that is not done) it is one child line under that row,
 * the first open row when none fits, so the title count is the plan's own and the band's. */
export function mergedTodos(s: Surfaces): TodoRow[] {
  const nameOf = (r: TodoRow): string | undefined => r.owner ?? AGENT_SUFFIX.exec(r.label)?.[1]; // a plan row names its worker in its `owner` or its `(alpha-explorer)` title suffix
  const agentOf = (r: TodoRow): AgentRow | undefined => { const n = nameOf(r); return n === undefined ? undefined : s.agents.find((a) => a.name === n || a.id === n || ownerBase(a.name) === ownerBase(n)); };
  const rows = s.todos.map((r): TodoRow => {
    const a = agentOf(r);
    const suffix = AGENT_SUFFIX.exec(r.label)?.[1];
    const label = suffix === undefined ? r.label : r.label.replace(AGENT_SUFFIX, '');
    if (a) return { ...r, label, agent: flat(a.name), agentTime: a.elapsed ?? NONE };
    const named = flat(r.owner ?? '') || suffix; // an assignee with no listed agent yet: the name holds its column from the first frame, the clock stays blank
    // Wave 36: a started row nobody owns is the lead's (`lead` in 245 where an agent's name would be); an unstarted one has no owner yet and shows none.
    return named ? { ...r, label, agent: named, agentTime: '' } : r.state !== 'queued' ? { ...r, label, agent: 'lead', agentTime: '' } : { ...r, label };
  });
  // State 38: no `└ explorer-xxxx queued` child rows. A dispatched worker the host has not listed yet is a row of the SUBAGENTS count and the band, never a line hung under a plan row.
  return rows;
}

/** The plan's count: rows closed done (a failed row, or one closed over a failed worker, is counted apart), the `n/m` figure, and the figure forms from widest to narrowest (`4/5 · ■1`, then `4/5■1`). One count format at every width, like the band, the board and the panel. */
export function planCount(rows: readonly TodoRow[], ui: Pick<Ui, 'ascii'>, failGlyph: string) {
  const failed = rows.filter(isFailedRow).length;
  const done = rows.filter((r) => r.state === 'done' && !isFailedRow(r)).length;
  const plain = planFigure(done, rows.length, rows.filter((r) => r.word === RETURNED).length);
  const failMark = `${ui.ascii ? '!' : failGlyph}${failed}`;
  const figures = failed > 0 ? [`${plain} · ${failMark}`, `${plain}${failMark}`] : [plain];
  return { failed, done, plain, failMark, figures };
}

/** What an agent last did and how it ended: the current action (never the `preparing` filler) and the outcome (never the dispatch title, the filler `finished`, a failed agent's own word or the setup filler: they say nothing). */
export function actionOutcome(a: AgentRow): { action: string; outcome: string } {
  const x = flat(a.tool);
  const action = a.action && a.action !== 'preparing' ? a.action : '';
  const outcome = x !== '' && x !== 'finished' && x !== KILLED && x !== 'preparing' && x.toLowerCase() !== flat(a.task ?? '').toLowerCase() ? x : '';
  return { action, outcome };
}
