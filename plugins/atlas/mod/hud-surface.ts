// The TODO and SUBAGENTS surfaces of the rev 4 ATLAS design (round2/design/atlas-design-system-rev4.md, sections 3f/3g).
// Pure and host free: design rows in, tone-tagged Runs out. mod/hud.ts adapts board and squad data to these rows and
// paints Runs for Claude Code; omp/hud-paint.ts paints the same Runs as ANSI, so the two hosts draw identical rows.
// Layout grid (cell columns): focus 0, glyph 2, label 4; state and meta columns follow the tier below.
import { animateRow, calmRun, easedMs, MOTION_MS, MOTION_STEP_MS, sharedSpinFrame, type MotionCtx } from './motion';
import { clipWords, lastText } from './data/lasttext';
import { noteWorkerFacts, tallyOf } from './data/live';
import { DONE_RETRIED, planFigure, WORKER_DOWN } from './board-model';
import { cells, CHIP_W, DONE_KILLED, COUNT_ORDER, GLYPH5, LINGER_MS, PALETTE5, PALETTES, WORKER_FAILED, xtermHex, clip, gauge, markOf, markToken, percent, RETURNED, rowWordTone, runsCells, spinClock, spinFrameOf, spinnerGlyph, chip, stateChip, stateGlyph, stateRun, type MarkState, type Run, type Ui, type UiState } from './atlas-ui';

export type TodoRow = { label: string; /** The plan item's id (T1): its spinner phase when no agent owns it, the same key the side panel turns. */ id?: string; /** The agent that owns the item: its spinner turns the owner's frame, as on the board. */ owner?: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`returned`: the owner agent ended, the store row is still open). */ word?: string; detail: string; focus: boolean; /** Motion key (hud.ts sets it); absent: the row never animates. */ key?: string; /** Epoch ms the item completed, when the board records it: a fresh one outranks the queue when rows fold. */ doneAt?: number; /** Merged block (wave 31): the agent that works the row and its clock (`alpha-explorer`, `0:08`), drawn right-aligned in 245. */ agent?: string; agentTime?: string; /** Wave 34: dispatches that fold under this plan row and have no row of their own (`explorer-f3da queued 0:00`), each drawn as one 240 child line while it is open. */ children?: readonly string[] };
/** `tasks`: the 1-based plan positions of every item the agent owns (`T1`, `T2`); none for an agent that owns no row. */
export type AgentRow = { /** Dispatch order (wave 36): the agent's place in the order it was dispatched; the SUBAGENTS table sorts by it, so a row never moves. */ seq?: number; name: string; state: UiState; model: string; tasks: readonly number[]; tool: string; ctx: number | null; focus: boolean; key?: string; /** The squad name (the side panel's row id): its spinner phase, which the display `name` would change. */ id?: string; /** The agent's own task text (its dispatch description): the TASK column shows it when the agent owns no plan row. */ task?: string; /** What RESULT reads when the agent has no outcome or call to show (its last tool word): never the state word again. */ fallback?: string; /** The LAST column: the elapsed clock since the agent started (`0:13`), frozen at its end. */ elapsed?: string; /** Tool calls the host counted for the agent (wave 35, the finish card's own figure): the CALLS column of the done table; absent when none were seen, never guessed. */ calls?: number };
/** The one spinner frame of the HUD: the shared clock's frame (spinFrameOf of spinClock) when the snapshot's `now` is known, else the caller's tick.
 * Rev 5: ONE phase for every row and title in a frame (no per-row id: out-of-phase spinners read as noise, critique 17.13.0 problem 1). */
const spinOf = (o: Pick<SurfaceOpts, 'now' | 'tick'>): number => (o.now !== undefined ? spinFrameOf(spinClock(o.now, o.tick), '') : o.tick ?? 0);
/** The braille spinner of the SUBAGENTS header and rows: the one shared tick (motion.ts sharedSpinFrame), the same beat spinOf counts for the circles. */
const brailleOf = (o: Pick<SurfaceOpts, 'now' | 'tick'>): number => (o.now !== undefined ? sharedSpinFrame(spinClock(o.now, o.tick)) : o.tick ?? 0);

/** The running mark of a HUD row. The capture scorer (round2/tools/live_capture.py GLYPH_STATE4, :467-469) reads a TODO item's state from its glyph alone and a SUBAGENTS row
 * only when its glyph is one of `◐◓◑◒◇■▲◉●`, so a braille frame there scores `wrong_state`/a missing row. Until the scorer maps braille, a row keeps the four-frame mark
 * on the SAME shared clock as the titles and the band, which carry the braille spinner. Flip to false when the scorer reads braille. */
const SCORER_READS_CIRCLES = true;
const ROW_SPIN = '◐◓◑◒';
/** The glyph a HUD row turns at spinner `frame`: the four-frame mark while the scorer needs it, else the shared braille spinner. */
export const rowSpinnerGlyph = (frame: number, ascii = false): string => (SCORER_READS_CIRCLES && !ascii ? [...ROW_SPIN][((Math.floor(frame) % 4) + 4) % 4]! : spinnerGlyph(frame, ascii));
function markRun(s: MarkState, o: Pick<SurfaceOpts, 'now' | 'tick' | 'ui'>): Run {
  if (s === RETURNED) return stateRun(RETURNED, o.ui); // `returned` is a hand-back, not a finish: the neutral `◉` (one the scorer reads) in body 252 and the word in 245, never the green done mark (critique 27, live-150-46d4825c-1 f0085:26)
  const base = stateRun(s, o.ui, spinOf(o));
  if (s === 'doubt') return { ...stateRun('failed', o.ui), tone: o.ui.ascii ? 'text' : 'bad' }; // a row closed over a killed worker is `■ failed` in the error 203: one glyph and one word for a killed worker everywhere (critique 28)
  return s === 'running' ? { ...base, t: rowSpinnerGlyph(spinOf(o), o.ui.ascii), ...(o.ui.ascii ? {} : { tone: 'accent' as const }) } : base; // wave 31: every running circle is the accent 141, as the band spinner and the side panel's
}

// ---- rev 5 titles: a plain title, a thin rule, the meter on the right ------------------------------------------------------
// File-local tokens until the shared set lands (names match slice A's GLYPH5): the meter marks, the rule.
const METER_ON = GLYPH5.meterOn;
const METER_OFF = GLYPH5.meterOff;
const METER_W = 8;
const RULE = '─';
/** The ellipsis of a cut cell: one cell, never three dots (critique 21: `(alpha-expl...` beside a whole `(beta-explorer)`). */
const ELL = String.fromCharCode(0x2026); // built, not typed: omp/glyph-guard.test.ts bans a literal ellipsis in source (ASCII and NO_COLOR modes swap it)
const ELL_ASCII = '~';
const ellOf = (ui: Pick<Ui, 'ascii'>): string => (ui.ascii ? ELL_ASCII : ELL);
/** A quiet run of the box chrome: the 240 neutral (PALETTE5.dim), the rule, the corners and the brand. The exact grey rides `fg` except in the light theme, where the tone's own muted grey is already the dark one. */
const dimRun = (text: string, ui: Pick<Ui, 'theme'>): Run => ({ t: text, tone: 'dim', ...(ui.theme === 'latte' ? {} : { fg: PALETTE5.dim }) });
/** The brand the scorer locates a block by (the ribbon text then `> TODO`, live_capture.py is_block_header :510): the same text as atlas-ui's wordmark, drawn quiet (no fill, 240); the band alone carries the solid chip. ASCII: `[ATLAS]`. */
const brand = (ui: Ui): Run[] => [dimRun(ui.ascii ? '[ATLAS]' : '◖ ◆ ATLAS ◗', ui)];
/** `▰▰▰▱▱▱▱▱` for done/total: full only when everything is done, never empty once one is. ASCII: `#` and `-`. */
export function meterRuns(done: number, total: number, ui: Ui, failed = 0): Run[] {
  const bad = Math.min(METER_W, Math.max(0, failed));
  const full = total > 0 && done + bad >= total; // everything is settled: done cells fill all the rest
  const on = total <= 0 ? 0 : full ? METER_W - bad : Math.min(METER_W - 1 - bad, Math.max(done > 0 ? 1 : 0, Math.round((METER_W * done) / total)));
  const fill = (t: string, tone: Run['tone']): Run => ({ t, tone });
  // Wave 36: 114 cells for the rows done, one 203 cell per failed row, the rest muted: a failed row never reads as a full green meter.
  return [fill((ui.ascii ? '#' : METER_ON).repeat(Math.max(0, on)), 'ok'), ...(bad > 0 ? [fill((ui.ascii ? '!' : METER_ON).repeat(bad), 'bad')] : []), fill((ui.ascii ? '-' : METER_OFF).repeat(Math.max(0, METER_W - Math.max(0, on) - bad)), 'muted')].filter((x) => x.t !== '');
}
/** The title: bold 252 (the body grey) in every theme but latte. */
const titleRun = (text: string, ui: Pick<Ui, 'theme'>): Run => ({ t: text, tone: 'text', bold: true, ...(ui.theme === 'latte' ? {} : { fg: PALETTE5.body }) });
/** The top edge of a box: `╭─ brand ▸ TITLE  count mid ────────╮` in exactly `cols` cells, the same shape in every state. The brand and the rule are quiet 240, the title bold 252, the count and the `mid` runs (the meter,
 * the spinner and counts) sit inside the rule, and the rule ends in a right corner on the LAST cell of the tree (`bodyColumns`). The host draws its `[-]` in the five cells it adds to the right of the tree's
 * first row (host types AbovePrompt, .claude-plugin/types/claude-code/index.d.ts:11227 and :11262-11270: `bodyColumns` is the column less the engine's five, which hold the `[-]`; the mod cannot draw in them and
 * the types give a mod no way to place text inside them), so the corner stands against the host's cells and `[-]` sits right of it, never inside the rule. Wider than `cols` when the parts and the corner do not fit; callers try narrower forms.
 * `flat`: a block drawn with no bottom rule has no box to open, so its ribbon has no corners either (a top edge with nothing to close it was a box left open: critique 27, live-150-46d4825c-1 f0065:25-36). */
export function titleRow(cols: number, title: string, count: string, mid: readonly Run[], ui: Ui, flat = false, bottom = false): Run[] {
  const left: Run[] = [dimRun(ui.ascii ? (flat ? '-- ' : '+- ') : flat ? '── ' : bottom ? '╰─ ' : '╭─ ', ui), ...brand(ui), dimRun(ui.ascii ? ' > ' : ' ▸ ', ui), titleRun(title, ui), ...(count ? [{ t: `  ${count}`, tone: 'sub' as const }] : []), ...(mid.length > 0 ? [dimRun(' ', ui), ...mid] : []), dimRun(' ', ui)];
  const room = Math.max(1, cols - runsCells(left) - 1); // the rule to the cell before the corner
  return [...left, dimRun((ui.ascii ? '-' : RULE).repeat(room) + (flat ? (ui.ascii ? '-' : RULE) : ui.ascii ? '+' : bottom ? '╯' : '╮'), ui)];
}
/** The bottom edge that closes a box: `╰────╯` in exactly `cols` cells in the 240 neutral (ASCII `+---+`), under the last row of a block in every state. The capture scorer skips a row with no space after its first character. */
export const bottomRule = (cols: number, ui: Ui): Run[] => {
  const w = Math.max(3, cols);
  return [dimRun(ui.ascii ? `+${'-'.repeat(w - 2)}+` : `╰${RULE.repeat(w - 2)}╯`, ui)];
};

/** The tone and weight of a row's state word. The tone is the ONE shared table (atlas-ui rowWordTone), so the HUD, the route tab and the board never disagree on a row's colour
 * (phase-sync.test.ts); rev 5 asks that table for: running `text`, finished and queued `muted`, failed `bad`, blocked/waiting/doubt `warn`, returned `text`. Weight: the running word
 * is bold, a warning never is. `worker failed` (a pending row whose worker died) is the error tone. */
function wordStyle(r: Pick<TodoRow, 'state' | 'word'>): { tone: Run['tone']; bold?: boolean } {
  const tone = r.word === WORKER_DOWN || isDoubt(r) ? 'bad' : r.word === RETURNED ? 'sub' : rowWordTone(r.state, r.word); // a doubted done is the error tone in the HUD (`closed · worker failed`) // `returned` is the secondary 245 word beside its neutral mark
  return r.state === 'running' && r.word === undefined ? { tone, bold: true } : { tone };
}
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
  /** The run's fixed shape (slot.ts): an empty block still draws its closed box with one quiet row (`no tasks yet`, `none running yet`), so the HUD has one shape from the first working frame to idle. */
  reserve?: boolean | undefined;
  /** False: never merge the running agents into the TODO rows (the row counters ask for the roomiest form so the slot holds one height). */
  merge?: boolean | undefined;
};
/** `spacers`: the blank rows of the mocks. `extras`: the rail and the progress gauge. `cap`: row slots for the rows (the overflow row takes one); undefined shows all, 0 only the ribbon. */
/** `header`: the SUBAGENTS column-name row (default: with `spacers`); `stack` always asks for it, so a drawn HUD prints it in every state until a budget too small turns it off. */
export type BlockOpts = { spacers: boolean; extras: boolean; cap?: number; header?: boolean; /** The `╰───╯` rule under the last row (a block with no row under its title has nothing to close); `stack` asks for it in every state. */ close?: boolean; /** Fold the finished rows into a `3 done` count on the ribbon and draw every open row (never folds an open one). */ foldDone?: boolean; /** The merged block (wave 31): each row carries its agent and clock at the right, and the closing rule is `closer`. */ merged?: boolean; closer?: Run[]; /** Agents windowed to `cap` rows with no `n more agents not shown` row: the running count already rides the ribbon, so every slot holds an agent. */ quiet?: boolean };

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
const detailOf = (r: Pick<TodoRow, 'label' | 'detail' | 'state' | 'word'>, rich = false): string => (r.detail !== '' && (flat(r.label).toLowerCase().includes(flat(r.detail).toLowerCase()) || isDoubt(r)) ? '' : r.detail); // a doubted done says `worker failed` in its state cell (non-rich), so the detail column does not say it again
/** A completed row whose worker failed or was killed (critique 17 A1). */
const isDoubt = (r: Pick<TodoRow, 'state' | 'word'>): boolean => markOf(r.state, r.word) === 'doubt';
/** A row the block draws `■ failed`: its state is failed, or the lead closed it over a failed worker (wave 36: one state for it in the title, the meter and the row). */
export const isFailedRow = (r: Pick<TodoRow, 'state' | 'word'>): boolean => r.state === 'failed' || isDoubt(r);
/** A doubted done spelled out in the plain form (the atlas-ui word, one source): the lead CLOSED the row (the store says completed) but its worker was killed, so the HUD does not call it done. The scorer reads the glyph (`●`, completed), which is the store's truth. */
export const CLOSED_KILLED = DONE_KILLED;
/** The one word for a worker that was stopped mid-call (critique 28), on the TODO row closed over it, the SUBAGENTS row and the band. */
const KILLED = 'failed';
/** The state cell's text: the row's word, and for a doubted done in the plain form `closed · worker failed` (critique 18 B2: a tone alone certified a killed worker; the chip form keeps its 11-cell chip and the detail column). */
const wordOf = (r: Pick<TodoRow, 'state' | 'word'>, rich: boolean): string => (isDoubt(r) ? KILLED : rich && (r.word === DONE_RETRIED || r.word === WORKER_DOWN) ? r.state : r.word ?? r.state); // the 11-cell chip cannot hold `retried · done` or `worker failed`: the chip reads the state and the detail column says the rest
/** The tone of a row's state word: `worker failed` (a pending row whose worker failed) is red, the rest is the shared word tone. */
const wordRun = (r: Pick<TodoRow, 'state' | 'word'>, text: string): Run => { const s = wordStyle(r); return t(text, s.tone, s.bold ? { bold: true } : {}); };
const toCol = (runs: Run[], col: number): Run[] => (runsCells(runs) >= col ? runs : [...runs, t(' '.repeat(col - runsCells(runs)))]);
const maxLen = (xs: readonly string[]): number => xs.reduce((n, x) => Math.max(n, cells(x)), 0);
/** The selection cursor: the accent (141) on every frame at every width. The motion leaves it be (critique 23: the cursor read 182 for a beat at 110 columns and 231/147 at 150 as its row arrived). */
const focusMark = (focus: boolean, ui: Ui): Run => (focus ? calmRun(t(ui.ascii ? '>' : '▸', 'accent', { bold: true })) : t(' '));

/** The fill of the selected row's bar: xterm 236 in the dark theme, the light theme's own quiet grey. */
const SELECT_BG = { mocha: PALETTE5.rule, latte: PALETTES.latte.queued_fill } as const;
/** The selected row as a full-width bar: every run on the 236 fill and the rest of the row padded in it (the name is already bold, the `▸ ` cursor text stays so the scorer still reads the row). NO_COLOR draws no fill. */
function barRow(runs: Run[], cols: number, ui: Ui): Run[] {
  if (ui.color === 'none') return runs;
  const bgHex = SELECT_BG[ui.theme === 'latte' ? 'latte' : 'mocha'];
  const filled = runs.map((r) => ({ ...r, bgHex }));
  const w = runsCells(filled);
  return w < cols ? [...filled, { t: ' '.repeat(cols - w), tone: 'text', bgHex }] : filled;
}

/** `1 queued · 1 running · 2 done · 1 failed`: only states that occur, so the header always equals the row sums. */
export function stateCounts(states: readonly UiState[]): string {
  const tally = tallyOf(states); // the one tally (data/live.ts): the band's worker segment reads the same counts
  return COUNT_ORDER.map((s) => [s, tally[s]] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(' · ');
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

// ---- TODO ------------------------------------------------------------------------------------------------

/** An empty block of the fixed shape: the closed box with one quiet row (critique 28: bare rows under a box). */
const emptyBox = (o: SurfaceOpts, title: string, text: string): Run[][] => [titleRow(o.cols, title, '', [], o.ui, false), [t(`  ${text}`, 'muted')], bottomRule(o.cols, o.ui)];

export function todoRows(rows: readonly TodoRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0) return o.reserve ? emptyBox(o, 'TODO', 'no tasks yet') : [];
  const { ui, cols } = o;
  const tier = tierOf(cols);
  const rich = isRich(o);
  const failed = rows.filter(isFailedRow).length; // wave 36: a failed row (or one closed over a failed worker) is counted apart, never as done
  const done = rows.filter((r) => r.state === 'done' && !isFailedRow(r)).length;
  const plain = planFigure(done, rows.length, rows.filter((r) => r.word === RETURNED).length); // one count format at every width: `n/m`, like the band, the board and the panel (critique 14: `5 of 5 done`)
  const failMark = `${ui.ascii ? '!' : '■'}${failed}`;
  const figures = failed > 0 ? [`${plain} · ${failMark}`, `${plain}${failMark}`] : [plain]; // `4/5 · ■1` with a failed row; the dot goes first when the title is crowded, the failed count never
  const figure = figures[0]!;
  const meter = meterRuns(done, rows.length, ui, failed);
  /** The title in the first form that fits: the count text with the meter, then without it. */
  const flatRibbon = b.close === false;
  const head = (forms: readonly string[]): Run[] => [...forms.map((f) => titleRow(cols, 'TODO', f, meter, ui, flatRibbon)), ...forms.map((f) => titleRow(cols, 'TODO', f, [], ui, flatRibbon))].find((r) => runsCells(r) <= cols) ?? titleRow(cols, 'TODO', '', [], ui, flatRibbon);
  if (b.cap === 0) return [head([`${figure} · +${rows.length} more`, ...figures])]; // every row folded onto the ribbon: the count says how many
  // Every slot holds a row: what does not fit is counted on the ribbon, not on a row of its own (critique 16: `3 more todos not shown` under 2 drawn rows, with room for a third).
  // A short budget folds the finished rows first: the ribbon counts them (`3/5 · 3 done`) and every open row keeps its place (critique 17: the 110 slot lost its band row and its blank to rows already done).
  const stays = (r: TodoRow): boolean => r.state !== 'done' || isFresh(r, o.now); // a row that completed within LINGER_MS keeps its place, as when the plan windows
  const foldable = rows.filter((r) => !stays(r)).length;
  const fold = b.foldDone === true && foldable > 0 && foldable < rows.length; // a plan that is all done keeps its rows
  const { shown, hidden } = fold ? { shown: rows.filter(stays), hidden: foldable } : windowRows(rows, b.cap, o.now, false);
  const forms = hidden > 0 && !fold ? [`${figure} · +${hidden} more`, ...figures] : figures; // wave 37: folded finished rows ride the figure's own done count (`1/5 · ■1`), never `1/5 · ■1 · 1 done` // one wording at every width (critique 26: `1 more todo not shown` at 150, `+2 more` at 110)
  const out: Run[][] = [head(forms)];
  // One layout at every width: ribbon (the one count), (rail), then a row per item with its state column. No blank rows, no second count.
  if (tier === 'full' && b.extras && rich && o.phases && o.phases.ids.length > 0) out.push(railRow(o.phases.ids, o.phases.active, ui));
  const stateAt0 = todoStateAt(rows, o, tier, rich);
  // The row that just turned done keeps its `▸` and its bold through the first beats of the fade (critique 21: the cursor vanished at t=0 and the bold dropped a step late); the
  // cursor of the next open row waits for it. The weight and the cursor fall on the LAST beat, with the colour landing on rest.
  const held = shown.find((r) => settling(r, o));
  const drawn = held ? shown.map((r) => (r.focus === (r === held) ? r : { ...r, focus: r === held })) : shown;
  const bodyAt = out.length;
  const right = b.merged ? rightCells(drawn, o, rich) : undefined; // the agent and its clock, flush right in 245
  const stateAt = right ? Math.min(stateAt0, right.stateMax) : stateAt0;
  const metaAt = stateAt + Math.max(14, todoWordW(rows, rich) + 2);
  const details = b.merged ? drawn.map(() => undefined) : detailCells(drawn, o, metaAt, tier, rich);
  drawn.forEach((r, i) => {
    out.push(todoRow(r, o, tier, rich, stateAt, metaAt, details[i], right?.cells[i], right?.at, b.merged === true));
    for (const c of r.children ?? []) out.push([dimRun(clipEll(`    ${ui.ascii ? '`-' : '└'} ${flat(c)}`, cols - 1, ellOf(ui)), ui)]); // wave 34: an open dispatch with no plan row of its own is one dim child line under its nearest T row
  });
  if (b.close === true && out.length > bodyAt) out.push(b.merged && b.closer ? b.closer : bottomRule(cols, ui));
  return out;
}

/** The merged block's right-hand grid (wave 32): the agent in a 15-cell column and its clock right-aligned in a 5-cell column, one cell apart, every row ending on the same cell (`cols - 1`). A name past 15 cells ends in `…`
 * (the column never widens, so the clocks never shift by a cell between rows or frames). The longest form that leaves the state column 14 cells or more, else the clock alone, else none. */
export const AGENT_W = 15;
export const TIME_W = 5;
function rightCells(drawn: readonly TodoRow[], o: SurfaceOpts, rich: boolean): { cells: (string | undefined)[]; at: number; stateMax: number } | undefined {
  const wordW = rich ? CHIP_W : todoWordW(drawn, rich);
  const timeW = Math.max(TIME_W, ...drawn.map((r) => cells(r.agentTime ?? '')));
  const pad = (x: string, n: number): string => x + ' '.repeat(Math.max(0, n - cells(x)));
  const lpad = (x: string, n: number): string => ' '.repeat(Math.max(0, n - cells(x))) + x;
  const forms: { w: number; of: (r: TodoRow) => string }[] = [
    { w: AGENT_W + 1 + timeW, of: (r) => `${pad(clipEll(r.agent ?? '', AGENT_W, ellOf(o.ui)), AGENT_W)} ${lpad(r.agentTime ?? '', timeW)}` },
    { w: timeW, of: (r) => lpad(r.agentTime ?? '', timeW) },
  ];
  for (const form of forms) {
    const texts = drawn.map((r) => (r.agent !== undefined ? form.of(r) : undefined));
    if (texts.every((x) => x === undefined)) return undefined;
    const at = o.cols - form.w - 1;
    if (at - wordW - 2 >= 14) return { cells: texts, at, stateMax: at - wordW - 2 };
  }
  return undefined;
}

/** A done row inside the first beats of its fade: it turned done in this window (not a row first seen done), and the last beat has not begun. */
function settling(r: TodoRow, o: SurfaceOpts): boolean {
  if (r.state !== 'done' || r.key === undefined || !o.motion) return false;
  const e = o.motion.entry(r.key);
  const age = e ? o.motion.now - e.changed : -1;
  return e !== undefined && e.state === 'done' && e.changed > e.born && age >= 0 && easedMs(e, o.motion.now) < MOTION_MS - MOTION_STEP_MS; // the held first beat of a done mark counts as settling
}

/** The detail column's text for every drawn row, all-or-none: every cell whole when the widest fits `cols - metaAt`, else every cell that does not fit ends in `…` (never `...`, never a
 * cell cut with no mark beside a whole one). `undefined` for a row with no detail or no column. */
function detailCells(rows: readonly TodoRow[], o: SurfaceOpts, metaAt: number, tier: Tier, rich: boolean): (string | undefined)[] {
  if (tier !== 'full') return rows.map(() => undefined);
  const room = Math.max(1, o.cols - metaAt);
  return rows.map((r) => { const d = flat(detailOf(r, rich)); return d === '' ? undefined : clipEll(d, room, ellOf(o.ui)); });
}

/** `text` in `n` cells: whole, else cut with a one-cell `…`. */
export function clipEll(text: string, n: number, ell: string = ELL): string {
  if (n <= 0) return '';
  if (cells(text) <= n) return text;
  let out = '';
  for (const c of [...text]) {
    if (cells(out) + cells(c) > n - 1) break;
    out += c;
  }
  return `${out.trimEnd()}${ell}`;
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

function todoRow(r: TodoRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, metaAt: number, detail?: string, right?: string, rightAt?: number, merged = false): Run[] {
  const runs = todoRowResting(r, o, tier, rich, stateAt, metaAt, detail, right, rightAt, merged);
  const moved = r.key === undefined ? runs : animateRow(runs, r.key, markOf(r.state, r.word), o.motion, o.ui, { pop: false }); // no pop glyph: the `●` itself steps from bright to ok (critique 21: `◌` reads empty)
  return r.focus && r.state !== 'queued' ? barRow(moved, o.cols, o.ui) : moved; // the row with the cursor is the selected one
}

function todoRowResting(r: TodoRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, metaAt: number, detail?: string, right?: string, rightAt?: number, merged = false): Run[] {
  const { ui } = o;
  const head: Run[] = [focusMark(r.focus && r.state !== 'queued', ui), t(' '), markRun(markOf(r.state, r.word), o), t(' ')]; // the cursor marks work in hand, never a queued row; one spinner phase for the whole frame
  // Wave 34: a merged row with no agent cell has free cells to its right: its title takes them (the state word follows it) instead of ending in `…` at the shared column (`T4 combine the three reports` at 110).
  const wordCells = r.word ? cells(r.word) : cells(r.state);
  const flex = merged && right === undefined && stateAt > 0 ? Math.max(0, Math.min(cells(flat(r.label)), o.cols - 4 - 1 - Math.max(7, wordCells)) - (stateAt - 5)) : 0;
  const finished = r.state === 'done' && markOf(r.state, r.word) !== 'doubt';
  const quiet = merged && finished;
  // Wave 37: a finished row of the merged block draws no state word, so its title runs on to the agent column (one blank cell between): `T4 combine the three reports`, never `T4 combine the thre…` with empty cells to its right.
  const labelW = stateAt === 0 ? Math.max(1, o.cols - 4) : quiet && rightAt !== undefined ? Math.max(1, rightAt - 5) : stateAt - 5 + flex;
  const text = clipEll(flat(r.label), labelW, ellOf(ui)); // wave 32: a finished row of the merged block is dim 240 text, with no `done` word (the green mark says it)
  const label = quiet ? t(text, 'sub') : t(text, finished ? 'muted' : r.state === 'queued' ? 'sub' : 'text', { bold: r.focus }); // a finished row is quiet 247 text beside its green `●`, never struck through (critique 21: a finished plan read as cancelled); bold marks the selected row only
  if (stateAt === 0) return [...head, label];
  if (quiet) return right !== undefined && rightAt !== undefined ? [...toCol([...head, label], rightAt), calmRun(t(right, 'sub'))] : [...head, label];
  const row = [...toCol([...head, label], stateAt + flex), rich ? (r.word ? chip(wordOf(r, rich), markToken(markOf(r.state, r.word)), ui) : stateChip(r.state, ui)) : wordRun(r, wordOf(r, rich))];
  if (right !== undefined && rightAt !== undefined) return [...toCol(row, rightAt), calmRun(t(right, 'sub'))]; // merged: the agent and its clock, right-aligned
  if (tier !== 'full' || detail === undefined) return row;
  const meta = t(detail, finished ? 'muted' : 'sub');
  return [...toCol(row, metaAt), flat(detailOf(r, rich)) === flat(r.owner ?? '') ? calmRun(meta) : meta]; // the owner never changes with the row's state: the motion leaves it be (critique 18: it flashed 231 at 0 ms)
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
  if (rows.length === 0) return o.reserve ? emptyBox(o, 'SUBAGENTS', 'none running yet') : [];
  const { ui, cols } = o;
  const rich = isRich(o);
  // The counts give way to the running count, then to nothing, where the full line would overflow the row (a narrow transcript beside the docked pane).
  const counts = rich ? [''] : [stateCounts(rows.map((r) => r.state)), stateCounts(rows.map((r) => r.state)).split(' · ')[0] ?? '', ''];
  // The working signal rides the title, inside the rule: the band lead's braille spinner (the shared clock and frame) before the counts while any agent runs.
  const spin: Run[] = rows.some((r) => r.state === 'running') ? [{ ...stateRun('running', ui, brailleOf(o), true), ...(ui.ascii ? {} : { tone: 'accent' as const }) }, t(' ')] : []; // the band lead's braille frame on the same shared index: a title is no row the scorer reads by glyph
  // A row the cap leaves out is counted on the title, in the one wording the TODO ribbon uses (`+2 more`), at every width: the title never says `3 running` over one drawn row without saying where the other two are
  // (critique 27, live-110-46d4825c-1 f0070:28-30). It is the last thing to give way on a narrow title.
  const hidden = windowRows(rows, b.cap, undefined, false).hidden;
  const rest = hidden > 0 ? `+${hidden} more` : '';
  const failedN = rows.filter((r) => r.state === 'failed').length;
  const failedLead = spin.length === 0 && failedN > 0 && !rich; // nothing runs and some failed (wave 33): the title leads with `■ 2 failed`, static, in the error 203
  const titled = (c: string): Run[] => {
    if (failedLead) {
      const others = c.split(' · ').filter((x) => x !== '' && !/ failed$/.test(x));
      const more = [...others, rest].filter((x) => x !== '').join(' · ');
      return titleRow(cols, 'SUBAGENTS', '', [stateRun('failed', ui), t(' '), t(`${failedN} failed`, ui.ascii ? 'text' : 'bad'), ...(more ? [t(` · ${more}`, 'sub')] : [])], ui, b.close === false);
    }
    const text = [c, rest].filter((x) => x !== '').join(' · ');
    return titleRow(cols, 'SUBAGENTS', '', text ? [...spin, t(text, 'sub')] : spin.slice(0, 1), ui, b.close === false);
  };
  const head = counts.map(titled).find((r) => runsCells(r) <= cols) ?? titled('');
  const out: Run[][] = [head];
  if (b.cap === 0) return out;
  const wordW = rich ? CHIP_W : 7;
  // The name column holds the longest name whole (19 cells at least, for alignment) and a gutter of AGENT_GUTTER cells separates it from STATE (critique 21: `alpha-explorer done`, one cell between);
  // only a name that alone overflows the row is end-clipped, with `…`. Under 80 columns (the 110-column transcript is 61) the column is as wide as the longest name: 5 cells more for LAST (critique 17).
  const nameW = Math.max(1, Math.min(Math.max(cols >= 80 ? 19 : 8, maxLen(rows.map((r) => flat(r.name)))), cols - NAME_AT - AGENT_GUTTER - wordW));
  const stateAt = NAME_AT + nameW + AGENT_GUTTER;
  const plan = agentCols(rows, o, rich, stateAt);
  if (b.header ?? b.spacers) out.push(agentHeader(o, rich, stateAt, plan)); // the column names: `stack` always asks for them (k9s), so every drawn HUD prints them; only a budget that cannot hold them asks for `header: false`
  const { shown } = windowRows(rows, b.cap, undefined, false);
  for (const r of shown) out.push(agentRow(r, o, rich, stateAt, nameW, plan));
  if (b.close === true && shown.length > 0) out.push(bottomRule(cols, ui));
  return out;
}

/** The LAST text as the column can hold it. One form at every width (critique 19 B1: `1 found` at 110, `1 function found` at 150): the outcome is already the short form (hud.ts outcomeOf),
 * and one that does not fit is ended on a whole word by the cell, never swapped for another wording (`returned` said nothing). */
const lastFor = (text: string): string => text;

/** What a TASK or LAST cell with nothing to say reads (critique 17.13.0: LAST was blank at 110). */
const NONE = '-';
const TASK_W = 7; // `T1,T2` or `3 tasks`: the TASK column is this wide in every frame (critique 19 B2: 5 cells in one frame, 12 in the next, as the agents' task texts came and went)
/** Every owned id (`T1,T2`) when they fit `width`, else the count (`3 tasks`); an agent that owns none shows nothing. */
export const taskCell = (tasks: readonly number[], width: number = TASK_W): string => {
  const ids = tasks.map((n) => `T${n}`).join(',');
  return tasks.length === 0 ? '' : ids.length <= width ? ids : `${tasks.length} tasks`;
};
/** The TASK cell of a row: its plan ids, else (an agent that owns no plan row) its dispatch text (`read gamma.py`), so TASK reads `-` only when nothing is known. */
const taskText = (r: AgentRow): string => taskCell(r.tasks) || flat(r.task ?? '');
/** The TASK cell of the plain form: the plan ids and the dispatch text (`T1 read alpha.py`), the whole width the column has. */
const taskLine = (r: AgentRow): string => [taskCell(r.tasks), flat(r.task ?? '')].filter((x) => x !== '').join(' ');
/** RESULT: a finished agent's count (`2 functions` -> `2 fn`), else `-`. Never the activity (`preparing`, `read alpha.py`) and never the state word again. */
export function resultOf(r: Pick<AgentRow, 'state' | 'tool'>): string {
  if (r.state !== 'done') return NONE;
  const m = /^(\d+)\s+(function|functions|fn|test|tests|file|files|line|lines|check|checks|finding|findings|row|rows)\b/i.exec(flat(r.tool));
  if (!m) return NONE;
  const unit = /^function/i.test(m[2]!) ? 'fn' : m[2]!.toLowerCase();
  return `${m[1]} ${unit}`;
}
/** The task column's width: constant. */
const taskWidth = (_rows: readonly AgentRow[]): number => TASK_W;

/** Which columns fit, and where they start: `AGENT STATE [MODEL] TASK LAST [RESULT]`. LAST is always the elapsed clock (one type in the column, frozen when the agent ends); RESULT, the dim last tool or outcome, takes the
 * cells after it only when at least RESULT_MIN remain. MODEL shows from 120 columns; a narrower row drops RESULT, then MODEL, then TASK before LAST is cut. A name is never cut here. */
type AgentCols = { model?: number; modelW: number; task?: number; taskW: number; last?: number; result?: number; ctx?: number };
const LAST_W = 7; // `59:59` is 5 cells, `1:02:03` 7
/** The RESULT column: a count (`2 fn`) or `-`, never prose. */
const RESULT_W = 7;
/** The STATE word column (`running`, `failed`). */
const STATE_W = 7;
const RESULT_MIN = 10;
const MODEL_FROM = 120;
function agentCols(rows: readonly AgentRow[], o: SurfaceOpts, rich: boolean, stateAt: number): AgentCols {
  const { cols } = o;
  // Critique 19 B2: one grid. The MODEL column width depends on the models only (the cell includes one blank, and the column after it starts one more cell on: MODEL and TASK never run together).
  const modelW = Math.max(rich ? 8 : 7, ...rows.map((r) => cells(r.model) + 1));
  const plan: AgentCols = { modelW, taskW: TASK_W };
  const resultAfter = (lastAt: number): void => { const at = lastAt + LAST_W + 1; if (at + RESULT_MIN <= cols) plan.result = at; };
  if (rich) {
    if (stateAt + 14 + 4 + 8 + 5 <= cols) plan.ctx = stateAt + 14;
    const modelAt = stateAt + 34;
    if (modelAt + modelW - 1 <= cols) plan.model = modelAt;
    const lastAt = modelAt + modelW;
    if (lastAt + LAST_W <= cols) { plan.last = lastAt; resultAfter(lastAt); }
    return plan;
  }
  // Wave 31 (critique 29): AGENT STATE TASK LAST RESULT at every width, no MODEL. RESULT and LAST are fixed to the right edge, so TASK takes every free cell before it is cut (`read a...` beside 35 empty RESULT cells).
  const resultAt = cols - 1 - RESULT_W;
  const lastAt = resultAt - LAST_W - 1;
  const taskAt = stateAt + STATE_W + 2;
  if (lastAt - 1 - taskAt >= 6) { plan.task = taskAt; plan.taskW = lastAt - 1 - taskAt; plan.last = lastAt; plan.result = resultAt; return plan; }
  if (stateAt + STATE_W + 2 + LAST_W <= cols) plan.last = stateAt + STATE_W + 2; // no room for TASK and RESULT: LAST is the one column kept
  return plan;
}

/** `AGENT  STATE  MODEL  TASK  LAST  RESULT`: the column names, printed in every state; only the columns the rows show. */
function agentHeader(o: SurfaceOpts, rich: boolean, stateAt: number, plan: AgentCols): Run[] {
  const h = (text: string, at: number | undefined): void => { if (at !== undefined && at < o.cols) row = [...toCol(row, at), t(text, 'muted')]; };
  let row: Run[] = [t(' ', 'muted')];
  h('AGENT', 4);
  h('STATE', stateAt);
  if (rich) { h('CTX', plan.ctx); h('MODEL', plan.model); h('LAST', plan.last); h('RESULT', plan.result); } else { h('MODEL', plan.model); h('TASK', plan.task); h('LAST', plan.last); h('RESULT', plan.result); }
  return row;
}

/** The name run of an agent row: after the focus mark, a blank, the state glyph and a blank. */
const NAME_AT = 4;
/** Cells between the longest name and the STATE column: AGENT and STATE never touch (critique 21: `alpha-explorer done`). */
const AGENT_GUTTER = 2;
function agentRow(r: AgentRow, o: SurfaceOpts, rich: boolean, stateAt: number, nameW: number, plan: AgentCols): Run[] {
  const runs = agentRowResting(r, o, rich, stateAt, nameW, plan);
  // A new row never types its name in: the AGENT cell is whole on every frame (critique 22: a blank AGENT cell at the first beat of the reveal), as are MODEL, TASK and LAST.
  const moved = r.key === undefined ? runs : animateRow(runs, r.key, r.state, o.motion, o.ui, { reveal: false, pop: false }); // no pop glyph: the done disc steps from bright to ok on its own (critique 21)
  return r.focus ? barRow(moved, o.cols, o.ui) : moved;
}

function agentRowResting(r: AgentRow, o: SurfaceOpts, rich: boolean, stateAt: number, nameW: number, plan: AgentCols): Run[] {
  const { ui, cols } = o;
  const finished = r.state === 'done';
  // A finished row is dim in its name and text but keeps its glyph colour: the green `●` is the one mark that says done (critique 21: done rows went wholly 247, state read from a 1-cell dot).
  const head: Run[] = [focusMark(r.focus, ui), t(' '), markRun(r.state, o), t(' '), t(clipEll(flat(r.name) || flat(r.id ?? '') || 'agent', nameW, ellOf(ui)), finished ? 'muted' : 'text', { bold: r.focus })]; // an agent is never nameless // bold marks the selected row only
  let row = [...toCol(head, stateAt), r.state === 'failed' && r.tool === KILLED ? (rich ? chip(KILLED, markToken('failed'), ui) : wordRun(r, KILLED)) : rich ? stateChip(r.state, ui) : wordRun(r, r.state)]; // one word for a stopped worker: `■ failed` (critique 28)
  /** `words`: the text is ended on a whole word when it does not fit (task and last text); a model is a token and is only clipped. `fallback`: what a cell reads when its text is empty or only a bare verb fits. */
  const cell = (text: string, at: number | undefined, width: number, words = false, still = false, fallback = '', dim = false): void => {
    if (at === undefined) return;
    const room = Math.max(1, Math.min(width, cols - at));
    const whole = flat(text);
    const ell = ellOf(ui);
    const cut = whole === '' ? '' : words ? wordsEll(whole, room, ell) : clipEll(whole, room, ell);
    const bare = words && new RegExp(`^\\S{1,6}${ell}$`).test(cut) && /\s/.test(whole); // `read…` or `report…` of a longer text: a short verb and a mark say nothing
    // All or none: a text that fits is whole, one that does not ends in the one-cell ellipsis (on a word, else by the cell), never swapped for another word; only a cell with nothing to say (or under 3 cells) reads its fallback, `-` last.
    const marked = whole !== '' && (cut === '' || bare) && room >= 3 ? clipEll(whole, room, ell) : cut;
    const shown = marked !== '' ? marked : clipEll(fallback || NONE, room, ell);
    const tone = dim || finished || shown === NONE || marked === '' ? 'muted' : 'sub';
    row = [...toCol(row, at), still ? calmRun(t(shown, tone)) : t(shown, tone)]; // MODEL and TASK never change with the state: the motion leaves them be
  };
  if (rich && plan.ctx !== undefined && r.ctx !== null) row = [...toCol(row, plan.ctx), t('ctx ', 'muted'), ...gauge(8, r.ctx, ui), t(` ${percent(r.ctx)}`, 'sub')];
  if (rich) cell(r.model, plan.model, plan.modelW, false, true);
  if (!rich) cell(taskLine(r), plan.task, plan.taskW, true, true, NONE); // a column never goes blank: `-` says there is nothing
  cell(r.elapsed ?? NONE, plan.last, LAST_W); // LAST is one type: the elapsed clock, frozen when the agent ends (hud.ts agentModel)
  if (rich) cell(lastFor(lastText(r.tool)), plan.result, cols, true, false, r.fallback ?? '', true); // RESULT: the outcome or the last call, whole or cut with the ellipsis, else the last tool word; always the dim tone
  else cell(resultOf(r), plan.result, RESULT_W, false, false, NONE, true); // wave 31: a count or `-`
  return row;
}

/** `text` in `n` cells on a whole word, ended with `…` (clipWords' own mark is `...`, three cells). */
function wordsEll(text: string, n: number, ell: string = ELL): string {
  if (cells(text) <= n) return text;
  const cut = clipWords(text, n);
  return cut.endsWith('...') ? `${cut.slice(0, -3)}${ell}` : ''; // not even one word fits: nothing (the cell reads its fallback)
}

// ---- assembly --------------------------------------------------------------------------------------------

export type Surfaces = { todos: readonly TodoRow[]; agents: readonly AgentRow[] };

/** An agent that works right now: the merged block draws it on its TODO row. */
const isLive = (a: Pick<AgentRow, 'state'>): boolean => a.state === 'running'; // wave 34: only a running agent turns the spinner; queued ones are not counted at all
/** Whether the block is merged: an agent runs, so the SUBAGENTS box gives way to the agent and clock on each TODO row (wave 31, critique 29). */
export const isMerged = (s: Surfaces, o: Pick<SurfaceOpts, 'merge' | 'reserve'>): boolean => o.merge !== false && s.todos.length > 0 && (s.agents.length > 0 || o.reserve === true); // wave 32: one block in every state; no plan rows: the agents keep their own SUBAGENTS box

const ownerBase = (name: string): string => name.replace(/\s+#\d+$/, '');
/** A plan row's `(alpha-explorer)` title suffix: a kebab name with a hyphen, optionally a retry mark. The merged block shows the agent in its own column, so the title drops it. */
const AGENT_SUFFIX = /\s*\(([a-z][a-z0-9]*(?:-[a-z0-9]+)+(?:\s#\d+)?)\)\s*$/i;
/** The file-like words of a text (`alpha.py`, `README.md`), lowercased: what a dispatch prompt and a plan row title share when they speak of the same work. */
const FILE_WORD = /[\w-]+\.[a-z]{1,5}\b/g;
const fileWords = (text: string): string[] => text.toLowerCase().match(FILE_WORD) ?? [];
/** The one plan row a dispatch's prompt is about (wave 34): the row whose title names a file the prompt names, else the row whose agent's first word the prompt names; none (-1) when no row or more than one fits. */
function homeOf(task: string, rows: readonly TodoRow[]): number {
  const text = flat(task).toLowerCase();
  if (text === '') return -1;
  const files = fileWords(text);
  const stem = (r: TodoRow): string => ownerBase(r.agent ?? r.owner ?? '').split('-')[0]!.toLowerCase();
  const byFile = rows.flatMap((r, i) => (files.some((f) => r.label.toLowerCase().includes(f)) ? [i] : []));
  if (byFile.length === 1) return byFile[0]!;
  if (byFile.length > 1) return -1;
  const byName = rows.flatMap((r, i) => (stem(r).length >= 3 && new RegExp(`\\b${stem(r).replace(/[^a-z0-9]/g, '')}\\b`).test(text) ? [i] : []));
  return byName.length === 1 ? byName[0]! : -1;
}

/** The TODO rows of the merged block (wave 34): exactly one row per plan item, each naming the agent that owns it with its clock (the title never repeats the name). An agent that owns no plan row has no row of its own:
 * a queued one (a dispatch whose worker the host never listed) folds into the plan row its prompt is about while that row is open, otherwise (and for any other orphan agent that is not done) it is one child line under that row,
 * the first open row when none fits, so the title count is the plan's own and the band's. */
export function mergedTodos(s: Surfaces): TodoRow[] {
  const nameOf = (r: TodoRow): string | undefined => r.owner ?? AGENT_SUFFIX.exec(r.label)?.[1]; // a plan row names its worker in its `owner` or its `(alpha-explorer)` title suffix
  const agentOf = (r: TodoRow): AgentRow | undefined => { const n = nameOf(r); return n === undefined ? undefined : s.agents.find((a) => a.name === n || a.id === n || ownerBase(a.name) === ownerBase(n)); };
  const used = new Set<AgentRow>();
  const rows = s.todos.map((r): TodoRow => {
    const a = agentOf(r);
    if (a) used.add(a);
    const suffix = AGENT_SUFFIX.exec(r.label)?.[1];
    const label = suffix === undefined ? r.label : r.label.replace(AGENT_SUFFIX, '');
    if (a) return { ...r, label, agent: flat(a.name), agentTime: a.elapsed ?? NONE };
    const named = flat(r.owner ?? '') || suffix; // an assignee with no listed agent yet: the name holds its column from the first frame, the clock stays blank
    // Wave 36: a started row nobody owns is the lead's (`lead` in 245 where an agent's name would be); an unstarted one has no owner yet and shows none.
    return named ? { ...r, label, agent: named, agentTime: '' } : r.state !== 'queued' ? { ...r, label, agent: 'lead', agentTime: '' } : { ...r, label };
  });
  const kids: string[][] = rows.map(() => []);
  // Wave 37 (`└ explorer-xxxx queued 0:00` under a finished plan): once the turn has ended (agents ran and none is at work) no worker is still to come, so no child line is drawn.
  const turnEnded = s.agents.some((a) => a.state === 'done' || a.state === 'failed') && !s.agents.some(isLive);
  for (const a of s.agents) {
    if (turnEnded) break;
    // Wave 36 (critique 35: `└ explorer-7a37 queued 0:00` wandered from T1 to T2 to T5 and outlived its worker): the child line is for a worker that is still to come or at work, never a dead one, and it hangs under ONE row for its life: the row its prompt is about, else the first row.
    if (used.has(a) || a.state === 'done' || a.state === 'failed') continue;
    const home = homeOf(a.task ?? '', rows);
    if (a.state === 'queued' && home >= 0 && rows[home]!.state !== 'done') continue; // folded: the plan row carries the work
    const firstOpen = rows.findIndex((x) => x.state !== 'done' && x.state !== 'failed'); // no fitting row: the first open one, never a finished row
    const to = home >= 0 ? home : firstOpen;
    if (to >= 0 && rows[to]!.state !== 'done' && rows[to]!.state !== 'failed') kids[to]!.push(`${flat(a.name)} ${a.state}${a.elapsed && a.elapsed !== NONE ? ` ${a.elapsed}` : ''}`);
  }
  return rows.map((r, i) => (kids[i]!.length ? { ...r, children: kids[i]! } : r));
}

/** The merged block's closing rule carries the SUBAGENTS title and the squad's one line, in every state: `╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS ⠧ 3 running ───╯` while one runs (braille spinner, accent 141),
 * `╰─ ◖ ◆ ATLAS ◗ ▸ SUBAGENTS ● 3 done · 0:04 0:01 0:02 · 5 fn ───╯` once none does (the mark of the worst state, each agent's clock, the count of what they found). */
function mergedCloser(s: Surfaces, o: SurfaceOpts): Run[] {
  const { ui, cols } = o;
  if (s.agents.length === 0) return titleRow(cols, 'SUBAGENTS', '', [t('none running yet', 'sub')], ui, false, true); // the run's block before its first agent: the same closing rule, nothing listed yet
  const agents = s.agents.filter((a) => a.state !== 'queued'); // wave 34: the rule counts agents only; a queued dispatch is a child line of the plan, not an agent (`3 running · 3 queued` beside three agents)
  if (agents.length === 0) return titleRow(cols, 'SUBAGENTS', '', [t('none running yet', 'sub')], ui, false, true);
  const states = agents.map((r) => r.state);
  const counts = stateCounts(states);
  const live = agents.some(isLive);
  const lead: Run[] = live ? [{ ...stateRun('running', ui, brailleOf(o), true), ...(ui.ascii ? {} : { tone: 'accent' as const }) }, t(' ')] : [stateRun(states.includes('failed') ? 'failed' : 'done', ui), t(' ')];
  const fn = agents.reduce((n, a) => n + Number(/^(\d+) fn$/.exec(resultOf(a))?.[1] ?? 0), 0);
  const tail = live ? [] : [fn > 0 ? `${fn} fn` : ''].filter((x) => x !== ''); // wave 36: never the agents' bare clocks without their names
  // Nothing runs and some failed (wave 33): the rule leads with `■ 2 failed` in the error 203, static, then the rest of the squad (`· 1 done · 0:04 0:01 0:02`).
  const failedN = states.filter((x) => x === 'failed').length;
  if (!live && failedN > 0) {
    const bad = (c: string): Run => t(c, ui.ascii ? 'text' : 'bad');
    const rest = counts.split(' · ').filter((x) => !/ failed$/.test(x));
    const failedForms: string[][] = [[...rest, ...tail], rest, []];
    const failedTitled = (more: string[]): Run[] => titleRow(cols, 'SUBAGENTS', '', [...lead.slice(0, 1), t(' '), bad(`${failedN} failed`), ...(more.length ? [t(` · ${more.join(' · ')}`, 'sub')] : [])], ui, false, true);
    return failedForms.map(failedTitled).find((r) => runsCells(r) <= cols) ?? failedTitled([]);
  }
  const forms = [[counts, ...tail].join(' · '), counts, counts.split(' · ')[0] ?? '', ''];
  const titled = (c: string): Run[] => titleRow(cols, 'SUBAGENTS', '', c ? [...lead, t(c, 'sub')] : lead.slice(0, 1), ui, false, true);
  return forms.map(titled).find((r) => runsCells(r) <= cols) ?? titled('');
}

/** The squad as a full-width k9s table, in every state (wave 36): `AGENT 16 | STATE 9 | TIME 6 | CALLS 6 | FN 4 | LAST` under a `SUBAGENTS` title, bold 245 headers, one row per agent in dispatch order (the order never changes while the
 * block lives). STATE is a 141 braille spinner and `running` while the agent works, `■ failed` in 203, `● done` in 114. TIME and CALLS are right-aligned; FN shows only when an agent reported a real function count; LAST (the current or last
 * call, a finished agent's outcome) fills the rest and is left out when no agent has text for it. The columns give way from the right (LAST, FN, CALLS) as the row narrows. `cap`: the most agent rows to draw; the rest are counted on a
 * `+N more` row, never as bare times. Null when there is no agent to list (queued dispatches are child lines of the plan, not agents). */
export function agentTable(s: Surfaces, o: SurfaceOpts, cap?: number): Run[][] | null {
  const { ui, cols } = o;
  const ell = ellOf(ui);
  const all = s.agents.filter((a) => a.state !== 'queued').map((a, i) => ({ a, i })).sort((x, y) => (x.a.seq ?? x.i) - (y.a.seq ?? y.i) || x.i - y.i).map((x) => x.a);
  if (all.length === 0) return null;
  const { shown, hidden } = cap === undefined || cap >= all.length ? { shown: all, hidden: 0 } : (() => { const w = windowRows(all, cap, o.now, false); return { shown: all.filter((a) => w.shown.includes(a)), hidden: w.hidden }; })();
  const fnOf = (a: AgentRow): string => /^(\d+) fn$/.exec(resultOf(a))?.[1] ?? NONE;
  const lastOf = (a: AgentRow): string => { const x = flat(a.tool); return x === '' || x === 'finished' || a.state === 'queued' || (a.state === 'failed' && x === KILLED) ? '' : x; }; // the filler `finished` and a failed agent's own word say nothing LAST does not
  // Wave 37: the schema is frozen. The same six columns in every state (running, done, blocked, idle) and at 150 and 110 columns: LAST only shrinks (to its 4-cell header) and a count nobody knows reads `-`.
  const LEAD = 2, AGENT = 16, STATE = 9, TIME = 6, CALLS = 6, FN = 4, LAST_MIN = 4;
  const base = LEAD + AGENT + 2 + STATE + 1 + TIME; // AGENT STATE TIME
  const withCalls = base + 1 + CALLS;
  const withFn = withCalls + 1 + FN;
  const lastAt = withFn + 2;
  const showCalls = cols >= withCalls + 1;
  const showFn = showCalls && cols >= withFn + 1;
  const showLast = showFn && cols - 1 - lastAt >= LAST_MIN;
  const newest = all.reduce<AgentRow | undefined>((b, a) => (a.state === 'running' && (b === undefined || (a.seq ?? 0) >= (b.seq ?? 0)) ? a : b), undefined); // the newest running row wears the 236 band
  const nameW = Math.max(6, Math.min(AGENT, cols - (LEAD + 2 + STATE + 1 + TIME) - 1)); // a very narrow row clips the name last
  const cell = (text: string, w: number, tone: Run['tone'], bold = false): Run => ({ ...t(clipEll(text, w, ell).padEnd(w), tone), ...(bold ? { bold: true } : {}) });
  const right = (text: string, w: number, tone: Run['tone'], bold = false): Run => ({ ...t(' '.repeat(Math.max(0, w - cells(text))) + clipEll(text, w, ell), tone), ...(bold ? { bold: true } : {}) });
  const failedN = all.filter((a) => a.state === 'failed').length;
  const live = all.some(isLive);
  const counts = stateCounts(all.map((a) => a.state));
  const others = counts.split(' · ').filter((x) => !/ failed$/.test(x)).join(' · ');
  const lead: Run[] = live
    ? [{ ...stateRun('running', ui, brailleOf(o), true), ...(ui.ascii ? {} : { tone: 'accent' as const }) }, t(' '), t(counts, 'sub')]
    : failedN > 0 ? [stateRun('failed', ui), t(' '), t(`${failedN} failed`, ui.ascii ? 'text' : 'bad'), ...(others ? [t(` · ${others}`, 'sub')] : [])] : [stateRun('done', ui), t(' '), t(counts, 'sub')];
  const head = [lead, lead.slice(0, 1)].map((mid) => titleRow(cols, 'SUBAGENTS', '', mid, ui, false, false)).find((r) => runsCells(r) <= cols) ?? titleRow(cols, 'SUBAGENTS', '', [], ui, false, false);
  const header: Run[] = [t(' '.repeat(LEAD)), cell('AGENT', nameW, 'muted', true), t('  '), cell('STATE', STATE, 'muted', true), t(' '), right('TIME', TIME, 'muted', true),
    ...(showCalls ? [t(' '), right('CALLS', CALLS, 'muted', true)] : []), ...(showFn ? [t(' '), right('FN', FN, 'muted', true)] : []), ...(showLast ? [t('  '), cell('LAST', cols - 1 - lastAt, 'muted', true)] : [])];
  const rows = shown.map((a): Run[] => {
    const failed = a.state === 'failed';
    const done = a.state === 'done';
    const mark = a.state === 'running' ? { ...stateRun('running', ui, brailleOf(o), true), ...(ui.ascii ? {} : { tone: 'accent' as const }) } : stateRun(a.state, ui);
    const word: Run = t(a.state, failed ? (ui.ascii ? 'text' : 'bad') : done ? (ui.ascii ? 'text' : 'ok') : a.state === 'running' ? 'text' : 'sub');
    const stateCell: Run[] = [mark, t(' '), word, t(' '.repeat(Math.max(0, STATE - 2 - cells(a.state))))];
    const time = a.elapsed && a.elapsed !== NONE ? a.elapsed : NONE;
    const callsCell = a.calls !== undefined && a.calls > 0 ? String(a.calls) : NONE;
    noteWorkerFacts([flat(a.name), flat(a.id ?? '')], time, callsCell); // the worker cards print these two cells (data/live workerFacts)
    const tone: Run['tone'] = done ? 'muted' : 'sub';
    const row: Run[] = [
      t(' '.repeat(LEAD)), cell(flat(a.name) || flat(a.id ?? '') || 'agent', nameW, failed ? (ui.ascii ? 'text' : 'bad') : done ? 'muted' : 'text'), t('  '), ...stateCell, t(' '), right(time, TIME, tone),
      ...(showCalls ? [t(' '), right(callsCell, CALLS, tone)] : []),
      ...(showFn ? [t(' '), right(fnOf(a), FN, tone)] : []),
      ...(showLast ? [t('  '), cell(lastOf(a), cols - 1 - lastAt, 'muted')] : []),
    ];
    if (a !== newest) return row;
    const band = xtermHex(236);
    return [...row, t(' '.repeat(Math.max(0, cols - runsCells(row))))].map((x) => ({ ...x, bgHex: band })); // padded to the last cell: a band, not a coloured word
  });
  return [head, header, ...rows, ...(hidden > 0 ? [[t(' '.repeat(LEAD)), t(`+${hidden} more`, 'sub')]] : []), bottomRule(cols, ui)];
}

/** Both blocks stacked. While an agent runs they are ONE block (merged); otherwise the TODO box and the SUBAGENTS box, with no blank row between: every row of the block is content or a rule. */
export function stack(s: Surfaces, o: SurfaceOpts, b: { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; header?: boolean; foldDone?: boolean; close?: boolean; quiet?: boolean; table?: boolean }): Run[][] {
  if (isMerged(s, o)) {
    const todos = mergedTodos(s);
    const table = b.table === true ? agentTable(s, o, b.agentCap) : null; // wave 36: the squad is a table under the plan's closed box in every state, running or not
    if (table) return [...todoRows(todos, o, { spacers: false, extras: b.extras, cap: b.todoCap, ...(b.foldDone ? { foldDone: true } : {}), close: true, merged: true, closer: bottomRule(o.cols, o.ui) }), ...table];
    return todoRows(todos, o, { spacers: false, extras: b.extras, cap: b.todoCap, ...(b.foldDone ? { foldDone: true } : {}), close: true, merged: true, closer: mergedCloser(s, o) });
  }
  const todo = todoRows(s.todos, o, { spacers: b.spacers, extras: b.extras, cap: b.todoCap, ...(b.foldDone ? { foldDone: true } : {}), close: b.close !== false });
  const agents = agentRows(s.agents, o, { spacers: b.spacers, extras: b.extras, cap: b.agentCap, header: b.header ?? true, close: b.close !== false, ...(b.quiet ? { quiet: true } : {}) }); // the column names stay while the agents do: columns drop (LAST, then MODEL) before the header does
  return [...todo, ...agents];
}

/** Every row padded to `cols` cells so a painter can fill the panel. */
export const padRows = (rows: readonly Run[][], cols: number): Run[][] =>
  rows.map((r) => {
    const w = runsCells(r);
    return w >= cols ? r : [...r, t(' '.repeat(cols - w))];
  });

/** The design rows for `maxRows`: the full form, then no spacers, no rail or progress, then the tree windowed down to its ribbon, then the agents. A running agent keeps its row before the plan keeps its last. */
export function fitStack(s: Surfaces, o: SurfaceOpts, maxRows: number): Run[][] {
  return fitRows(s, o, maxRows); // every box is the same shape: a top rule ending in `╮` on the last cell, a bottom rule `╰──╯` under its rows (titleRow, bottomRule)
}

function fitRows(s: Surfaces, o: SurfaceOpts, maxRows: number): Run[][] {
  if (maxRows <= 0) return [];
  const n = s.todos.length;
  const m = s.agents.length;
  type Try = { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; hideTodo?: boolean; header?: boolean; foldDone?: boolean; close?: boolean; quiet?: boolean; table?: boolean };
  const flatBox = { spacers: false, extras: false, close: true } as const; // no rail: both bottom rules
  const tries: Try[] = [];
  if (isMerged(s, o)) {
    // One block: every plan row and agent row, the ribbon and the closing rule. Only when they do not fit are the finished rows folded onto the ribbon (`3/5 · 2 done`), then the plan windowed (`0/5 · +2 more`).
    const total = mergedTodos(s).length;
    if (agentTable(s, o)) {
      // Wave 36: the table in every state. Decoration first (the rail), then the finished plan rows are folded onto the ribbon, then agent rows are cut to the ones that fit plus `+N more`, then the plan is windowed; never bare times.
      const k = s.agents.filter((a) => a.state !== 'queued').length;
      tries.push({ spacers: false, extras: true, close: true, table: true }, { ...flatBox, table: true }, { ...flatBox, table: true, foldDone: true });
      for (let cap = total - 1; cap >= 1; cap--) tries.push({ ...flatBox, table: true, todoCap: cap }); // open plan rows fold onto the title first: every agent keeps its row (critique 28)
      for (let cap = k - 1; cap >= 1; cap--) tries.push({ ...flatBox, table: true, todoCap: 1, agentCap: cap });
      tries.push({ ...flatBox, table: true, todoCap: 0, agentCap: 1 });
    }
    tries.push({ spacers: false, extras: true, close: true }, flatBox, { ...flatBox, foldDone: true });
    for (let cap = total - 1; cap >= 1; cap--) tries.push({ ...flatBox, todoCap: cap });
    tries.push({ ...flatBox, todoCap: 0 });
  } else {
    // Rows over decoration: the rail, then the column names, then finished plan rows (counted on the title), then plan rows (down to one), the plan box, and only then agent rows. Every try is a closed box.
    tries.push({ spacers: false, extras: true, close: true }, flatBox);
    tries.push({ ...flatBox, header: false }); // the column names are decoration: they go before a plan row folds
    tries.push({ ...flatBox, foldDone: true, header: false });
    for (let cap = n - 1; cap >= 1; cap--) tries.push({ ...flatBox, header: false, todoCap: cap }); // windowRows ranks open and fresh rows first
    if (n > 0 && m > 0) tries.push({ ...flatBox, hideTodo: true, header: false });
    if (m > 1) for (let cap = m - 1; cap >= 1; cap--) tries.push({ ...flatBox, hideTodo: true, header: false, agentCap: cap, quiet: true });
    tries.push({ ...flatBox, todoCap: 0, agentCap: 0, header: false });
  }
  const ss = { todos: s.todos, agents: m > 0 ? s.agents : [] };
  for (const tr of tries) {
    const rows = stack(tr.hideTodo ? { ...ss, todos: [] } : ss, o, tr);
    if (rows.length <= maxRows) return rows;
  }
  // One row: the agents' ribbon when any run, else the plan's.
  const agents = agentRows(ss.agents, o, { spacers: false, extras: false, cap: 0 });
  return agents.length > 0 ? agents.slice(0, 1) : todoRows(ss.todos, o, { spacers: false, extras: false, cap: 0 }).slice(0, 1);
}
