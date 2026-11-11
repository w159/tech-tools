// panel-layout.ts: the one side panel layout both harnesses draw (design system rev 4, "SIDEPANEL" surface).
// The Claude Code pane (mod/pane/sidebar.tsx) and the omp painter (omp/panel-view.ts) are thin adapters: each builds a
// PanelModel from its own data, calls panelLines, and paints the runs (Elements on Claude Code, ANSI on omp). Parity
// is structural: the text both print comes from here, and the goldens (contracts/panel-golden.ts) assert it.
//
// Rules: marks come from the state glyph map in atlas-ui (queued, running, done, failed, blocked, waiting; never a
// literal check mark, bullet or ellipsis); every number carries its word; colour carries state only; truncation is
// `...` through `clip`; the surface is the rev 4 panel token.
import { brandMark, capsule, cells, clip, clipMiddle, countRuns, gauge, GRID_LEAD, gridPlan, gridRow, percent, ribbon, stateGlyph, stateRun, stateWordTone, UI_STATES, type Run, type Tone, type Ui, type UiState } from './atlas-ui';
import { railNo, railOf } from './rail';
import { hasCore, tok, type CoreModel, type Verdict } from './data/core';

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

/** A strip tab as drawn: its id, hotkey and the label of the form that fits. */
export type StripTab = { id: PanelTab | 'board'; key: string; label: string };
/** Label forms of the strip, widest first: the words; `channel` shortened; two letters. The first form whose tabs fit the pane on one row is drawn. */
const SHORT: Record<string, string> = { channel: 'chan' };
const TINY: Record<string, string> = { route: 'rt', team: 'tm', channel: 'ch', gates: 'gt', core: 'co', board: 'bd' };
const STRIP_FORMS: readonly { gap: number; label: (id: string, full: string) => string }[] = [
  { gap: STRIP_GAP, label: (_, full) => full },
  { gap: STRIP_GAP, label: (id, full) => SHORT[id] ?? full },
  { gap: 1, label: (id, full) => SHORT[id] ?? full },
  { gap: 1, label: (id) => TINY[id] ?? id },
];
const stripWidth = (tabs: readonly { label: string }[], gap: number): number => tabs.reduce((n, t, i) => n + (i ? gap : 0) + HOTKEY_W + cells(t.label), 0);

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

/** The strip both hosts draw at `inner` cells: the widest label form that fits one row, else the narrowest form wrapped. The rule under the lit tab is as wide as the drawn label. */
export function stripLayout(inner: number): { rows: StripTab[][]; gap: number } {
  let last = STRIP_FORMS[STRIP_FORMS.length - 1]!;
  for (const f of STRIP_FORMS) {
    const tabs = STRIP_TABS.map((t): StripTab => ({ ...t, label: f.label(t.id, t.label) }));
    last = f;
    if (stripWidth(tabs, f.gap) <= inner) return { rows: [tabs], gap: f.gap };
  }
  const tabs = STRIP_TABS.map((t): StripTab => ({ ...t, label: last.label(t.id, t.label) }));
  return { rows: stripRows(tabs, inner, last.gap), gap: last.gap };
}

export type PanelTodo = { id: string; label: string; state: UiState; owner?: string; detail?: string; evidence?: string | null };
export type PanelWorker = { name: string; role?: string; state: UiState; model?: string; task?: string; detail: string; secs?: number; tools?: number };
export type PanelGateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
export type PanelGate = { id: string; title: string; error?: string; lines: PanelGateLine[] };
export type PanelNote = { at: string; from: string; to?: string; kind?: string; text: string; lead?: boolean };

export type PanelModel = {
  cols: number;
  /** Row budget (the channel log keeps the newest `rows - 4` notes). */
  rows: number;
  ui: Ui;
  tab: PanelTab;
  /** Spinner frame the render reads. */
  tick: number;
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
};

/** A row a press acts on: `toggle` opens or closes `key`; `worker` also picks `name` as the message recipient; `copy` is
 * what a second press on an open row copies. */
export type Press = { kind: 'toggle' | 'worker'; key: string; name?: string; copy?: string };
export type PanelLine = { runs: Run[]; press?: Press };

// ---- run helpers ---------------------------------------------------------------------------------------------------

const r = (t: string, tone: Tone = 'text', o: Partial<Run> = {}): Run => ({ t, tone, ...o });
const line = (runs: Run[], press?: Press): PanelLine => (press ? { runs, press } : { runs });
export const BLANK: PanelLine = { runs: [] };
const rowWidth = (runs: readonly Run[]): number => runs.reduce((n, x) => n + cells(x.t), 0);
const pad = (t: string, n: number): string => t + ' '.repeat(Math.max(0, n - cells(t)));
const cut = (t: string, n: number): string => pad(clip(t, n), n);
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

/** `◐ ` and friends: the state glyph run followed by a space. */
const mark = (s: UiState, m: Pick<PanelModel, 'ui' | 'tick'>): Run => {
  const g = stateRun(s, m.ui, m.tick);
  return { ...g, t: `${g.t} ` };
};
/** Label column: eight cells from 100 columns, seven below (design: `phase   research   2/4` at 120, `phase  research 2/4` at 80). */
const label = (t: string, cols: number): Run => r(pad(t, cols >= 100 ? 8 : 7), 'muted');
const dot = (ui: Ui): string => (ui.ascii ? '|' : '·');
const sep = (ui: Ui): Run => r(` ${dot(ui)} `, 'muted');
const WIDE = 100;

// ---- header: ribbon and tab strip ---------------------------------------------------------------------------------

const countWords = (workers: readonly PanelWorker[], ui: Ui): string => {
  const n = (s: UiState): number => workers.filter((w) => w.state === s).length;
  return UI_STATES.filter((s) => n(s)).map((s) => `${n(s)} ${s}`).join(` ${dot(ui)} `);
};

/** The ribbon's right-hand text: what the active tab counts, always with its word. */
function ribbonRight(m: PanelModel): string {
  if (m.tab === 'team') return m.workers.length ? countWords(m.workers, m.ui) : '';
  if (m.tab === 'gates') return m.gates.length ? `${m.gates.filter(groupOk).length} of ${m.gates.length} green` : '';
  if (m.tab === 'channel') return m.channel ? `#${m.channel}` : '';
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
  return line(ribbon(m.cols, 'SIDEPANEL', fitsRight ? right : '', m.ui));
}

/** The tab strip and the rule under the lit tab: `r: route  t: team  c: channel  g: gates  k: core  o: board`, `━━━━━` under the lit one. A
 * strip that does not fit wraps onto a second row (the rule sits under the row that holds the lit tab). */
export function tabRows(m: PanelModel): PanelLine[] {
  const { rows, gap: g } = stripLayout(m.cols);
  const gap = r(' '.repeat(g));
  return rows.flatMap((row): PanelLine[] => {
    const strip: Run[] = [];
    const under: Run[] = [];
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

/** `gates   ● lint   ● test   ■ doctor   2 of 3 green`; names that do not fit fold to the count alone. */
function gatesRow(m: PanelModel): PanelLine | null {
  const gs = m.gates;
  if (!gs.length) return null;
  const green = gs.filter(groupOk).length;
  const word = m.cols >= WIDE ? `${green} of ${gs.length} green` : `${green}/${gs.length}`;
  const names: Run[] = gs.flatMap((g, i): Run[] => [...(i ? [r('   ')] : []), mark(groupOk(g) ? 'done' : 'failed', m), r(g.id)]);
  const full = [label('gates', m.cols), ...names, r(`   ${word}`)];
  if (rowWidth(full) <= m.cols) return line(full);
  return line([label('gates', m.cols), r(`${green}/${gs.length} green`)]);
}

function todoCount(m: PanelModel): PanelLine {
  const done = m.todos.filter((t) => t.state === 'done').length;
  const total = m.todos.length;
  if (!total) return line([label('todo', m.cols), r('no tasks yet', 'muted')]);
  const g = m.cols >= 40 ? [...gauge(10, done / total, m.ui), r(' ')] : [];
  return line([label('todo', m.cols), ...g, r(`${done} of ${total}`)]);
}

/** The agents row: one count per state; segments that do not fit wrap under the label instead of overflowing. */
function agentsRows(m: PanelModel): PanelLine[] {
  if (!m.workers.length) return [];
  const sep = m.cols >= WIDE ? 3 : 2;
  const segs = UI_STATES.filter((s) => m.workers.some((w) => w.state === s)).map((s) => countRuns(s, m.workers.filter((w) => w.state === s).length, m.ui, m.tick));
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

const WORD_W = 7; // `running` and `blocked` are the longest of the six state words
const stateWordTone2 = (s: UiState): Tone => (s === 'failed' ? 'bad' : s === 'blocked' ? 'warn' : 'sub');
const OWNER_W = 18;
const TITLE_MIN_W = 21; // the title column's least width (the state word starts in cell 26 when every title is short, as in the design); it grows to the longest title the pane has room for

/** The Board's compact form on the panel: `focus glyph title state [detail] owner`. Every task row shares one state column (cell 26) and one
 * right-aligned owner column (dropped when the panel is too narrow to keep a title of 8 cells); a title that does not fit is cut in the
 * middle; from 100 columns the reason (detail) fills the room between the state word and the owner. An open row adds its owner and detail,
 * then its evidence. */
function todoRows(m: PanelModel, t: PanelTodo, w: { nameW: number; valueW: number }): PanelLine[] {
  const key = `task:${t.id}`;
  const runs = gridRow({
    cols: m.cols, ui: m.ui, mark: stateRun(t.state, m.ui, m.tick),
    name: { t: oneLine(t.label), tone: t.state === 'done' ? 'sub' : 'text' }, nameW: w.nameW,
    word: { t: t.state, tone: stateWordTone2(t.state) }, wordW: WORD_W,
    ...(m.cols >= WIDE && t.detail ? { detail: { t: oneLine(t.detail) } } : {}), // wide panels show the reason in one fixed column after the state word
    ...(w.valueW && t.owner ? { value: { t: clipMiddle(oneLine(t.owner), w.valueW), tone: 'sub' as const } } : {}),
  });
  const open = m.expanded === key;
  const facts = [t.owner ? `owner ${oneLine(t.owner)}` : '', oneLine(t.detail)].filter(Boolean).join(` ${dot(m.ui)} `);
  const extra = open ? [...(facts ? [facts] : []), t.evidence ? `evidence: ${oneLine(t.evidence)}` : 'no evidence yet'] : [];
  return [line(fitRuns(runs, m.cols), { kind: 'toggle', key }), ...extra.map((x) => line(fitRuns([r(`    ${x}`, 'muted')], m.cols)))];
}

/** Rows a tab may use below its header; a plan longer than that folds into `+N more`. */
const bodyRows = (m: PanelModel, used: number): number => Math.max(3, m.rows - headerRows(m).length - used - 2);

function routeBody(m: PanelModel): PanelLine[] {
  const rows: PanelLine[] = [phaseRow(m)];
  const gates = gatesRow(m);
  if (gates) rows.push(gates);
  rows.push(todoCount(m));
  rows.push(...agentsRows(m));
  if (!m.todos.length) {
    // Work may be running with no plan on the board: say so with the workers, never "nothing planned".
    const running = m.workers.filter((w) => w.state === 'running');
    const nameW = Math.min(18, Math.max(...running.map((w) => cells(w.name)), 1));
    if (running.length) rows.push(BLANK, ...running.slice(0, bodyRows(m, rows.length)).map((w) => line(gridRow({ cols: m.cols, ui: m.ui, mark: stateRun('running', m.ui, m.tick), name: { t: w.name }, nameW, detail: { t: w.detail } }))));
    else if (!m.workers.length) rows.push(BLANK, line([r('(no state)', 'muted'), r(`  no tasks yet ${dot(m.ui)} add one with /todo add`, 'muted')]));
    return rows;
  }
  const room = bodyRows(m, rows.length);
  const ordered = m.todos; // the Board's order (plan rows as the board lists them), not regrouped by state
  const widest = Math.min(OWNER_W, Math.max(0, ...ordered.map((t) => cells(oneLine(t.owner)))));
  // The title column is as wide as the longest title the pane has room for (the state word follows it on every row, so the words line up); only a title past the room is cut, in the middle.
  const plan = gridPlan(m.cols, { names: [' '.repeat(TITLE_MIN_W), ...ordered.map((t) => oneLine(t.label))], word: WORD_W, value: widest, optional: true, min: 8, max: m.cols >= WIDE ? Math.max(TITLE_MIN_W, m.cols - 60) : m.cols }); // from 100 columns the title leaves the reason a column
  const shown: PanelLine[] = [];
  for (const t of ordered) {
    const rs = todoRows(m, t, plan);
    if (shown.length + rs.length > room) break;
    shown.push(...rs);
  }
  const hidden = ordered.length - ordered.filter((t) => shown.some((l) => l.press?.key === `task:${t.id}`)).length;
  rows.push(BLANK, ...shown, ...(hidden > 0 ? [line([r(`    ${hidden} more ${hidden === 1 ? 'task' : 'tasks'} on the board`, 'muted')])] : []));
  return rows;
}

// ---- team (subagents by name and state) -----------------------------------------------------------------------------------

export const shortAge = (secs: number): string => (secs < 60 ? `${Math.max(0, Math.floor(secs))}s` : secs < 3600 ? `${Math.floor(secs / 60)}m${String(Math.floor(secs % 60)).padStart(2, '0')}s` : `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`);

function workerRows(m: PanelModel, w: PanelWorker, nameW: number, focus: boolean): PanelLine[] {
  const key = `worker:${w.name}`;
  const wide = m.cols >= WIDE;
  // Wide: the design's Subagents columns after the state word (model, task, what it is doing), shared with the HUD block.
  const tail = wide ? [r(pad(w.model ?? '', 10), 'sub'), r(pad(w.task ?? '', 6), 'sub'), r(w.detail, 'muted')] : [];
  const runs = gridRow({
    cols: m.cols, ui: m.ui, focus, mark: stateRun(w.state, m.ui, m.tick),
    name: { t: w.name, bold: true }, nameW, gap: 2,
    word: { t: w.state, tone: w.state === 'failed' ? 'bad' : w.state === 'blocked' ? 'warn' : 'sub' }, wordW: wide ? 12 : 10, tail,
  });
  const out = [line(fitRuns(runs, m.cols), { kind: 'worker', key, name: w.name })];
  if (m.expanded === key) {
    out.push(line(fitRuns([r(`    ${w.detail || w.state}`, 'muted')], m.cols)));
    if (w.secs !== undefined) out.push(line(fitRuns([r(`    running ${shortAge(w.secs)}${w.tools !== undefined ? ` ${dot(m.ui)} ${w.tools} tool calls` : ''}`, 'muted')], m.cols)));
  }
  return out;
}

/** `lead  1 running · 2 done`: the lead's tally of its workers. Running always reads; the other states only when not zero. */
function leadSummary(m: PanelModel): PanelLine {
  const n = (s: UiState): number => m.workers.filter((w) => w.state === s).length;
  const parts = UI_STATES.filter((s) => s === 'running' || n(s)).map((s) => `${n(s)} ${s}`);
  return line(fitRuns([r('lead  ', 'text', { bold: true }), r(parts.join(` ${dot(m.ui)} `), 'muted')], m.cols));
}

function teamBody(m: PanelModel): PanelLine[] {
  const mates = m.mates ?? [];
  const everyone = [...(m.lead ? [m.lead] : []), ...m.workers, ...mates];
  if (!everyone.length) return [line([r('(no state)', 'muted'), r('  nobody dispatched yet, ask the lead to start a worker', 'muted')])];
  const nameW = Math.min(18, Math.max(6, ...everyone.map((w) => cells(w.name))));
  const focusName = m.recipient && everyone.some((w) => w.name === m.recipient) ? m.recipient : m.workers.find((w) => w.state === 'running')?.name;
  const rows = (ws: readonly PanelWorker[]): PanelLine[] => ws.flatMap((w) => workerRows(m, w, Math.min(nameW, Math.max(6, m.cols - 14)), w.name === focusName));
  const hint = !m.workers.length && !mates.length ? [line([r('(no state)', 'muted'), r('  nobody dispatched yet, ask the lead to start a worker', 'muted')])] : [];
  return [...(m.lead ? rows([m.lead]) : []), ...hint, ...rows(m.workers), ...rows(mates), ...(m.lead ? [leadSummary(m)] : [])];
}

// ---- channel ------------------------------------------------------------------------------------------------------------------

function noteRow(m: PanelModel, n: PanelNote, g: { nameW: number; wordW: number; timeW: number }): PanelLine {
  const kind = n.kind === 'blocked' ? 'blocked' : n.kind === 'handoff' || n.kind === 'done' ? n.kind : '';
  const state: UiState | null = kind === 'blocked' ? 'blocked' : kind ? 'done' : null;
  const to = n.to && n.to !== 'all' && !kind ? `${m.ui.ascii ? '>' : '▸'} ${n.to} ` : '';
  return line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: state ? stateRun(state, m.ui) : null,
    name: { t: n.from, bold: true }, nameW: g.nameW, gap: 2,
    ...(g.wordW ? { word: kind ? { t: kind, tone: kind === 'blocked' ? 'warn' as const : 'ok' as const } : { t: '' }, wordW: g.wordW } : {}),
    detail: { t: `${to}${oneLine(n.text)}`, tone: 'text' },
    ...(g.timeW ? { value: { t: n.at, tone: 'muted' as const } } : {}),
  }), m.cols));
}

function channelBody(m: PanelModel): PanelLine[] {
  const head = line(fitRuns([
    r(`#${m.channel ?? 'channel'}  `, 'text', { bold: true }),
    r(`${m.people} ${m.people === 1 ? 'person' : 'people'}${m.unread ? ` ${dot(m.ui)} ${m.unread} unread` : ''}`, 'muted'),
  ], m.cols));
  const log = m.notes.slice(-Math.max(1, m.rows - 4));
  const hasKind = log.some((n) => n.kind === 'blocked' || n.kind === 'handoff' || n.kind === 'done');
  const timeW = m.cols >= 50 ? Math.max(0, ...log.map((n) => cells(n.at))) : 0;
  const plan = gridPlan(m.cols, { names: log.map((n) => n.from), word: hasKind ? 7 : 0, gap: 2, value: timeW, optional: true, min: 4, max: m.cols >= 100 ? 24 : 12 });
  return [head, ...log.map((n) => noteRow(m, n, { nameW: plan.nameW, wordW: plan.wordW, timeW: plan.valueW }))];
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
    line(gridRow({ cols: m.cols, ui: m.ui, mark: stateRun(ln.ok ? 'done' : 'failed', m.ui), name: { t: `  ${first}` }, nameW: cells(first) + 2 }), { kind: 'toggle', key, ...(open && ln.fix ? { copy: ln.fix } : {}) }),
    ...more.map((t) => note(`  ${t}`, m)), ...extra.map((t) => note(`  ${oneLine(t)}`, m)),
  ];
}

const GATE_WORD_W = 7; // `passing` and `failing`
/** `1 of 3 failing`: the group's failing count, the value column; empty while it passes. */
const gateValue = (g: PanelGate): string => (groupFailing(g) ? `${groupFailing(g)} of ${g.lines.length} failing` : '');

function gateGroupRows(m: PanelModel, g: PanelGate, nameW: number): PanelLine[] {
  const bad = groupFailing(g);
  const key = `group:${g.id}`;
  const first = g.lines.find((l) => !l.ok) ?? g.lines[0];
  const tail = g.error ? `unavailable: ${oneLine(g.error)}` : oneLine(bad ? first?.fix ?? first?.label : first?.detail);
  const word = bad || g.error ? 'failing' : 'passing';
  // The failing count is the right-aligned value; the first fix (or the first detail) follows the word when it fits whole, else wraps under.
  const value = gateValue(g);
  const fixed = GRID_LEAD + nameW + 2 + GATE_WORD_W + (value ? cells(value) + 1 : 0) + 1;
  const fits = !tail || cells(tail) <= m.cols - fixed;
  const open = m.expanded === key || g.lines.some((l) => m.expanded === `gate:${l.id}`);
  const runs = gridRow({
    cols: m.cols, ui: m.ui, mark: stateRun(groupOk(g) ? 'done' : 'failed', m.ui),
    name: { t: oneLine(g.title), bold: true }, nameW, gap: 2, word: { t: word, tone: bad || g.error ? 'bad' : 'ok' }, wordW: GATE_WORD_W,
    ...(fits && tail ? { detail: { t: tail } } : {}), ...(value ? { value: { t: value, tone: 'bad' as const } } : {}),
  });
  return [
    line(fitRuns(runs, m.cols), { kind: 'toggle', key }),
    ...(fits ? [] : wrap(tail, Math.max(8, m.cols - 6)).map((t) => note(t, m))),
    ...(open ? g.lines.flatMap((l) => gateLineRows(m, l)) : []),
  ];
}

function gatesBody(m: PanelModel): PanelLine[] {
  if (!m.gates.length) return [line([r('(no state)', 'muted'), r('  no gates reported yet', 'muted')])];
  const valueW = Math.max(0, ...m.gates.map((g) => cells(gateValue(g))));
  const plan = gridPlan(m.cols, { names: m.gates.map((g) => oneLine(g.title)), word: GATE_WORD_W, gap: 2, value: valueW, min: 4, max: 24 });
  const nameW = plan.nameW;
  return m.gates.flatMap((g) => gateGroupRows(m, g, nameW));
}

// ---- core (contract, verdicts, offload, route) ------------------------------------------------------------------------------------

const heading = (title: string, figures: Run[], m: PanelModel): PanelLine => line(fitRuns([r(title, 'muted', { bold: true }), ...(figures.length ? [r('  '), ...figures] : [])], m.cols));
const tallyTone = (ok: number, total: number): Tone => (!total ? 'muted' : ok === total ? 'text' : 'warn');
const joinSep = (parts: Run[], ui: Ui): Run[] => parts.flatMap((p, i) => (i ? [sep(ui), p] : [p]));

/** A heading and its figures, wrapped by whole figure: a figure that does not fit moves to the next row (indented under the first), it is never cut. */
function flowHeading(title: string, parts: readonly string[], m: PanelModel): PanelLine[] {
  const indent = cells(title) + 2;
  const rows: Run[][] = [[r(title, 'muted', { bold: true }), r('  ')]];
  let used = indent;
  for (const p of parts) {
    const first = used === indent;
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

/** `contract`: three rows, each `glyph name  n of m`; the figure sits in the word column, whole at any width. */
function contractRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const { header: h, evidence: e, verifiedDone: v } = c.contract;
  const items: [string, { ok: number; total: number }][] = [['header', h], ['evidence', e], ['verified', v]];
  return [
    heading('contract', [], m),
    ...items.map(([name, t]) => line(fitRuns(gridRow({
      cols: m.cols, ui: m.ui, mark: stateRun(!t.total ? 'queued' : t.ok === t.total ? 'done' : 'blocked', m.ui),
      name: { t: name }, nameW: 8, word: { t: t.total ? `${t.ok} of ${t.total}` : 'none yet', tone: tallyTone(t.ok, t.total) }, wordW: 8,
    }), m.cols))),
  ];
}

function verdictRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const l = c.ledger;
  const none = l.verified + l.refuted + l.pending === 0;
  const figures = none
    ? joinSep([r('no verdicts yet', 'muted'), ...(l.unchecked ? [r(`${l.unchecked} unchecked`, 'warn')] : [])], m.ui)
    : joinSep([
      r(`${l.verified} verified`, l.verified ? 'ok' : 'muted'), r(`${l.refuted} refuted`, l.refuted ? 'bad' : 'muted'),
      ...(l.pending ? [r(`${l.pending} open`, 'warn')] : []), ...(l.unchecked ? [r(`${l.unchecked} unchecked`, 'warn')] : []),
    ], m.ui);
  const shown = c.verdicts.slice(-8);
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
  return [heading('verdicts', figures, m), ...(rows.length || unchecked.length ? [...rows, ...unchecked] : [line([r('    no verdict recorded yet', 'muted')])])];
}

/** Offload in plain words: what each worker read, and what it returned to the lead. Figures keep their whole width; the name column gives way. */
function offloadRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const o = c.offload;
  const pct = o.kept > 0 && o.returned <= o.kept ? Math.max(1, Math.round((o.returned / o.kept) * 100)) : null;
  const head = flowHeading('offload', [`${tok(o.kept)} tokens read by workers`, `${tok(o.returned)} returned to the lead`, ...(pct !== null ? [`${pct}% of what they read`] : [])], m);
  const ws = o.workers.slice(-8);
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

const SEAT_WORD_W = 10; // `as planned`

/** The dispatch plan against what ran: a row per team (class/effort, name, transport), a row per seat with the verdict `as planned`, `drift` or `not run`. */
function dispatchRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const teams = c.routes.slice(-6).reverse();
  const head = heading('dispatch', [r('planned against what ran', 'muted')], m);
  const inProcessNote = (): PanelLine[] => (c.inProcess ? [] : wrap('in-process dispatches are not shown here', Math.max(8, m.cols - 4)).map((t) => note(t, m)));
  if (!teams.length) return [head, note('no team this session', m), ...inProcessNote()];
  const names = teams.flatMap((rt) => [`${rt.cls}/${rt.effort}`, ...rt.seats.map((s) => `  ${s.count}x ${s.role}`)]);
  const { nameW } = gridPlan(m.cols, { names, word: SEAT_WORD_W, min: 8, max: 16 });
  const withDetail = (runs: Run[], text: string): PanelLine[] => {
    const used = rowWidth(runs);
    const fits = cells(text) + 1 <= m.cols - used;
    return [line(fitRuns(fits ? [...runs, r(` ${text}`, 'muted')] : runs, m.cols)), ...(fits ? [] : wrap(text, Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m)))];
  };
  const rows = teams.flatMap((rt): PanelLine[] => {
    const teamName = `${rt.cls}/${rt.effort}`;
    const team = gridRow({ cols: m.cols, ui: m.ui, mark: rt.drift.length ? stateRun('failed', m.ui) : null, name: { t: teamName, bold: true }, nameW: cells(teamName), tail: rt.drift.length ? [r('  drift', 'bad')] : [] });
    const seats = rt.seats.flatMap((s): PanelLine[] => {
      const same = s.ran.every((x) => x.toLowerCase().includes(s.model.toLowerCase()) || s.model === 'inherit');
      const over = s.ran.length > s.count;
      const used = [...new Set(s.ran.map((x) => x.replace(/^claude-/, '')))].join(', ');
      const [st, word, tone]: [UiState, string, Tone] = !s.ran.length ? ['queued', 'not run', 'muted'] : same && !over ? ['done', 'as planned', 'ok'] : ['failed', 'drift', 'bad'];
      const ran = !s.ran.length ? 'not run yet' : over ? `ran ${s.ran.length} / planned ${s.count} (${used})` : `ran ${used}`;
      const runs = gridRow({ cols: m.cols, ui: m.ui, mark: stateRun(st, m.ui), name: { t: `  ${s.count}x ${s.role}` }, nameW, word: { t: word, tone }, wordW: SEAT_WORD_W });
      return withDetail(runs, `${ran}  ${s.model}/${s.effort}`);
    });
    return [...withDetail(team, `${rt.name || rt.teamId}  ${[rt.transport ?? 'transport unknown', rt.isolation].filter(Boolean).join(', ')}, max ${rt.maxParallel}`), ...seats];
  });
  return [head, ...rows, ...inProcessNote()];
}

function coreBody(m: PanelModel): PanelLine[] {
  if (!hasCore(m.core)) return [line([r('(no state)', 'muted'), r('  no verdicts, workers or gates yet', 'muted')])];
  const c = m.core;
  return [...contractRows(c, m), BLANK, ...verdictRows(c, m), BLANK, ...offloadRows(c, m), BLANK, ...dispatchRows(c, m)];
}

// ---- the panel ------------------------------------------------------------------------------------------------------------------------

const BODIES: Record<PanelTab, (m: PanelModel) => PanelLine[]> = { route: routeBody, team: teamBody, channel: channelBody, gates: gatesBody, core: coreBody };

/** The active tab's body rows (no header). */
export const bodyLines = (m: PanelModel): PanelLine[] => BODIES[m.tab](m);
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
