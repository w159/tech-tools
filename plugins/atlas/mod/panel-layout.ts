// panel-layout.ts: the one side panel layout both harnesses draw (design system rev 4, "SIDEPANEL" surface).
// The Claude Code pane (mod/pane/sidebar.tsx) and the omp painter (omp/panel-view.ts) are thin adapters: each builds a
// PanelModel from its own data, calls panelLines, and paints the runs (Elements on Claude Code, ANSI on omp). Parity
// is structural: the text both print comes from here, and the goldens (contracts/panel-golden.ts) assert it.
//
// Rules: marks come from the state glyph map in atlas-ui (queued, running, done, failed, blocked, waiting; never a
// literal check mark, bullet or ellipsis); every number carries its word; colour carries state only; truncation is
// `...` through `clip`; the surface is the rev 4 panel token.
import { capsule, cells, clip, countRuns, gauge, percent, ribbon, stateGlyph, stateRun, UI_STATES, type Run, type Tone, type Ui, type UiState } from './atlas-ui';
import { hasCore, tok, type CoreModel, type Verdict } from './data/core';

export type PanelTab = 'route' | 'team' | 'channel' | 'gates' | 'core';
/** Tabs in strip order. Hotkeys: r t c g k (the board toggle `o` belongs to the band). */
export const PANEL_TABS: readonly { id: PanelTab; key: string; label: string }[] = [
  { id: 'route', key: 'r', label: 'route' }, { id: 'team', key: 't', label: 'team' }, { id: 'channel', key: 'c', label: 'channel' },
  { id: 'gates', key: 'g', label: 'gates' }, { id: 'core', key: 'k', label: 'core' },
];

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

/** Gap between tabs: three cells from 100 columns, two below, one when very tight. */
export function tabGap(cols: number): number {
  const base = PANEL_TABS.reduce((n, t) => n + t.label.length, 0);
  const want = cols >= 100 ? 3 : 2;
  return [want, 2, 1].find((g) => g <= want && base + g * (PANEL_TABS.length - 1) <= cols) ?? 1;
}

/** The tab strip and the rule under the active tab (design: `route   team   channel   gates   core`, `━━━━━` under the lit one). */
export function tabRows(m: PanelModel): PanelLine[] {
  const gap = tabGap(m.cols);
  const strip: Run[] = [];
  const under: Run[] = [];
  PANEL_TABS.forEach((t, i) => {
    const on = t.id === m.tab;
    if (i) { strip.push(r(' '.repeat(gap))); under.push(r(' '.repeat(gap))); }
    strip.push(on ? r(t.label, 'text', { bold: true }) : r(t.label, 'muted'));
    under.push(on ? r((m.ui.ascii ? '-' : '━').repeat(t.label.length), 'accent') : r(' '.repeat(t.label.length)));
  });
  return [line(fitRuns(strip, m.cols)), line(fitRuns(under, m.cols))];
}

/** Ribbon, blank, tab strip, rule, and (from 100 columns) a blank before the body; the 80-column design has none. */
export const headerRows = (m: PanelModel): PanelLine[] => [ribbonRow(m), BLANK, ...tabRows(m), ...(m.cols >= 100 ? [BLANK] : [])];

// ---- route ------------------------------------------------------------------------------------------------------------

const groupOk = (g: PanelGate): boolean => !g.error && g.lines.every((l) => l.ok);
const groupFailing = (g: PanelGate): number => g.lines.filter((l) => !l.ok).length;

/** `phase   research   2/4`: the lit phase and its place on the rail. */
function phaseRow(m: PanelModel): PanelLine {
  const i = m.phases.indexOf(m.phase);
  const at = i >= 0 ? i + 1 : m.phase === 'done' ? m.phases.length : 0;
  return line([label('phase', m.cols), r(m.phase), ...(m.phases.length && at ? [r(`${m.cols >= 100 ? '   ' : ' '}${at}/${m.phases.length}`)] : [])]);
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

function todoRows(m: PanelModel, t: PanelTodo): PanelLine[] {
  const key = `task:${t.id}`;
  const wide = m.cols >= WIDE;
  const word = m.cols >= 36 ? t.state : '';
  const owner = wide && t.owner ? t.owner : '';
  const labelW = Math.max(8, m.cols - 2 - 2 - (word ? 11 : 0) - (owner ? 20 : 0) - (wide && t.detail ? 2 + cells(t.detail) : 0));
  const body = pad(clip(oneLine(t.label), labelW), word ? Math.min(labelW, 30) : 0);
  const runs: Run[] = [
    r('  '), mark(t.state, m), r(body, t.state === 'done' ? 'sub' : 'text'),
    ...(word ? [r(` ${pad(word, 9)}`, t.state === 'failed' ? 'bad' : t.state === 'blocked' ? 'warn' : 'muted')] : []),
    ...(owner ? [r(` ${pad(clip(owner, 18), 18)}`, 'muted')] : []),
    ...(wide && t.detail ? [r(` ${oneLine(t.detail)}`, 'muted')] : []),
  ];
  const open = m.expanded === key;
  const ev = open ? [line([r(`      ${t.evidence ? oneLine(t.evidence) : 'no evidence yet'}`, 'muted')])] : [];
  return [line(fitRuns(runs, m.cols), { kind: 'toggle', key }), ...ev.map((l) => line(fitRuns(l.runs, m.cols)))];
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
    if (running.length) rows.push(BLANK, ...running.slice(0, bodyRows(m, rows.length)).map((w) => line(fitRuns([r('  '), mark('running', m), r(w.name), r(`  ${w.detail}`, 'muted')], m.cols))));
    else if (!m.workers.length) rows.push(BLANK, line([r('(no state)', 'muted'), r(`  no tasks yet ${dot(m.ui)} add one with /todo add`, 'muted')]));
    return rows;
  }
  const room = bodyRows(m, rows.length);
  const ordered = [...m.todos.filter((t) => t.state !== 'done'), ...m.todos.filter((t) => t.state === 'done')];
  const shown: PanelLine[] = [];
  for (const t of ordered) {
    const rs = todoRows(m, t);
    if (shown.length + rs.length > room) break;
    shown.push(...rs);
  }
  const hidden = ordered.length - ordered.filter((t) => shown.some((l) => l.press?.key === `task:${t.id}`)).length;
  rows.push(BLANK, ...shown, ...(hidden > 0 ? [line([r(`  ${hidden} more ${hidden === 1 ? 'task' : 'tasks'} on the board`, 'muted')])] : []));
  return rows;
}

// ---- team (subagents by name and state) -----------------------------------------------------------------------------------

export const shortAge = (secs: number): string => (secs < 60 ? `${Math.max(0, Math.floor(secs))}s` : secs < 3600 ? `${Math.floor(secs / 60)}m${String(Math.floor(secs % 60)).padStart(2, '0')}s` : `${Math.floor(secs / 3600)}h${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}m`);

function workerRows(m: PanelModel, w: PanelWorker, nameW: number, focus: boolean): PanelLine[] {
  const key = `worker:${w.name}`;
  const wide = m.cols >= WIDE;
  const tail = wide ? [
    r(pad(w.model ?? '', 10), 'sub'),
    r(pad(w.task ?? '', 6), 'sub'),
    r(w.detail, 'muted'),
  ] : [];
  const nameCell = r(`${pad(clip(w.name, nameW), nameW)}`, 'text', { bold: true });
  const stateCell = r(`  ${pad(w.state, wide ? 12 : 10)}`, w.state === 'failed' ? 'bad' : w.state === 'blocked' ? 'warn' : 'sub');
  const runs: Run[] = [r(focus ? (m.ui.ascii ? '> ' : '▸ ') : '  ', focus ? 'accent' : 'text', { bold: focus }), mark(w.state, m), nameCell, stateCell, ...tail];
  const out = [line(fitRuns(runs, m.cols), { kind: 'worker', key, name: w.name })];
  if (m.expanded === key) {
    out.push(line(fitRuns([r(`      ${w.detail || w.state}`, 'muted')], m.cols)));
    out.push(line(fitRuns([r(`      running ${shortAge(w.secs ?? 0)}${w.tools !== undefined ? ` ${dot(m.ui)} ${w.tools} tool calls` : ''}`, 'muted')], m.cols)));
  }
  return out;
}

function teamBody(m: PanelModel): PanelLine[] {
  if (!m.workers.length) return [line([r('(no state)', 'muted'), r('  nobody dispatched yet, ask the lead to start a worker', 'muted')])];
  const nameW = Math.min(18, Math.max(6, ...m.workers.map((w) => cells(w.name))));
  const focusName = m.recipient && m.workers.some((w) => w.name === m.recipient) ? m.recipient : m.workers.find((w) => w.state === 'running')?.name;
  return m.workers.flatMap((w) => workerRows(m, w, Math.min(nameW, Math.max(6, m.cols - 14)), w.name === focusName));
}

// ---- channel ------------------------------------------------------------------------------------------------------------------

function noteRow(m: PanelModel, n: PanelNote, nickW: number): PanelLine {
  const kind = n.kind ?? '';
  const flag: Run[] = kind === 'blocked' ? [mark('blocked', m), r('blocked ', 'warn')]
    : kind === 'handoff' || kind === 'done' ? [mark('done', m), r(`${kind} `, 'ok')]
      : [];
  const to = n.to && n.to !== 'all' && !flag.length ? [r(`${m.ui.ascii ? '>' : '▸'} ${n.to} `, 'muted')] : [];
  return line(fitRuns([
    ...(m.cols >= 50 ? [r(`${n.at} `, 'muted')] : []),
    r(`${pad(clip(n.from, nickW), nickW)} `, 'text', { bold: true }),
    ...flag, ...to, r(oneLine(n.text)),
  ], m.cols));
}

function channelBody(m: PanelModel): PanelLine[] {
  const head = line(fitRuns([
    r(`#${m.channel ?? 'channel'}  `, 'text', { bold: true }),
    r(`${m.people} ${m.people === 1 ? 'person' : 'people'}${m.unread ? ` ${dot(m.ui)} ${m.unread} unread` : ''}`, 'muted'),
  ], m.cols));
  const log = m.notes.slice(-Math.max(1, m.rows - 4));
  const nickW = Math.min(m.cols >= 100 ? 18 : 10, Math.max(4, ...log.map((n) => cells(n.from))));
  return [head, ...log.map((n) => noteRow(m, n, nickW))];
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

const note = (t: string, m: PanelModel): PanelLine => line(fitRuns([r(`     ${t}`, 'muted')], m.cols));

function gateLineRows(m: PanelModel, ln: PanelGateLine): PanelLine[] {
  const key = `gate:${ln.id}`;
  const open = m.expanded === key;
  const [first = '', ...more] = wrap(oneLine(ln.label), Math.max(8, m.cols - 4));
  const extra = open ? [ln.detail, ln.fix ? `fix: ${ln.fix} (press to copy)` : undefined].filter((x): x is string => !!x) : [];
  return [
    line(fitRuns([r('  '), mark(ln.ok ? 'done' : 'failed', m), r(first)], m.cols), { kind: 'toggle', key, ...(open && ln.fix ? { copy: ln.fix } : {}) }),
    ...more.map((t) => note(t, m)), ...extra.map((t) => note(oneLine(t), m)),
  ];
}

function gateGroupRows(m: PanelModel, g: PanelGate): PanelLine[] {
  const bad = groupFailing(g);
  const key = `group:${g.id}`;
  const first = g.lines.find((l) => !l.ok) ?? g.lines[0];
  const tail = g.error ? `unavailable: ${oneLine(g.error)}` : oneLine(bad ? first?.fix ?? first?.label : first?.detail);
  const head: Run[] = [mark(groupOk(g) ? 'done' : 'failed', m), r(oneLine(g.title)), r(bad ? `  ${bad} failing` : g.error ? '  failed' : '  passing', bad || g.error ? 'bad' : 'ok')];
  const fits = !tail || rowWidth(head) + 2 + cells(tail) <= m.cols;
  const open = m.expanded === key || g.lines.some((l) => m.expanded === `gate:${l.id}`);
  return [
    line(fitRuns(fits ? [...head, r(tail ? `  ${tail}` : '', 'muted')] : head, m.cols), { kind: 'toggle', key }),
    ...(fits ? [] : wrap(tail, Math.max(8, m.cols - 5)).map((t) => note(t, m))),
    ...(open ? g.lines.flatMap((l) => gateLineRows(m, l)) : []),
  ];
}

function gatesBody(m: PanelModel): PanelLine[] {
  if (!m.gates.length) return [line([r('(no state)', 'muted'), r('  no gates reported yet', 'muted')])];
  return m.gates.flatMap((g) => gateGroupRows(m, g));
}

// ---- core (contract, verdicts, offload, route) ------------------------------------------------------------------------------------

const head = (title: string, figures: Run[], m: PanelModel): PanelLine => line(fitRuns([r(`${title}  `, 'muted', { bold: true }), ...figures], m.cols));
const tally = (ok: number, total: number): string => (total ? `${ok}/${total}` : 'none');
const tallyTone = (ok: number, total: number): Tone => (!total ? 'muted' : ok === total ? 'text' : 'warn');
const joinSep = (parts: Run[], ui: Ui): Run[] => parts.flatMap((p, i) => (i ? [sep(ui), p] : [p]));

const VERDICT: Record<Verdict['status'], { s: UiState; word: string; tone: Tone }> = {
  verified: { s: 'done', word: 'verified', tone: 'ok' },
  rejected: { s: 'failed', word: 'refuted', tone: 'bad' },
  'needs-evidence': { s: 'blocked', word: 'needs evidence', tone: 'warn' },
};
const VERDICT_WORD_W = Math.max(...Object.values(VERDICT).map((v) => v.word.length));
const VERDICT_ID_W = 15;

function contractRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const { header: h, evidence: e, verifiedDone: v } = c.contract;
  const part = (name: string, t: { ok: number; total: number }): Run => r(`${name} ${tally(t.ok, t.total)}`, tallyTone(t.ok, t.total));
  return [head('contract', joinSep([part('header', h), part('evidence', e), part('verified', v)], m.ui), m)];
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
  const rows = c.verdicts.slice(-8).flatMap((v): PanelLine[] => {
    const look = VERDICT[v.status];
    const key = `core:v:${v.id}`;
    const checked = c.claims.find((x) => x.matched === v.id);
    const open = m.expanded === key;
    const detail = open ? [checked ? `checks the done claim of ${checked.owner}` : 'no worker claim before it', `by ${v.by}`, `evidence: ${oneLine(v.evidence) || 'none recorded'}`] : [];
    return [
      line(fitRuns([r('  '), mark(look.s, m), r(`${pad(clip(oneLine(v.id), VERDICT_ID_W), VERDICT_ID_W)} `), r(pad(look.word, VERDICT_WORD_W), look.tone, { bold: v.status === 'rejected' }), r(` ${oneLine(v.title)}`, 'muted')], m.cols), { kind: 'toggle', key }),
      ...detail.map((t) => line(fitRuns([r(`      ${t}`, 'muted')], m.cols))),
    ];
  });
  const unchecked = c.claims.filter((x) => x.status === 'DONE' && x.matched === null).map((x) =>
    line(fitRuns([r('  '), mark('blocked', m), r(pad(clip(x.owner, 16), 16)), r('unchecked: says done, no verdict yet', 'warn')], m.cols)));
  return [head('verdicts', figures, m), ...(rows.length || unchecked.length ? [...rows, ...unchecked] : [line([r('  no verdict recorded yet', 'muted')])])];
}

function offloadRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const o = c.offload;
  const ratio = o.ratio === null ? '' : ` (${o.ratio >= 10 ? Math.round(o.ratio) : o.ratio.toFixed(1)}x)`;
  const rows = o.workers.slice(-8).map((w) => line(fitRuns([
    r('  '), r(pad(clip(w.name, 18), 18)), r(pad(clip((w.model ?? '?').replace(/^claude-/, ''), 12), 12), 'muted'),
    r(`${tok(w.peak).padStart(6)} held ${tok(w.kept).padStart(6)} kept ${tok(w.returned).padStart(6)} back`),
    r(w.costUsd === null ? '' : `  $${w.costUsd.toFixed(2)}`, 'muted'),
  ], m.cols)));
  return [head('offload', [r(`${tok(o.kept)} kept in tmux, ${tok(o.returned)} back`), r(ratio, 'muted')], m), ...rows];
}

function ranRuns(s: CoreModel['routes'][number]['seats'][number], m: PanelModel): Run[] {
  if (!s.ran.length) return [r('  '), mark('queued', m), r('not run yet', 'muted')];
  const same = s.ran.every((x) => x.toLowerCase().includes(s.model.toLowerCase()) || s.model === 'inherit');
  const over = s.ran.length > s.count;
  const used = [...new Set(s.ran.map((x) => x.replace(/^claude-/, '')))].join(', ');
  const what = over ? `ran ${s.ran.length} / planned ${s.count} (${used})` : `ran ${used}`;
  return [r(`  ${what} `, over ? 'bad' : 'muted'), ...(same && !over ? [mark('done', m), r('as planned', 'ok')] : [mark('failed', m), r('drift', 'bad')])];
}

function routeRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const rows = c.routes.slice(-6).reverse().flatMap((rt): PanelLine[] => [
    line(fitRuns([
      r('  '), r(`${rt.cls}/${rt.effort}`, 'text', { bold: true }),
      r(`  ${rt.name || rt.teamId}  ${[rt.transport ?? 'tmux', rt.isolation].filter(Boolean).join(', ')}, max ${rt.maxParallel}`, 'muted'),
      ...(rt.drift.length ? [r('  '), mark('failed', m), r('drift', 'bad')] : []),
    ], m.cols)),
    ...rt.seats.map((s) => line(fitRuns([r(`    ${m.ui.ascii ? '>' : '▸'} `, 'muted'), r(`${s.count}x ${s.role} `), r(`${s.model}/${s.effort}`), ...ranRuns(s, m)], m.cols))),
  ]);
  return [
    line(fitRuns([r('route  ', 'muted', { bold: true }), r('class/effort, then seats, then the model each ran', 'muted')], m.cols)),
    ...(rows.length ? rows : [line([r('  no team this session', 'muted')])]),
    ...(c.inProcess ? [] : [line([r('  in-process dispatches are not shown here', 'muted')])]),
  ];
}

function coreBody(m: PanelModel): PanelLine[] {
  if (!hasCore(m.core)) return [line([r('(no state)', 'muted'), r('  no verdicts, workers or gates yet', 'muted')])];
  const c = m.core;
  return [...contractRows(c, m), BLANK, ...verdictRows(c, m), BLANK, ...offloadRows(c, m), BLANK, ...routeRows(c, m)];
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

/** A worker card as rows of runs: `┌─ running implementer-band ──────── opus ─┐`, rows inside `│ ... │`, a closed bottom. Its width is
 * `min(CARD_W, cols)`; the steps gauge is 12 cells from 100 columns and 8 below. */
export function cardLines(c: CardModel, cols = 120): Run[][] {
  const b = c.ui.ascii ? BOX_ASCII : BOX;
  const w = Math.max(20, Math.min(CARD_W, cols));
  const inner = w - 4;
  const g = stateRun(c.state, c.ui);
  const edge = (t: string): Run => r(t, g.tone); // the frame carries the state hue (design: blue while running); the rule between name and tag stays grey
  const body = (runs: Run[]): Run[] => [edge(b.v), r(' '), ...fitRuns(runs, inner), r(' '.repeat(Math.max(0, inner - rowWidth(fitRuns(runs, inner))))), r(' '), edge(b.v)];
  const rowLabel = (t: string): Run => r(pad(t, 6), 'muted');
  const title: Run[] = [r(c.state), r(' '), r(c.name, 'text', { bold: true })];
  const tagW = c.model ? cells(c.model) + 1 : 0;
  // `┌─ ` + title + ` ` + rule + tag + ` ─┐`
  const room = c.model ? w - tagW - 8 : w - 7;
  const titleRuns = fitRuns(title, Math.max(4, room));
  const fill = Math.max(1, w - 3 - rowWidth(titleRuns) - 1 - tagW - (c.model ? 3 : 2));
  const top: Run[] = [edge(`${b.tl}${b.h} `), ...titleRuns, r(' '), r(b.h.repeat(fill), 'line'), ...(c.model ? [r(` ${c.model} `, 'sub'), edge(`${b.h}${b.tr}`)] : [edge(`${b.h}${b.tr}`)])];
  const stepsW = cols >= 100 ? 12 : 8;
  const rows: Run[][] = [];
  if (c.goal) rows.push(body([rowLabel('goal'), r(oneLine(c.goal))]));
  if (c.last) rows.push(body([rowLabel('last'), r(oneLine(c.last))]));
  if (c.steps && c.steps.total > 0) {
    const v = c.steps.done / c.steps.total;
    rows.push(body([rowLabel('steps'), ...gauge(stepsW, v, c.ui, 'info'), r(` ${c.steps.done} of ${c.steps.total} ${dot(c.ui)} ${percent(v)}`)]));
  }
  if (c.ctx !== undefined) rows.push(body([rowLabel('ctx'), ...gauge(8, c.ctx, c.ui, 'info'), r(` ${percent(c.ctx)}`)]));
  return [top, ...rows, [edge(`${b.bl}${b.h.repeat(w - 2)}${b.br}`)]];
}

/** `● done  implementer-layout  9 of 9 steps`: state first, then the name, then one fact. No full stop. */
export function toastRuns(state: UiState, name: string, fact: string, ui: Ui): Run[] {
  const g = stateRun(state, ui);
  return [{ ...g, t: `${g.t} ` }, r(state), r(`  ${name}`), ...(fact ? [r(`  ${oneLine(fact)}`, 'sub')] : [])];
}
export const toastText = (state: UiState, name: string, fact: string, ui: Ui): string => runsText(toastRuns(state, name, fact, ui));
export { stateGlyph };
