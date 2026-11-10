// mission-layout.ts: the one Mission Control layout both harnesses draw. The Claude Code band (mod/band.tsx) and the
// omp mission panel (omp/mission-panel.ts) are thin adapters: each builds a MissionModel from its own data, calls
// missionLines, and paints the runs (Segments via MOCHA on Claude Code, ANSI on omp). Parity is structural: the
// text both print comes from here, and contracts/band-golden.ts asserts it on both.
//
// Design rules (docs/specs/2026-11-10_atlas-terminal-ui.md):
//   - One fact, one place: task progress lives in the header, checks in the footer, workers in their rows.
//   - Colour carries state only (ok, warn, bad) plus one violet accent for "now"; structure is muted and dim grey.
//   - Every glyph is paired with a word; motion (spinners) marks only what is running right now.
//   - Rows drop in a fixed order under a tight budget: blanks, the message, the footer, then workers past "+N more".
import { DONE_GLYPH, fitText, formatDuration, spin, textWidth } from './theme';

/** A run's role, not its colour: each harness maps tones to its own palette (TONE_HEX is the shared one). */
export type Tone = 'text' | 'muted' | 'dim' | 'accent' | 'ok' | 'warn' | 'bad';
export type Run = { t: string; tone: Tone; bold?: boolean };
/** One row. `raised`: the header's lifted background. `keys`: the footer, where the band appends its key buttons in
 * `keysWidth` cells. `board`: a slot of `rows` rows the harness fills with its own todo list. */
export type Line = { runs: Run[]; raised?: boolean; keys?: boolean; board?: number };

/** Catppuccin Mocha hexes for each tone; both harnesses paint from this table. */
export const TONE_HEX: Record<Tone, string> = {
  text: '#cdd6f4', muted: '#9399b2', dim: '#585b70', accent: '#cba6f7', ok: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8',
};
/** Panel backgrounds: the band body and the raised header. */
export const PANEL_BG = '#11111b';
export const RAISED_BG = '#1e1e2e';

export type WorkerState = 'running' | 'thinking' | 'starting' | 'waiting' | 'failed' | 'done';
export type MissionWorker = { name: string; role?: string; state: WorkerState; tool?: string; target?: string; secs: number };
export type MissionNote = { from: string; to: string; text: string; at?: string };
/** Presence and system events (a worker joining or leaving, a worktree merge) are not messages: the message row shows
 * the newest comm whose kind is not one of these (`say`, `dispatch`, `report`, or a kind the source does not state). */
const NOT_MESSAGE = new Set(['join', 'leave', 'exit', 'merge']);
export const isMessageKind = (kind?: string): boolean => !kind || !NOT_MESSAGE.has(kind);
export type MissionCheck = { id: string; ok: boolean };
export type LastRun = { workers: number; secs?: number; failed: number };

export type MissionModel = {
  cols: number;
  maxRows: number;
  tick: number;
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
};

const FULL = 100; // the role column joins at this width
const MID = 80; // below this, one summary row
const NAME_MAX = 18;
const ROLE_W = 13;
const TIME_W = 7;
const BAR_W = 16;

const r = (t: string, tone: Tone = 'text', bold = false): Run => (bold ? { t, tone, bold } : { t, tone });
export const runsWidth = (runs: readonly Run[]): number => runs.reduce((n, x) => n + textWidth(x.t), 0);
/** Plain text of a row, for goldens and text surfaces. */
export const runsText = (runs: readonly Run[]): string => runs.map((x) => x.t).join('');
const padTo = (t: string, n: number): string => { const f = fitText(t, n); return f + ' '.repeat(Math.max(0, n - textWidth(f))); };

/** `left` then `right` flush to `cols`; right drops when both do not fit, then left is cut. */
function spread(left: Run[], right: Run[], cols: number): Run[] {
  const gap = cols - runsWidth(left) - runsWidth(right);
  if (right.length && gap >= 2) return [...left, r(' '.repeat(gap)), ...right];
  return fitRuns(left, cols);
}
/** Cut runs to `cols` cells, the overflowing run ellipsized; pad to `cols`. */
function fitRuns(runs: readonly Run[], cols: number): Run[] {
  const out: Run[] = [];
  let left = cols;
  for (const x of runs) {
    if (left <= 0) break;
    const t = fitText(x.t, left);
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

/** A thin progress bar: violet while open, green once complete, dim track. */
function progressBar(done: number, total: number, width = BAR_W): Run[] {
  const full = total > 0 ? Math.round((Math.min(done, total) / total) * width) : 0;
  const tone: Tone = total > 0 && done >= total ? 'ok' : 'accent';
  return [r('━'.repeat(full), tone), r('━'.repeat(width - full), 'dim')];
}

// ---- header -------------------------------------------------------------------------

const isRunning = (m: MissionModel): boolean => m.workers.some((w) => w.state !== 'done' && w.state !== 'failed');

function header(m: MissionModel): Line {
  const running = isRunning(m);
  const left: Run[] = [r(' ◆ ATLAS', 'accent', true), r('   '), r(m.project, 'text')];
  if (running && m.scope) left.push(r('  ·  ', 'dim'), r(m.scope, 'muted'));
  if (!running && !m.blocked) left.push(r('  ·  ', 'dim'), r('idle', 'muted'));
  if (m.blocked) left.push(r('   '), r('blocked', 'warn', true), r(' · needs you', 'warn'));
  const tasks = m.total ? [r(`${m.done} of ${m.total} tasks `, 'muted'), ...progressBar(m.done, m.total)] : [];
  const time = running && m.elapsedSecs !== undefined ? [r(`   ${clock(m.elapsedSecs)}`, 'muted')] : [];
  const right = [...tasks, ...time, r(' ')];
  // A narrow row keeps the bar's numbers and drops the bar first.
  const short = m.total ? [r(`${m.done}/${m.total} tasks`, 'muted'), ...time, r(' ')] : [...time, r(' ')];
  const fitsFull = runsWidth(left) + runsWidth(right) + 2 <= m.cols;
  return { runs: spread(left, fitsFull ? right : short, m.cols), raised: true };
}

// ---- stepper ------------------------------------------------------------------------

type StepMode = 'full' | 'short' | 'mark';
const stepName = (id: string, mode: StepMode): string => (mode === 'full' ? id : mode === 'short' ? id.slice(0, 3) : '');

/** One step: done ✓ green with a muted name, current violet and bold with a spinner while workers run, future ○ dim.
 * The current step always keeps its full name. The `done` phase reads as all steps complete. */
function step(id: string, rel: number, m: MissionModel, mode: StepMode, animate: boolean): Run[] {
  const named = (t: string, tone: Tone, bold = false): Run[] => (t ? [r(' '), r(t, tone, bold)] : []);
  const finished = m.phase === 'done';
  if (rel < 0 || (finished && rel === 0)) return [r(DONE_GLYPH, 'ok'), ...named(stepName(id, rel === 0 ? 'full' : mode), rel === 0 ? 'text' : 'muted', rel === 0)];
  if (rel > 0) return [r('○', 'dim'), ...named(stepName(id, mode), 'dim')];
  if (m.blocked) return [r('!', 'warn', true), r(' '), r(id, 'warn', true)];
  return [r(animate ? spin(m.tick) : '●', 'accent'), r(' '), r(id, 'accent', true)];
}

/** The widest stepper that fits: full names, three letters, then marks only. */
export function stepperRuns(m: MissionModel, cols: number, animate: boolean): Run[] {
  const at = m.phases.indexOf(m.phase);
  const build = (mode: StepMode): Run[] => [r(' '), ...m.phases.flatMap((id, i) => [...step(id, i - at, m, mode, animate), ...(i < m.phases.length - 1 ? [r(' ─ ', 'dim')] : [])])];
  for (const mode of ['full', 'short'] as const) {
    const row = build(mode);
    if (runsWidth(row) <= cols) return row;
  }
  return build('mark');
}

function lastRunRuns(l: LastRun | undefined): Run[] {
  if (!l || !l.workers) return [];
  const parts: Run[] = [r('last run  ', 'dim'), r(plural(l.workers, 'worker'), 'muted')];
  if (l.secs !== undefined) parts.push(r(' · ', 'dim'), r(formatDuration(l.secs * 1000), 'muted'));
  parts.push(r(' · ', 'dim'), l.failed ? r(`${l.failed} failed`, 'bad') : r('all ok', 'ok'));
  return [...parts, r(' ')];
}

function stepperLine(m: MissionModel, running: boolean): Line {
  const right = running ? [] : lastRunRuns(m.lastRun);
  const room = m.cols - (right.length ? runsWidth(right) + 2 : 0);
  const left = stepperRuns(m, room >= 40 ? room : m.cols, running);
  return { runs: spread(left, runsWidth(left) <= room ? right : [], m.cols) };
}

// ---- workers ------------------------------------------------------------------------

/** The status mark: a spinner only while a tool is in flight. */
function mark(w: MissionWorker, tick: number): Run {
  switch (w.state) {
    case 'running': return r(spin(tick), 'ok');
    case 'thinking': return r(spin(tick), 'muted');
    case 'starting': return r('◌', 'muted');
    case 'waiting': return r('○', 'warn');
    case 'failed': return r('✗', 'bad', true);
    case 'done': return r(DONE_GLYPH, 'ok');
  }
}

/** What the worker is doing, in words. */
function activity(w: MissionWorker): Run[] {
  const target = w.target ? [r('  '), r(w.target, 'muted')] : [];
  switch (w.state) {
    case 'running': return [r(w.tool ?? 'working', 'text', true), ...target];
    case 'thinking': return [r('thinking', 'muted'), ...(w.tool ? [r('   last ', 'dim'), r(w.tool, 'dim'), ...(w.target ? [r(` ${w.target}`, 'dim')] : [])] : [])];
    case 'starting': return [r('starting', 'muted')];
    case 'waiting': return [r('waiting', 'warn'), ...target];
    case 'failed': return [r('failed', 'bad', true), ...target];
    case 'done': return [r('finished', 'muted')];
  }
}

type Cols = { name: number; role: number };
function workerCols(m: MissionModel): Cols {
  const longest = Math.max(8, ...m.workers.map((w) => textWidth(w.name)));
  return { name: Math.min(NAME_MAX, longest) + 2, role: m.cols >= FULL ? ROLE_W : 0 };
}

function workerLine(w: MissionWorker, m: MissionModel, c: Cols): Line {
  const head = [r(' '), mark(w, m.tick), r(' '), r(padTo(w.name, c.name - 1) + ' ', w.state === 'done' ? 'muted' : 'text', w.state !== 'done'), ...(c.role ? [r(padTo(w.role ?? '', c.role - 1) + ' ', 'muted')] : [])];
  const time = r(fitText(formatDuration(w.secs * 1000), TIME_W - 1).padStart(TIME_W - 1) + ' ', 'muted');
  const room = m.cols - runsWidth(head) - TIME_W;
  return { runs: [...head, ...fitRuns(activity(w), Math.max(0, room)), time] };
}

/** `+2 more · 1 waiting`: the hidden workers, with any that need attention named by state. */
function moreLine(hidden: readonly MissionWorker[], cols: number): Line {
  const waiting = hidden.filter((w) => w.state === 'waiting').length;
  const failed = hidden.filter((w) => w.state === 'failed').length;
  const runs: Run[] = [r(`   +${hidden.length} more`, 'muted')];
  if (waiting) runs.push(r(' · ', 'dim'), r(`${waiting} waiting`, 'warn'));
  if (failed) runs.push(r(' · ', 'dim'), r(`${failed} failed`, 'bad'));
  return { runs: fitRuns(runs, cols) };
}

// ---- message and footer ---------------------------------------------------------------

function noteLine(n: MissionNote, cols: number): Line {
  const left: Run[] = [r(' '), r(n.from, 'text', true), r(' → ', 'dim'), r(n.to, 'muted'), r('   ')];
  const right = n.at ? [r(` ${n.at} `, 'dim')] : [r(' ')];
  const room = cols - runsWidth(left) - runsWidth(right);
  return { runs: [...left, ...fitRuns([r(n.text.replace(/\s+/g, ' '), 'text')], Math.max(0, room)), ...right] };
}

/** `checks  ✓ completion  ✗ tripwire  ✓ routing`; when that does not fit, `checks  ✗ tripwire` (failures only) or
 * `checks  ✓ all 3 pass`. Failing names take the text tone so they stand out; passing names stay muted. */
function checkRuns(checks: readonly MissionCheck[] | null, room: number): Run[] {
  if (!checks?.length) return [];
  const one = (c: MissionCheck): Run[] => [c.ok ? r(DONE_GLYPH, 'ok') : r('✗', 'bad', true), r(` ${c.id}`, c.ok ? 'muted' : 'text')];
  const join = (cs: readonly MissionCheck[]): Run[] => cs.flatMap((c, i) => [...(i ? [r('  ')] : []), ...one(c)]);
  const failing = checks.filter((c) => !c.ok);
  const forms: Run[][] = [
    join(checks),
    failing.length ? [...join(failing), r(`  ${checks.length - failing.length} ok`, 'muted')] : [r(DONE_GLYPH, 'ok'), r(` all ${checks.length} pass`, 'muted')],
    failing.length ? [r('✗', 'bad', true), r(` ${plural(failing.length, 'failing')}`, 'text')] : [r(DONE_GLYPH, 'ok')],
  ];
  const label = [r(' checks  ', 'dim')];
  for (const f of forms) if (runsWidth(label) + runsWidth(f) <= room) return [...label, ...f];
  return [];
}

function footerLine(m: MissionModel): Line | null {
  const keys = m.keysWidth ?? 0;
  const checks = checkRuns(m.checks, m.cols - keys - (keys ? 2 : 0));
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

/** How many worker rows, message and footer rows fit `maxRows` (header and stepper are fixed). Hidden workers
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

/** Workers that need attention sort first (failed, waiting), then running, thinking, starting, finished. */
const ORDER: Record<WorkerState, number> = { failed: 0, waiting: 1, running: 2, thinking: 3, starting: 4, done: 5 };
const byAttention = (ws: readonly MissionWorker[]): MissionWorker[] => ws.map((w, i) => [w, i] as const).sort((a, b) => ORDER[a[0].state] - ORDER[b[0].state] || a[1] - b[1]).map(([w]) => w);

function narrowLine(m: MissionModel): Line {
  const active = m.workers.filter((w) => w.state !== 'done' && w.state !== 'failed').length;
  const failing = m.checks?.filter((c) => !c.ok).length ?? 0;
  const parts: Run[] = [r(' ◆ ATLAS', 'accent', true), r('  '), r(m.blocked ? 'blocked' : m.phase, m.blocked ? 'warn' : 'text', true)];
  const add = (t: string, tone: Tone) => parts.push(r(' · ', 'dim'), r(t, tone));
  if (m.total) add(`${m.done}/${m.total} tasks`, 'muted');
  add(active ? `${active} working` : 'idle', 'muted');
  if (failing) add(`${failing} failing`, 'bad');
  return { runs: fitRuns(parts, m.cols), raised: true };
}

const blank = (cols: number): Line => ({ runs: [r(' '.repeat(cols))] });

function idleLines(m: MissionModel): Line[] {
  const head = header(m);
  if (m.maxRows < 2) return [head];
  const foot = footerLine(m);
  const footRows = foot && m.maxRows >= 3 ? 1 : 0;
  const core = m.core?.length && m.maxRows >= 3 + footRows ? [{ runs: fitRuns(m.core, m.cols) }] : [];
  const room = m.maxRows - 2 - core.length - footRows;
  const board = m.boardRows && room >= 1 ? [{ runs: [], board: Math.min(m.boardRows, room) }] : [];
  return [head, stepperLine(m, false), ...core, ...board, ...(footRows && foot ? [foot] : [])];
}

function runningLines(m: MissionModel): Line[] {
  const shown = byAttention(m.workers);
  const foot = footerLine(m);
  const boardWant = m.boardRows ?? 0;
  const board = boardWant && m.maxRows - 2 >= 4 ? Math.min(boardWant, m.maxRows - 2 - 3) : 0; // keep a worker, the message and the footer
  const plan = planRows(m.maxRows - board, shown.length, !!m.note, !!foot);
  const c = workerCols(m);
  const head: Line[] = [header(m), stepperLine(m, true), ...(board ? [{ runs: [], board }] : [])];
  const rows: Line[] = shown.slice(0, plan.lanes).map((w) => workerLine(w, m, c));
  const extras: Line[] = [...(plan.more ? [moreLine(shown.slice(plan.lanes), m.cols)] : []), ...(plan.ticker && m.note ? [noteLine(m.note, m.cols)] : [])];
  const tail: Line[] = plan.footer && foot ? [foot] : [];
  // Spare rows breathe: one blank under the stepper, then one between the workers and the message; the first to go.
  const spare = m.maxRows - (head.length - (board ? 1 : 0) + board) - rows.length - extras.length - tail.length;
  return [...head, ...(spare >= 1 ? [blank(m.cols)] : []), ...rows, ...(spare >= 2 && extras.length ? [blank(m.cols)] : []), ...extras, ...tail];
}

/** Mission Control rows for `m`, at most `maxRows`, each exactly `cols` cells (board slots aside). */
export function missionLines(m: MissionModel): Line[] {
  if (m.maxRows < 1) return [];
  const running = isRunning(m);
  if (running && (m.cols < MID || m.maxRows < 3)) return [narrowLine(m)];
  if (!running && m.cols < MID) return [narrowLine(m)];
  const lines = running ? runningLines(m) : idleLines(m);
  let used = 0;
  const kept = lines.filter((l) => (used += l.board ?? 1) <= m.maxRows); // a board slot counts as the rows it holds
  return kept.map((l) => (l.board || l.keys ? l : { ...l, runs: fitRuns(l.runs, m.cols) }));
}
