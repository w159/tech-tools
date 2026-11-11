// mission-layout.ts: the one Mission Control layout both harnesses draw. The Claude Code band (mod/band.tsx) and the
// omp mission panel (omp/mission-panel.ts) are thin adapters: each builds a MissionModel from its own data, calls
// missionLines, and paints the runs (Segments on Claude Code, ANSI on omp). Parity is structural: the text both print
// comes from here, and the goldens (contracts/band-golden.ts, contracts/band-world-golden.ts) assert it on both.
//
// Design rules (design system rev 4; the primitives live in atlas-ui.ts):
//   - The band is the brand capsule plus the facts (phase, todo, context, worker counts) in the widest of four forms
//     that fits (120, 80, 60, 40 columns). `rich` adds a phase rail and a gauge row. Workers, the message, the checks
//     footer and the key buttons sit under it as before.
//   - Colour carries state only. States are the six-word vocabulary (glyph + word); state colours never colour text.
//   - Rows drop in a fixed order under a tight budget: blanks, the message, the footer, then workers past "+N more".
import { atColumn, capsule, clip, COUNT_ORDER, countRuns, gauge, padEnd, PALETTES, percent, rail, spinFrameOf, spinnerGlyph, stateRun, uiFromEnv, type Run, type Tone, type Ui, type UiState } from './atlas-ui';
import { animateRow, BAND_OPTS, type MotionCtx, type MotionItem } from './motion';
import { blockReasons } from './data/runstate';
import { displayName } from './hud';
import { fitText, formatDuration, textWidth } from './theme';

export type { Run, Tone };
/** One row, on the theme's panel colour. `keys`: the footer, where the band appends its key buttons in `keysWidth`
 * cells. `board`: a slot of `rows` rows the harness fills with its own todo list. */
export type Line = { runs: Run[]; keys?: boolean; board?: number };

/** Mocha hexes for each tone (the default theme); the hosts paint the live theme through atlas-ui `toneHex`. */
export const TONE_HEX: Record<Tone, string> = { ...PALETTES.mocha, dim: '#585b70' };
/** Panel background of the surfaces that have not moved to the rev 4 panel token yet (todo list, side panel). */
export const PANEL_BG = '#11111b';

export type WorkerState = 'running' | 'thinking' | 'queued' | 'waiting' | 'failed' | 'done';
export type MissionWorker = { name: string; role?: string; state: WorkerState; tool?: string; target?: string; secs: number };
export type MissionNote = { from: string; to: string; text: string; at?: string; kind?: string };
/** Presence and system events (a worker joining or leaving, a worktree merge) are not messages: the message row shows
 * the newest comm whose kind is not one of these (`say`, `dispatch`, `report`, or a kind the source does not state). */
const NOT_MESSAGE = new Set(['join', 'leave', 'exit', 'merge']);
export const isMessageKind = (kind?: string): boolean => !kind || !NOT_MESSAGE.has(kind);
/** `name`: what a failing check is called in the blocked reason (the failing line's own words, `team gate`); the id when absent. */
export type MissionCheck = { id: string; ok: boolean; name?: string };
export type LastRun = { workers: number; secs?: number; failed: number };

export type MissionModel = {
  cols: number;
  maxRows: number;
  tick: number;
  /** The shared clock reading (ms): the spinner frame of a worker is spinFrameOf(now, name). Absent: the local `tick`. */
  now?: number;
  /** `<repo>@<branch>` (or the project folder). */
  project: string;
  /** `<class>/<effort>` of the running team, when the harness knows it. */
  scope?: string;
  /** Rail phases in order, and the lit one. */
  phases: readonly string[];
  phase: string;
  /** The lead's last reply declared the blocked phase. */
  blocked?: boolean;
  done: number;
  total: number;
  /** Plan items in the blocked state (the board's rule: its own status, or a waiting owner). Shown beside the todo count with its own glyph, so a blocked task never hides. */
  todoBlocked?: number;
  /** Workers to show: running, waiting, failed and recently finished (never parked). */
  workers: readonly MissionWorker[];
  /** The newest channel message. */
  note?: MissionNote;
  /** Check groups (completion, tripwire, routing); null before any report. */
  checks: readonly MissionCheck[] | null;
  /** Seconds since the oldest running worker started. */
  elapsedSecs?: number;
  /** Idle only: the most recent wave. */
  lastRun?: LastRun;
  /** Idle only: the core row (contract, verdicts, offload, route) as runs. */
  core?: readonly Run[];
  /** Rows the expanded todo list wants; 0 when the board is folded. */
  boardRows?: number;
  /** Cells the band's key buttons take on the footer; 0 on omp. */
  keysWidth?: number;
  /** Cells the focus hint after the keys wants (with its gap); the checks keep to a shorter form before they push it out. */
  hintWidth?: number;
  /** Lead context used, 0..1; absent hides the ctx gauge. */
  ctx?: number;
  /** The tall band (phase rail, blank, gauge row) when the width and rows allow it. */
  rich?: boolean;
  /** Theme, ASCII and colour mode; absent reads the environment. */
  ui?: Ui;
  /** The HUD's Subagents block lists the workers: the band keeps the counts and draws no worker rows. */
  workersInHud?: boolean;
  /** Gauge values on screen while a figure glides (0..1); the labels keep the true figures. Absent: the figure itself. */
  eased?: { todo?: number; ctx?: number };
  /** Motion view (mod/motion.ts): a count that changed is drawn mid-transition. Absent: the resting render. */
  motion?: MotionCtx | undefined;
};

const MID = 80; // below this, only the band
const NAME_MAX = 18;
const ROLE_W = 13;
const TIME_W = 7;
const FULL = 100; // the role column joins at this width

const r = (t: string, tone: Tone = 'text', bold = false): Run => (bold ? { t, tone, bold } : { t, tone });
export const runsWidth = (runs: readonly Run[]): number => runs.reduce((n, x) => n + textWidth(x.t), 0);
/** Plain text of a row, for goldens and text surfaces. */
export const runsText = (runs: readonly Run[]): string => runs.map((x) => x.t).join('');
const padTo = (t: string, n: number): string => padEnd(clip(t, n), n);

/** `left` then `right` flush to `cols`; right drops when both do not fit, then left is cut. */
function spread(left: Run[], right: Run[], cols: number): Run[] {
  const gap = cols - runsWidth(left) - runsWidth(right);
  if (right.length && gap >= 2) return [...left, r(' '.repeat(gap)), ...right];
  return fitRuns(left, cols);
}
/** Cut runs to `cols` cells, the overflowing run clipped; pad to `cols`. */
function fitRuns(runs: readonly Run[], cols: number): Run[] {
  const out: Run[] = [];
  let left = cols;
  for (const x of runs) {
    if (left <= 0) break;
    const t = clip(x.t, left);
    left -= textWidth(t);
    out.push({ ...x, t });
  }
  return left > 0 ? [...out, r(' '.repeat(left))] : out;
}

const clock = (secs: number): string => {
  const s = Math.max(0, Math.floor(secs));
  return s >= 3600 ? formatDuration(s * 1000) : `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// ---- band ------------------------------------------------------------------------------

const isRunning = (m: MissionModel): boolean => m.workers.some((w) => w.state !== 'done' && w.state !== 'failed');
const uiOf = (m: MissionModel): Ui => m.ui ?? uiFromEnv();
/** A mission worker's place in the six-word vocabulary. */
export const uiStateOf = (s: WorkerState): UiState => (s === 'thinking' ? 'running' : s);

/** Failed workers on the band: the listed workers, and on an idle band the last wave's failures too (idle never hides a failure). */
const failedCount = (m: MissionModel): number => Math.max(m.workers.filter((w) => uiStateOf(w.state) === 'failed').length, isRunning(m) ? 0 : m.lastRun?.failed ?? 0);

/** Agent counts by state, in the order the band shows them; zero counts are left out. `words`: `◐ 1 running`; otherwise glyph and
 * number (`◐1`), where queued gives way. `noun`: the basis, `agents`, in front (the todo count is tasks; the two are never mixed). */
const countOf = (m: MissionModel, s: UiState): number => (s === 'failed' ? failedCount(m) : m.workers.filter((w) => uiStateOf(w.state) === s).length);
/** What the Motion observes of the band: each state's agent count, so a count that moves is drawn mid-transition. */
export const bandMotionItems = (m: MissionModel): MotionItem[] => COUNT_ORDER.map((s): MotionItem => ({ key: `count:${s}`, state: String(countOf(m, s)) }));

function bandCounts(m: MissionModel, ui: Ui, words: boolean, noun = false, gap = '   '): Run[] {
  const n = (s: UiState): number => countOf(m, s);
  const order = COUNT_ORDER.filter((s) => (words ? s === 'running' || s === 'failed' || s === 'queued' || s === 'waiting' : s === 'running' || s === 'failed' || s === 'waiting'));
  const parts = order.filter((s) => n(s) > 0).map((s): Run[] => animateRow(words ? countRuns(s, n(s), ui, m.tick) : [stateRun(s, ui, m.tick), r(`${n(s)}`)], `count:${s}`, s, m.motion, ui, BAND_OPTS));
  const body = parts.flatMap((p, i) => (i ? [r(words ? gap : ' '), ...p] : p));
  return noun && body.length ? [r('agents ', 'muted'), ...body] : body;
}

/** The blocked tasks beside the todo count: `▲ 1 blocked` (words) or `▲1`; nothing when none. */
function blockedRuns(m: MissionModel, ui: Ui, words: boolean): Run[] {
  const n = m.todoBlocked ?? 0;
  if (n <= 0) return [];
  return words ? countRuns('blocked', n, ui) : [stateRun('blocked', ui), r(`${n}`)];
}

/** 0-based lit phase; `phases.length` once the run is done (every phase reads complete). */
function phaseIndex(m: MissionModel): number {
  if (m.phase === 'done') return m.phases.length;
  return Math.max(0, m.phases.indexOf(m.phase));
}

const todoGauge = (m: MissionModel, ui: Ui, w: number): Run[] => gauge(w, m.eased?.todo ?? (m.total ? Math.min(1, m.done / m.total) : 0), ui);
const ctxBar = (m: MissionModel, ui: Ui, w: number): Run[] => gauge(w, m.eased?.ctx ?? m.ctx ?? 0, ui);

/** Narrowest width (columns) of the wide standard forms (the first four); the compact forms below them carry their own minimum. A form also has to fit. */
const WIDE_MIN = 100;

/** The one run state every form below reads: blocked (declared by the lead, or idle beside a failing check), idle, and why. */
export function runStateOf(m: MissionModel): { blocked: boolean; idle: boolean; reason: { long: string; short: string } } {
  const quiet = !m.blocked && !isRunning(m);
  const failing = (m.checks ?? []).filter((c) => !c.ok).map((c) => c.name ?? c.id);
  const stuck = quiet && failing.length > 0; // idle in every way but a failing check: the header says so
  return { blocked: !!m.blocked || stuck, idle: quiet && !stuck, reason: blockReasons(!!m.blocked, failing) };
}

/** `▲ BLOCKED · tripwire failing`: glyph, the header chip's upper-case word and, when given, the reason. */
const blockedHead = (ui: Ui, reason?: string): Run[] => [stateRun('blocked', ui), r(' BLOCKED', 'text', true), ...(reason ? [r(` · ${reason}`, 'sub')] : [])];

type Form = { runs: Run[]; min: number };

/** The standard forms, widest first: 120 (the design's look; then a tight one for a crowded row: 2-cell gaps, ctx as a figure, an 8-cell todo gauge; each with and without the `agents` noun), 80, then the 60 and 40 column forms. The long word `phase` is used wherever it fits; `ph` only when it does not. A blocked band keeps its glyph, word and reason at every width. */
function standardForms(m: MissionModel, ui: Ui): Form[] {
  const cap = capsule(ui);
  const idx = phaseIndex(m);
  const n = m.phases.length;
  const phaseNo = `${Math.min(idx + 1, n)}/${n}`;
  const { blocked, idle, reason } = runStateOf(m);
  const name: Run[] = blocked
    ? [...blockedHead(ui, reason.long), r(` · phase ${phaseNo}`, 'sub')]
    : idle ? [r('idle', 'text', true), r(` · phase ${phaseNo}`, 'sub')] : [r(m.phase, 'text', true), r(` · phase ${phaseNo}`, 'sub')];
  const lead = idle ? 'idle · ' : '';
  const todo = m.total ? `${m.done}/${m.total}` : '';
  const blockedWords = blockedRuns(m, ui, true);
  const blockedTiny = blockedRuns(m, ui, false);
  const full = (noun: boolean, ctxGauge: boolean, gap: string, gw = 10): Run[] => {
    const counts = bandCounts(m, ui, true, noun, gap);
    return [
      ...cap, r('  '), ...name,
      ...(m.total ? [r(gap), r('todo '), ...todoGauge(m, ui, gw), r(` ${m.done} of ${m.total}`, 'sub'), ...(blockedWords.length ? [r(' '), ...blockedWords] : [])] : []),
      ...(m.ctx !== undefined ? [r(gap), r('ctx '), ...(ctxGauge ? [...ctxBar(m, ui, 8), r(' ')] : []), r(percent(m.ctx), 'sub')] : []),
      ...(counts.length ? [r(gap), ...counts] : []),
    ];
  };
  const counts = bandCounts(m, ui, true);
  const tiny = bandCounts(m, ui, false);
  const midTodo = `${todo ? ` · todo ${todo}` : ''}`;
  const tail = (cs: Run[]): Run[] => [...(blockedTiny.length ? [r(' '), ...blockedTiny] : []), ...(cs.length ? [r(' · ', 'sub'), ...cs] : [])];
  const compact = (word: string, cs: Run[], why: string): Run[] => [...cap, ...(blocked ? [r(' '), ...blockedHead(ui, why), r(` · ${word} ${phaseNo}${midTodo}`, 'sub')] : [r(` ${lead}${word} ${phaseNo}${midTodo}`, 'sub')]), ...tail(cs)];
  const out: Form[] = [
    { runs: full(true, true, '   '), min: WIDE_MIN }, { runs: full(true, false, '  ', 8), min: WIDE_MIN },
    { runs: full(false, true, '   '), min: WIDE_MIN }, { runs: full(false, false, '  ', 8), min: WIDE_MIN },
    { runs: compact('phase', counts, reason.long), min: 80 },
    { runs: compact('phase', tiny, reason.short), min: 50 },
    { runs: compact('ph', tiny, reason.short), min: 50 },
  ];
  if (blocked) {
    const todoPart = todo ? [r(` todo ${todo}`, 'sub')] : [];
    const small = (...parts: Run[][]): Run[] => [...cap, r(' '), ...blockedHead(ui, reason.short), ...parts.flat()];
    out.push({ runs: small(todoPart, tail(tiny)), min: 0 }, { runs: small(todoPart), min: 0 }, { runs: small(), min: 0 }, { runs: [...cap, r(' '), ...blockedHead(ui)], min: 0 });
  } else out.push({ runs: [...cap, r(`${idle ? ' idle' : ''}${todo ? `${quiet(m) ? ' · ' : ' '}todo ${todo}` : ''}`, 'sub'), ...tail(tiny)], min: 0 });
  return out;
}
const quiet = (m: MissionModel): boolean => !m.blocked && !isRunning(m);

/** The rich band: the capsule and the numbered phase rail, a blank row, then the todo and ctx gauges and the counts. */
function richBand(m: MissionModel, ui: Ui): Line[] {
  const { blocked: isBlocked, idle, reason } = runStateOf(m);
  const head: Run[] = [...capsule(ui), r('  '), ...rail(m.phases, phaseIndex(m), ui), ...(isBlocked ? [r('   '), ...blockedHead(ui, reason.long)] : idle ? [r('   '), r('idle', 'text', true)] : [])];
  const todo: Run[] = m.total ? [r('todo ', 'muted'), ...todoGauge(m, ui, 16), r(` ${m.done} of ${m.total} · ${percent(m.done / m.total)}`, 'sub')] : [];
  const ctx: Run[] = m.ctx !== undefined ? [r('ctx ', 'muted'), ...ctxBar(m, ui, 10), r(` ${percent(m.ctx)}`, 'sub')] : [];
  const counts = bandCounts(m, ui, true, true);
  const blocked = blockedRuns(m, ui, true);
  const to = (row: Run[], col: number): Run[] => (row.length ? atColumn(row, col) : [r(' '.repeat(col))]);
  const todoRow = [...todo, ...(todo.length && blocked.length ? [r('  '), ...blocked] : [])];
  const ctxAt = Math.max(40, runsWidth(todoRow) + 3); // the ctx and count columns move right when the blocked count joins the todo group
  let row = todoRow;
  if (ctx.length) row = [...to(row, ctxAt), ...ctx];
  if (counts.length) row = [...to(row, Math.max(62, ctxAt + (ctx.length ? 22 : 0))), ...counts];
  return [{ runs: head }, { runs: [r(' ')] }, { runs: row }];
}

/** The band alone: one row in the widest standard form that fits `cols`, or the three rich rows when `m.rich`, the
 * rows allow (`maxRows` >= 3) and the width fits. Rows are padded to `cols`. */
export function bandLines(m: MissionModel): Line[] {
  const ui = uiOf(m);
  if (m.rich && m.maxRows >= 3) {
    const rows = richBand(m, ui);
    if (rows.every((l) => runsWidth(l.runs) <= m.cols)) return rows.map((l) => ({ ...l, runs: fitRuns(l.runs, m.cols) }));
  }
  const forms = standardForms(m, ui);
  const row = (forms.find((f) => m.cols >= f.min && runsWidth(f.runs) <= m.cols) ?? forms[forms.length - 1]!).runs;
  return [{ runs: fitRuns(row, m.cols) }];
}

function lastRunRuns(l: LastRun | undefined, checksFail = false): Run[] {
  if (!l || !l.workers) return [];
  const parts: Run[] = [r(' last run  ', 'muted'), r(plural(l.workers, 'worker'), 'sub')];
  if (l.secs !== undefined) parts.push(r(' · ', 'sub'), r(formatDuration(l.secs * 1000), 'sub'));
  if (l.failed) parts.push(r(' · ', 'sub'), r(`${l.failed} failed`, 'text', true));
  else if (!checksFail) parts.push(r(' · ', 'sub'), r('all ok', 'sub')); // never `all ok` above a failing check
  return [...parts, r(' ')];
}

// ---- workers ------------------------------------------------------------------------

/** The status mark: a spinner only while a tool is in flight. */
function mark(w: MissionWorker, m: MissionModel, ui: Ui): Run {
  const frame = m.now === undefined ? m.tick : spinFrameOf(m.now, w.name);
  switch (w.state) {
    case 'running': return stateRun('running', ui, frame);
    case 'thinking': return r(spinnerGlyph(frame, ui.ascii), 'muted');
    case 'queued': return stateRun('queued', ui);
    case 'waiting': return stateRun('waiting', ui);
    case 'failed': return stateRun('failed', ui);
    case 'done': return stateRun('done', ui);
  }
}

/** What the worker is doing, in words. */
function activity(w: MissionWorker): Run[] {
  const target = w.target ? [r('  '), r(w.target, 'sub')] : [];
  switch (w.state) {
    case 'running': return [r(w.tool ?? 'working', 'text', true), ...target];
    case 'thinking': return [r('thinking', 'sub'), ...(w.tool ? [r('   last ', 'muted'), r(w.tool, 'muted'), ...(w.target ? [r(` ${w.target}`, 'muted')] : [])] : [])];
    case 'queued': return [r('queued', 'sub')];
    case 'waiting': return [r('waiting', 'text'), ...target];
    case 'failed': return [r('failed', 'text', true), ...target];
    case 'done': return [r('finished', 'sub')];
  }
}

type Cols = { name: number; role: number };
function workerCols(m: MissionModel): Cols {
  const longest = Math.max(8, ...m.workers.map((w) => textWidth(w.name)));
  return { name: Math.min(NAME_MAX, longest) + 2, role: m.cols >= FULL ? ROLE_W : 0 };
}

function workerLine(w: MissionWorker, m: MissionModel, c: Cols): Line {
  const ui = uiOf(m);
  const head = [r(' '), mark(w, m, ui), r(' '), r(padTo(w.name, c.name - 1) + ' ', w.state === 'done' ? 'sub' : 'text', w.state !== 'done'), ...(c.role ? [r(padTo(w.role ?? '', c.role - 1) + ' ', 'sub')] : [])];
  const time = r(clip(formatDuration(w.secs * 1000), TIME_W - 1).padStart(TIME_W - 1) + ' ', 'sub');
  const room = m.cols - runsWidth(head) - TIME_W;
  return { runs: [...head, ...fitRuns(activity(w), Math.max(0, room)), time] };
}

/** `+2 more · 1 waiting`: the hidden workers, with any that need attention named by state. */
function moreLine(hidden: readonly MissionWorker[], cols: number): Line {
  const waiting = hidden.filter((w) => w.state === 'waiting').length;
  const failed = hidden.filter((w) => w.state === 'failed').length;
  const runs: Run[] = [r(`   +${hidden.length} more`, 'sub')];
  if (waiting) runs.push(r(' · ', 'sub'), r(`${waiting} waiting`, 'text'));
  if (failed) runs.push(r(' · ', 'sub'), r(`${failed} failed`, 'text'));
  return { runs: fitRuns(runs, cols) };
}

// ---- message and footer ---------------------------------------------------------------

/** What a message was, in words of our own: the line is built from who, to whom and the kind, never from the message text
 * (a free-text body leaks list markers, paths and prompts into the band). */
const NOTE_STATE: Record<string, string> = { dispatch: 'dispatched work', report: 'reported', say: 'sent a message' };
export const noteState = (kind?: string): string => (kind ? NOTE_STATE[kind] : undefined) ?? 'sent a message';

function noteLine(n: MissionNote, cols: number): Line {
  const left: Run[] = [r(' '), r(displayName(n.from), 'text', true), r(' to ', 'muted'), r(displayName(n.to), 'sub'), r('   ')];
  const right = n.at ? [r(` ${n.at} `, 'muted')] : [r(' ')];
  const room = cols - runsWidth(left) - runsWidth(right);
  return { runs: [...left, ...fitRuns([r(noteState(n.kind), 'text')], Math.max(0, room)), ...right] };
}

/** `checks  ● completion  ■ tripwire  ● routing  2 of 3 green`; when that does not fit, `checks  ■ tripwire  2 of 3 green` (failures only) or
 * `checks  ● 3 of 3 green`. The figure is the gates tab's own `n of m green`. Failing names take the text tone so they stand out; passing names stay muted. */
function checkRuns(checks: readonly MissionCheck[] | null, room: number, ui: Ui, hint = 0): Run[] {
  const lean = hint > 0 ? checkRuns(checks, room - hint, ui) : []; // the form that leaves the hint its room, when one fits
  if (lean.length) return lean;
  if (!checks?.length) return [];
  const one = (c: MissionCheck): Run[] => [stateRun(c.ok ? 'done' : 'failed', ui), r(` ${c.id}`, c.ok ? 'sub' : 'text')];
  const join = (cs: readonly MissionCheck[]): Run[] => cs.flatMap((c, i) => [...(i ? [r('  ')] : []), ...one(c)]);
  const failing = checks.filter((c) => !c.ok);
  const green = `${checks.length - failing.length} of ${checks.length} green`;
  const forms: Run[][] = [
    [...join(checks), r(`  ${green}`, 'sub')],
    join(checks), // tight: the names and marks carry the figure
    failing.length ? [...join(failing), r(`  ${green}`, 'sub')] : [stateRun('done', ui), r(` ${green}`, 'sub')],
    failing.length ? [stateRun('failed', ui), r(` ${plural(failing.length, 'failing')}`, 'text')] : [stateRun('done', ui)],
  ];
  const label = [r(' checks  ', 'muted')];
  for (const f of forms) if (runsWidth(label) + runsWidth(f) <= room) return [...label, ...f];
  return [];
}

function footerLine(m: MissionModel): Line | null {
  const keys = m.keysWidth ?? 0;
  const checks = checkRuns(m.checks, m.cols - keys - (keys ? 2 : 0), uiOf(m), keys ? m.hintWidth ?? 0 : 0);
  if (!checks.length && !keys) return null;
  // With keys the band pads the gap itself (flush-right buttons), so the checks stay unpadded.
  return { runs: keys ? checks : fitRuns(checks, m.cols), keys: keys > 0 };
}

// ---- row budget -----------------------------------------------------------------------

/** Whether the message and footer stay: drop the message first, then the footer, until `need` worker rows fit. */
function chrome(room: number, need: number, hasNote: boolean, hasFooter: boolean): [boolean, boolean] {
  for (const [n, f] of [[hasNote, hasFooter], [false, hasFooter], [false, false]] as const) if (room - +n - +f >= need) return [n, f];
  return [false, false];
}

/** How many worker rows, message and footer rows fit `maxRows` (two head rows are fixed). Hidden workers
 * outrank the message: it gives way to the "+N more" row. */
export function planRows(maxRows: number, nWorkers: number, hasNote: boolean, hasFooter = true): { lanes: number; ticker: boolean; footer: boolean; more: boolean } {
  const room = Math.max(0, maxRows - 2);
  const [kept, footer] = chrome(room, Math.min(1, nWorkers), hasNote, hasFooter);
  const slotsWith = room - +kept - +footer;
  const ticker = kept && !(nWorkers > slotsWith && slotsWith < 2);
  const slots = room - +ticker - +footer;
  const more = nWorkers > slots && slots >= 2;
  return { lanes: more ? slots - 1 : Math.min(nWorkers, slots), ticker, footer, more };
}

/** Workers that need attention sort first (failed, waiting), then running, thinking, queued, finished. */
const ORDER: Record<WorkerState, number> = { failed: 0, waiting: 1, running: 2, thinking: 3, queued: 4, done: 5 };
const byAttention = (ws: readonly MissionWorker[]): MissionWorker[] => ws.map((w, i) => [w, i] as const).sort((a, b) => ORDER[a[0].state] - ORDER[b[0].state] || a[1] - b[1]).map(([w]) => w);

const blank = (cols: number): Line => ({ runs: [r(' '.repeat(cols))] });

function idleLines(m: MissionModel): Line[] {
  const band = bandLines(m);
  const last = lastRunRuns(m.lastRun, runStateOf(m).blocked); // `all ok` never sits under a BLOCKED header, declared or from a failing check
  const lastRow: Line[] = last.length && m.maxRows > band.length ? [{ runs: last }] : [];
  const head = [...band, ...lastRow];
  const foot = footerLine(m);
  const footRows = foot && m.maxRows >= head.length + 1 ? 1 : 0;
  const core = m.core?.length && m.maxRows >= head.length + 1 + footRows ? [{ runs: fitRuns(m.core, m.cols) }] : [];
  const room = m.maxRows - head.length - core.length - footRows;
  const board = m.boardRows && room >= 1 ? [{ runs: [], board: Math.min(m.boardRows, room) }] : [];
  return [...head, ...core, ...board, ...(footRows && foot ? [foot] : [])];
}

function runningLines(m: MissionModel): Line[] {
  const shown = m.workersInHud ? [] : byAttention(m.workers); // the HUD's Subagents block lists them; the band keeps the counts
  const foot = footerLine(m);
  const band = bandLines(m);
  const boardWant = m.boardRows ?? 0;
  const board = boardWant && m.maxRows - band.length >= 4 ? Math.min(boardWant, m.maxRows - band.length - 3) : 0; // keep a worker, the message and the footer
  const plan = planRows(m.maxRows - board - (band.length - 2), shown.length, !!m.note, !!foot);
  const c = workerCols(m);
  const head: Line[] = [...band, ...(board ? [{ runs: [], board }] : [])];
  const rows: Line[] = shown.slice(0, plan.lanes).map((w) => workerLine(w, m, c));
  const extras: Line[] = [...(plan.more ? [moreLine(shown.slice(plan.lanes), m.cols)] : []), ...(plan.ticker && m.note ? [noteLine(m.note, m.cols)] : [])];
  const tail: Line[] = plan.footer && foot ? [foot] : [];
  // Spare rows breathe: one blank under the band, then one between the workers and the message; the first to go.
  const spare = m.maxRows - (head.length - (board ? 1 : 0) + board) - rows.length - extras.length - tail.length;
  return [...head, ...(spare >= 1 ? [blank(m.cols)] : []), ...rows, ...(spare >= 2 && extras.length ? [blank(m.cols)] : []), ...extras, ...tail];
}

/** Mission Control rows for `m`, at most `maxRows`, each exactly `cols` cells (board slots aside). Below 80 columns
 * (or three rows, running) only the band shows. */
export function missionLines(m: MissionModel): Line[] {
  if (m.maxRows < 1) return [];
  const running = isRunning(m);
  if ((running && (m.cols < MID || m.maxRows < 3)) || (!running && m.cols < MID)) return bandLines({ ...m, rich: false });
  const lines = running ? runningLines(m) : idleLines(m);
  let used = 0;
  const kept = lines.filter((l) => (used += l.board ?? 1) <= m.maxRows); // a board slot counts as the rows it holds
  return kept.map((l) => (l.board || l.keys ? l : { ...l, runs: fitRuns(l.runs, m.cols) }));
}
