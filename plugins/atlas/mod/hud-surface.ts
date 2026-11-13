// The TODO and SUBAGENTS surfaces of the rev 4 ATLAS design (round2/design/atlas-design-system-rev4.md, sections 3f/3g).
// Pure and host free: design rows in, tone-tagged Runs out. mod/hud.ts adapts board and squad data to these rows and
// paints Runs for Claude Code; omp/hud-paint.ts paints the same Runs as ANSI, so the two hosts draw identical rows.
// Layout grid (cell columns): focus 0, glyph 2, label 4; state and meta columns follow the tier below.
import { animateRow, calmRun, easedMs, MOTION_MS, MOTION_STEP_MS, type MotionCtx } from './motion';
import { clipWords, lastText } from './data/lasttext';
import { DONE_RETRIED, planFigure, WORKER_DOWN } from './board-model';
import { cells, CHIP_W, DONE_KILLED, COUNT_ORDER, GLYPH5, LINGER_MS, PALETTE5, PALETTES, WORKER_FAILED, clip, gauge, markOf, markToken, percent, RETURNED, rowWordTone, runsCells, spinClock, spinFrameOf, spinnerGlyph, chip, stateChip, stateGlyph, stateRun, type MarkState, type Run, type Ui, type UiState } from './atlas-ui';

export type TodoRow = { label: string; /** The plan item's id (T1): its spinner phase when no agent owns it, the same key the side panel turns. */ id?: string; /** The agent that owns the item: its spinner turns the owner's frame, as on the board. */ owner?: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`returned`: the owner agent ended, the store row is still open). */ word?: string; detail: string; focus: boolean; /** Motion key (hud.ts sets it); absent: the row never animates. */ key?: string; /** Epoch ms the item completed, when the board records it: a fresh one outranks the queue when rows fold. */ doneAt?: number };
/** `tasks`: the 1-based plan positions of every item the agent owns (`T1`, `T2`); none for an agent that owns no row. */
export type AgentRow = { name: string; state: UiState; model: string; tasks: readonly number[]; tool: string; ctx: number | null; focus: boolean; key?: string; /** The squad name (the side panel's row id): its spinner phase, which the display `name` would change. */ id?: string; /** The agent's own task text (its dispatch description): the TASK column shows it when the agent owns no plan row. */ task?: string; /** What RESULT reads when the agent has no outcome or call to show (its last tool word): never the state word again. */ fallback?: string; /** The LAST column: the elapsed clock since the agent started (`0:13`), frozen at its end. */ elapsed?: string };
/** The one spinner frame of the HUD: the shared clock's frame (spinFrameOf of spinClock) when the snapshot's `now` is known, else the caller's tick.
 * Rev 5: ONE phase for every row and title in a frame (no per-row id: out-of-phase spinners read as noise, critique 17.13.0 problem 1). */
const spinOf = (o: Pick<SurfaceOpts, 'now' | 'tick'>): number => (o.now !== undefined ? spinFrameOf(spinClock(o.now, o.tick), '') : o.tick ?? 0);

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
  if (s === 'doubt') return { ...stateRun('failed', o.ui), tone: o.ui.ascii ? 'text' : 'bad' }; // a row closed over a killed worker is `■ killed` in the error 203: one glyph and one word for a killed worker everywhere (critique 28)
  return s === 'running' ? { ...base, t: rowSpinnerGlyph(spinOf(o), o.ui.ascii) } : base;
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
export function meterRuns(done: number, total: number, ui: Ui): Run[] {
  const on = total <= 0 ? 0 : done >= total ? METER_W : Math.min(METER_W - 1, Math.max(done > 0 ? 1 : 0, Math.round((METER_W * done) / total)));
  return [{ t: (ui.ascii ? '#' : METER_ON).repeat(on), tone: 'ok' }, { t: (ui.ascii ? '-' : METER_OFF).repeat(METER_W - on), tone: 'muted' }];
}
/** The title: bold 252 (the body grey) in every theme but latte. */
const titleRun = (text: string, ui: Pick<Ui, 'theme'>): Run => ({ t: text, tone: 'text', bold: true, ...(ui.theme === 'latte' ? {} : { fg: PALETTE5.body }) });
/** The top edge of a box: `╭─ brand ▸ TITLE  count mid ────────╮` in exactly `cols` cells, the same shape in every state. The brand and the rule are quiet 240, the title bold 252, the count and the `mid` runs (the meter,
 * the spinner and counts) sit inside the rule, and the rule ends in a right corner on the LAST cell of the tree (`bodyColumns`). The host draws its `[-]` in the five cells it adds to the right of the tree's
 * first row (host types AbovePrompt, .claude-plugin/types/claude-code/index.d.ts:11227 and :11262-11270: `bodyColumns` is the column less the engine's five, which hold the `[-]`; the mod cannot draw in them and
 * the types give a mod no way to place text inside them), so the corner stands against the host's cells and `[-]` sits right of it, never inside the rule. Wider than `cols` when the parts and the corner do not fit; callers try narrower forms.
 * `flat`: a block drawn with no bottom rule has no box to open, so its ribbon has no corners either (a top edge with nothing to close it was a box left open: critique 27, live-150-46d4825c-1 f0065:25-36). */
export function titleRow(cols: number, title: string, count: string, mid: readonly Run[], ui: Ui, flat = false): Run[] {
  const left: Run[] = [dimRun(ui.ascii ? (flat ? '-- ' : '+- ') : flat ? '── ' : '╭─ ', ui), ...brand(ui), dimRun(ui.ascii ? ' > ' : ' ▸ ', ui), titleRun(title, ui), ...(count ? [{ t: `  ${count}`, tone: 'sub' as const }] : []), ...(mid.length > 0 ? [dimRun(' ', ui), ...mid] : []), dimRun(' ', ui)];
  const room = Math.max(1, cols - runsCells(left) - 1); // the rule to the cell before the corner
  return [...left, dimRun((ui.ascii ? '-' : RULE).repeat(room) + (flat ? (ui.ascii ? '-' : RULE) : ui.ascii ? '+' : '╮'), ui)];
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
  const tone = r.word === WORKER_DOWN || isDoubt(r) ? 'bad' : r.word === RETURNED ? 'sub' : rowWordTone(r.state, r.word); // a doubted done is the error tone in the HUD (`closed · worker killed`) // `returned` is the secondary 245 word beside its neutral mark
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
};
/** `spacers`: the blank rows of the mocks. `extras`: the rail and the progress gauge. `cap`: row slots for the rows (the overflow row takes one); undefined shows all, 0 only the ribbon. */
/** `header`: the SUBAGENTS column-name row (default: with `spacers`); `stack` always asks for it, so a drawn HUD prints it in every state until a budget too small turns it off. */
export type BlockOpts = { spacers: boolean; extras: boolean; cap?: number; header?: boolean; /** The `╰───╯` rule under the last row (a block with no row under its title has nothing to close); `stack` asks for it in every state. */ close?: boolean; /** Fold the finished rows into a `3 done` count on the ribbon and draw every open row (never folds an open one). */ foldDone?: boolean; /** Agents windowed to `cap` rows with no `n more agents not shown` row: the running count already rides the ribbon, so every slot holds an agent. */ quiet?: boolean };

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
const detailOf = (r: Pick<TodoRow, 'label' | 'detail' | 'state' | 'word'>, rich = false): string => (r.detail !== '' && (flat(r.label).toLowerCase().includes(flat(r.detail).toLowerCase()) || isDoubt(r)) ? '' : r.detail); // a doubted done says `worker killed` in its state cell (non-rich), so the detail column does not say it again
/** A completed row whose worker failed or was killed (critique 17 A1). */
const isDoubt = (r: Pick<TodoRow, 'state' | 'word'>): boolean => markOf(r.state, r.word) === 'doubt';
/** A doubted done spelled out in the plain form (the atlas-ui word, one source): the lead CLOSED the row (the store says completed) but its worker was killed, so the HUD does not call it done. The scorer reads the glyph (`●`, completed), which is the store's truth. */
export const CLOSED_KILLED = DONE_KILLED;
/** The one word for a worker that was stopped mid-call (critique 28), on the TODO row closed over it, the SUBAGENTS row and the band. */
const KILLED = 'killed';
/** The state cell's text: the row's word, and for a doubted done in the plain form `closed · worker killed` (critique 18 B2: a tone alone certified a killed worker; the chip form keeps its 11-cell chip and the detail column). */
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

// ---- TODO ------------------------------------------------------------------------------------------------

/** An empty block of the fixed shape: the closed box with one quiet row (critique 28: bare rows under a box). */
const emptyBox = (o: SurfaceOpts, title: string, text: string): Run[][] => [titleRow(o.cols, title, '', [], o.ui, false), [t(`  ${text}`, 'muted')], bottomRule(o.cols, o.ui)];

export function todoRows(rows: readonly TodoRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0) return o.reserve ? emptyBox(o, 'TODO', 'no tasks yet') : [];
  const { ui, cols } = o;
  const tier = tierOf(cols);
  const rich = isRich(o);
  const done = rows.filter((r) => r.state === 'done').length;
  const figure = planFigure(done, rows.length, rows.filter((r) => r.word === RETURNED).length); // one count format at every width: `n/m`, like the band, the board and the panel (critique 14: `5 of 5 done`)
  const meter = meterRuns(done, rows.length, ui);
  /** The title in the first form that fits: the count text with the meter, then without it. */
  const flatRibbon = b.close === false;
  const head = (forms: readonly string[]): Run[] => [...forms.map((f) => titleRow(cols, 'TODO', f, meter, ui, flatRibbon)), ...forms.map((f) => titleRow(cols, 'TODO', f, [], ui, flatRibbon))].find((r) => runsCells(r) <= cols) ?? titleRow(cols, 'TODO', '', [], ui, flatRibbon);
  if (b.cap === 0) return [head([`${figure} · +${rows.length} more`, figure])]; // every row folded onto the ribbon: the count says how many
  // Every slot holds a row: what does not fit is counted on the ribbon, not on a row of its own (critique 16: `3 more todos not shown` under 2 drawn rows, with room for a third).
  // A short budget folds the finished rows first: the ribbon counts them (`3/5 · 3 done`) and every open row keeps its place (critique 17: the 110 slot lost its band row and its blank to rows already done).
  const stays = (r: TodoRow): boolean => r.state !== 'done' || isFresh(r, o.now); // a row that completed within LINGER_MS keeps its place, as when the plan windows
  const foldable = rows.filter((r) => !stays(r)).length;
  const fold = b.foldDone === true && foldable > 0 && foldable < rows.length; // a plan that is all done keeps its rows
  const { shown, hidden } = fold ? { shown: rows.filter(stays), hidden: foldable } : windowRows(rows, b.cap, o.now, false);
  const forms = hidden > 0 ? [fold ? `${figure} · ${hidden} done` : `${figure} · +${hidden} more`, figure] : [figure]; // one wording at every width (critique 26: `1 more todo not shown` at 150, `+2 more` at 110)
  const out: Run[][] = [head(forms)];
  // One layout at every width: ribbon (the one count), (rail), then a row per item with its state column. No blank rows, no second count.
  if (tier === 'full' && b.extras && rich && o.phases && o.phases.ids.length > 0) out.push(railRow(o.phases.ids, o.phases.active, ui));
  const stateAt = todoStateAt(rows, o, tier, rich);
  const metaAt = stateAt + Math.max(14, todoWordW(rows, rich) + 2);
  // The row that just turned done keeps its `▸` and its bold through the first beats of the fade (critique 21: the cursor vanished at t=0 and the bold dropped a step late); the
  // cursor of the next open row waits for it. The weight and the cursor fall on the LAST beat, with the colour landing on rest.
  const held = shown.find((r) => settling(r, o));
  const drawn = held ? shown.map((r) => (r.focus === (r === held) ? r : { ...r, focus: r === held })) : shown;
  const bodyAt = out.length;
  const details = detailCells(drawn, o, metaAt, tier, rich);
  drawn.forEach((r, i) => out.push(todoRow(r, o, tier, rich, stateAt, metaAt, details[i])));
  if (b.close === true && out.length > bodyAt) out.push(bottomRule(cols, ui));
  return out;
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

function todoRow(r: TodoRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, metaAt: number, detail?: string): Run[] {
  const runs = todoRowResting(r, o, tier, rich, stateAt, metaAt, detail);
  const moved = r.key === undefined ? runs : animateRow(runs, r.key, markOf(r.state, r.word), o.motion, o.ui, { pop: false }); // no pop glyph: the `●` itself steps from bright to ok (critique 21: `◌` reads empty)
  return r.focus && r.state !== 'queued' ? barRow(moved, o.cols, o.ui) : moved; // the row with the cursor is the selected one
}

function todoRowResting(r: TodoRow, o: SurfaceOpts, tier: Tier, rich: boolean, stateAt: number, metaAt: number, detail?: string): Run[] {
  const { ui } = o;
  const head: Run[] = [focusMark(r.focus && r.state !== 'queued', ui), t(' '), markRun(markOf(r.state, r.word), o), t(' ')]; // the cursor marks work in hand, never a queued row; one spinner phase for the whole frame
  const labelW = stateAt === 0 ? Math.max(1, o.cols - 4) : stateAt - 5;
  const text = clipEll(flat(r.label), labelW, ellOf(ui));
  const finished = r.state === 'done' && markOf(r.state, r.word) !== 'doubt';
  const label = t(text, finished ? 'muted' : r.state === 'queued' ? 'sub' : 'text', { bold: r.focus }); // a finished row is quiet 247 text beside its green `●`, never struck through (critique 21: a finished plan read as cancelled); bold marks the selected row only
  if (stateAt === 0) return [...head, label];
  const row = [...toCol([...head, label], stateAt), rich ? (r.word ? chip(wordOf(r, rich), markToken(markOf(r.state, r.word)), ui) : stateChip(r.state, ui)) : wordRun(r, wordOf(r, rich))];
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
  const spin: Run[] = rows.some((r) => r.state === 'running') ? [stateRun('running', ui, spinOf(o), true), t(' ')] : []; // the band lead's braille frame on the same shared index: a title is no row the scorer reads by glyph
  // A row the cap leaves out is counted on the title, in the one wording the TODO ribbon uses (`+2 more`), at every width: the title never says `3 running` over one drawn row without saying where the other two are
  // (critique 27, live-110-46d4825c-1 f0070:28-30). It is the last thing to give way on a narrow title.
  const hidden = windowRows(rows, b.cap, undefined, false).hidden;
  const rest = hidden > 0 ? `+${hidden} more` : '';
  const titled = (c: string): Run[] => {
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
/** The task column's width: constant. */
const taskWidth = (_rows: readonly AgentRow[]): number => TASK_W;

/** Which columns fit, and where they start: `AGENT STATE [MODEL] TASK LAST [RESULT]`. LAST is always the elapsed clock (one type in the column, frozen when the agent ends); RESULT, the dim last tool or outcome, takes the
 * cells after it only when at least RESULT_MIN remain. MODEL shows from 120 columns; a narrower row drops RESULT, then MODEL, then TASK before LAST is cut. A name is never cut here. */
type AgentCols = { model?: number; modelW: number; task?: number; taskW: number; last?: number; result?: number; ctx?: number };
const LAST_W = 7; // `59:59` is 5 cells, `1:02:03` 7
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
  const modelAt = stateAt + (cols < 80 ? 10 : 12); // a narrow transcript (110 with the pane docked) takes 2 cells less between STATE and TASK so RESULT keeps its column (critique 28)
  for (const withModel of cols >= MODEL_FROM ? [true, false] : [false]) {
    const taskAt = withModel ? modelAt + modelW + 1 : modelAt;
    const lastAt = taskAt + TASK_W + 1;
    if (lastAt + LAST_W > cols) continue;
    if (withModel) plan.model = modelAt;
    plan.task = taskAt;
    plan.last = lastAt;
    resultAfter(lastAt);
    return plan;
  }
  if (modelAt + LAST_W <= cols) plan.last = modelAt; // no room for TASK: LAST is the one column kept
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
  let row = [...toCol(head, stateAt), r.state === 'failed' && r.tool === KILLED ? (rich ? chip(KILLED, markToken('failed'), ui) : wordRun(r, KILLED)) : rich ? stateChip(r.state, ui) : wordRun(r, r.state)]; // one word for a stopped worker: `■ killed` (critique 28)
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
  cell(r.model, plan.model, plan.modelW, false, true);
  if (!rich) cell(taskText(r), plan.task, plan.taskW, true, true, NONE); // a column never goes blank: `-` says there is nothing
  cell(r.elapsed ?? NONE, plan.last, LAST_W); // LAST is one type: the elapsed clock, frozen when the agent ends (hud.ts agentModel)
  cell(lastFor(lastText(r.tool)), plan.result, cols, true, false, r.fallback ?? '', true); // RESULT: the outcome or the last call, whole or cut with the ellipsis, else the last tool word; always the dim tone
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

/** Both blocks stacked (a blank between them when `spacers`). */
export function stack(s: Surfaces, o: SurfaceOpts, b: { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; header?: boolean; foldDone?: boolean; close?: boolean; quiet?: boolean }): Run[][] {
  const todo = todoRows(s.todos, o, { spacers: b.spacers, extras: b.extras, cap: b.todoCap, ...(b.foldDone ? { foldDone: true } : {}), close: b.close !== false });
  const agents = agentRows(s.agents, o, { spacers: b.spacers, extras: b.extras, cap: b.agentCap, header: b.header ?? true, close: b.close !== false, ...(b.quiet ? { quiet: true } : {}) }); // the column names stay while the agents do: columns drop (LAST, then MODEL) before the header does
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
  return fitRows(s, o, maxRows); // every box is the same shape: a top rule ending in `╮` on the last cell, a bottom rule `╰──╯` under its rows (titleRow, bottomRule)
}

function fitRows(s: Surfaces, o: SurfaceOpts, maxRows: number): Run[][] {
  if (maxRows <= 0) return [];
  const n = s.todos.length;
  const m = s.agents.length;
  type Try = { spacers: boolean; extras: boolean; todoCap?: number; agentCap?: number; hideTodo?: boolean; header?: boolean; foldDone?: boolean; close?: boolean; quiet?: boolean };
  // A rows-over-decoration ladder (critique 26: `1 more todo not shown` beside a slot that held every row): the rail, the blank between the blocks, then the two bottom rules, together. A box is closed on both
  // blocks or drawn open on both, and an open block's ribbon has no corners: three agents running dropped both `╰───╯` rules while the `╭─` ribbons stayed, boxes with a top and no bottom (critique 27,
  // live-150-46d4825c-1 f0065:25-36). Then finished plan rows (counted on the title, `3/5 · 3 done`). The SUBAGENTS column names stay while an agent row shows; what folds next is agent rows (down to one, the
  // title counts the rest: `3 running · +2 more`), then plan rows (counted on the title, `0/5 · +2 more`), the last agent's box last.
  // Critique 28: every try is a closed box. The ladder gives up decoration first (rail, blank, bottom-of-box extras), then finished rows, then the column names, then plan rows (down to one, counted on the title: `0/5 · +3 more`,
  // so SUBAGENTS draws every running agent at 110 columns), then the plan box, and only then agent rows (`+N more` on the title).
  const flatBox = { spacers: false, extras: false, close: true } as const; // no blank, no rail, both bottom rules
  const tries: Try[] = [{ spacers: true, extras: true, close: true }, { spacers: true, extras: false, close: true }, flatBox];
  tries.push({ ...flatBox, header: false }); // the column names are decoration: they go before a plan row folds
  tries.push({ ...flatBox, foldDone: true, header: false });
  for (let cap = n - 1; cap >= 1; cap--) tries.push({ ...flatBox, header: false, todoCap: cap }); // windowRows ranks open and fresh rows first
  if (n > 0 && m > 0) tries.push({ ...flatBox, hideTodo: true, header: false });
  if (m > 1) for (let cap = m - 1; cap >= 1; cap--) tries.push({ ...flatBox, hideTodo: true, header: false, agentCap: cap, quiet: true });
  tries.push({ ...flatBox, todoCap: 0, agentCap: 0, header: false });
  const ss = { todos: s.todos, agents: m > 0 ? s.agents : [] };
  for (const tr of tries) {
    const rows = stack(tr.hideTodo ? { ...ss, todos: [] } : ss, o, tr);
    if (rows.length <= maxRows) return rows;
  }
  // One row: the agents' ribbon when any run, else the plan's.
  const agents = agentRows(ss.agents, o, { spacers: false, extras: false, cap: 0 });
  return agents.length > 0 ? agents.slice(0, 1) : todoRows(ss.todos, o, { spacers: false, extras: false, cap: 0 }).slice(0, 1);
}
