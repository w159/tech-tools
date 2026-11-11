// panel-layout.ts: the one side panel layout both harnesses draw (design system rev 4, "SIDEPANEL" surface).
// The Claude Code pane (mod/pane/sidebar.tsx) and the omp painter (omp/panel-view.ts) are thin adapters: each builds a
// PanelModel from its own data, calls panelLines, and paints the runs (Elements on Claude Code, ANSI on omp). Parity
// is structural: the text both print comes from here, and the goldens (contracts/panel-golden.ts) assert it.
//
// Rules: marks come from the state glyph map in atlas-ui (queued, running, done, failed, blocked, waiting; never a
// literal check mark, bullet or ellipsis); every number carries its word; colour carries state only; truncation is
// `...` through `clip`; the surface is the rev 4 panel token.
import { brandMark, capsule, cells, clip, countRuns, gauge, GRID_LEAD, gridPlan, gridRow as gridRowAt, markOf, percent, ribbon, rowWordTone, spinFrameOf, stateGlyph, stateRun, stateWordTone, UI_STATES, warnMark, type MarkState, type Run, type Tone, type Ui, type UiState } from './atlas-ui';
import { animateRow, type MotionCtx, type MotionItem } from './motion';
import { labelCut } from './board-model';
import { railNo, railOf } from './rail';
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
const STRIP_FORMS: readonly StripForm[] = [
  { gap: STRIP_GAP, label: (_, full) => full },
  { gap: 1, label: (_, full) => full },
];
const stripWidth = (tabs: readonly { label: string }[], gap: number): number => tabs.reduce((n, t, i) => n + (i ? gap : 0) + HOTKEY_W + cells(t.label), 0);
const formTabs = (f: StripForm): StripTab[] => STRIP_TABS.map((t): StripTab => ({ ...t, label: f.label(t.id, t.label) }));

/** Tabs per strip row: as many as fit in `inner` cells, each costing its label plus the `k: ` prefix and `gap` cells between; the rest wrap. */
export function stripRows<T extends { label: string }>(items: readonly T[], inner: number, gap: number = STRIP_GAP): T[][] {
  const rows: T[][] = [];
  let used = 0;
  for (const it of items) {
    const w = HOTKEY_W + cells(it.label);
    if (!rows.length || (rows[rows.length - 1]!.length && used + gap + w > inner)) { rows.push([]); used = 0; }
    rows[rows.length - 1]!.push(it);
    used += (rows[rows.length - 1]!.length > 1 ? gap : 0) + w;
  }
  return rows;
}

/** The strip both hosts draw at `cols` cells, after `STRIP_PAD` cells of padding: the widest label form that fits one row, else the
 * full words wrapped onto a second row. The rule under the lit tab is as wide as the drawn label. */
export function stripLayout(cols: number, _lit?: string): { rows: StripTab[][]; gap: number } {
  const inner = Math.max(1, cols - STRIP_PAD);
  for (const f of STRIP_FORMS) {
    const tabs = formTabs(f);
    if (stripWidth(tabs, f.gap) <= inner) return { rows: [tabs], gap: f.gap };
  }
  const wide = STRIP_FORMS[0]!;
  return { rows: stripRows(formTabs(wide), inner, wide.gap), gap: wide.gap };
}

export type PanelTodo = { id: string; label: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`returned`). */ word?: string; owner?: string; detail?: string; evidence?: string | null };
export type PanelWorker = { name: string; role?: string; state: UiState; model?: string; task?: string; /** The dispatch description (`name: what to do`): the HUD's source for the one name every surface shows (displayName). */ goal?: string; detail: string; secs?: number; tools?: number };
export type PanelGateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
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
const cut = (t: string, n: number): string => pad(clip(t, n), n);
/** The grammar row with every name cut at its end: a name is never cut in the middle on the panel. */
const gridRow = (spec: Parameters<typeof gridRowAt>[0]): Run[] => gridRowAt({ nameCut: 'end', ...spec });
const oneLine = (t: string | undefined | null): string => (t ?? '').replace(/\s+/g, ' ').trim();

/** Runs cut to `cols` cells: the run that overflows is clipped with `...`, the rest dropped. */
export function fitRuns(runs: readonly Run[], cols: number): Run[] {
  const out: Run[] = [];
  let left = Math.max(1, cols);
  for (const x of runs) {
    if (left <= 0) break;
    const t = cells(x.t) <= left ? x.t : clip(x.t, left);
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
/** The state glyph of agent `id` on its row. */
const stateMark = (s: MarkState, m: Pick<PanelModel, 'ui' | 'now' | 'tick'>, id = ''): Run => stateRun(s, m.ui, frameOf(m, id));
/** The one name every surface shows for an agent (mod/hud.ts displayName); the real name stays the key, the recipient and the spinner id. */
const nameOf = (w: PanelWorker): string => oneLine(displayName(w.name, w.role ?? '', w.goal));
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
export const channelLabel = (name: string | undefined, fallback = 'channel'): string => (name && /^lc-[a-z0-9]{4,}$/i.test(name) ? 'this run' : `#${name ?? fallback}`);

/** The ribbon's right-hand text: what the active tab counts, always with its word. */
function ribbonRight(m: PanelModel): string {
  if (m.tab === 'team') return m.workers.length ? countWords(m.workers, m.ui) : '';
  if (m.tab === 'gates') { const t = tallyOf(gatesOf(m)); return t.total ? `${t.green}/${t.total}` : ''; } // `n/m` at every width: `2/4` at 110 and `1 of 4 green` at 150 was one figure in two formats (critique 11)
  if (m.tab === 'channel') return m.channel ? channelLabel(m.channel) : '';
  return '';
}

export function ribbonRow(m: PanelModel): PanelLine {
  if (m.cols < 34) {
    const cap = capsule(m.ui);
    const fill = Math.max(0, m.cols - rowWidth(cap) - 1);
    return line(fitRuns([...cap, r(' '), m.ui.ascii ? r('-'.repeat(fill), 'muted') : r('━'.repeat(fill), 'line')], m.cols));
  }
  const right = ribbonRight(m);
  const fitsRight = right && m.cols >= 40 + cells(right);
  // The gates figure (`17/18`) never drops from the header while the capsule and title fit beside it.
  const keep = m.tab === 'gates' && !!right && m.cols >= 32 + cells(right);
  return line(ribbon(m.cols, 'SIDEPANEL', fitsRight || keep ? right : '', m.ui));
}

/** The tab strip and the rule under the lit tab: `r: route  t: team  c: channel  g: gates  k: core  o: board`, `━━━━━` under the lit one. A
 * strip that does not fit wraps onto a second row (the rule sits under the row that holds the lit tab). */
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
      strip.push(r(`${t.key}: `, 'muted'), on ? r(t.label, 'text', { bold: true }) : r(t.label, 'muted'));
      under.push(r(' '.repeat(HOTKEY_W)), on ? r((m.ui.ascii ? '-' : '━').repeat(cells(t.label)), 'accent') : r(' '.repeat(cells(t.label))));
    });
    return [line(fitRuns(strip, m.cols)), ...(row.some((t) => t.id === m.tab) ? [line(fitRuns(under, m.cols))] : [])];
  });
}

/** Ribbon, blank, tab strip, rule, and (from 100 columns) a blank before the body; the 80-column design has none. */
export const headerRows = (m: PanelModel): PanelLine[] => [ribbonRow(m), BLANK, ...tabRows(m), ...(m.cols >= 100 ? [BLANK] : [])];

// ---- route ------------------------------------------------------------------------------------------------------------

const groupOk = (g: PanelGate): boolean => !g.error && g.lines.every((l) => l.ok);
const groupFailing = (g: PanelGate): number => g.lines.filter((l) => !l.ok).length;

/** `phase   research   2/4`: the lit phase and its place on the rail. */
function phaseRow(m: PanelModel): PanelLine {
  const rail = railOf(m.phases, m.phase); // the one rail (mod/rail.ts): the band, the HUD and omp read the same index
  return line([label('phase', m.cols), r(m.phase), ...(m.phases.length && (m.phase === 'done' || m.phases.includes(m.phase)) ? [r(`${m.cols >= 100 ? '   ' : ' '}${railNo(rail)}`)] : [])]);
}

/** `gates   ● lint   ● test   ▲ doctor   2/3 green`; names that do not fit fold to the count alone. `n/m` like the ribbon's figure (critique 12 B3). */
function gatesRow(m: PanelModel): PanelLine | null {
  const t = tallyOf(gatesOf(m));
  const gs = countedGates(gatesOf(m));
  if (!t.total) return null;
  const word = `${t.green}/${t.total} green`;
  const names: Run[] = gs.flatMap((g, i): Run[] => [...(i ? [r('   ')] : []), groupOk(g) ? mark('done', m) : { ...warnMark(m.ui), t: `${warnMark(m.ui).t} ` }, r(g.id)]);
  const full = [label('gates', m.cols), ...names, r(`   ${word}`)];
  if (rowWidth(full) <= m.cols) return line(full);
  return line([label('gates', m.cols), r(word)]);
}

function todoCount(m: PanelModel): PanelLine {
  const done = m.todos.filter((t) => t.state === 'done').length;
  const total = m.todos.length;
  if (!total) return line([label('todo', m.cols), r('no tasks yet', 'muted')]);
  const g = m.cols >= 40 ? [...gauge(10, done / total, m.ui, 'ok', 'muted'), r(' ')] : []; // the ok tone fills and the muted tone is the track: quieter than any state word
  return line([label('todo', m.cols), ...g, r(`${done}/${total}`)]);
}

/** The agents row: one count per state; segments that do not fit wrap under the label instead of overflowing. */
function agentsRows(m: PanelModel): PanelLine[] {
  if (!m.workers.length) return [];
  const sep = m.cols >= WIDE ? 3 : 2;
  const segs = UI_STATES.filter((s) => m.workers.some((w) => w.state === s)).map((s) => countRuns(s, m.workers.filter((w) => w.state === s).length, m.ui, frameOf(m, m.workers.find((w) => w.state === s)?.name)));
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

function todoRows(m: PanelModel, t: PanelTodo, w: { nameW: number; valueW: number; wordW: number; shown?: string }): PanelLine[] {
  const key = `task:${t.id}`;
  const runs = gridRow({
    cols: m.cols, ui: m.ui, mark: stateMark(markOf(t.state, t.word), m, t.owner || t.id),
    name: { t: w.shown ?? oneLine(t.label), tone: t.state === 'done' ? 'sub' : 'text', ...(t.state === 'done' ? { strike: true } : {}) }, nameW: w.nameW, nameCut: 'end', // a done title is struck through, as in the HUD (critique 11)
    word: { t: t.word ?? t.state, tone: rowWordTone(t.state, t.word) }, wordW: w.wordW,
    ...(m.cols >= WIDE && t.detail ? { detail: { t: oneLine(t.detail) } } : {}), // wide panels show the reason in one fixed column after the state word
    ...(w.valueW && ownerColumn(t) ? { value: { t: clip(oneLine(t.owner), w.valueW), tone: 'sub' as const } } : {}),
  });
  const open = m.expanded === key;
  const facts = [t.owner ? `owner ${oneLine(t.owner)}` : '', oneLine(t.detail)].filter(Boolean).join(` ${dot(m.ui)} `);
  const extra = open ? [...(facts ? [facts] : []), t.evidence ? `evidence: ${oneLine(t.evidence)}` : 'no evidence yet'] : [];
  return [line(fitRuns(moving(runs, key, markOf(t.state, t.word), m), m.cols), { kind: 'toggle', key }), ...extra.map((x) => line(fitRuns([r(`    ${x}`, 'muted')], m.cols)))];
}

/** What the Motion observes of the panel: each plan task, worker, gate group and gate line (key and state word), the rows `bodyLines` can move. */
export function panelMotionItems(m: Pick<PanelModel, 'todos' | 'workers' | 'lead' | 'mates' | 'gates'>): MotionItem[] {
  return [
    ...m.todos.map((t): MotionItem => ({ key: `task:${t.id}`, state: t.state })),
    ...[...m.workers, ...(m.mates ?? [])].map((w): MotionItem => ({ key: `worker:${w.name}`, state: w.state })),
    ...m.gates.flatMap((g): MotionItem[] => [{ key: `group:${g.id}`, state: groupOk(g) ? 'done' : 'failed' }, ...g.lines.map((l): MotionItem => ({ key: `gate:${l.id}`, state: l.ok ? 'done' : 'failed' }))]),
  ];
}

/** Rows a tab may use below its header; a plan longer than that folds into `+N more`. */
const bodyRows = (m: PanelModel, used: number): number => Math.max(3, m.rows - headerRows(m).length - used - 2);

/** Panes of this many rows or more have room beyond the tabs' own rows: each tab fills it with detail the snapshot already holds. */
const TALL = 30;
const tall = (m: PanelModel): boolean => m.rows >= TALL;
/** Rows left in a pane after the header and `used` body rows (one row stays free at the foot). */
const spareRows = (m: PanelModel, used: number): number => m.rows - headerRows(m).length - used - 1;

/** A worker's last step as every `last` text shows it: no list marker, backtick or absolute path (`lastText`), ended on a whole word within `room` cells; empty when no word fits. */
const lastFit = (w: PanelWorker, room: number): string => clipWords(lastText(w.detail), Math.max(0, room));

/** An agent row under the route tab's `agents` row: glyph, whole name, state word, from 100 columns what it is doing. */
function routeAgentRow(m: PanelModel, w: PanelWorker, nameW: number): PanelLine {
  const tone: Tone = rowWordTone(w.state);
  const last = m.cols >= WIDE ? lastFit(w, m.cols - 2 - (GRID_LEAD + nameW + 1 + WORD_W) - 1) : '';
  return line(fitRuns(moving([r('  '), ...gridRow({ cols: m.cols - 2, ui: m.ui, mark: stateMark(w.state, m, w.name), name: { t: nameOf(w), bold: true }, nameW, word: { t: w.state, tone }, wordW: WORD_W, ...(last ? { detail: { t: last } } : {}) })], `worker:${w.name}`, w.state, m), m.cols));
}

function routeBody(m: PanelModel): PanelLine[] {
  const rows: PanelLine[] = [phaseRow(m)];
  const gates = gatesRow(m);
  if (gates) rows.push(gates);
  rows.push(...agentsRows(m));
  // A tall pane lists the agents under their count (the row headed `agents` holds agents, never plan rows); a short one names only the loose ones below the plan.
  const team = workersByTask(m); // the one agent order (HUD, route and team tab): by task
  const listed = tall(m) ? team.slice(0, AGENT_ROWS) : [];
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
    if (running.length) rows.push(BLANK, ...running.slice(0, bodyRows(m, rows.length)).map((w) => line(gridRow({ cols: m.cols, ui: m.ui, mark: stateMark('running', m, w.name), name: { t: nameOf(w) }, nameW, detail: { t: lastFit(w, m.cols - (GRID_LEAD + nameW) - 1) } }))));
    else if (!m.workers.length) rows.push(BLANK, line([r('(no state)', 'muted'), r(`  no tasks yet ${dot(m.ui)} add one with /todo add`, 'muted')]));
    return rows;
  }
  // Agents that work but hold no plan row (the plan rows carry no owner while the agents are host-spawned): a group under the plan names them, in the HUD Subagents state words.
  const owners = new Set(m.todos.map((t) => t.owner).filter((o): o is string => !!o));
  const loose = listed.length ? [] : team.filter((w) => w.state !== 'done' && w.state !== 'queued' && !owners.has(w.name));
  const looseShown = loose.slice(0, AGENT_ROWS);
  const room = Math.max(1, bodyRows(m, rows.length + 1) - (loose.length ? looseShown.length + 1 + (loose.length > looseShown.length ? 1 : 0) : 0));
  const ordered = m.todos; // the Board's order (plan rows as the board lists them), not regrouped by state
  // The owner column goes first (critique 12 A2): a row whose title already names its owner (`T1 read alpha.py (alpha-explorer)`) prints no second copy, so the title keeps the room.
  const widest = Math.min(m.cols >= WIDE ? 28 : OWNER_W, Math.max(0, ...ordered.filter(ownerColumn).map((t) => cells(oneLine(t.owner)))));
  // The title column is as wide as the longest title the pane has room for (the state word follows it on every row, so the words line up); only a title past the room is cut, in the middle.
  const todoWordW = ordered.reduce((n, t) => Math.max(n, cells(t.word ?? t.state)), WORD_W); // 8 while a row reads `returned`
  const titleMax = m.cols >= WIDE ? Math.max(TITLE_MIN_W, m.cols - 60) : m.cols; // from 100 columns the title leaves the reason a column
  const titles = [' '.repeat(TITLE_MIN_W), ...ordered.map((t) => oneLine(t.label))];
  const plan = gridPlan(m.cols, { names: titles, word: todoWordW, value: widest, optional: true, min: Math.min(titleMax, Math.max(8, ...ordered.filter((t) => t.owner && !ownerColumn(t)).map((t) => cells(oneLine(t.label))))), max: titleMax }); // a title that names its owner stays whole: the column gives way before it is cut
  const shown: PanelLine[] = [];
  const shownTitles = labelCut(ordered.map((t) => oneLine(t.label)), plan.nameW);
  for (const [i, t] of ordered.entries()) {
    const rs = todoRows(m, t, { ...plan, wordW: todoWordW, shown: shownTitles[i]! });
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

function workerRows(m: PanelModel, w: PanelWorker, nameW: number, focus: boolean, more = false): PanelLine[] {
  const key = `worker:${w.name}`;
  const wide = m.cols >= WIDE;
  // Wide: the design's Subagents columns after the state word (model, task, what it is doing), shared with the HUD block.
  // Dropped as the pane narrows: the model first, then the task tag; the detail is cut at its end last. The name never gives way to them.
  const room = m.cols - GRID_LEAD - nameW - 2 - (wide ? 12 : 10) - 1;
  const withModel = room >= 10 + 6 + 12;
  const withTask = room >= 6 + 12;
  const tail = wide ? [...(withModel ? [r(pad(w.model ?? '', 10), 'sub')] : []), ...(withTask ? [r(pad(w.task ?? '', 6), 'sub')] : []), r(lastFit(w, room - (withModel ? 10 : 0) - (withTask ? 6 : 0)), 'muted')] : [];
  const runs = gridRow({
    cols: m.cols, ui: m.ui, focus, mark: stateMark(w.state, m, w.name),
    name: { t: nameOf(w), bold: true }, nameW, gap: 2,
    word: { t: w.state, tone: w.state === 'failed' ? 'bad' : w.state === 'blocked' ? 'warn' : 'sub' }, wordW: wide ? 12 : 10, tail,
  });
  const out = [line(fitRuns(moving(runs, key, w.state, m), m.cols), { kind: 'worker', key, name: w.name })];
  if (m.expanded === key) {
    out.push(line(fitRuns([r(`    ${lastFit(w, m.cols - 4) || w.state}`, 'muted')], m.cols)));
    if (w.secs !== undefined) out.push(line(fitRuns([r(`    running ${shortAge(w.secs)}${w.tools !== undefined ? ` ${dot(m.ui)} ${w.tools} tool calls` : ''}`, 'muted')], m.cols)));
  } else if (more) out.push(...workerDetail(m, w));
  return out;
}

/** `workers  1 running · 2 done`: the tally of the lead's workers, under its own row (which already names the lead, so the name is not said twice). Running always reads; the other states only when not zero. */
function leadSummary(m: PanelModel): PanelLine {
  const n = (s: UiState): number => m.workers.filter((w) => w.state === s).length;
  const parts = UI_STATES.filter((s) => s === 'running' || n(s)).map((s) => `${n(s)} ${s}`);
  return line(fitRuns([r(' '.repeat(GRID_LEAD)), r('workers  ', 'text', { bold: true }), r(parts.join(` ${dot(m.ui)} `), 'muted')], m.cols)); // in the name column, under the lead's own row
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

function teamBody(m: PanelModel): PanelLine[] {
  const mates = m.mates ?? [];
  const lead = leadOf(m);
  const workers = workersByTask(m);
  const everyone = [...(lead ? [lead] : []), ...workers, ...mates];
  if (!everyone.length) return [line([r('(no state)', 'muted'), r('  nobody dispatched yet, ask the lead to start a worker', 'muted')])];
  const cap = Math.max(18, Math.min(40, m.cols - GRID_LEAD - 2 - (m.cols >= WIDE ? 12 : 10) - 1 - (m.cols >= WIDE ? 28 : 0)));
  const nameW = Math.min(cap, Math.max(6, ...everyone.map((w) => cells(nameOf(w)))));
  const focusName = m.recipient && everyone.some((w) => w.name === m.recipient) ? m.recipient : workers.find((w) => w.state === 'running')?.name;
  const rows = (ws: readonly PanelWorker[], more: ReadonlySet<string>): PanelLine[] => ws.flatMap((w) => workerRows(m, w, Math.min(nameW, Math.max(6, m.cols - 14)), w.name === focusName, more.has(w.name)));
  const hint = !m.workers.length && !mates.length ? [line([r('(no state)', 'muted'), r('  nobody dispatched yet, ask the lead to start a worker', 'muted')])] : [];
  const build = (more: ReadonlySet<string>): PanelLine[] => [...(lead ? rows([lead], more) : []), ...hint, ...rows(workers, more), ...rows(mates, more), ...(m.lead ? [leadSummary(m)] : [])];
  const base = build(new Set());
  if (!tall(m)) return base;
  // A tall pane: the rows left go to per-agent detail, in roster order (the lead, then running first), each agent whole or not at all.
  let spare = spareRows(m, base.length);
  const more = new Set<string>();
  for (const w of everyone) {
    const cost = m.expanded === `worker:${w.name}` ? 0 : workerDetail(m, w).length;
    if (cost && cost <= spare) { more.add(w.name); spare -= cost; }
  }
  return more.size ? build(more) : base;
}

// ---- channel ------------------------------------------------------------------------------------------------------------------

const noteText = (m: PanelModel, n: PanelNote): string => {
  const kind = n.kind === 'blocked' || n.kind === 'handoff' || n.kind === 'done';
  return `${n.to && n.to !== 'all' && !kind ? `${m.ui.ascii ? '>' : '▸'} ${n.to} ` : ''}${oneLine(n.text)}`;
};

/** A note as one row; `bare` leaves the text off (a tall pane reads the whole message on the rows under it). */
function noteRow(m: PanelModel, n: PanelNote, g: { nameW: number; wordW: number; timeW: number }, bare = false): PanelLine {
  const kind = n.kind === 'blocked' ? 'blocked' : n.kind === 'handoff' || n.kind === 'done' ? n.kind : '';
  const state: UiState | null = kind === 'blocked' ? 'blocked' : kind ? 'done' : null;
  return line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: state ? stateRun(state, m.ui) : null,
    name: { t: n.from, bold: true }, nameW: g.nameW, gap: 2,
    ...(g.wordW ? { word: kind ? { t: kind, tone: kind === 'blocked' ? 'warn' as const : 'ok' as const } : { t: '' }, wordW: g.wordW } : {}),
    ...(bare ? {} : { detail: { t: noteText(m, n), tone: 'text' as const } }),
    ...(g.timeW ? { value: { t: n.at, tone: 'muted' as const } } : {}),
  }), m.cols));
}

const NOTE_LINES = 4; // rows one message may take on a tall pane

function channelBody(m: PanelModel): PanelLine[] {
  const ind = ' '.repeat(GRID_LEAD); // the indent every other tab's rows have: the name column (critique 11: the channel head sat one cell from the border)
  const head = line(fitRuns([
    ...(m.channel && channelLabel(m.channel) === 'this run'
      ? [r(`${ind}this run`, 'text', { bold: true }), r(` ${dot(m.ui)} #${m.channel}`, 'muted'), r('  ')] // the words stay and the real id shows dim: a reader and the live scorer both look for the channel name (live 6b7f637d)
      : [r(`${ind}${channelLabel(m.channel)}  `, 'text', { bold: true })]),
    r(`${m.people} ${m.people === 1 ? 'person' : 'people'}${m.unread ? ` ${dot(m.ui)} ${m.unread} unread` : ''}`, 'muted'),
  ], m.cols));
  if (!m.notes.length) return [head, BLANK, line(fitRuns([r(`${ind}no messages yet`, 'muted')], m.cols)), ...wrap('workers post here when they hand off or block; type below to message the lead', Math.max(8, m.cols - GRID_LEAD - 1), 3).map((t) => line(fitRuns([r(`${ind}${t}`, 'muted')], m.cols)))];
  const log = m.notes.slice(-Math.max(1, tall(m) ? m.rows - headerRows(m).length - 2 : m.rows - 4)); // a tall pane: the head, the log and the foot row make exactly the pane
  const hasKind = log.some((n) => n.kind === 'blocked' || n.kind === 'handoff' || n.kind === 'done');
  const timeW = m.cols >= 50 ? Math.max(0, ...log.map((n) => cells(n.at))) : 0;
  const plan = gridPlan(m.cols, { names: log.map((n) => n.from), word: hasKind ? 7 : 0, gap: 2, value: timeW, optional: true, min: 4, max: m.cols >= 100 ? 24 : 12 });
  const g = { nameW: plan.nameW, wordW: plan.wordW, timeW: plan.valueW };
  if (!tall(m)) return [head, ...log.map((n) => noteRow(m, n, g))];
  // A tall pane: the rows left go to the newest messages, read whole over up to four rows; a message that already fits its row keeps it.
  const inline = m.cols - GRID_LEAD - g.nameW - (g.wordW ? g.wordW + 2 : 0) - (g.timeW ? g.timeW + 1 : 0) - 2;
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
  if (out.length <= max) return out.map((l) => clip(l, width));
  const kept = out.slice(0, max);
  kept[max - 1] = clip(`${kept[max - 1]} ${out.slice(max).join(' ')}`, width);
  return kept;
}

const note = (t: string, m: PanelModel): PanelLine => line(fitRuns([r(`    ${t}`, 'muted')], m.cols));

function gateLineRows(m: PanelModel, ln: PanelGateLine): PanelLine[] {
  const key = `gate:${ln.id}`;
  const open = m.expanded === key;
  const [first = '', ...more] = wrap(oneLine(ln.label), Math.max(8, m.cols - 6));
  const extra = open ? [ln.detail, ln.fix ? `fix: ${ln.fix} (press to copy)` : undefined].filter((x): x is string => !!x) : [];
  return [
    line(moving(gridRow({ cols: m.cols, ui: m.ui, mark: ln.ok ? stateRun('done', m.ui) : warnMark(m.ui), name: { t: `  ${first}` }, nameW: cells(first) + 2 }), key, ln.ok ? 'done' : 'blocked', m), { kind: 'toggle', key, ...(open && ln.fix ? { copy: ln.fix } : {}) }),
    ...more.map((t) => note(`  ${t}`, m)), ...extra.map((t) => note(`  ${oneLine(t)}`, m)),
  ];
}

const GATE_WORD_W = 7; // `passing` and `warning`
/** `2/3 green`: the group's checks that pass, the value column (the `n/m` the tab ribbon uses); empty while the group passes. */
const gateValue = (g: PanelGate): string => (groupFailing(g) ? `${g.lines.length - groupFailing(g)}/${g.lines.length} green` : '');

function gateGroupRows(m: PanelModel, g: PanelGate, nameW: number, showValue: boolean, all = false): PanelLine[] {
  const bad = groupFailing(g);
  const key = `group:${g.id}`;
  const first = g.lines.find((l) => !l.ok);
  const open = all || m.expanded === key || g.lines.some((l) => m.expanded === `gate:${l.id}`);
  // What is wrong follows the word: the first fix, else (while the group is closed) the failing check's name. Once the checks are listed the name is
  // their own row, never said twice; a passing group says nothing here (a check's detail belongs to its row, never beside another's name).
  const tail = g.error ? `unavailable: ${oneLine(g.error)}` : bad ? oneLine(first?.fix ?? (open ? '' : first?.label)) : '';
  const word = bad || g.error ? 'warning' : 'passing';
  // The green count is the right-aligned value; the tail follows the word when it fits whole, else wraps under.
  const value = showValue ? gateValue(g) : '';
  const fixed = GRID_LEAD + nameW + 2 + GATE_WORD_W + (value ? cells(value) + 1 : 0) + 1;
  const fits = !tail || cells(tail) <= m.cols - fixed;
  const runs = gridRow({
    cols: m.cols, ui: m.ui, mark: groupOk(g) ? stateRun('done', m.ui) : warnMark(m.ui),
    name: { t: oneLine(g.title), bold: true }, nameW, gap: 2, word: { t: word, tone: bad || g.error ? 'warn' : 'ok' }, wordW: GATE_WORD_W,
    ...(fits && tail ? { detail: { t: tail } } : {}), ...(value ? { value: { t: value, tone: 'warn' as const } } : {}),
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
  if (!gs.length) return [line([r('(no state)', 'muted'), r('  no gates reported yet', 'muted')])];
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

const heading = (title: string, figures: Run[], m: PanelModel): PanelLine => line(fitRuns([r(` ${title}`, 'muted', { bold: true }), ...(figures.length ? [r('  '), ...figures] : [])], m.cols));
const tallyTone = (ok: number, total: number): Tone => (!total ? 'muted' : ok === total ? 'text' : 'warn');
const joinSep = (parts: Run[], ui: Ui): Run[] => parts.flatMap((p, i) => (i ? [sep(ui), p] : [p]));

/** A heading and its figures, wrapped by whole figure: a figure that does not fit moves to the next row (indented under the first), it is never cut. */
function flowHeading(title: string, parts: readonly string[], m: PanelModel): PanelLine[] {
  const indent = cells(title) + 3;
  const rows: Run[][] = [[r(` ${title}`, 'muted', { bold: true }), r('  ')]];
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

/** `contract`: `evidence` and `verified`, each `glyph name  n/m` over the plan's items (the denominator of the band's `todo n/m`; the done items when the pane has no
 * plan). The header tally counts replies, a different unit: it lives on the gates tab (Header contract), not here. */
function contractRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const { evidence: e, verifiedDone: v } = c.contract;
  const plan = m.todos.length;
  const over = (t: { total: number; ok: number }): number => (plan > 0 && t.total > 0 ? Math.max(plan, t.ok) : t.total); // the figure's denominator; the tone and mark read the done items (amber when one lacks evidence)
  // A figure short of its plan says why, in the row: `evidence 0/5  5 done without evidence`, `verified 0/5  0 verified findings so far`. The verified row is present for every plan, so the
  // gates and core tabs always carry the verified count against the plan denominator (critique 12 B1, B6: a bare zero beside `todo 5/5` read as a defect).
  const why = (name: string, t: { ok: number; total: number }): string => (!t.total || t.ok === t.total ? '' : name === 'evidence' ? `${t.total - t.ok} done without evidence` : `${c.ledger.verified} verified finding${c.ledger.verified === 1 ? '' : 's'} so far`);
  const items: [string, { ok: number; total: number }][] = [['evidence', e], ['verified', v]];
  return [
    heading('contract', [], m),
    ...items.map(([name, t]) => line(fitRuns(gridRow({
      cols: m.cols, ui: m.ui, mark: stateRun(!t.total ? 'queued' : t.ok === t.total ? 'done' : 'blocked', m.ui),
      name: { t: name }, nameW: 8, word: { t: t.total ? `${t.ok}/${over(t)}` : 'none yet', tone: tallyTone(t.ok, t.total) }, wordW: 8,
      ...(why(name, t) ? { detail: { t: why(name, t) } } : {}),
    }), m.cols))),
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
    return [
      line(fitRuns(gridRow({
        cols: m.cols, ui: m.ui, mark: stateRun(look.s, m.ui), name: { t: oneLine(v.id) }, nameW: plan.nameW,
        word: { t: look.word, tone: look.tone, bold: v.status === 'rejected' }, wordW: VERDICT_WORD_W, detail: { t: oneLine(v.title) },
      }), m.cols), { kind: 'toggle', key }),
      ...detail.map((t) => line(fitRuns([r(`    ${t}`, 'muted')], m.cols))),
    ];
  });
  const unchecked = owners.map((x) => line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: stateRun('blocked', m.ui), name: { t: x.owner }, nameW: plan.nameW,
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
  const head = flowHeading('reading', nothing ? [gone ? `${gone} worker${gone === 1 ? '' : 's'} returned, no token figures kept` : 'workers have read and returned nothing yet'] :[`${tok(o.kept)} tokens read by workers`, `${tok(o.returned)} returned to the lead`, ...(pct !== null ? [`${pct}% of what they read`] : [])], m);
  const ws = o.workers.slice(-cap);
  if (!ws.length) return head;
  const model = (w: (typeof ws)[number]): string => clip((w.model ?? '?').replace(/^claude-/, ''), 12);
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
  const head = heading(tmux === 0 && inProc > 0 ? 'dispatches' : 'teams', teams.length ? [r(inProc > 0 && tmux > 0 ? `${tmux} tmux, ${inProc} in-process` : `${teams.length} this session`, 'muted')] : [], m);
  const inProcessNote = (): PanelLine[] => (c.inProcess ? [] : wrap('in-process dispatches are not shown here', Math.max(8, m.cols - 4)).map((t) => note(t, m)));
  if (!teams.length) return [head, note('no team this session', m), ...inProcessNote()];
  const names = teams.flatMap((rt) => rt.seats.map((s) => `  ${seatCount(s)}x ${s.role}`));
  const { nameW } = gridPlan(m.cols, { names, word: SEAT_WORD_W, min: 8, max: 16 });
  const withDetail = (runs: Run[], text: string): PanelLine[] => {
    const used = rowWidth(runs);
    const fits = cells(text) + 1 <= m.cols - used;
    return [line(fitRuns(fits ? [...runs, r(` ${text}`, 'muted')] : runs, m.cols)), ...(fits ? [] : wrap(text, Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m)))];
  };
  const rows = teams.flatMap((rt): PanelLine[] => {
    const teamName = `${rt.cls} team (${rt.effort} effort)`; // plain words, never the `class/effort` scope token
    // A team that ran differently says what happened, in words: `planned audit team (low effort), ran 3 explorers` (data/core plannedText, the band's wording).
    const headName = rt.drift.length ? plannedText(rt) : teamName;
    const team = gridRow({ cols: m.cols, ui: m.ui, mark: rt.drift.length ? stateRun('failed', m.ui) : null, name: { t: headName, bold: true }, nameW: Math.min(cells(headName), Math.max(1, m.cols - GRID_LEAD)) });
    const seats = rt.seats.flatMap((s): PanelLine[] => {
      const same = s.ran.every((x) => x.toLowerCase().includes(s.model.toLowerCase()) || s.model === 'inherit');
      const over = s.ran.length > s.count;
      const used = [...new Set(s.ran.map((x) => x.replace(/^claude-/, '')))].join(', ');
      const [st, word, tone]: [UiState, string, Tone] = !s.ran.length ? ['queued', 'not run', 'muted'] : same && !over ? ['done', 'as planned', 'ok'] : ['failed', 'off plan', 'bad'];
      // Plain words, no `model/effort` token: `3 explorers ran, 1 planned (haiku, low effort)`; a seat that ran another model reads `ran on opus, planned haiku, low effort`.
      const plan = `${s.model}, ${s.effort} effort`;
      const detail = !s.ran.length ? `not run yet, planned ${plan}` : over ? `${s.ran.length} ${s.role}${s.ran.length === 1 ? '' : 's'} ran, ${s.count} planned (${plan})` : same ? `ran ${used}, ${s.effort} effort` : `ran on ${used}, planned ${plan}`;
      const runs = gridRow({ cols: m.cols, ui: m.ui, mark: stateRun(st, m.ui), name: { t: `  ${seatCount(s)}x ${s.role}` }, nameW, word: { t: word, tone }, wordW: SEAT_WORD_W });
      return withDetail(runs, detail);
    });
    // In-process routes have no team name or isolation to show: the sentence says how the workers ran.
    const how = rt.transport === 'in-process' ? `workers ran in-process (no tmux team), up to ${rt.maxParallel} at once` : `${rt.name || rt.teamId}  ${[rt.transport ?? 'transport unknown', rt.isolation].filter(Boolean).join(', ')}, max ${rt.maxParallel}`;
    return [...withDetail(team, how), ...seats];
  });
  return [head, ...rows, ...inProcessNote()];
}

function coreBody(m: PanelModel): PanelLine[] {
  if (!hasCore(m.core)) return [line([r('(no state)', 'muted'), r('  no verdicts, workers or gates yet', 'muted')])];
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
  return n > 0 ? Array.from({ length: n }, () => BLANK) : [];
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
    rows.push(body([rowLabel('steps'), ...gauge(gaugeW, v, c.ui, 'info'), r(` ${c.steps.done} of ${c.steps.total} ${dot(c.ui)} ${percent(v)}`)]));
  }
  if (c.ctx !== undefined) {
    if (hasSteps) rows.push(body([])); // gauges on adjacent rows touch and merge into one stepped block
    rows.push(body([rowLabel('ctx'), ...gauge(gaugeW, c.ctx, c.ui, 'info'), r(` ${percent(c.ctx)}`)]));
  }
  return [top, ...rows, [edge(`${b.bl}${b.h.repeat(w - 2)}${b.br}`)]];
}

/** The head of a toast: a left bar in `tone` (`▌`, `|` in ASCII), then the ATLAS mark. */
const toastHead = (tone: Tone, ui: Ui): Run[] => [r(ui.ascii ? '|' : '▌', ui.ascii ? 'text' : tone), r(' '), ...brandMark(ui), r('  ')];

/** `▌ ◆ ATLAS  ● done  implementer-layout  9 of 9 steps`: the bar and the state word in the state's tone, then the mark, the state, the
 * name, one fact. No full stop. */
export function toastRuns(state: UiState, name: string, fact: string, ui: Ui): Run[] {
  const g = stateRun(state, ui);
  return [...toastHead(g.tone, ui), { ...g, t: `${g.t} ` }, r(state, stateWordTone(state, ui), { bold: true }), r(`  ${name}`), ...(fact ? [r(`  ${oneLine(fact)}`, 'sub')] : [])];
}
export const toastText = (state: UiState, name: string, fact: string, ui: Ui): string => runsText(toastRuns(state, name, fact, ui));

/** A note toast: the same head in the accent tone, the word `note`, the sender, a preview. */
export function noteToastRuns(sender: string, preview: string, ui: Ui): Run[] {
  return [...toastHead('accent', ui), r('note', 'accent', { bold: true }), r(`  ${sender}`), ...(preview ? [r(`  ${oneLine(preview)}`, 'sub')] : [])];
}
export const noteToastText = (sender: string, preview: string, ui: Ui): string => runsText(noteToastRuns(sender, preview, ui));
export { stateGlyph };
