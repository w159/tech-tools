// panel-layout.ts: the one side panel layout both harnesses draw (design system rev 4, "SIDEPANEL" surface).
// The Claude Code pane (mod/pane/sidebar.tsx) and the omp painter (omp/panel-view.ts) are thin adapters: each builds a
// PanelModel from its own data, calls panelLines, and paints the runs (Elements on Claude Code, ANSI on omp). Parity
// is structural: the text both print comes from here, and the goldens (contracts/panel-golden.ts) assert it.
//
// Rules: marks come from the state glyph map in atlas-ui (queued, running, done, failed, blocked, waiting; never a
// literal check mark, bullet or ellipsis); every number carries its word; colour carries state only; truncation is
// `…` through `clipE`; the surface is the rev 4 panel token.
import { brandMark, capsule, cells, countRuns, DONE_KILLED, GRID_LEAD, meter, todoMeter, gridPlan, gridRow as gridRowAt, markOf, motionState, percent, ribbon, RETURNED, rowWordTone, spinFrameOf, stateGlyph, stateRun, stateWordTone, UI_STATES, gateMark, warnMark, type MarkState, type Run, type Tone, type Ui, type UiState } from './atlas-ui';
import { animateRow, type MotionCtx, type MotionItem } from './motion';
import { ELLIPSIS, clipE, labelCut, lightRibbon, planFigure } from './board-model';
import { hasCore, plannedText, tok, type CoreModel, type Verdict } from './data/core';
import { clipWords, lastText } from './data/lasttext';
import { blockReasons, gateTally, STOP_LINE, withCoreTally } from './data/runstate';
import { displayName } from './hud';
import { sortAgents } from './hud-surface';
import type { GateGroup } from './pane/sidebar-types';

export type PanelTab = 'route' | 'team' | 'channel' | 'gates' | 'core';
/** Tabs in strip order. Hotkeys: r t c g k (the board toggle `o` belongs to the band). */
export const PANEL_TABS: readonly { id: PanelTab; key: string; label: string }[] = [
  { id: 'route', key: 'r', label: 'route' }, { id: 'team', key: 't', label: 'team' }, { id: 'channel', key: 'c', label: 'channel' },
  { id: 'gates', key: 'g', label: 'gates' }, { id: 'core', key: 'k', label: 'core' },
];

/** The tab strip both hosts draw: the five views, then the board toggle (`o`; it opens the Board pane, it is not a view). The band's footer
 * buttons (mod/band.tsx BAND_BUTTONS) are this list. Each tab reads `k: label`, the key the host binds. */
export const STRIP_TABS: readonly { id: PanelTab | 'board'; key: string; label: string }[] = [...PANEL_TABS, { id: 'board', key: 'o', label: 'board' }];
/** Cells the `k: ` prefix of a strip tab takes. */
export const HOTKEY_W = 3;
/** Cells between strip tabs. */
export const STRIP_GAP = 2;

/** A strip tab as drawn: its id, hotkey and its label (always the whole word, the same on every surface: no `chan`, no two-letter form). */
export type StripTab = { id: PanelTab | 'board'; key: string; label: string };
/** Cells of padding between the pane's left rule and the strip (both hosts draw it). */
export const STRIP_PAD = 1;
/** Forms of the strip, widest first: the words; the same with one cell between tabs. The first form that fits the pane on one row is drawn;
 * none fitting, the words wrap onto a second row (never a shortened `chan` or a two-letter `rt tm ch` form). */
type StripForm = { gap: number; label: (id: string, full: string) => string };
const STRIP_FORMS: readonly StripForm[] = [{ gap: STRIP_GAP, label: (_, full) => full }];
const stripWidth = (tabs: readonly { label: string }[], gap: number, prefix: number = 0): number => tabs.reduce((n, t, i) => n + (i ? gap : 0) + prefix + cells(t.label), 0);
const formTabs = (f: StripForm): StripTab[] => STRIP_TABS.map((t): StripTab => ({ ...t, label: f.label(t.id, t.label) }));

/** Tabs per strip row: as many as fit in `inner` cells, each costing its label plus `prefix` cells and `gap` cells between; the rest wrap. */
export function stripRows<T extends { label: string }>(items: readonly T[], inner: number, gap: number = STRIP_GAP, prefix: number = HOTKEY_W): T[][] {
  const rows: T[][] = [];
  let used = 0;
  for (const it of items) {
    const w = prefix + cells(it.label);
    if (!rows.length || (rows[rows.length - 1]!.length && used + gap + w > inner)) { rows.push([]); used = 0; }
    rows[rows.length - 1]!.push(it);
    used += (rows[rows.length - 1]!.length > 1 ? gap : 0) + w;
  }
  return rows;
}

/** The strip both hosts draw at `cols` cells, after `STRIP_PAD` cells of padding (design rev 5, C1): the names alone, two spaces between, on one row down to 35 cells (one space
 * between below that), else the whole names wrapped. The key letters are never drawn in the strip: they stay bound (mod/pane/sidebar.tsx's zero-width layer), the band footer names
 * them and a dim line at the pane foot repeats them where there is room. The form depends on the width only, never on the lit tab. `bare` is therefore always true. */
export function stripLayout(cols: number, _lit?: string): { rows: StripTab[][]; gap: number; /** Always true: the `k: ` prefix is never drawn. */ bare: boolean } {
  const inner = Math.max(1, cols - STRIP_PAD);
  const wide = STRIP_FORMS[0]!;
  for (const gap of [wide.gap, 1]) {
    const words = formTabs(wide);
    if (stripWidth(words, gap, 0) <= inner) return { rows: [words], gap, bare: true };
  }
  return { rows: stripRows(formTabs(wide), inner, wide.gap, 0), gap: wide.gap, bare: true };
}

export type PanelTodo = { id: string; label: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`returned`). */ word?: string; owner?: string; detail?: string; evidence?: string | null };
export type PanelWorker = { name: string; role?: string; state: UiState; model?: string; task?: string; /** The dispatch description (`name: what to do`): the HUD's source for the one name every surface shows (displayName). */ goal?: string; detail: string; secs?: number; /** When the worker started and when its run ended (or now), in the snapshot clock's ms: the board's Gantt places its bar by them. */ startMs?: number; endMs?: number; tools?: number };
export type PanelGateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string; /** Only Stop decides it (data/runstate withPending): drawn `◇`. */ pending?: boolean };
export type PanelGate = { id: string; title: string; error?: string; lines: PanelGateLine[] };
export type PanelNote = { at: string; from: string; to?: string; kind?: string; text: string; lead?: boolean };

export type PanelModel = {
  cols: number;
  /** Row budget (the channel log keeps the newest `rows - 4` notes). */
  rows: number;
  ui: Ui;
  tab: PanelTab;
  /** Spinner frame the render reads when `now` is absent. */
  tick: number;
  /** The shared clock reading in ms: with it every spinner turns spinFrameOf(now, agent name), so one agent shows one frame on every row. */
  now?: number;
  expanded: string | null;
  recipient: string | null;
  phases: readonly string[];
  phase: string;
  todos: readonly PanelTodo[];
  workers: readonly PanelWorker[];
  /** The lead's own row (the Team tab lists it first); absent where the host has no lead to show (the design world). */
  lead?: PanelWorker;
  /** Roster members the squad does not list: shown after the workers, never counted in the ribbon or the agents row. */
  mates?: readonly PanelWorker[];
  gates: readonly PanelGate[];
  core?: CoreModel | null;
  channel?: string;
  people: number;
  unread: number;
  notes: readonly PanelNote[];
  /** Motion view (mod/motion.ts): rows with an entry are drawn mid-transition. Absent: the resting render. */
  motion?: MotionCtx | undefined;
};

/** A row a press acts on: `toggle` opens or closes `key`; `worker` also picks `name` as the message recipient; `copy` is
 * what a second press on an open row copies. */
export type Press = { kind: 'toggle' | 'worker'; key: string; name?: string; copy?: string };
export type PanelLine = { runs: Run[]; press?: Press };

// ---- run helpers ---------------------------------------------------------------------------------------------------

const r = (t: string, tone: Tone = 'text', o: Partial<Run> = {}): Run => ({ t, tone, ...o });
const line = (runs: Run[], press?: Press): PanelLine => (press ? { runs, press } : { runs });
export const BLANK: PanelLine = { runs: [] };
/** A row's runs mid-transition when the model carries a motion view (key: the row's entry; accent: the state that leads). */
const moving = (runs: Run[], key: string, accent: MarkState, m: Pick<PanelModel, 'motion' | 'ui'>): Run[] => animateRow(runs, key, accent, m.motion, m.ui);
const rowWidth = (runs: readonly Run[]): number => runs.reduce((n, x) => n + cells(x.t), 0);
const pad = (t: string, n: number): string => t + ' '.repeat(Math.max(0, n - cells(t)));
const cut = (t: string, n: number): string => pad(clipE(t, n), n);
/** The grammar row with every name cut at its end: a name is never cut in the middle on the panel. */
const gridRow = (spec: Parameters<typeof gridRowAt>[0]): Run[] => {
  // Every cut is a `…` (wave 24): the name and the word are cut here, the detail's own `...` (atlas-ui gridRow) is swapped after.
  const name = { ...spec.name, t: clipE(spec.name.t, Math.max(0, spec.nameW)) };
  const word = spec.word && spec.wordW ? { ...spec.word, t: clipE(spec.word.t, spec.wordW) } : spec.word;
  // `...` is three cells and `…` one: a swapped detail keeps its width (two spaces) while a value column follows, so the right-hand column stays aligned.
  const runs = gridRowAt({ nameCut: 'end', ...spec, name, ...(word ? { word } : {}) });
  return runs.map((x, i) => (x.t.length > 3 && x.t.endsWith('...') ? { ...x, t: `${x.t.slice(0, -3)}${ELLIPSIS}${i < runs.length - 1 ? '  ' : ''}` } : x));
};
const oneLine = (t: string | undefined | null): string => (t ?? '').replace(/\s+/g, ' ').trim();

/** Runs cut to `cols` cells: the run that overflows is clipped with `...`, the rest dropped. */
export function fitRuns(runs: readonly Run[], cols: number): Run[] {
  const out: Run[] = [];
  let left = Math.max(1, cols);
  for (const x of runs) {
    if (left <= 0) break;
    const t = cells(x.t) <= left ? x.t : clipE(x.t, left);
    out.push(t === x.t ? x : { ...x, t });
    left -= cells(t);
  }
  return out;
}
/** The plain text of runs. */
export const runsText = (runs: readonly Run[]): string => runs.map((x) => x.t).join('');
export const lineText = (l: PanelLine): string => runsText(l.runs);

/** Spinner frame of agent `id`: the shared clock reading (spinFrameOf, a fixed phase per id) when the model carries one, else the tick. */
const frameOf = (m: Pick<PanelModel, 'now' | 'tick'>, id = ''): number => (m.now !== undefined ? spinFrameOf(m.now, id) : m.tick);
/** The mark of a core-tab row: a `blocked` state there is a warning (a team off plan, evidence missing, a claim no verdict backs), so it keeps the amber triangle; blocked work is the red square (critique 16 A2). */
const coreMark = (s: UiState, ui: Ui): Run => (s === 'blocked' ? warnMark(ui) : stateRun(s, ui));
/** The state glyph of agent `id` on its row. */
/** `braille`: the band lead's frame on the same shared index, for the rows the capture scorer does not read by glyph (the agents lines: live_capture.py reads a team row by its WORD, `\S` for the glyph);
 * the plan rows (route tab `T1`..) are read by glyph (GLYPH_STATE4) and keep the circle quarters. */
const stateMark = (s: MarkState, m: Pick<PanelModel, 'ui' | 'now' | 'tick'>, id = '', braille = false): Run => stateRun(s, m.ui, frameOf(m, id), braille);
/** The one name every surface shows for an agent (mod/hud.ts displayName); the real name stays the key, the recipient and the spinner id. */
const nameOf = (w: PanelWorker): string => oneLine(displayName(w.name, w.role ?? '', w.goal)) || ELLIPSIS; // a worker is never a blank cell: whole name, or `…` (critique 22: `◐ running` with no AGENT)
/** Widest name column an agent row may take: the whole name is kept, the columns after it give way (a name is never cut in the middle). */
const nameCap = (cols: number): number => Math.max(18, Math.min(40, cols - GRID_LEAD - 2 - 7 - 6));

/** `◐ ` and friends: the state glyph run followed by a space. */
const mark = (s: MarkState, m: Pick<PanelModel, 'ui' | 'now' | 'tick'>, id = ''): Run => {
  const g = stateMark(s, m, id);
  return { ...g, t: `${g.t} ` };
};

/** The gates figure, from the one definition the band uses (mod/data/runstate.ts): a group with no data is neither green nor a check. */
/** The gates as every row reads them: the header contract line comes from the core row's own tally (one evaluation). */
const gatesOf = (m: Pick<PanelModel, 'gates' | 'core'>): readonly PanelGate[] => withCoreTally(m.gates, m.core);
const tallyOf = (gs: readonly PanelGate[]) => gateTally(gs as unknown as readonly GateGroup[]);
/** The groups the tally counts, in their order. */
const countedGates = (gs: readonly PanelGate[]): PanelGate[] => {
  const ids = new Set(tallyOf(gs).checks.map((c) => c.id as string));
  return gs.filter((g) => ids.has(g.id)).map((g) => (g.lines.some((l) => l.id === STOP_LINE) ? { ...g, lines: g.lines.filter((l) => l.id !== STOP_LINE) } : g)); // the Stop verdict is a record, not a gate row
};
/** Label column: one cell in (the tab indent, like the strip and the headings) and eight cells wide at every width, so `agents` keeps a blank before its figure. */
const label = (t: string, _cols: number): Run => r(pad(` ${t}`, 8), 'muted');
const dot = (ui: Ui): string => (ui.ascii ? '|' : '·');
const sep = (ui: Ui): Run => r(` ${dot(ui)} `, 'muted');
const WIDE = 100;

// ---- header: ribbon and tab strip ---------------------------------------------------------------------------------

const countWords = (workers: readonly PanelWorker[], ui: Ui): string => {
  const n = (s: UiState): number => workers.filter((w) => w.state === s).length;
  return UI_STATES.filter((s) => n(s)).map((s) => `${n(s)} ${s}`).join(` ${dot(ui)} `);
};

/** A channel as a person reads it: a generated id (`lc-opl0e60i`, a launch code) is no name, so it reads `this run`; a named channel keeps its `#name` (critique 12). */
export const channelLabel = (name: string | undefined, fallback = 'channel'): string => (name && /^lc-[\w-]{4,}$/i.test(name) ? 'this run' : `#${name ?? fallback}`);

/** The ribbon's right-hand text: what the active tab counts, always with its word. */
function ribbonRight(m: PanelModel): string {
  if (m.tab === 'team') return m.lead ? '' : m.workers.length ? countWords(m.workers, m.ui) : ''; // with a lead the tally is the `workers` row under it: once, at every width (critique 14: `3 done` twice)
  if (m.tab === 'gates') { const t = tallyOf(gatesOf(m)); return t.total ? `${t.green}/${t.total}` : ''; } // `n/m` at every width: `2/4` at 110 and `1 of 4 green` at 150 was one figure in two formats (critique 11)
  if (m.tab === 'channel') return m.channel && channelLabel(m.channel) !== 'this run' ? channelLabel(m.channel) : ''; // the head row says `this run` once; the ribbon names only a real channel
  return '';
}

/** `view`: another view in the panel's ribbon (the board: `▸ BOARD  5 items`, critique 15 B5); absent: the SIDEPANEL ribbon of the lit tab. */
export function ribbonRow(m: PanelModel, view?: { title: string; right: string }): PanelLine {
  if (m.cols < 34) {
    const cap = capsule(m.ui);
    const fill = Math.max(0, m.cols - rowWidth(cap) - 1);
    return line(fitRuns([...cap, r(' '), m.ui.ascii ? r('-'.repeat(fill), 'muted') : r('─'.repeat(fill), 'dim')], m.cols));
  }
  const right = view ? view.right : ribbonRight(m);
  const fitsRight = right && m.cols >= 40 + cells(right);
  // The gates figure (`17/18`) never drops from the header while the capsule and title fit beside it.
  const keep = !view && m.tab === 'gates' && !!right && m.cols >= 32 + cells(right);
  return line(lightRibbon(ribbon(m.cols, view?.title ?? 'SIDEPANEL', fitsRight || keep ? right : '', m.ui), m.ui));
}

/** The tab strip and the rule under the lit tab (design rev 5, C1): `route  team  channel  gates  core  board`, the lit name bold accent with `━━━━━` in accent under it, the rest
 * dim. No key letters (see stripLayout). A strip too narrow for one row wraps (the rule sits under the row that holds the lit tab). */
export function tabRows(m: PanelModel): PanelLine[] {
  const { rows, gap: g } = stripLayout(m.cols, m.tab);
  const gap = r(' '.repeat(g));
  const lead = r(' '.repeat(STRIP_PAD));
  return rows.flatMap((row): PanelLine[] => {
    const strip: Run[] = [lead];
    const under: Run[] = [lead];
    row.forEach((t, i) => {
      const on = t.id === m.tab;
      if (i) { strip.push(gap); under.push(gap); }
      strip.push(on ? r(t.label, 'accent', { bold: true }) : r(t.label, 'muted'));
      under.push(on ? r((m.ui.ascii ? '-' : '━').repeat(cells(t.label)), 'accent') : r(' '.repeat(cells(t.label))));
    });
    return [line(fitRuns(strip, m.cols)), ...(row.some((t) => t.id === m.tab) ? [line(fitRuns(under, m.cols))] : [])];
  });
}

/** Ribbon, blank, tab strip, rule, and (from 100 columns) a blank before the body; the 80-column design has none. */
export const headerRows = (m: PanelModel): PanelLine[] => [ribbonRow(m), BLANK, ...tabRows(m), ...(m.cols >= 100 ? [BLANK] : [])];

// ---- route ------------------------------------------------------------------------------------------------------------

const groupOk = (g: PanelGate): boolean => !g.error && g.lines.every((l) => l.ok);
/** A group that passes but for conditions only Stop decides: `◇ pending`, neither the green mark nor the warning. */
const groupPending = (g: PanelGate): boolean => groupOk(g) && g.lines.some((l) => l.pending);
const groupMark = (g: PanelGate, ui: Ui): Run => (groupPending(g) ? stateRun('queued', ui) : groupOk(g) ? stateRun('done', ui) : gateMark(ui));
const groupFailing = (g: PanelGate): number => g.lines.filter((l) => !l.ok).length;

/** `phase   research   2/4`: the lit phase and its place on the rail. While the Stop gate refused the stop (or the lead declared it) the phase is `blocked` with no rail
 * number: never `done 5/5` beside a blocked band (critique 16 A3, stoprun f0090). */
function phaseRow(m: PanelModel): PanelLine {
  // Critique 18 A4: the same state the band draws: a refused Stop makes the phase `blocked` whatever the lead's last header said (`research`, `done`), and the lead's own ask of the user does too (the header phase is `blocked`).
  if (m.phase === 'blocked' || tallyOf(gatesOf(m)).stop?.blocked) return line([label('phase', m.cols), r('blocked', 'bad', { bold: true })]);
  // Critique 17 A5: the phase word alone (`phase implement`): a rail number beside it (`research 1/5`) read as the same kind of figure as the todo `n/m` and went stale beside the chip.
  return line([label('phase', m.cols), r(m.phase)]);
}

/** `gates   ● lint   ● test   ▲ doctor   2/3 green`; names that do not fit fold to the count alone. `n/m` like the ribbon's figure (critique 12 B3). */
function gatesRow(m: PanelModel): PanelLine | null {
  const t = tallyOf(gatesOf(m));
  const gs = countedGates(gatesOf(m));
  if (!t.total) return null;
  const word = `${t.green}/${t.total} green`;
  const names: Run[] = gs.flatMap((g, i): Run[] => [...(i ? [r('   ')] : []), groupPending(g) ? { ...stateRun('queued', m.ui), t: `${stateRun('queued', m.ui).t} ` } : groupOk(g) ? mark('done', m) : { ...gateMark(m.ui), t: `${gateMark(m.ui).t} ` }, r(g.id)]);
  const full = [label('gates', m.cols), ...names, r(`   ${word}`)];
  if (rowWidth(full) <= m.cols) return line(full);
  return line([label('gates', m.cols), r(word)]);
}

function todoCount(m: PanelModel): PanelLine {
  const done = m.todos.filter((t) => t.state === 'done').length;
  const total = m.todos.length;
  if (!total) return line([label('todo', m.cols), r('no tasks yet', 'muted')]);
  const g = m.cols >= 40 ? [...todoMeter(done, total, m.ui), r(' ')] : []; // the HUD's own meter (8 cells, ok green; atlas-ui todoMeter), never the `████░░` gauge
  return line([label('todo', m.cols), ...g, r(planFigure(done, total, m.todos.filter((t) => t.word === RETURNED).length))]);
}

/** The agents row: one count per state; segments that do not fit wrap under the label instead of overflowing. */
function agentsRows(m: PanelModel): PanelLine[] {
  if (!m.workers.length) return [];
  const sep = m.cols >= WIDE ? 3 : 2;
  const segs = UI_STATES.filter((s) => m.workers.some((w) => w.state === s)).map((s) => countRuns(s, m.workers.filter((w) => w.state === s).length, m.ui, frameOf(m, m.workers.find((w) => w.state === s)?.name), true));
  const lead = label('agents', m.cols);
  const w0 = cells(lead.t);
  const out: Run[][] = [[lead]];
  let used = w0;
  for (const g of segs) {
    const w = g.reduce((n, x) => n + cells(x.t), 0);
    const row = out[out.length - 1]!;
    if (row.length > 1 && used + sep + w > m.cols) { out.push([r(' '.repeat(w0))]); used = w0; }
    const cur = out[out.length - 1]!;
    if (cur.length > 1) { cur.push(r(' '.repeat(sep))); used += sep; }
    cur.push(...g);
    used += w;
  }
  return out.map((runs) => line(runs));
}

const AGENT_ROWS = 5; // agents named under the plan on the route tab; the rest fold into `+N more`
const WORD_W = 7; // `running` and `blocked` are the longest of the six state words
const OWNER_W = 18;
const TITLE_MIN_W = 21; // the title column's least width (the state word starts in cell 26 when every title is short, as in the design); it grows to the longest title the pane has room for

/** The Board's compact form on the panel: `focus glyph title state [detail] owner`. Every task row shares one state column (cell 26) and one
 * right-aligned owner column (dropped when the panel is too narrow to keep a title of 8 cells); a title that does not fit is cut at its end (labels that share a head keep their tail); from 100 columns the reason (detail) fills the room between the state word and the owner. An open row adds its owner and detail,
 * then its evidence. */
/** A task row prints its owner in the right-hand column unless its title already names that owner. */
const ownerColumn = (t: PanelTodo): boolean => !!t.owner && !oneLine(t.label).includes(oneLine(t.owner));

/** The task without the `(owner)` its title ends with: `T1 read alpha.py (alpha-explorer)` reads `T1 read alpha.py`. */
const withoutOwner = (t: PanelTodo): PanelTodo => {
  const label = oneLine(t.label);
  const tail = ` (${t.owner ?? ''})`;
  return t.owner && label.endsWith(tail) ? { ...t, label: label.slice(0, -tail.length) } : t;
};

const TODO_GAP = 2; // cells between a title and its state word where the title spills (critique 14: `...(alpha... done` had one); the one-row grammar keeps its single cell
const SPILL_BELOW = 50; // panes narrower than this (the 110-column pane is 37) draw a title that cannot sit beside its state whole, state under it

function todoRows(m: PanelModel, t: PanelTodo, w: { nameW: number; valueW: number; wordW: number; shown?: string; doubtWord?: boolean }): PanelLine[] {
  const key = `task:${t.id}`;
  const full = oneLine(t.label);
  // Critique 19 C4: a done row whose worker was killed says so in words, as the HUD does (`closed · worker killed`), not only in amber: in the state cell where the pane gave it the room (`w.doubtWord`),
  // else (the narrow pane, where the row spills) the word follows the title on its own line. From 100 columns the reason column says it.
  const doubt = markOf(t.state, t.word) === 'doubt';
  const spelled = doubt && (w.doubtWord === true || m.cols < SPILL_BELOW);
  const wordRun = { t: spelled ? DONE_KILLED : t.word ?? t.state, tone: rowWordTone(t.state, t.word) };
  const settled = t.state === 'done' && markOf(t.state, t.word) !== 'doubt'; // a done row whose worker failed (critique 17 A1) is not struck through
  const nameCell = { tone: settled ? 'sub' as const : 'text' as const }; // a done title is dim, never struck through (the HUD draws none; critique 22)
  const accent = markOf(t.state, t.word);
  const glyph = stateMark(accent, m, t.owner || t.id);
  // A title that does not fit beside its state word is drawn whole and its state follows it (critique 14, the 110-column pane: `T1 read alpha.py (alpha...` was cut
  // while the title fit the pane). A pane from SPILL_BELOW columns keeps the one-row form: it has the room.
  const room = m.cols - GRID_LEAD - (w.wordW + 1) - (w.valueW ? w.valueW + 1 : 0); // the title column's widest possible width
  const spill = m.cols < SPILL_BELOW && (spelled || cells(full) > w.nameW || (cells(full) === w.nameW && w.nameW >= room)); // too long, or filling the column and jammed against the word
  let rows: PanelLine[];
  if (spill) {
    const width = Math.max(8, m.cols - GRID_LEAD);
    // The title wraps, never the state: it wraps narrower by the gap and the word, so the word closes the last title line (critique 15 C2).
    const lines = cells(full) + TODO_GAP + cells(wordRun.t) <= width ? [full] : spelled ? wrap(full, width, 3) : wrap(full, Math.max(8, width - TODO_GAP - cells(wordRun.t)), 3); // a long spelled word (`closed · worker killed`) takes its own line, it does not wrap the title
    const head = gridRow({ cols: m.cols, ui: m.ui, mark: glyph, name: { t: lines[0]!, ...nameCell }, nameW: Math.min(width, cells(lines[0]!)), nameCut: 'end' });
    const wordTail = [r(' '.repeat(TODO_GAP)), r(wordRun.t, wordRun.tone)];
    const lastW = cells(lines[lines.length - 1]!);
    const inline = lastW + TODO_GAP + cells(wordRun.t) <= width;
    const owner = w.valueW && ownerColumn(t) ? clipE(oneLine(t.owner), w.valueW) : '';
    const ownerTail = (used: number): Run[] => (owner && used + TODO_GAP + cells(owner) <= width ? [r(' '.repeat(TODO_GAP)), r(owner, 'sub')] : []);
    const cont = lines.slice(1).map((l, i, a): Run[] => [r(' '.repeat(GRID_LEAD)), r(l, nameCell.tone), ...(inline && i === a.length - 1 ? wordTail : [])]);
    const tail: Run[][] = inline ? [] : [[r(' '.repeat(GRID_LEAD)), r(wordRun.t, wordRun.tone), ...ownerTail(cells(wordRun.t))]];
    const firstRuns = [...head, ...(inline && lines.length === 1 ? wordTail : [])];
    rows = [moving(firstRuns, key, accent, m), ...cont, ...tail].map((runs, i) => line(fitRuns(runs, m.cols), i === 0 ? { kind: 'toggle', key } : undefined));
  } else {
    const runs = gridRow({
      cols: m.cols, ui: m.ui, mark: glyph,
      name: { t: w.shown ?? full, ...nameCell }, nameW: w.nameW, nameCut: 'end',
      word: wordRun, wordW: w.wordW,
      ...(m.cols >= WIDE && t.detail ? { detail: { t: oneLine(t.detail) } } : {}), // wide panels show the reason in one fixed column after the state word
      ...(w.valueW && ownerColumn(t) ? { value: { t: clipE(oneLine(t.owner), w.valueW), tone: 'sub' as const } } : {}),
    });
    rows = [line(fitRuns(moving(runs, key, accent, m), m.cols), { kind: 'toggle', key })];
  }
  const open = m.expanded === key;
  const facts = [t.owner ? `owner ${oneLine(t.owner)}` : '', oneLine(t.detail)].filter(Boolean).join(` ${dot(m.ui)} `);
  const extra = open ? [...(facts ? [facts] : []), t.evidence ? `evidence: ${oneLine(t.evidence)}` : 'no evidence yet'] : [];
  return [...rows, ...extra.map((x) => line(fitRuns([r(`    ${x}`, 'muted')], m.cols)))];
}

/** What the Motion observes of the panel: each plan task, worker, gate group and gate line (key and state word), the rows `bodyLines` can move. */
export function panelMotionItems(m: Pick<PanelModel, 'todos' | 'workers' | 'lead' | 'mates' | 'gates'>): MotionItem[] {
  return [
    ...m.todos.map((t): MotionItem => ({ key: `task:${t.id}`, state: motionState(t.state, t.word) })),
    ...[...m.workers, ...(m.mates ?? [])].map((w): MotionItem => ({ key: `worker:${w.name}`, state: w.state })),
    ...m.gates.flatMap((g): MotionItem[] => [{ key: `group:${g.id}`, state: groupOk(g) ? 'done' : 'failed' }, ...g.lines.map((l): MotionItem => ({ key: `gate:${l.id}`, state: l.ok ? 'done' : 'failed' }))]),
  ];
}

/** Rows a tab may use below its header; a plan longer than that folds into `+N more`. */
const bodyRows = (m: PanelModel, used: number): number => Math.max(3, m.rows - headerRows(m).length - used - 2);

/** Panes of this many rows or more have room beyond the tabs' own rows: each tab fills it with detail the snapshot already holds. */
const TALL = 30;
const tall = (m: PanelModel): boolean => m.rows >= TALL;
/** A pane under TALL rows still names its agents under their count when they and the whole plan fit beside the header: the host's own agent list
 * below the prompt takes one row per running agent from the pane, so with three agents running a 40 row terminal (31 pane rows) fell under TALL
 * and the route tab named nobody for as long as all three ran (hud110). `used`: body rows already drawn. */
/** Panes shorter than this keep the design's short form (the 24 row pane names only the loose agents below the plan). */
const LIST_MIN = 26;
const agentsFit = (m: PanelModel, used: number, agents: number): boolean => {
  const listed = Math.min(agents, AGENT_ROWS);
  return m.rows >= LIST_MIN && listed > 0 && m.todos.length > 0 && m.rows - headerRows(m).length - (used + listed + (agents > listed ? 1 : 0) + 2 + m.todos.length) >= 2;
};
/** Rows left in a pane after the header and `used` body rows (one row stays free at the foot). */
const spareRows = (m: PanelModel, used: number): number => m.rows - headerRows(m).length - used - 1;

/** A worker's last step as every `last` text shows it: no list marker, backtick or absolute path (`lastText`), ended on a whole word within `room` cells; empty when no word fits. */
const lastFit = (w: PanelWorker, room: number): string => clipWords(lastText(w.detail), Math.max(0, room));

/** An agent row under the route tab's `agents` row: glyph, whole name, state word, from 100 columns what it is doing. */
function routeAgentRow(m: PanelModel, w: PanelWorker, nameW: number): PanelLine {
  const tone: Tone = rowWordTone(w.state);
  const last = m.cols >= WIDE ? lastFit(w, m.cols - 2 - (GRID_LEAD + nameW + 1 + WORD_W) - 1) : '';
  return line(fitRuns(moving([r('  '), ...gridRow({ cols: m.cols - 2, ui: m.ui, mark: stateMark(w.state, m, w.name, true), name: { t: nameOf(w), bold: true }, nameW, word: { t: w.state, tone }, wordW: WORD_W, ...(last ? { detail: { t: last } } : {}) })], `worker:${w.name}`, w.state, m), m.cols));
}

function routeBody(m: PanelModel): PanelLine[] {
  const rows: PanelLine[] = [phaseRow(m)];
  const gates = gatesRow(m);
  if (gates) rows.push(gates);
  rows.push(...agentsRows(m));
  // A tall pane lists the agents under their count (the row headed `agents` holds agents, never plan rows); a short one names only the loose ones below the plan.
  const team = workersByTask(m); // the one agent order (HUD, route and team tab): by task
  const listed = tall(m) || agentsFit(m, rows.length, team.length) ? team.slice(0, AGENT_ROWS) : [];
  if (listed.length) {
    const nameW = Math.min(nameCap(m.cols), Math.max(...listed.map((w) => cells(nameOf(w))), 1));
    rows.push(...listed.map((w) => routeAgentRow(m, w, nameW)));
    if (m.workers.length > listed.length) rows.push(line([r(`    ${m.workers.length - listed.length} more on the team tab`, 'muted')]));
  }
  if (!m.todos.length) {
    rows.push(todoCount(m));
    // Work may be running with no plan on the board: say so with the workers, never "nothing planned".
    const running = listed.length ? [] : team.filter((w) => w.state === 'running');
    const nameW = Math.min(nameCap(m.cols), Math.max(...running.map((w) => cells(nameOf(w))), 1));
    if (running.length) rows.push(BLANK, ...running.slice(0, bodyRows(m, rows.length)).map((w) => line(gridRow({ cols: m.cols, ui: m.ui, mark: stateMark('running', m, w.name, true), name: { t: nameOf(w) }, nameW, detail: { t: lastFit(w, m.cols - (GRID_LEAD + nameW) - 1) } }))));
    else if (!m.workers.length) rows.push(BLANK, ...indentedHint(m, 'add one with /todo add')); // the `todo` row above already says `no tasks yet`
    return rows;
  }
  // Agents that work but hold no plan row (the plan rows carry no owner while the agents are host-spawned): a group under the plan names them, in the HUD Subagents state words.
  const owners = new Set(m.todos.map((t) => t.owner).filter((o): o is string => !!o));
  const loose = listed.length ? [] : team.filter((w) => w.state !== 'done' && w.state !== 'queued' && !owners.has(w.name));
  const looseShown = loose.slice(0, AGENT_ROWS);
  const room = Math.max(1, bodyRows(m, rows.length + 1) - (loose.length ? looseShown.length + 1 + (loose.length > looseShown.length ? 1 : 0) : 0));
  // A narrow pane (the 110-column pane is 37) drops the owner: the title's `(alpha-explorer)` and the owner column both go, the team tab names the owner (critique 17: the title wrapped
  // to `T1 read alpha.py` / `(alpha-explorer) done`, a staircase that doubled the row height).
  const narrow = m.cols < SPILL_BELOW;
  let ordered = narrow ? m.todos.map(withoutOwner) : m.todos; // the Board's order (plan rows as the board lists them), not regrouped by state
  const layout = (os: readonly PanelTodo[]) => {
    // The owner column goes first (critique 12 A2): a row whose title already names its owner (`T1 read alpha.py (alpha-explorer)`) prints no second copy, so the title keeps the room.
    const widest = narrow ? 0 : Math.min(m.cols >= WIDE ? 28 : OWNER_W, Math.max(0, ...os.filter(ownerColumn).map((t) => cells(oneLine(t.owner)))));
    // The title column is as wide as the longest title the pane has room for (the state word follows it on every row, so the words line up); only a title past the room is cut, in the middle.
    // Critique 19 C4: a pane that can keep a whole title beside `closed · worker killed` spells it in the state cell; a narrower one (and the 100+ reason column) does not.
    const doubtWord = !narrow && m.cols < WIDE && os.some((t) => markOf(t.state, t.word) === 'doubt') && m.cols - GRID_LEAD - cells(DONE_KILLED) - 1 >= TITLE_MIN_W + 4;
    const todoWordW = os.reduce((n, t) => Math.max(n, cells(t.word ?? t.state)), doubtWord ? cells(DONE_KILLED) : WORD_W); // 8 while a row reads `returned`
    const titleMax = m.cols >= WIDE ? Math.max(TITLE_MIN_W, m.cols - 60) : m.cols; // from 100 columns the title leaves the reason a column
    const titles = [' '.repeat(TITLE_MIN_W), ...os.map((t) => oneLine(t.label))];
    const plan = gridPlan(m.cols, { names: titles, word: todoWordW, value: widest, optional: true, min: Math.min(titleMax, Math.max(8, ...os.filter((t) => t.owner && !ownerColumn(t)).map((t) => cells(oneLine(t.label))))), max: titleMax }); // a title that names its owner stays whole: the column gives way before it is cut
    return { doubtWord, todoWordW, plan };
  };
  let lay = layout(ordered);
  // Critique 23: a worker's name is never cut (`T1 read alpha.py (alpha-explo… done` at 150 columns). When a title that ends in its owner does not fit whole, every row drops the `(owner)` and the
  // owner column carries it, whole (the narrow pane has always done this).
  const cutOwner = (t: PanelTodo): boolean => !!t.owner && oneLine(t.label).endsWith(` (${t.owner})`) && cells(oneLine(t.label)) > lay.plan.nameW;
  if (!narrow && ordered.some(cutOwner)) { ordered = ordered.map(withoutOwner); lay = layout(ordered); }
  const { doubtWord, todoWordW, plan } = lay;
  const shown: PanelLine[] = [];
  const shownTitles = labelCut(ordered.map((t) => oneLine(t.label)), plan.nameW);
  for (const [i, t] of ordered.entries()) {
    const rs = todoRows(m, t, { ...plan, wordW: todoWordW, shown: shownTitles[i]!, doubtWord });
    if (shown.length + rs.length > room) break;
    shown.push(...rs);
  }
  const hidden = ordered.length - ordered.filter((t) => shown.some((l) => l.press?.key === `task:${t.id}`)).length;
  rows.push(BLANK, todoCount(m), ...shown, ...(hidden > 0 ? [line([r(`    ${hidden} more ${hidden === 1 ? 'task' : 'tasks'} on the board`, 'muted')])] : []));
  if (loose.length) {
    const nameW = Math.min(nameCap(m.cols), Math.max(...looseShown.map((w) => cells(nameOf(w))), 1));
    rows.push(BLANK, line([label('agents', m.cols)]), ...looseShown.map((w) => routeAgentRow(m, w, nameW)));
    if (loose.length > looseShown.length) rows.push(line([r(`    ${loose.length - looseShown.length} more on the team tab`, 'muted')]));
  }
  return rows;
}

// ---- team (subagents by name and state) -----------------------------------------------------------------------------------

export const shortAge = (secs: number): string => (secs < 60 ? `${Math.max(0, Math.floor(secs))}s` : secs < 3600 ? `${Math.floor(secs / 60)}m${String(Math.floor(secs % 60)).padStart(2, '0')}s` : `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`);

/** An agent's dispatch description without its `name: ` prefix (`board-auditor: audit the items` reads `audit the items`). */
const goalOf = (w: PanelWorker): string => oneLine(w.goal).replace(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*:\s+/i, '');

/** The rows a tall pane adds under an agent: what it was asked, which model and for how long, and its last step. Only fields the snapshot holds. */
function workerDetail(m: PanelModel, w: PanelWorker): PanelLine[] {
  const lab = (t: string): string => pad(t, 6);
  const task = [goalOf(w), w.task && goalOf(w) ? `(${w.task})` : w.task].filter(Boolean).join(' ');
  const how = [w.model, w.secs !== undefined ? shortAge(w.secs) : '', w.tools !== undefined ? `${w.tools} tool calls` : ''].filter(Boolean).join(` ${dot(m.ui)} `);
  if (!task && !how) return []; // a last step alone is what the row already says
  const lastRaw = lastFit(w, m.cols - 4 - 6);
  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  const last = same(lastRaw, goalOf(w)) || same(lastRaw, task) ? '' : lastRaw; // `task read alpha.py` over `last read alpha.py` says it twice (critique 12)
  return [task ? ['task', task] : null, how ? ['model', how] : null, last ? ['last', last] : null]
    .filter((x): x is [string, string] => !!x)
    .map(([k, v]) => line(fitRuns([r(`    ${lab(k)}`, 'muted'), r(v, 'sub')], m.cols)));
}

/** The Team tab's columns, one set for every row (wave 24): `glyph name  role  state word  elapsed`. The role gives way first, then the elapsed time; the name is cut last, with `…`. */
type TeamGrid = { nameW: number; roleW: number; wordW: number; ageW: number };
// The role column says what the name does not: `ghost-explorer` already starts with its role, so that row leaves the column blank rather than print the word twice.
const roleOf = (w: PanelWorker): string => (w.role && w.role !== 'unknown' && w.role !== w.name && !nameOf(w).toLowerCase().startsWith(w.role.toLowerCase()) ? w.role : '');
// A queued agent has not started: it has no elapsed time to show.
const ageOf = (w: PanelWorker): string => (w.secs !== undefined && w.state !== 'queued' ? shortAge(w.secs) : '');

function teamGrid(m: PanelModel, ws: readonly PanelWorker[]): TeamGrid {
  const longest = Math.max(6, ...ws.map((w) => cells(nameOf(w))));
  const wordW = Math.max(4, ...ws.map((w) => cells(w.state)));
  const roleW = Math.min(11, Math.max(0, ...ws.map((w) => cells(roleOf(w)))));
  const ageW = Math.max(0, ...ws.map((w) => cells(ageOf(w))));
  const room = m.cols - 1 - GRID_LEAD; // right margin, then the glyph cells
  const need = (withRole: boolean, withAge: boolean): number => 2 + wordW + (withRole && roleW ? 2 + roleW : 0) + (withAge && ageW ? 2 + ageW : 0);
  for (const [withRole, withAge] of [[true, true], [false, true], [false, false]] as const) {
    if (longest + need(withRole, withAge) <= room) return { nameW: longest, roleW: withRole ? roleW : 0, wordW, ageW: withAge ? ageW : 0 };
  }
  return { nameW: Math.max(6, room - need(false, false)), roleW: 0, wordW, ageW: 0 };
}

/** One agent as one row; its detail rows (what it was asked, its model, its last step) open only on a press. */
function workerRows(m: PanelModel, w: PanelWorker, g: TeamGrid, focus: boolean): PanelLine[] {
  const key = `worker:${w.name}`;
  const used = GRID_LEAD + g.nameW + 2 + g.wordW + (g.roleW ? 2 + g.roleW : 0) + (g.ageW ? 2 + g.ageW : 0);
  const wide = m.cols >= WIDE;
  const room = m.cols - 1 - used - 2;
  const last = wide && room >= 8 ? lastFit(w, room) : '';
  const tail: Run[] = [
    ...(g.roleW ? [r('  '), r(pad(clipE(roleOf(w), g.roleW), g.roleW), 'sub')] : []),
    r('  '), r(pad(w.state, g.wordW), rowWordTone(w.state)), // the one word tone of every surface (atlas-ui rowWordTone)
    ...(g.ageW ? [r('  '), r(pad(ageOf(w), g.ageW), 'muted')] : []),
    ...(last ? [r('  '), r(last, 'muted')] : []),
  ];
  const runs = gridRow({ cols: m.cols, ui: m.ui, focus, mark: stateMark(w.state, m, w.name, true), name: { t: nameOf(w), bold: true }, nameW: g.nameW, tail });
  const out = [line(fitRuns(moving(runs, key, w.state, m), m.cols), { kind: 'worker', key, name: w.name })];
  if (m.expanded === key) {
    out.push(...workerDetail(m, w));
    out.push(line(fitRuns([r(`    ${lastFit(w, m.cols - 4) || w.state}`, 'muted')], m.cols)));
    if (w.secs !== undefined) out.push(line(fitRuns([r(`    running ${shortAge(w.secs)}${w.tools !== undefined ? ` ${dot(m.ui)} ${w.tools} tool calls` : ''}`, 'muted')], m.cols)));
  }
  return out;
}

/** `workers  1 running · 2 done`: the tally of the lead's workers, under its own row (which already names the lead, so the name is not said twice). Running always reads; the other states only when not zero. */
function leadSummary(m: PanelModel): PanelLine {
  const n = (s: UiState): number => m.workers.filter((w) => w.state === s).length;
  const tally = (all: boolean): string => UI_STATES.filter((s) => (all && s === 'running') || n(s)).map((s) => `${n(s)} ${s}`).join(` ${dot(m.ui)} `);
  const head = `${' '.repeat(GRID_LEAD)}workers  `;
  const parts = cells(head) + cells(tally(true)) <= m.cols - 1 ? tally(true) : tally(false) || tally(true); // a narrow pane drops the `0 running` before it cuts a figure
  return line(fitRuns([r(' '.repeat(GRID_LEAD)), r('workers  ', 'text', { bold: true }), r(parts, 'muted')], m.cols)); // in the name column, under the lead's own row
}

/** The lead as the band would read it: while the band is BLOCKED (the lead declared it, or the Stop gate's last verdict refused the stop) the lead is not `done`; it
 * reads blocked, with the reason the band gives. A failing check alone never blocks it (the band says warning then). Any other state is the lead's own. */
function leadOf(m: PanelModel): PanelWorker | undefined {
  const lead = m.lead;
  if (!lead || lead.state !== 'done') return lead;
  const stop = tallyOf(gatesOf(m)).stop;
  const declared = m.phase === 'blocked';
  if (!declared && !stop?.blocked) return lead;
  return { ...lead, state: 'blocked', detail: blockReasons(declared, stop?.gates ?? ['gate']).long };
}

/** The workers in the HUD's order (hud-surface sortAgents): by the earliest plan row (T1 before T2) each owns, whatever its state, those that own none after, then as
 * given (start order). The plan row number is its place in `m.todos` (the board's order); a worker whose row names no owner falls back to its own `T3` tag. */
export function workersByTask(m: Pick<PanelModel, 'todos' | 'workers'>): PanelWorker[] {
  const tag = (w: PanelWorker): number[] => { const n = /^T(\d+)$/i.exec(w.task ?? '')?.[1]; return n ? [Number(n)] : []; };
  return sortAgents(m.workers.map((w) => { const owned = m.todos.flatMap((t, i) => (t.owner === w.name ? [i + 1] : [])); return { w, tasks: owned.length ? owned : tag(w) }; })).map((x) => x.w);
}

/** An empty tab's one sentence, indented like the rows it stands in for and wrapped to the pane (critique 15: an unindented `(no state)` lead-in was the only thing at the margin). */
/** A hint under a row that already says the pane is empty (the route tab's todo row): indented like the rows it stands in for, wrapped to the pane. */
const indentedHint = (m: PanelModel, text: string): PanelLine[] => wrap(text, Math.max(8, m.cols - GRID_LEAD), 3).map((l) => line([r(' '.repeat(GRID_LEAD)), r(l, 'muted')]));
/** An empty tab's one sentence (design rev 5, C2): dim and centred in the pane, nothing else under it. */
/** One dim line in the middle of the pane's body (an empty channel or board): centred across the width and down the rows the pane has left. */
export function centred(m: Pick<PanelModel, 'cols' | 'rows'>, text: string): PanelLine[] {
  const t = clipE(text, Math.max(1, m.cols - 2));
  const lead = Math.max(0, Math.floor((m.cols - cells(t)) / 2));
  const above = Math.max(1, Math.floor((m.rows - 8) / 2));
  return [...Array.from({ length: above }, () => BLANK), line([r(' '.repeat(lead)), r(t, 'dim')])];
}

export const emptyHint = (m: PanelModel, text: string): PanelLine[] => {
  const t = clipE(text, Math.max(8, m.cols - 2));
  return [line([r(' '.repeat(Math.max(1, Math.floor((m.cols - cells(t)) / 2)))), r(t, 'muted')])];
};

function teamBody(m: PanelModel): PanelLine[] {
  const mates = m.mates ?? [];
  const lead = leadOf(m);
  const workers = workersByTask(m);
  const everyone = [...(lead ? [lead] : []), ...workers, ...mates];
  if (!everyone.length) return emptyHint(m, 'nobody dispatched yet');
  const g = teamGrid(m, everyone);
  const focusName = m.recipient && everyone.some((w) => w.name === m.recipient) ? m.recipient : workers.find((w) => w.state === 'running')?.name;
  const rows = (ws: readonly PanelWorker[]): PanelLine[] => ws.flatMap((w) => workerRows(m, w, g, w.name === focusName));
  const hint = !m.workers.length && !mates.length ? emptyHint(m, 'nobody dispatched yet') : [];
  return [...(lead ? rows([lead]) : []), ...hint, ...rows(workers), ...rows(mates), ...(m.lead ? [leadSummary(m)] : [])]; // one row per agent, at every height
}

// ---- channel ------------------------------------------------------------------------------------------------------------------

const noteText = (m: PanelModel, n: PanelNote): string => {
  const kind = n.kind === 'blocked' || n.kind === 'failed' || n.kind === 'handoff' || n.kind === 'done';
  return `${n.to && n.to !== 'all' && !kind ? `${m.ui.ascii ? '>' : '▸'} ${n.to} ` : ''}${oneLine(n.text)}`;
};

/** A post's state: a blocked or failed one is the blocked or failed mark and says so in a word (`failed` always sits beside a `■`); a hand-off or done reads done. */
function noteState(n: PanelNote): { state: UiState | null; word: string } {
  if (n.kind === 'failed') return { state: 'failed', word: 'failed' };
  if (n.kind === 'blocked') return { state: 'blocked', word: 'blocked' };
  if (n.kind === 'handoff' || n.kind === 'done') return { state: 'done', word: n.kind };
  return { state: null, word: '' };
}
const noteTone = (word: string): Tone => (word === 'failed' ? rowWordTone('failed') : word === 'blocked' ? rowWordTone('blocked') : 'ok');

/** A post as one row; `bare` leaves the text off (the rows under it read the whole message). */
function noteRow(m: PanelModel, n: PanelNote, g: { nameW: number; wordW: number; timeW: number }, bare = false): PanelLine {
  const { state, word } = noteState(n);
  return line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: state ? stateRun(state, m.ui) : null,
    name: { t: n.from, bold: true }, nameW: g.nameW, gap: 2,
    ...(g.wordW ? { word: word ? { t: word, tone: noteTone(word) } : { t: '' }, wordW: g.wordW } : {}),
    ...(bare ? {} : { detail: { t: noteText(m, n), tone: 'text' as const } }),
    ...(g.timeW ? { value: { t: n.at, tone: 'muted' as const } } : {}),
  }), m.cols));
}

const NOTE_LINES = 4; // rows one message may take on a tall pane
const NOTE_LINES_SHORT = 2; // rows one message may take on a short pane
const NOTE_INLINE_MIN = 20; // cells of text a one-row post needs beside its whole name; less and the post takes two rows

function channelBody(m: PanelModel): PanelLine[] {
  const rows = channelLog(m);
  // Critique 23: the generated slug is no title and not the head's business (`this run  1 person  ....  #lc-ila3f5i_` read as a cut name in an empty pane). The live scorer finds the channel by its
  // `#name`, so the id stays as one quiet line at the foot of the log, only where the pane has a spare row for it.
  const id = channelLabel(m.channel) === 'this run' && m.channel && m.notes.length ? `#${m.channel}` : '';
  return id && spareRows(m, rows.length) >= 1 ? [...rows, BLANK, line(fitRuns([r(`${' '.repeat(GRID_LEAD)}${id}`, 'dim')], m.cols))] : rows;
}

function channelLog(m: PanelModel): PanelLine[] {
  const ind = ' '.repeat(GRID_LEAD); // the indent every other tab's rows have: the name column (critique 11: the channel head sat one cell from the border)
  const count = `${m.people} ${m.people === 1 ? 'person' : 'people'}${m.unread ? ` ${dot(m.ui)} ${m.unread} unread` : ''}`;
  const title = channelLabel(m.channel);
  const head = line(fitRuns([r(`${ind}${title}  `, 'text', { bold: true }), r(count, 'muted')], m.cols));
  if (!m.notes.length) return [head, ...centred(m, 'no messages yet')];
  const wide = m.cols >= WIDE;
  const avail = tall(m) ? m.rows - headerRows(m).length - 2 : m.rows - 4; // a tall pane: the head, the log and the foot row make exactly the pane
  const timeW = m.cols >= 50 ? Math.max(0, ...m.notes.map((n) => cells(n.at))) : 0;
  const hasKind = m.notes.some((n) => noteState(n).word !== '');
  // Names are whole: the name column is the longest name that leaves the word and time columns their room (never `ghost-exp...`).
  const plan = gridPlan(m.cols, { names: m.notes.map((n) => n.from), word: hasKind ? 7 : 0, gap: 2, value: timeW, optional: true, min: 4, max: wide ? 24 : 30 });
  const g = { nameW: plan.nameW, wordW: plan.wordW, timeW: plan.valueW };
  // The text's room beside the whole name, the state word and the time. A pane that leaves the text NOTE_INLINE_MIN cells keeps one row per post; a narrower one gives the post two rows.
  const inline = m.cols - GRID_LEAD - g.nameW - (g.wordW ? g.wordW + 2 : 0) - (g.timeW ? g.timeW + 1 : 0) - 2;
  if (wide || inline >= NOTE_INLINE_MIN) {
    const log = m.notes.slice(-Math.max(1, avail));
    if (!tall(m)) return [head, ...log.map((n) => noteRow(m, n, g))];
    // A tall pane: the rows left go to the newest messages, read whole over up to four rows; a message that already fits its row keeps it.
    const whole = new Map<PanelNote, string[]>();
    let spare = spareRows(m, 1 + log.length);
    for (const n of [...log].reverse()) {
      const text = noteText(m, n);
      if (cells(text) <= inline) continue;
      const rows = wrap(text, Math.max(8, m.cols - 6), NOTE_LINES);
      if (rows.length <= spare) { whole.set(n, rows); spare -= rows.length; }
    }
    return [head, ...log.flatMap((n): PanelLine[] => {
      const rows = whole.get(n);
      return rows ? [noteRow(m, n, g, true), ...rows.map((t) => line(fitRuns([r(`    ${t}`, 'text')], m.cols)))] : [noteRow(m, n, g)];
    })];
  }
  // A narrow pane: a post is two rows (wave 24), who and what state (and when) over what was said, so the name is never cut for the text. The newest posts that fit the pane's rows.
  const cap = tall(m) ? NOTE_LINES : NOTE_LINES_SHORT;
  const posts = m.notes.map((n) => ({ n, text: wrap(noteText(m, n), Math.max(8, m.cols - 6), cap) }));
  const kept: typeof posts = [];
  let left = Math.max(2, avail - 1);
  for (const p of [...posts].reverse()) {
    const cost = 1 + p.text.length;
    if (kept.length && cost > left) break;
    kept.unshift(p);
    left -= cost;
  }
  return [head, ...kept.flatMap((p): PanelLine[] => [noteRow(m, p.n, g, true), ...p.text.map((t) => line(fitRuns([r(`    ${t}`, 'text')], m.cols)))])];
}

// ---- gates --------------------------------------------------------------------------------------------------------------------

const WRAP_LINES = 2;
/** Greedy word wrap into at most `max` lines; the last line is clipped with `...` only when text is left over. */
export function wrap(text: string, width: number, max = WRAP_LINES): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ').filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cells(next) <= width) { cur = next; continue; }
    if (cur) out.push(cur);
    cur = word;
  }
  if (cur) out.push(cur);
  if (out.length <= max) return out.map((l) => clipE(l, width));
  const kept = out.slice(0, max);
  kept[max - 1] = clipE(`${kept[max - 1]} ${out.slice(max).join(' ')}`, width);
  return kept;
}

const note = (t: string, m: PanelModel): PanelLine => line(fitRuns([r(`    ${t}`, 'muted')], m.cols));

/** The one reading of `verified n/m` that the gates tab (`Verified finding recorded`) and the core tab (`verified n/m`) both draw: the verified done items over the plan's items (never a
 * dispatch row's count: 5 plan items read `0/5`, not `0/8`). `waived`: the figure is short and Stop's own gate passes, so the run needs no verified finding (`not required`). Null without a core. */
export function verifiedFigure(m: Pick<PanelModel, 'todos' | 'gates' | 'core'>): { ok: number; total: number; waived: boolean } | null {
  const t = m.core?.contract.verifiedDone;
  if (!t || !t.total) return null;
  const total = m.todos.length > 0 ? m.todos.length : t.total;
  const ok = Math.min(t.ok, total);
  return { ok, total, waived: ok < total && m.gates.some((g) => g.lines.some((l) => l.id === VERIFIED_GATE && l.ok)) };
}
const VERIFIED_GATE = 'b'; // atlas_gates.py: `Verified finding recorded`

function gateLineRows(m: PanelModel, ln: PanelGateLine): PanelLine[] {
  const key = `gate:${ln.id}`;
  const open = m.expanded === key;
  const [first = '', ...more] = wrap(oneLine(ln.label), Math.max(8, m.cols - 6));
  const extra = open ? [ln.detail, ln.fix ? `fix: ${ln.fix} (press to copy)` : undefined].filter((x): x is string => !!x) : [];
  // The verified line says what the core tab says (one source, verifiedFigure): a short figure the Stop gate waives is `◇ 0/5 not required`, never a green `●` beside a core `verified 0/5`.
  const vf = ln.id === VERIFIED_GATE ? verifiedFigure(m) : null;
  const waived = !!vf?.waived;
  const mk = ln.pending || waived ? stateRun('queued', m.ui) : ln.ok ? stateRun('done', m.ui) : gateMark(m.ui);
  const figure = waived && vf ? `${vf.ok}/${vf.total} not required` : '';
  const beside = figure && cells(first) + GRID_LEAD + 2 + 2 + cells(figure) <= m.cols - 1;
  return [
    // Design rev 5, C2: a check hangs under its group's title: the mark sits at the title's first letter, the label two cells on.
    line(moving([r(' '.repeat(GRID_LEAD)), { ...mk, t: `${mk.t} ` }, r(first), ...(beside ? [r(`  ${figure}`, 'muted')] : [])], key, ln.ok && !waived ? 'done' : waived ? 'queued' : 'blocked', m), { kind: 'toggle', key, ...(open && ln.fix ? { copy: ln.fix } : {}) }),
    ...(figure && !beside ? [note(`  ${figure}`, m)] : []),
    ...more.map((t) => note(`  ${t}`, m)), ...extra.map((t) => note(`  ${oneLine(t)}`, m)),
  ];
}

const GATE_WORD_W = 7; // `passing` and `warning`
/** `2/3`: the group's checks that pass over its checks, the value column of every group (design rev 5, C2: a count per group, dim while the group passes, warn while it fails). */
const gateValue = (g: PanelGate): string => {
  if (!g.lines.length) return '';
  // Critique 19 C4: the header contract is judged over replies, not lines: `7/8 replies` (the transcript's own tally, the unit named while it fails), never `0/1` beside 7 chips.
  const tally = g.id === 'header' ? /^(\d+) of (\d+)$/.exec(g.lines.find((l) => l.id === 'header-matched')?.detail ?? '') : null;
  if (tally) return groupFailing(g) ? `${tally[1]}/${tally[2]} replies` : `${tally[1]}/${tally[2]}`;
  return `${g.lines.length - groupFailing(g)}/${g.lines.length}`;
};

function gateGroupRows(m: PanelModel, g: PanelGate, nameW: number, showValue: boolean, all = false): PanelLine[] {
  const bad = groupFailing(g);
  const key = `group:${g.id}`;
  const first = g.lines.find((l) => !l.ok);
  const open = all || m.expanded === key || g.lines.some((l) => m.expanded === `gate:${l.id}`);
  // What is wrong follows the word: the first fix, else (while the group is closed) the failing check's name. Once the checks are listed the name is
  // their own row, never said twice; a passing group says nothing here (a check's detail belongs to its row, never beside another's name).
  const tail = g.error ? `unavailable: ${oneLine(g.error)}` : bad ? oneLine(first?.fix ?? (open ? '' : first?.label)) : '';
  const pend = groupPending(g);
  const word = bad || g.error ? 'warning' : pend ? 'pending' : 'passing';
  // The green count is the right-aligned value; the tail follows the word when it fits whole, else wraps under.
  const value = showValue ? gateValue(g) : '';
  const fixed = GRID_LEAD + nameW + 2 + GATE_WORD_W + (value ? cells(value) + 1 : 0) + 1;
  const fits = !tail || cells(tail) <= m.cols - fixed;
  const runs = gridRow({
    cols: m.cols, ui: m.ui, mark: groupMark(g, m.ui),
    name: { t: oneLine(g.title), bold: true }, nameW, gap: 2, word: { t: word, tone: bad || g.error ? 'warn' : pend ? 'muted' : 'ok' }, wordW: GATE_WORD_W,
    ...(fits && tail ? { detail: { t: tail } } : {}), ...(value ? { value: { t: value, tone: bad ? 'warn' as const : 'muted' as const } } : {}),
  });
  return [
    line(fitRuns(moving(runs, key, groupOk(g) ? 'done' : 'blocked', m), m.cols), { kind: 'toggle', key }),
    ...(!showValue && gateValue(g) ? [note(gateValue(g), m)] : []),
    ...(fits ? [] : wrap(tail, Math.max(8, m.cols - 6)).map((t) => note(t, m))),
    ...(open ? g.lines.flatMap((l) => gateLineRows(m, l)) : []),
  ];
}

function gatesBody(m: PanelModel): PanelLine[] {
  const gs = countedGates(gatesOf(m)); // the groups the tally counts: one with no data is not a gate yet
  if (!gs.length) return emptyHint(m, 'no gates reported yet');
  const valueW = Math.max(0, ...gs.map((g) => cells(gateValue(g))));
  const longest = Math.min(24, Math.max(1, ...gs.map((g) => cells(oneLine(g.title)))));
  // The failing count is the first column to go: the name keeps its whole width, the count moves into the row below.
  const plan = gridPlan(m.cols, { names: gs.map((g) => oneLine(g.title)), word: GATE_WORD_W, gap: 2, value: valueW, optional: true, min: longest, max: 24 });
  const nameW = plan.nameW;
  const build = (all: ReadonlySet<string>): PanelLine[] => gs.flatMap((g) => gateGroupRows(m, g, nameW, plan.valueW > 0, all.has(g.id)));
  const base = build(new Set());
  if (!tall(m)) return base;
  // A tall pane: the rows left open the groups' checks, the failing groups first, each group whole or not at all.
  let spare = spareRows(m, base.length);
  const all = new Set<string>();
  for (const g of [...gs.filter((x) => !groupOk(x)), ...gs.filter(groupOk)]) {
    const cost = m.expanded === `group:${g.id}` ? 0 : g.lines.flatMap((l) => gateLineRows(m, l)).length;
    if (cost && cost <= spare) { all.add(g.id); spare -= cost; }
  }
  return all.size ? build(all) : base;
}

// ---- core (contract, verdicts, offload, route) ------------------------------------------------------------------------------------

const heading = (title: string, figures: Run[], m: PanelModel): PanelLine => line(fitRuns([r(`${' '.repeat(GRID_LEAD)}${title}`, 'muted', { bold: true }), ...(figures.length ? [r('  '), ...figures] : [])], m.cols));
const tallyTone = (ok: number, total: number): Tone => (!total ? 'muted' : ok === total ? 'text' : 'warn');
const joinSep = (parts: Run[], ui: Ui): Run[] => parts.flatMap((p, i) => (i ? [sep(ui), p] : [p]));

/** A heading and its figures, wrapped by whole figure: a figure that does not fit moves to the next row (indented under the first), it is never cut. */
function flowHeading(title: string, parts: readonly string[], m: PanelModel): PanelLine[] {
  const indent = GRID_LEAD + cells(title) + 2; // the heading sits in the name column like every other tab's rows (critique 14: flush against the border)
  const rows: Run[][] = [[r(`${' '.repeat(GRID_LEAD)}${title}`, 'muted', { bold: true }), r('  ')]];
  let used = indent;
  for (const p of parts) {
    const first = used === indent;
    if (cells(p) > m.cols - indent) { // a figure wider than the row wraps on its words, it is never cut mid-phrase
      const [head, ...rest] = wrap(p, Math.max(8, m.cols - indent), 3);
      if (!first) rows.push([r(' '.repeat(indent))]);
      rows[rows.length - 1]!.push(r(head ?? '', 'text'));
      for (const t of rest) rows.push([r(' '.repeat(indent)), r(t, 'text')]);
      used = m.cols;
      continue;
    }
    const w = cells(p) + (first ? 0 : 2);
    if (!first && used + w > m.cols) { rows.push([r(' '.repeat(indent))]); used = indent; }
    rows[rows.length - 1]!.push(r(used === indent ? p : `, ${p}`, 'text'));
    used += used === indent ? cells(p) : w;
  }
  return rows.map((runs) => line(fitRuns(runs, m.cols)));
}

const VERDICT: Record<Verdict['status'], { s: UiState; word: string; tone: Tone }> = {
  verified: { s: 'done', word: 'verified', tone: 'ok' },
  rejected: { s: 'failed', word: 'refuted', tone: 'bad' },
  'needs-evidence': { s: 'blocked', word: 'needs evidence', tone: 'warn' },
};
const VERDICT_WORD_W = Math.max(...Object.values(VERDICT).map((v) => v.word.length));
const VERDICT_ID_W = 15;
/** Rows each core section lists by default (the newest); a tall pane trades them against its height (coreBody). */
const VERDICT_CAP = 8;
const OFFLOAD_CAP = 8;
const TEAM_CAP = 6;

/** The first of `forms` (richest first) that fits `room` cells, else the last: a sentence is shortened on purpose before it is cut or wrapped (critique 14, the 110-column pane). */
const pickForm = (forms: readonly string[], room: number): string => forms.find((f) => cells(f) <= room) ?? forms[forms.length - 1]!;

/** A row and the sentence that follows it: beside the row when the whole sentence fits the cells left, else wrapped on its words onto the rows under it, indented
 * (critique 14, the 110-column pane: `5 done withou...` was cut while the sentence fits a row of its own). Nothing is ever cut with `...`. */
function withRoom(runs: Run[], text: string, m: PanelModel): PanelLine[] {
  if (!text) return [line(fitRuns(runs, m.cols))];
  if (cells(text) + 1 <= m.cols - rowWidth(runs)) return [line(fitRuns([...runs, r(` ${text}`, 'muted')], m.cols))];
  return [line(fitRuns(runs, m.cols)), ...wrap(text, Math.max(8, m.cols - GRID_LEAD - 1), 4).map((t) => line(fitRuns([r(`${' '.repeat(GRID_LEAD)}${t}`, 'muted')], m.cols)))];
}

/** `contract`: `evidence` and `verified`, each `glyph name  n/m` over the plan's items (the denominator of the band's `todo n/m`; the done items when the pane has no
 * plan). The header tally counts replies, a different unit: it lives on the gates tab (Header contract), not here. */
function contractRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const { evidence: e } = c.contract;
  const plan = m.todos.length;
  // The plan's items are the denominator and the cap of every figure (never `8 of 8` over a 5-item plan: dispatch rows are not items); the verified figure is the gates tab's own (verifiedFigure).
  const over = (t: { ok: number; total: number }): { ok: number; total: number } => (plan > 0 && t.total > 0 ? { ok: Math.min(t.ok, plan), total: plan } : t);
  const vf = verifiedFigure(m);
  // A figure short of its plan says why, in the row: `evidence 0/5  5 done without evidence`, `verified 0/5  0 verified findings so far`. The verified row is present for every plan, so the
  // gates and core tabs always carry the verified count against the plan denominator (critique 12 B1, B6: a bare zero beside `todo 5/5` read as a defect).
  const why = (name: string, t: { ok: number; total: number }): string => (!t.total || t.ok === t.total ? '' : name === 'evidence' ? `${t.total - t.ok} done without evidence` : `${c.ledger.verified} verified finding${c.ledger.verified === 1 ? '' : 's'} so far`);
  // [name, the figure shown over the plan, the done items' own tally (the mark and the tone read it: amber when one lacks evidence), waived]
  const items: [string, { ok: number; total: number }, { ok: number; total: number }, boolean][] = [
    ['evidence', over(e), e, e.total > 0 && e.ok < e.total && m.gates.some((g) => g.lines.some((l) => l.id === 'a' && l.ok))],
    ['verified', vf ?? over(c.contract.verifiedDone), c.contract.verifiedDone, !!vf?.waived],
  ];
  const shown = over(e);
  return [
    // Critique 18 A5: a plain heading with its own figure (`done items  5 of 5`), never the bare word `contract` over two rows.
    heading('done items', [r(e.total > 0 || plan > 0 ? `${plan > 0 ? Math.min(e.total, plan) : e.total} of ${plan > 0 ? plan : e.total}` : 'none yet', 'muted')], m),
    ...items.flatMap(([name, t, own, waived]): PanelLine[] => {
      const runs = gridRow({
        cols: m.cols, ui: m.ui, mark: coreMark(!own.total || waived ? 'queued' : own.ok === own.total ? 'done' : 'blocked', m.ui),
        name: { t: name }, nameW: 8, word: { t: t.total ? `${t.ok}/${t.total}` : 'none yet', tone: waived ? 'muted' : tallyTone(own.ok, own.total) }, wordW: 8,
      });
      return withRoom(runs, waived ? (name === 'evidence' ? 'not required for this run' : `${why(name, t)}, not required for this run`) : why(name, t), m); // a waived verified row keeps the true count: the verdict line the live scorer reads (gates metric 66.7 at 95c4a588)
    }),
  ];
}

function verdictRows(c: CoreModel, m: PanelModel, cap = VERDICT_CAP): PanelLine[] {
  const l = c.ledger;
  const none = l.verified + l.refuted + l.pending === 0;
  const figures = none
    ? joinSep([r('no verdicts yet', 'muted'), ...(l.unchecked ? [r(`${l.unchecked} unchecked`, 'warn')] : [])], m.ui)
    : joinSep([
      r(`${l.verified} verified`, l.verified ? 'ok' : 'muted'), r(`${l.refuted} refuted`, l.refuted ? 'bad' : 'muted'),
      ...(l.pending ? [r(`${l.pending} open`, 'warn')] : []), ...(l.unchecked ? [r(`${l.unchecked} unchecked`, 'warn')] : []),
    ], m.ui);
  const shown = c.verdicts.slice(-cap);
  const owners = c.claims.filter((x) => x.status === 'DONE' && x.matched === null);
  const plan = gridPlan(m.cols, { names: [...shown.map((v) => oneLine(v.id)), ...owners.map((x) => x.owner)], word: VERDICT_WORD_W, min: 6, max: VERDICT_ID_W });
  const rows = shown.flatMap((v): PanelLine[] => {
    const look = VERDICT[v.status];
    const key = `core:v:${v.id}`;
    const checked = c.claims.find((x) => x.matched === v.id);
    const open = m.expanded === key;
    const detail = open ? [checked ? `checks the done claim of ${checked.owner}` : 'no worker claim before it', `by ${v.by}`, `evidence: ${oneLine(v.evidence) || 'none recorded'}`] : [];
    const verdictRow = (withTitle: boolean): Run[] => gridRow({
      cols: m.cols, ui: m.ui, mark: coreMark(look.s, m.ui), name: { t: oneLine(v.id) }, nameW: plan.nameW,
      word: { t: look.word, tone: look.tone, bold: v.status === 'rejected' }, wordW: VERDICT_WORD_W, ...(withTitle ? { detail: { t: oneLine(v.title) } } : {}),
    });
    // A pane narrower than SPILL_BELOW (the 110-column pane) puts the title beside the verdict when it fits, else on the rows under it: never cut with `...`.
    const head = m.cols < SPILL_BELOW ? withRoom(verdictRow(false), oneLine(v.title), m) : [line(fitRuns(verdictRow(true), m.cols))];
    return [
      { ...head[0]!, press: { kind: 'toggle', key } },
      ...head.slice(1),
      ...detail.map((t) => line(fitRuns([r(`    ${t}`, 'muted')], m.cols))),
    ];
  });
  const unchecked = owners.map((x) => line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: gateMark(m.ui), name: { t: x.owner }, nameW: plan.nameW,
    word: { t: 'unchecked', tone: 'warn' }, wordW: VERDICT_WORD_W, detail: { t: 'says done, no verdict yet' },
  }), m.cols)));
  return [heading('verdicts', figures, m), ...(rows.length || unchecked.length || none ? [...rows, ...unchecked] : [line([r('    no verdict recorded yet', 'muted')])])];
}

/** Offload in plain words: what each worker read, and what it returned to the lead. Figures keep their whole width; the name column gives way. */
function offloadRows(c: CoreModel, m: PanelModel, cap = OFFLOAD_CAP): PanelLine[] {
  const o = c.offload;
  const pct = o.kept > 0 && o.returned <= o.kept ? Math.max(1, Math.round((o.returned / o.kept) * 100)) : null;
  const nothing = o.kept === 0 && o.returned === 0;
  const gone = m.workers.filter((w) => w.state === 'done' || w.state === 'failed').length; // in-process workers keep no token log: they returned, the figure is absent
  const head = flowHeading('reading', nothing ? [gone ? pickForm([`${gone} worker${gone === 1 ? '' : 's'} finished`, `${gone} finished`], m.cols - GRID_LEAD - cells('reading') - 2) :'workers have read and returned nothing yet'] :[`${tok(o.kept)} tokens read by workers`, `${tok(o.returned)} returned to the lead`, ...(pct !== null ? [`${pct}% of what they read`] : [])], m);
  const ws = o.workers.slice(-cap);
  if (!ws.length) return head;
  const model = (w: (typeof ws)[number]): string => clipE((w.model ?? '?').replace(/^claude-/, ''), 12);
  const cost = (w: (typeof ws)[number]): string => (w.costUsd === null ? '' : `$${w.costUsd.toFixed(2)}`);
  const col = (label: string, f: (w: (typeof ws)[number]) => string): ((w: (typeof ws)[number]) => string) => {
    const wd = Math.max(...ws.map((w) => cells(f(w))));
    return (w) => `${label} ${f(w).padStart(wd)}`;
  };
  const peak = col('peak', (w) => tok(w.peak));
  const read = col('read', (w) => tok(w.kept));
  const back = col('returned', (w) => tok(w.returned));
  const dollars = (w: (typeof ws)[number]): string => cost(w).padStart(Math.max(...ws.map((x) => cells(cost(x)))));
  // Richest first; the first form that leaves the name column 10 cells (or the longest name) is the one every row uses.
  const forms: { word: boolean; cells: ((w: (typeof ws)[number]) => string)[] }[] = [
    { word: true, cells: [peak, read, back, dollars] }, { word: false, cells: [read, back, dollars] }, { word: false, cells: [read, back] }, { word: false, cells: [back] },
  ];
  const names = ws.map((w) => w.name);
  const need = Math.min(10, Math.max(...names.map(cells)));
  const text = (f: (typeof forms)[number], w: (typeof ws)[number]): string => f.cells.map((x) => x(w)).filter(Boolean).join('  ');
  const form = forms.find((f) => m.cols - GRID_LEAD - (f.word ? 13 : 0) - Math.max(...ws.map((w) => cells(text(f, w)))) - 1 >= need) ?? forms[forms.length - 1]!;
  const vw = Math.max(...ws.map((w) => cells(text(form, w))));
  const plan = gridPlan(m.cols, { names, word: form.word ? 12 : 0, value: vw, min: need, max: 18 });
  return [...head, ...ws.map((w) => line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: null, name: { t: w.name }, nameW: plan.nameW,
    ...(form.word ? { word: { t: model(w), tone: 'sub' as const }, wordW: 12 } : {}), value: { t: text(form, w), tone: 'text' },
  }), m.cols)))];
}

/** The seat row's figure is how many agents ran; a seat that has not run yet shows its planned count. */
const seatCount = (s: { count: number; ran: readonly string[] }): number => (s.ran.length || s.count);

const SEAT_WORD_W = 10; // `as planned`

/** The dispatch plan against what ran: a row per team (class/effort, name, transport), a row per seat with the verdict `as planned`, `drift` or `not run`. */
function dispatchRows(c: CoreModel, m: PanelModel, cap = TEAM_CAP): PanelLine[] {
  const teams = c.routes.slice(-cap).reverse();
  // One source for the heading and the rows: an in-process route is a dispatch group, never a tmux team (its row says `no tmux team`), so it is counted apart.
  const inProc = teams.filter((rt) => rt.transport === 'in-process').length;
  const tmux = teams.length - inProc;
  const dispatched = teams.reduce((n, rt) => n + rt.seats.reduce((k, s) => k + seatCount(s), 0), 0); // every worker the dispatches ran (critique 17 A6: `dispatches 1 this session` after 3 workers ran)
  const head = heading(tmux === 0 && inProc > 0 ? 'dispatches' : 'teams', teams.length ? [r(inProc > 0 && tmux > 0 ? `${tmux} tmux, ${inProc} in-process` : `${tmux === 0 ? dispatched || teams.length : teams.length} this session`, 'muted')] : [], m);
  const inProcessNote = (): PanelLine[] => (c.inProcess ? [] : wrap('in-process dispatches are not shown here', Math.max(8, m.cols - 4)).map((t) => note(t, m)));
  if (!teams.length) return [head, note('no team this session', m), ...inProcessNote()];
  const seatName = (s: { count: number; ran: readonly string[]; role: string }): string => `  ${seatCount(s)} ${s.role}${seatCount(s) === 1 ? '' : 's'}`; // plain words: `3 explorers`, never `3x explorer` (critique 18 A5)
  const names = teams.flatMap((rt) => rt.seats.map(seatName));
  const { nameW } = gridPlan(m.cols, { names, word: SEAT_WORD_W, min: 8, max: 16 });
  const withDetail = (runs: Run[], forms: string | readonly string[]): PanelLine[] => {
    const used = rowWidth(runs);
    const all = typeof forms === 'string' ? [forms] : forms;
    const text = all.find((f) => cells(f) + 1 <= m.cols - used) ?? pickForm(all, m.cols - 6); // beside the row when a form fits, else the form that fits a row of its own
    const fits = cells(text) + 1 <= m.cols - used;
    return [line(fitRuns(fits ? [...runs, r(` ${text}`, 'muted')] : runs, m.cols)), ...(fits ? [] : wrap(text, Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m)))];
  };
  const rows = teams.flatMap((rt): PanelLine[] => {
    const teamName = `${rt.cls} team (${rt.effort} effort)`; // plain words, never the `class/effort` scope token
    // A team that ran differently says what happened, in words: `planned audit team (low effort), ran 3 explorers` (data/core plannedText, the band's wording).
    const headName = rt.drift.length ? plannedText(rt) : teamName;
    const headLines = cells(headName) <= m.cols - GRID_LEAD ? [headName] : wrap(headName, Math.max(8, m.cols - GRID_LEAD), 3); // a name wider than the pane wraps on its words, it is never cut
    const team = gridRow({ cols: m.cols, ui: m.ui, mark: rt.drift.length ? gateMark(m.ui) : null, name: { t: headLines[0]!, bold: true }, nameW: Math.min(cells(headLines[0]!), Math.max(1, m.cols - GRID_LEAD)) });
    const headMore = headLines.slice(1).map((t) => line(fitRuns([r(' '.repeat(GRID_LEAD)), r(t, 'text', { bold: true })], m.cols)));
    const seats = rt.seats.flatMap((s): PanelLine[] => {
      const same = s.ran.every((x) => x.toLowerCase().includes(s.model.toLowerCase()) || s.model === 'inherit');
      const over = s.ran.length > s.count;
      // The heading already says `3 explorers ran, the plan said 1`: a second row `3 explorers too many` said the count twice (critique 21). The seat keeps only what the heading does not, the plan's model.
      if (rt.drift.length && over) return wrap(`planned on ${s.model}, ${s.effort} effort`, Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m));
      const used = [...new Set(s.ran.map((x) => x.replace(/^claude-/, '')))].join(', ');
      const [st, word, tone]: [UiState, string, Tone] = !s.ran.length ? ['queued', 'not run', 'muted'] : same && !over ? ['done', 'as planned', 'ok'] : ['blocked', over ? 'too many' : 'changed', 'warn']; // plain words (critique 17 A6); amber like the gates tab's routing warning: a team that ran differently is a warning, not a failure (critique 14)
      // Plain words, no `model/effort` token: `3 explorers ran, 1 planned (haiku, low effort)`; a seat that ran another model reads `ran on opus, planned haiku, low effort`.
      const plan = `${s.model}, ${s.effort} effort`;
      // The heading above already says `3 explorers ran, the plan said 1`: the seat row says what was asked for, in two short forms (critique 18 A5: no `3x`, no `3 ran, plan said 1 (haiku)`).
      // Critique 19 C4: the heading says the counts (`3 explorers ran, the plan said 1`); an over-run seat names only what the heading does not, the model and effort that were planned.
      const detail = !s.ran.length ? `not run yet, planned ${plan}` : over ? `planned on ${s.model}, ${s.effort} effort` : same ? `ran ${used}, ${s.effort} effort` : `ran on ${used}, planned ${plan}`;
      const runs = gridRow({ cols: m.cols, ui: m.ui, mark: coreMark(st, m.ui), name: { t: seatName(s) }, nameW, word: { t: word, tone }, wordW: SEAT_WORD_W });
      return withDetail(runs, over ? [detail, `planned on ${s.model}`] : detail);
    });
    // In-process routes have no team name or isolation to show: the sentence says how the workers ran.
    const how = rt.transport === 'in-process' ? [`workers ran in-process (no tmux team), up to ${rt.maxParallel} at once`, `ran in-process, up to ${rt.maxParallel} at once`] : `${rt.name || rt.teamId}  ${[rt.transport ?? 'transport unknown', rt.isolation].filter(Boolean).join(', ')}, max ${rt.maxParallel}`;
    const howRows = wrap(pickForm(typeof how === 'string' ? [how] : how, m.cols - 6), Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m));
    return [...(headMore.length ? [line(fitRuns(team, m.cols)), ...headMore, ...howRows] : withDetail(team, how)), ...seats];
  });
  return [head, ...rows, ...inProcessNote()];
}

function coreBody(m: PanelModel): PanelLine[] {
  if (!hasCore(m.core)) return emptyHint(m, 'no verdicts, workers or gates yet');
  const c = m.core;
  const build = (v: number, o: number, t: number): PanelLine[] => [...contractRows(c, m), BLANK, ...verdictRows(c, m, v), BLANK, ...offloadRows(c, m, o), BLANK, ...dispatchRows(c, m, t)];
  const base = build(VERDICT_CAP, OFFLOAD_CAP, TEAM_CAP);
  const room = m.rows - headerRows(m).length - 1; // one foot row stays free
  const have = [c.verdicts.length, c.offload.workers.length, c.routes.length];
  const spill = Math.max(have[0]! - VERDICT_CAP, have[1]! - OFFLOAD_CAP, have[2]! - TEAM_CAP);
  if (!tall(m) || (base.length <= room && spill <= 0)) return base;
  // A tall pane: the sections list as many rows as the pane holds. The same extra count for all three (negative: fewer than the default when the
  // default overflows; one row of each stays) by bisection, then one more row at a time to whichever section still has data and room.
  const caps = (k: number): [number, number, number] => [Math.max(1, VERDICT_CAP + k), Math.max(1, OFFLOAD_CAP + k), Math.max(1, TEAM_CAP + k)];
  let lo = 1 - Math.max(VERDICT_CAP, OFFLOAD_CAP, TEAM_CAP); // down to one row of each section, however wrapped words lengthen the rest
  let hi = Math.max(0, spill);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build(...caps(mid)).length <= room) lo = mid; else hi = mid - 1;
  }
  const at = caps(lo);
  for (let i = 0; i < 3; i++) {
    if (at[i]! >= have[i]!) continue;
    const next = [...at] as [number, number, number];
    next[i] = at[i]! + 1;
    if (build(...next).length <= room) at[i] = next[i]!;
  }
  return build(...at);
}

// ---- the panel ------------------------------------------------------------------------------------------------------------------------

const BODIES: Record<PanelTab, (m: PanelModel) => PanelLine[]> = { route: routeBody, team: teamBody, channel: channelBody, gates: gatesBody, core: coreBody };

/** The active tab's body rows (no header). */
/** Room to spare on a tall pane: the team, gates and channel tabs put a blank row between items (an item is a pressable row with its detail rows, or one note) when the whole body still fits a pane of 48 rows or more (a short pane keeps its rows tight). */
const AIRY: ReadonlySet<PanelTab> = new Set<PanelTab>(['team', 'gates', 'channel']);
function airy(m: PanelModel, lines: PanelLine[]): PanelLine[] {
  const starts = (l: PanelLine, i: number): boolean => i > 0 && (m.tab === 'channel' ? true : !!l.press);
  const gaps = lines.filter(starts).length;
  if (m.rows < 48 || !AIRY.has(m.tab) || !gaps || lines.length + gaps > m.rows - headerRows(m).length - 1) return lines;
  return lines.flatMap((l, i) => (starts(l, i) ? [BLANK, l] : [l]));
}
export const bodyLines = (m: PanelModel): PanelLine[] => airy(m, BODIES[m.tab](m));
/** Tabs whose body ends where its data does: they carry the panel surface down to the pane's foot row. */
const FILLED: ReadonlySet<PanelTab> = new Set<PanelTab>(['team', 'channel', 'core']);
/** Blank rows after a `bodyLen`-row body so header + body + fill is `rows - 1` lines, the one foot row staying free (on team and channel the
 * message field is that row). Only on a tab that has fewer rows than the pane; never negative, so a body taller than the pane is untouched. */
export function fillRows(m: PanelModel, bodyLen: number): PanelLine[] {
  const n = FILLED.has(m.tab) ? m.rows - 1 - headerRows(m).length - bodyLen : 0;
  if (n <= 0) return [];
  const fill = Array.from({ length: n }, () => BLANK);
  // Design rev 5, C1: the strip names no keys, so the last spare row (above the message field) names them once, dim.
  if (n >= 2) fill[n - 1] = line([r(' '.repeat(STRIP_PAD)), r(`keys  ${STRIP_TABS.map((t) => t.key).join(' ')}`, 'muted')]);
  return fill;
}
/** Every row of the panel: ribbon, blank, tab strip, rule, blank, then the active tab. */
export const panelLines = (m: PanelModel): PanelLine[] =>
  [...headerRows(m), ...bodyLines(m)].map((l) => (rowWidth(l.runs) > m.cols ? { ...l, runs: fitRuns(l.runs, m.cols) } : l));
/** Plain text rows, trailing spaces trimmed: what the goldens compare. */
export const panelText = (m: PanelModel): string[] => panelLines(m).map((l) => lineText(l).trimEnd());

// ---- worker card (transcript) and toast --------------------------------------------------------------------------------------------------

export type CardModel = {
  state: UiState;
  name: string;
  model?: string;
  goal?: string;
  last?: string;
  /** Steps done / total of the worker's plan. */
  steps?: { done: number; total: number };
  /** Context held, 0..1. */
  ctx?: number;
  ui: Ui;
};
/** Closed boxes are this wide at any terminal width (narrower terminals clip to their own width). */
export const CARD_W = 44;

const BOX = { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' };
const BOX_ASCII = { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };

/** A worker card as rows of runs: `┌─ ◆ running implementer-band ──────── opus ─┐`, rows inside `│ ... │`, a closed bottom. Its width is
 * `min(CARD_W, cols)`; both gauges are the same width (12 cells from 100 columns, 8 below) with a blank row between them, so unequal
 * fills never read as one stepped block. The ATLAS mark leads the title and the state word takes its state tone. */
export function cardLines(c: CardModel, cols = 120): Run[][] {
  const b = c.ui.ascii ? BOX_ASCII : BOX;
  const w = Math.max(20, Math.min(CARD_W, cols));
  const inner = w - 4;
  const g = stateRun(c.state, c.ui);
  const edge = (t: string): Run => r(t, g.tone); // the frame carries the state hue (design: blue while running); the rule between name and tag stays grey
  const body = (runs: Run[]): Run[] => [edge(b.v), r(' '), ...fitRuns(runs, inner), r(' '.repeat(Math.max(0, inner - rowWidth(fitRuns(runs, inner))))), r(' '), edge(b.v)];
  const rowLabel = (t: string): Run => r(pad(t, 6), 'muted');
  const title: Run[] = [r(c.ui.ascii ? '@' : '◆', c.ui.ascii ? 'text' : 'accent', { bold: true }), r(' '), r(c.state, stateWordTone(c.state, c.ui), { bold: true }), r(' '), r(c.name, 'text', { bold: true })];
  const tagW = c.model ? cells(c.model) + 1 : 0;
  // `┌─ ` + title + ` ` + rule + tag + ` ─┐`
  const room = c.model ? w - tagW - 8 : w - 7;
  const titleRuns = fitRuns(title, Math.max(4, room));
  const fill = Math.max(1, w - 3 - rowWidth(titleRuns) - 1 - tagW - (c.model ? 3 : 2));
  const top: Run[] = [edge(`${b.tl}${b.h} `), ...titleRuns, r(' '), r(b.h.repeat(fill), 'line'), ...(c.model ? [r(` ${c.model} `, 'sub'), edge(`${b.h}${b.tr}`)] : [edge(`${b.h}${b.tr}`)])];
  const gaugeW = cols >= 100 ? 12 : 8;
  const rows: Run[][] = [];
  if (c.goal) rows.push(body([rowLabel('goal'), r(oneLine(c.goal))]));
  if (c.last) rows.push(body([rowLabel('last'), r(oneLine(c.last))]));
  const hasSteps = !!c.steps && c.steps.total > 0;
  if (c.steps && hasSteps) {
    const v = c.steps.done / c.steps.total;
    rows.push(body([rowLabel('steps'), ...meter(gaugeW, v, c.ui), r(` ${c.steps.done} of ${c.steps.total} ${dot(c.ui)} ${percent(v)}`)]));
  }
  if (c.ctx !== undefined) {
    if (hasSteps) rows.push(body([])); // gauges on adjacent rows touch and merge into one stepped block
    rows.push(body([rowLabel('ctx'), ...meter(gaugeW, c.ctx, c.ui), r(` ${percent(c.ctx)}`)]));
  }
  return [top, ...rows, [edge(`${b.bl}${b.h.repeat(w - 2)}${b.br}`)]];
}

/** Cells the state word of a rail card (and a toast) takes before the two-cell gap and the name: the widest word is `waiting` / `running` / `blocked`. */
export const CARD_WORD_W = 7;

/** The head of a toast: a left bar in `tone` (`▌`, `|` in ASCII), then, only on a finish card (`brand`), the ATLAS mark. The mark is one grey (dim, 240) wherever it is drawn: the one solid chip belongs
 * to the band, the ribbons and the side panel title carry the brand, and a start card, a failure card, a toast and a note repeat only the name (critique 25: `◆ ATLAS` seven times on one screen, in two greys).
 * The finish card keeps it: the capture scorer locates a card by `▌ ◆ ATLAS  <glyph> done  name  role finished` (live_capture.py :676). */
const toastHead = (tone: Tone, ui: Ui, brand = false): Run[] => [r(ui.ascii ? '|' : '▌', ui.ascii ? 'text' : tone), r(' '), ...(!brand ? [] : ui.ascii ? brandMark(ui) : [r('◆ ', 'dim'), r('ATLAS', 'dim')]), ...(brand ? [r('  ')] : [])];

/** `▌ ◆ ATLAS  ● done  implementer-layout  9 of 9 steps` (a finish card, `brand`) or `▌ ◐ running  implementer-layout  what it does`: the bar and the state word in the state's tone, the state, the
 * name, one fact. No full stop. */
export function toastRuns(state: UiState, name: string, fact: string, ui: Ui, brand = false): Run[] {
  const g = stateRun(state, ui);
  // Design rev 5, C3: the state word sits in a fixed-width column (CARD_WORD_W), so the name starts at the same cell on every card; `failed` and `killed` are the same width.
  return [...toastHead(state === 'running' ? 'accent' : g.tone, ui, brand), { ...g, t: `${g.t} ` }, r(state, stateWordTone(state, ui), { bold: true }), r(`${' '.repeat(Math.max(0, CARD_WORD_W - cells(state)) + 2)}${name}`), ...(fact ? [r(`  ${oneLine(fact)}`, 'sub')] : [])];
}
export const toastText = (state: UiState, name: string, fact: string, ui: Ui): string => runsText(toastRuns(state, name, fact, ui));

/** A note toast: the same head in the note grey (245), the word `note`, the sender, a preview. */
export function noteToastRuns(sender: string, preview: string, ui: Ui): Run[] {
  return [...toastHead('sub', ui), r('note', 'text', { bold: true }), r(`  ${sender}`), ...(preview ? [r(`  ${oneLine(preview)}`, 'sub')] : [])];
}
export const noteToastText = (sender: string, preview: string, ui: Ui): string => runsText(noteToastRuns(sender, preview, ui));
export { stateGlyph };
