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
import { atColumn, clip, COUNT_ORDER, countRuns, elapsedClock, GLYPH5, GLYPH5_ASCII, meter, padEnd, PALETTES, percent, rail, leadSpinnerGlyph, rowWordTone, spinFrameOf, spinnerGlyph, stateRun, STATE_GLYPHS, uiFromEnv, gateMark, wordmark, type Run, type Tone, type Ui, type UiState } from './atlas-ui';
import { animateRow, BAND_OPTS, reducedMotion, type MotionCtx, type MotionItem } from './motion';
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
/** `agoSecs`: for a done or failed worker, seconds since it ended (snapshot.now less its stamped finish); absent reads as just ended. */
export type MissionWorker = { name: string; role?: string; state: WorkerState; tool?: string; target?: string; secs: number; agoSecs?: number };
export type MissionNote = { from: string; to: string; text: string; at?: string; kind?: string };
/** Presence and system events (a worker joining or leaving, a worktree merge) are not messages: the message row shows
 * the newest comm whose kind is not one of these (`say`, `dispatch`, `report`, or a kind the source does not state). */
const NOT_MESSAGE = new Set(['join', 'leave', 'exit', 'merge']);
export const isMessageKind = (kind?: string): boolean => !kind || !NOT_MESSAGE.has(kind);
/** `name`: what a failing check is called in the blocked reason (the failing line's own words, `team gate`); the id when absent. */
export type MissionCheck = { id: string; ok: boolean; name?: string; /** Only Stop decides it: drawn `◇`, counted as not failing. */ pending?: boolean };
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
  /** The gates that refused the session's last Stop (the completion gate's verdict, mod/data/runstate.ts); absent or empty: Stop did not block. Only this, or the lead's own declaration, makes the band BLOCKED. */
  stopGates?: readonly string[];
  done: number;
  total: number;
  /** Plan items in the blocked state (the board's rule: its own status, or a waiting owner). Shown beside the todo count with its own glyph, so a blocked task never hides. */
  todoBlocked?: number;
  /** Stop's open-item count (openWork, mod/data/core.ts). Open rows beyond the plan's own (dispatch rows the plan does not list) show as `· n open`, so `todo 5/5` never reads as all done while Stop would refuse. */
  openWork?: number;
  /** Of Stop's open rows, how many are dispatch rows: the extra open rows beyond the plan read `n dispatch open` when they all are. */
  openDispatch?: number;
  /** The title of the first open dispatch row: a blocked band names it in its reason (`blocked: dispatch read ghost.py open`) and leaves the todo figure at the plan's own count. */
  openDispatchTitle?: string;
  /** The lead is mid-turn: its own tool runs or it is thinking (data/runstate leadBusy), or a plan row is running (planBusy, the HUD's TODO rule), though no worker is listed. The band never reads `idle` then. */
  busy?: boolean;
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
  /** The HUD's Subagents block lists the workers: the band keeps the counts and draws its worker rows only in the rows the HUD left spare (compact rows, `G name state  detail time`, one worker per row; critique 19 Band 3). */
  workersInHud?: boolean;
  /** Measure the band without those compact worker rows: what the HUD may reclaim (bandSpareRows) never counts the rows a worker would fill. */
  noWorkerRows?: boolean;
  /** Gauge values on screen while a figure glides (0..1); the labels keep the true figures. Absent: the figure itself. */
  eased?: { todo?: number; ctx?: number };
  /** Motion view (mod/motion.ts): a count that changed is drawn mid-transition. Absent: the resting render. */
  motion?: MotionCtx | undefined;
  /** Seconds the turn has been working (the host's turn clock, ticked each second): the `0:42` after `working`. Absent: the oldest running worker's age. */
  turnSecs?: number;
  /** Seconds the last run took: the `1:12` after `done` and `last run`. Frozen when the run ends, never reset. Absent: the last wave's. */
  ranSecs?: number;
  /** Seconds Atlas has been at rest since the last run ended: from IDLE_AFTER_SECS a finished band reads `idle . last run 1:08`, not `done`. Absent: just finished. */
  restSecs?: number;
  /** Failed workers whose dispatch row is closed (the work was finished another way): the band draws them as a dim `● n closed`, not as `■ n failed`. */
  closed?: number;
  /** No wordmark sweep (ATLAS_REDUCED_MOTION, NO_COLOR); the spinner frames still step. Absent: read from the environment. */
  still?: boolean;
};

const MID = 80; // below this, only the band
const NAME_MAX = 18;
const TIME_W = 7;

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
/** Of those, the ones whose dispatch row was closed: no longer a failure to act on (round 3: `■ 1 failed` stayed red after the row closed). */
const closedCount = (m: MissionModel): number => Math.min(Math.max(0, m.closed ?? 0), failedCount(m));

/** Agent counts by state, in the order the band shows them; zero counts are left out. `words`: `◐ 1 running`; otherwise glyph and
 * number (`◐1`), where queued gives way. `noun`: the basis, `agents`, in front (the todo count is tasks; the two are never mixed). */
const countOf = (m: MissionModel, s: UiState): number => (s === 'failed' ? failedCount(m) - closedCount(m) : m.workers.filter((w) => uiStateOf(w.state) === s).length);
/** What the Motion observes of the band: each state's agent count, so a count that moves is drawn mid-transition. */
export const bandMotionItems = (m: MissionModel): MotionItem[] => COUNT_ORDER.map((s): MotionItem => ({ key: `count:${s}`, state: String(countOf(m, s)) }));

/** The spinner frame of a state's count: the running count turns the frame of the worker listed first (the HUD and the panel turn spinFrameOf(clock, name) for that same row, critique 19: `◒` in the band against `◐` in the HUD); the local tick otherwise. */
function countFrame(m: MissionModel, s: UiState): number {
  const first = s === 'running' && m.now !== undefined ? byAttention(m.workers).find((w) => uiStateOf(w.state) === 'running') : undefined;
  return first && m.now !== undefined ? spinFrameOf(m.now, first.name) : m.tick;
}

function bandCounts(m: MissionModel, ui: Ui, words: boolean, noun = false, gap = '   ', queued = true): Run[] {
  const n = (s: UiState): number => countOf(m, s);
  const order = COUNT_ORDER.filter((s) => (words ? s === 'running' || s === 'failed' || (s === 'queued' && queued) || s === 'waiting' : s === 'running' || s === 'failed' || s === 'waiting'));
  const closed = closedCount(m);
  const closedRuns: Run[] = [{ t: ui.ascii ? `${GLYPH5_ASCII.done} ` : `${STATE_GLYPHS.done} `, tone: 'dim' }, r(`${closed} closed`, 'dim')]; // a closed failure is a dim record, never the red mark
  const parts = order.flatMap((s): Run[][] => [
    ...(n(s) > 0 ? [animateRow(words ? countRuns(s, n(s), ui, countFrame(m, s)) : [stateRun(s, ui, countFrame(m, s)), r(`${n(s)}`)], `count:${s}`, s, m.motion, ui, BAND_OPTS)] : []),
    ...(s === 'failed' && words && closed > 0 ? [closedRuns] : []),
  ]);
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

/** ` · 1 open`: the store's open rows the plan count does not carry; empty when the plan's own open rows cover them. */
const openMore = (m: MissionModel): string => {
  const n = (m.openWork ?? 0) - (m.total - m.done);
  if (!m.total || n <= 0) return '';
  if (m.openDispatchTitle && (m.openDispatch ?? 0) >= n && (m.blocked || (m.stopGates?.length ?? 0) > 0)) return ''; // a blocked band names the row in its reason
  // An open dispatch row of a worker that is listed running is that worker: `1 dispatch open` beside `◐ 1 running` said one fact twice (critique 12 B4, f0061). The agent count carries it.
  if ((m.openDispatch ?? 0) >= n && n <= m.workers.filter((w) => w.state !== 'done' && w.state !== 'failed').length) return '';
  return (m.openDispatch ?? 0) >= n ? ` · ${n} ${n === 1 ? 'dispatch' : 'dispatches'} open` : ` · ${n} open`; // an open dispatch row is named: Stop refuses on it though the plan reads full
};
/** The todo figure: the plan's own `n/m`, the count the TODO header, the route and the board give (critique 16 A1: `todo 5/6` beside a TODO header of `5/5` invented a sixth row).
 * Open rows the plan does not list never join the denominator: a blocked band names the open dispatch row in its reason, an unblocked one beside the figure (`openMore`). */
function figure(m: MissionModel): { done: number; total: number } {
  return { done: m.done, total: m.total };
}
/** The band's progress meter is the shared `▰▱` one (HUD and board draw it too); fill in info over a muted track keeps the old gauge's colours and the 3:1 glyph contrast. */
const bandMeter = (w: number, v: number, ui: Ui): Run[] => meter(w, v, ui).map((x): Run => ({ ...x, tone: x.tone === 'accent' ? 'info' : 'muted' }));
const todoGauge = (m: MissionModel, ui: Ui, w: number): Run[] => { const f = figure(m); return bandMeter(w, m.eased?.todo ?? (f.total ? Math.min(1, f.done / f.total) : 0), ui); };
const ctxBar = (m: MissionModel, ui: Ui, w: number): Run[] => bandMeter(w, m.eased?.ctx ?? m.ctx ?? 0, ui);

/** The one figures-and-` · ` band form (phase word, todo, ctx, counts) starts here: below a docked 150-column terminal's transcript (93), so 110 and 150 read alike. A form also has to fit. */
const STD_MIN = 90;
/** The gauge forms need this much: between STD_MIN and here the band carries the same facts as figures. */
const GAUGE_MIN = 120;
/** The widest the core row and the last run may be together to share one row: the docked 150-column transcript is 93 wide, one cell spare. */
const JOIN_MAX = 92;

/** A finished band reads `done` for this long, then rests as `idle . last run 1:08`. */
export const IDLE_AFTER_SECS = 30;

/** The one run state every form below reads. `blocked`: the lead declared it, or the Stop gate refused the stop (never inferred from a failing check alone).
 * `warn`: idle while a check fails and Stop did not refuse (`2 gates to check`). `flagged`: either, the band's attention state. */
export type BandKind = 'working' | 'idle' | 'done' | 'blocked';
/** `2 gates to check`, `1 gate to check`: a failing gate is something to look at, never a block and never the lead. */
const gatesToCheck = (failing: readonly string[]): string => `${failing.length} ${failing.length === 1 ? 'gate' : 'gates'} to check`;
export function runStateOf(m: MissionModel): { blocked: boolean; warn?: string; flagged: boolean; idle: boolean; kind: BandKind; reason: { long: string; short: string } } {
  const stopGates = m.stopGates ?? [];
  const blocked = !!m.blocked || stopGates.length > 0;
  const quiet = !blocked && !isRunning(m) && !m.busy;
  const failing = (m.checks ?? []).filter((c) => !c.ok).map((c) => c.name ?? c.id);
  // Idle in every way but a failing check: a warning, not a block. A band that still says `done` with a check failing warns too (critique 14: `done` beside an amber triangle).
  const warn = !blocked && failing.length > 0 && (quiet || m.phase === 'done') ? gatesToCheck(failing) : undefined;
  // The reason is read against the figure beside it (critique 18 A1): a plan that reads n/n never sits beside `1 todo open`.
  const now = { allDone: m.total > 0 && m.done >= m.total, openLeft: Math.max(0, (m.openWork ?? 0) - (m.total - m.done)) };
  // The state the band leads with: blocked (the lead or Stop says so), working (a turn, a worker or a running plan row), done (the plan is full and nothing runs, for IDLE_AFTER_SECS), else idle.
  // A gate warning never leads (round 3): it rides the tail of a done, idle or working band (`warn`).
  const finished = m.phase === 'done' || (m.total > 0 && m.done >= m.total);
  const kind: BandKind = blocked ? 'blocked' : !quiet ? 'working' : finished && (m.restSecs ?? 0) < IDLE_AFTER_SECS ? 'done' : 'idle';
  return { blocked, ...(warn ? { warn } : {}), flagged: blocked || !!warn, idle: quiet && !warn, kind, reason: blockReasons(!!m.blocked, stopGates, m.openDispatchTitle, now) };
}

/** The spinner frame the band turns: the shared clock (the HUD, the panel and the counts turn the same one), else the local tick. */
const bandFrame = (m: MissionModel): number => (m.now === undefined ? m.tick : spinFrameOf(m.now));

/** The wordmark ribbon `◖ ◆ ATLAS ◗`, once, at the left end of the band. A solid chip in every state (round 3: the inverted-letter shimmer read as a stray cursor); motion comes from the spinner alone. */
function ribbonOf(_m: MissionModel, ui: Ui, _kind: BandKind): Run[] {
  return wordmark(ui);
}

/** What a blocked band needs, in the lead's words: `dispatch T2 read ghost.py open` reads `needs: close dispatch T2` (`needs: close T2` short, `close T2` bare);
 * `retry stop` is the spinner word `retrying` (leadRuns draws it), not a need; other reasons stay as the gates word them. */
export function needsOf(reason: string, form: 'long' | 'short' | 'bare' = 'long'): string {
  const open = /^dispatch (\S.*?) open$/.exec(reason);
  if (open) {
    const id = /^T\d+\b/.exec(open[1]!)?.[0] ?? open[1]!;
    return form === 'long' ? `needs: close dispatch ${id}` : form === 'short' ? `needs: close ${id}` : `close ${id}`;
  }
  return reason === 'retry stop' ? 'retrying' : reason;
}

/** The warn tail of a quiet or working band: ` . △ 2 gates to check` (amber 179, never the lead); `short`: ` . △ 2 gates`. */
const warnSeg = (ui: Ui, st: ReturnType<typeof runStateOf>, form: 'long' | 'short' = 'long'): Run[] => (st.warn ? [r(' · ', 'sub'), gateMark(ui), r(` ${form === 'long' ? st.warn : st.warn.replace(/ to check$/, '')}`, 'warn')] : []);

/** How much of the lead a form keeps: the clock or last run, the blocked reason (`long`, `short`, `bare`, or none) and the moving `fixing`. */
type LeadOpts = { clock: boolean; reason: 'long' | 'short' | 'bare' | 'none'; fix: boolean };
const LEAD_FULL: LeadOpts = { clock: true, reason: 'long', fix: true };

/** The state the band leads with, by glyph AND word (never colour alone), four states on the one spinner clock:
 * working `◐ working 0:42` (accent spinner, bold 252 word, quiet clock); done `● done . 1:08` (ok, bold, the final duration frozen);
 * idle `○ idle . last run 1:08` (245, after IDLE_AFTER_SECS at rest); blocked `▲ blocked . needs: close dispatch T2 . ◐ fixing` (bold 203; `. ◐ retrying` when Stop is retried).
 * The todo figure is its own segment (standardForms), so no count is said twice. */
function leadRuns(m: MissionModel, ui: Ui, st: ReturnType<typeof runStateOf>, reason: string | undefined, o: LeadOpts): Run[] {
  const mark = (glyph: string, tone: Tone, bold = false): Run => ({ t: glyph, tone: ui.ascii ? 'text' : tone, ...(bold ? { bold: true } : {}) });
  const spin = (): Run => mark(leadSpinnerGlyph(bandFrame(m), ui.ascii), 'accent');
  const ran = m.ranSecs ?? m.lastRun?.secs; // the run clock's own figure (the host's wall time of the run); the worker wave's span only where no clock ran (omp)
  switch (st.kind) {
    case 'working': return [spin(), r(' '), r('working', 'text', true), ...(o.clock && (m.turnSecs ?? m.elapsedSecs) !== undefined ? [r(` ${elapsedClock((m.turnSecs ?? m.elapsedSecs)!)}`, 'sub')] : [])];
    case 'done': return [mark(ui.ascii ? GLYPH5_ASCII.done : STATE_GLYPHS.done, 'ok', true), r(' '), r('done', 'ok', true), ...(o.clock && ran !== undefined ? [r(` · ${elapsedClock(ran)}`, 'sub')] : [])];
    case 'idle': return [mark(ui.ascii ? GLYPH5_ASCII.idle : GLYPH5.idle, 'muted'), r(' '), r('idle', 'muted'), ...(o.clock && ran !== undefined ? [r(` · last run ${elapsedClock(ran)}`, 'muted')] : [])];
    case 'blocked': {
      const why = reason && o.reason !== 'none' ? needsOf(reason, o.reason) : '';
      const retrying = why === 'retrying';
      return [
        mark(ui.ascii ? GLYPH5_ASCII.blocked : GLYPH5.blocked, 'bad', true), r(' blocked', 'bad', true),
        ...(why && !retrying ? [r(` · ${why}`, 'bad', true)] : []),
        ...(retrying ? [r(' · ', 'bad', true), spin(), r(' retrying', 'text')] : (m.busy || isRunning(m)) && o.fix ? [r(' · ', 'bad', true), spin(), r(' fixing', 'text')] : []), // `fixing` only while the host turn or a worker runs; a host waiting on the person reads `blocked · needs you` and nothing moves
      ];
    }
  }
}

type Form = { runs: Run[]; min: number };

/** The standard forms, widest first. Segments in this order: the lead (state glyph, word, clock), `todo n/m`, the blocked tasks, the agent counts, the gate warning, ctx.
 * `todo n/m` is the band's one progress fact and survives every width and state (round 3: at 110 it fell off behind a long lead); a narrower row drops the other segments
 * first: ctx, the open-row note, the queued count, the long warning, the blocked count, then shortens the lead (reason, clock). */
function standardForms(m: MissionModel, ui: Ui): Form[] {
  const idx = phaseIndex(m);
  const n = m.phases.length;
  const phaseNo = `${Math.min(idx + 1, n)}/${n}`;
  const st = runStateOf(m);
  const { reason } = st;
  const cap = ribbonOf(m, ui, st.kind);
  const fig = figure(m);
  const glue: Run = r(' · ', 'sub'); // critique 18 A3: always a middle dot between segments
  const blockedWords = blockedRuns(m, ui, true);
  const lead = (o: LeadOpts): Run[] => leadRuns(m, ui, st, reason.long, o);
  // `phase n/m` only when no plan carries the progress (the lead's reply header and the plan's done count are two clocks).
  const todoSeg = (open: boolean): Run[] => (m.total ? [glue, r(`todo ${fig.done}/${fig.total}${open ? openMore(m) : ''}`, 'sub')] : [glue, r(`phase ${phaseNo}`, 'sub')]);
  const ctxSeg: Run[] = m.ctx !== undefined ? [glue, r('ctx '), r(percent(m.ctx), 'sub')] : [];
  type CtxMode = 'gauge' | 'text' | 'none';
  type CountMode = 'words' | 'tiny' | 'none';
  // The gauge forms drop their segments in the one order: ctx, then the agent counts, and the meter last (it becomes the `todo n/m` text in the row forms below).
  const wide = (noun: boolean, ctxMode: CtxMode, gap: string, gw = 10, countMode: CountMode = 'words'): Run[] => {
    const counts = countMode === 'none' ? [] : countMode === 'tiny' ? bandCounts(m, ui, false) : bandCounts(m, ui, true, noun, gap);
    return [
      ...cap, r('  '), ...lead(LEAD_FULL),
      ...(m.total ? [r(gap), r('todo '), ...todoGauge(m, ui, gw), r(` ${fig.done}/${fig.total}${openMore(m)}`, 'sub'), ...(blockedWords.length ? [glue, ...blockedWords] : [])] : [r(gap), r(`phase ${phaseNo}`, 'sub')]),
      ...(m.ctx !== undefined && ctxMode !== 'none' ? [r(gap), r('ctx '), ...(ctxMode === 'gauge' ? [...ctxBar(m, ui, 8), r(' ')] : []), r(percent(m.ctx), 'sub')] : []),
      ...(counts.length ? [r(gap), ...counts] : []),
      ...warnSeg(ui, st),
    ];
  };
  const stdCounts = bandCounts(m, ui, true, false, ' · ');
  const noQueued = bandCounts(m, ui, true, false, ' · ', false);
  const tiny = bandCounts(m, ui, false);
  const tail = (cs: Run[]): Run[] => (cs.length ? [glue, ...cs] : []);
  type Lv = { o: LeadOpts; open: boolean; bw: boolean; counts: 'words' | 'noq' | 'tiny' | 'none'; warn: 'long' | 'short' | 'none'; ctx: boolean };
  const row = (v: Lv): Form => ({
    min: 0,
    runs: [...cap, r(' '), ...lead(v.o), ...todoSeg(v.open), ...(v.bw && blockedWords.length ? [glue, ...blockedWords] : []), ...tail(v.counts === 'words' ? stdCounts : v.counts === 'noq' ? noQueued : v.counts === 'tiny' ? tiny : []), ...(v.warn === 'none' ? [] : warnSeg(ui, st, v.warn)), ...(v.ctx ? ctxSeg : [])],
  });
  const F = LEAD_FULL;
  const levels: Lv[] = [
    { o: F, open: true, bw: true, counts: 'words', warn: 'long', ctx: true },
    { o: F, open: true, bw: true, counts: 'words', warn: 'long', ctx: false },
    { o: F, open: false, bw: true, counts: 'words', warn: 'long', ctx: false },
    { o: F, open: false, bw: true, counts: 'noq', warn: 'long', ctx: false },
    { o: F, open: false, bw: true, counts: 'noq', warn: 'short', ctx: false },
    { o: F, open: false, bw: true, counts: 'words', warn: 'none', ctx: false },
    { o: F, open: false, bw: true, counts: 'noq', warn: 'none', ctx: false },
    { o: F, open: false, bw: false, counts: 'words', warn: 'none', ctx: false },
    { o: F, open: false, bw: false, counts: 'tiny', warn: 'short', ctx: false },
    { o: F, open: false, bw: false, counts: 'tiny', warn: 'none', ctx: false },
    // the lead gets shorter: the short reason, then the bare reason, then no `fixing`, no clock, no reason
    { o: { ...F, reason: 'short' }, open: false, bw: false, counts: 'tiny', warn: 'none', ctx: false },
    { o: { ...F, reason: 'short' }, open: false, bw: false, counts: 'none', warn: 'none', ctx: false },
    { o: { ...F, reason: 'bare' }, open: false, bw: false, counts: 'tiny', warn: 'none', ctx: false },
    { o: { ...F, reason: 'bare' }, open: false, bw: false, counts: 'none', warn: 'none', ctx: false },
    // the reason text goes before the spinner does: a band that is working, fixing or retrying keeps its spinner at every width the lead fits
    { o: { clock: true, reason: 'none', fix: true }, open: false, bw: false, counts: 'none', warn: 'none', ctx: false },
    { o: { clock: false, reason: 'none', fix: true }, open: false, bw: false, counts: 'none', warn: 'none', ctx: false },
    { o: { clock: false, reason: 'none', fix: false }, open: false, bw: false, counts: 'none', warn: 'none', ctx: false },
  ];
  const out: Form[] = [
    { runs: wide(true, 'gauge', '   '), min: GAUGE_MIN }, { runs: wide(true, 'text', '  ', 8), min: GAUGE_MIN },
    { runs: wide(false, 'gauge', '   '), min: GAUGE_MIN }, { runs: wide(false, 'text', '  ', 8), min: GAUGE_MIN },
    { runs: wide(false, 'none', '  ', 8), min: GAUGE_MIN }, { runs: wide(false, 'none', '  ', 8, 'tiny'), min: GAUGE_MIN }, { runs: wide(false, 'none', '  ', 8, 'none'), min: GAUGE_MIN },
    ...levels.map(row),
    // the last resorts: the chip and the todo figure, then the chip alone
    { runs: [...cap, r(' '), ...(m.total ? [r(`todo ${fig.done}/${fig.total}`, 'sub')] : [])], min: 0 },
    { runs: [...cap], min: 0 },
  ];
  return out;
}

/** The rich band: the capsule and the numbered phase rail, a blank row, then the todo and ctx gauges and the counts. */
function richBand(m: MissionModel, ui: Ui): Line[] {
  const st = runStateOf(m);
  const { reason } = st;
  const head: Run[] = [...ribbonOf(m, ui, st.kind), r('  '), ...leadRuns(m, ui, st, reason.long, LEAD_FULL), ...warnSeg(ui, st), r('   '), ...rail(m.phases, phaseIndex(m), ui)];
  const todo: Run[] = m.total ? [r('todo ', 'muted'), ...todoGauge(m, ui, 16), r(` ${figure(m).done}/${figure(m).total} · ${percent(figure(m).done / figure(m).total)}${openMore(m)}`, 'sub')] : [];
  const ctx: Run[] = m.ctx !== undefined ? [r('ctx ', 'muted'), ...ctxBar(m, ui, 10), r(` ${percent(m.ctx)}`, 'sub')] : [];
  const counts = bandCounts(m, ui, true, true);
  const blocked = blockedRuns(m, ui, true);
  const to = (row: Run[], col: number): Run[] => (row.length ? atColumn(row, col) : [r(' '.repeat(col))]);
  const todoRow = [...todo, ...(todo.length && blocked.length ? [r(' · ', 'sub'), ...blocked] : [])]; // a middle dot between segments (critique 18 A3)
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

/** The name column of the worker rows: the longest name up to NAME_MAX (at least 8). */
function workerNameW(m: MissionModel): number {
  return Math.min(NAME_MAX, Math.max(8, ...m.workers.map((w) => textWidth(w.name))));
}

/** One worker row, `G name  state  last  time` (compactLine): the form the capture scorer reads, with or without the HUD's Subagents block. */
function workerLine(w: MissionWorker, m: MissionModel, nameW: number): Line {
  return compactLine(w, m, nameW);
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

// ---- compact worker rows (the HUD lists the workers) ------------------------------------

/** Narrowest band that draws a compact worker row. */
const COMPACT_MIN = 40;
/** The state word column: `running` and two cells, so the detail never touches the word. */
const WORD_W = 9;
/** A worker that ended this recently takes a row first, so its `done` or `failed` row is seen. */
const PIN_SECS = 4;
/** With fewer rows than workers the rows turn through the workers on the shared clock (snapshot.now), one step per this many ms. */
const ROTATE_MS = 2000;
const endedState = (w: MissionWorker): boolean => w.state === 'done' || w.state === 'failed';

/** `k` of `list`, starting where the shared clock points: every entry gets its turn when the rows are fewer than the workers. */
function turn<T>(list: readonly T[], k: number, clockMs: number): T[] {
  if (list.length <= k) return [...list];
  const start = (Math.floor(clockMs / ROTATE_MS) * k) % list.length;
  return Array.from({ length: k }, (_, i) => list[(start + i) % list.length]!);
}

/** The workers that take the `slots` compact rows: those that ended in the last PIN_SECS (failed first), then the live ones by attention (waiting, running, queued);
 * a worker that ended earlier takes a row only when no live worker needs it. More workers than rows: the rows turn through them. */
function compactPick(m: MissionModel, slots: number, running: boolean): MissionWorker[] {
  const clockMs = m.now ?? m.tick * 100;
  const pinned = m.workers.filter((w) => endedState(w) && (w.agoSecs ?? 0) <= PIN_SECS).sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const live = running ? byAttention(m.workers.filter((w) => !endedState(w))) : [];
  const head = turn(pinned, slots, clockMs);
  const liveRows = turn(live, slots - head.length, clockMs);
  const stale = running ? m.workers.filter((w) => endedState(w) && !pinned.includes(w)).sort((a, b) => ORDER[a.state] - ORDER[b.state]) : []; // an older failure or finish takes only a row nobody live needs
  return [...head, ...liveRows, ...stale.slice(0, Math.max(0, slots - head.length - liveRows.length))];
}

/** What the worker is doing beside its state word. */
function compactDetail(w: MissionWorker): string {
  const call = `${(w.tool ?? 'working').toLowerCase()}${w.target ? ` ${w.target}` : ''}`;
  switch (w.state) {
    case 'running': return call;
    case 'thinking': return 'thinking';
    case 'waiting': return w.target ?? '';
    case 'failed': return w.tool ? 'killed' : ''; // stopped mid-call: the HUD's LAST says the same
    case 'done': return `${w.role ?? 'agent'} finished`;
    case 'queued': return '';
  }
}

/** `G name  state  detail  time`: the form the scorer reads (glyph, name, lowercase state word, two or more cells, the rest). */
function compactLine(w: MissionWorker, m: MissionModel, nameW: number): Line {
  const ui = uiOf(m);
  const st = uiStateOf(w.state);
  const ended = endedState(w);
  const head = [r(' '), mark(w, m, ui), r(' '), r(padTo(w.name, nameW) + ' ', ended ? 'sub' : 'text', !ended), r(padTo(st, WORD_W), rowWordTone(st), st === 'failed')];
  const time = r(clip(clock(w.secs), TIME_W - 1).padStart(TIME_W - 1) + ' ', 'sub');
  const room = Math.max(0, m.cols - runsWidth(head) - TIME_W);
  return { runs: [...head, ...fitRuns([r(compactDetail(w), 'sub')], room), time] };
}

/** The compact rows that follow the band's own row while the HUD lists the workers: `band` the rows they sit under, `rows` the worker rows, `after` what a running band keeps beneath them (the message, the footer);
 * null when this model draws none (no workers to name, no room, a board slot or a narrow band). */
function hudWorkerRows(m: MissionModel, running: boolean): { band: Line[]; rows: Line[]; after: Line[] } | null {
  if (!m.workersInHud || m.noWorkerRows || m.cols < COMPACT_MIN || m.maxRows < 2 || (m.boardRows && m.maxRows - 1 >= 4)) return null; // a board slot that fits (runningLines gives it 4 rows or more) keeps the old layout; a tight band has no slot for it
  const band = bandLines({ ...m, rich: false });
  const foot = footerLines(m);
  // The message and the footer keep the rows the counts-only band gave them (planRows with no workers); the worker rows take what is left, in place of the breathing blanks.
  const plan = running ? planRows(m.maxRows - (band.length - 2), 0, !!m.note, foot.length) : { ticker: false, footerRows: 0 };
  const extras: Line[] = plan.ticker && m.note ? [noteLine(m.note, m.cols)] : [];
  const tail: Line[] = foot.slice(foot.length - plan.footerRows);
  const slots = m.maxRows - band.length - extras.length - tail.length;
  if (slots < 1) return null;
  const picked = compactPick(m, slots, running);
  if (!picked.length) return null;
  const nameW = Math.max(6, Math.min(NAME_MAX, Math.max(...picked.map((w) => textWidth(w.name))), m.cols - 28));
  const rows = picked.map((w) => compactLine(w, m, nameW));
  return { band, rows, after: [...(slots - rows.length >= 1 && extras.length ? [blank(m.cols)] : []), ...extras, ...tail] };
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

/** `checks  ● completion  ■ tripwire  ● routing  2/3 green`; when that does not fit, `checks  ■ tripwire  2/3 green` (failures only) or
 * `checks  ● 3/3 green`. The figure is the gates tab's own `n/m green`. Failing names take the text tone so they stand out; passing names stay muted. */
function checkRuns(checks: readonly MissionCheck[] | null, room: number, ui: Ui, hint = 0): Run[] {
  const lean = hint > 0 ? checkRuns(checks, room - hint, ui) : []; // the form that leaves the hint its room, when one fits
  if (lean.length) return lean;
  if (!checks?.length) return [];
  const one = (c: MissionCheck): Run[] => [c.pending ? stateRun('queued', ui) : c.ok ? stateRun('done', ui) : gateMark(ui), r(` ${c.id}`, c.ok ? 'sub' : 'text')];
  const join = (cs: readonly MissionCheck[]): Run[] => cs.flatMap((c, i) => [...(i ? [r('  ')] : []), ...one(c)]);
  const failing = checks.filter((c) => !c.ok);
  // Critique 18 A2: the figure counts the green marks drawn: a pending check (`◇`) and a failing one (`▲`) are not green.
  const attention = checks.filter((c) => !c.ok || c.pending);
  const green = `${checks.length - attention.length}/${checks.length} green`;
  const forms: Run[][] = [
    [...join(checks), r(`  ${green}`, 'sub')],
    join(checks), // tight: the names and marks carry the figure
    attention.length ? [...join(attention), r(`  ${green}`, 'sub')] : [stateRun('done', ui), r(` ${green}`, 'sub')],
    failing.length ? [gateMark(ui), r(` ${plural(failing.length, 'warning')}`, 'text')] : [stateRun('done', ui)],
  ];
  const label = [r(' checks  ', 'muted')];
  for (const f of forms) if (runsWidth(label) + runsWidth(f) <= room) return [...label, ...f];
  return [];
}

/** The footer rows: the `checks` row and the key buttons' row, each on its own row when both show (the buttons are flush right, the band
 * pads their gap itself). Fewer rows when only one has content; none when neither. */
function footerLines(m: MissionModel): Line[] {
  const keys = m.keysWidth ?? 0;
  const checks = checkRuns(m.checks, m.cols, uiOf(m));
  return [...(checks.length ? [{ runs: fitRuns(checks, m.cols) }] : []), ...(keys > 0 ? [{ runs: [], keys: true }] : [])];
}

// ---- row budget -----------------------------------------------------------------------

/** Whether the message and footer stay: drop the message first, then the footer, until `need` worker rows fit. */
function chrome(room: number, need: number, hasNote: boolean, footRows: number): [boolean, number] {
  const tries: [boolean, number][] = [[hasNote, footRows], [false, footRows], ...(footRows > 1 ? [[false, footRows - 1] as [boolean, number]] : []), [false, 0]]; // two footer rows give way to one (the key row), then none
  for (const [n, f] of tries) if (room - +n - f >= need) return [n, f];
  return [false, 0];
}

/** How many worker rows, message and footer rows fit `maxRows` (two head rows are fixed). Hidden workers
 * outrank the message: it gives way to the "+N more" row. */
export function planRows(maxRows: number, nWorkers: number, hasNote: boolean, hasFooter: boolean | number = true): { lanes: number; ticker: boolean; footer: boolean; footerRows: number; more: boolean } {
  const room = Math.max(0, maxRows - 2);
  const [kept, footerRows] = chrome(room, Math.min(1, nWorkers), hasNote, Number(hasFooter));
  const slotsWith = room - +kept - footerRows;
  const ticker = kept && !(nWorkers > slotsWith && slotsWith < 2);
  const slots = room - +ticker - footerRows;
  const more = nWorkers > slots && slots >= 2;
  return { lanes: more ? slots - 1 : Math.min(nWorkers, slots), ticker, footer: footerRows > 0, footerRows, more };
}

/** Workers that need attention sort first (failed, waiting), then running, thinking, queued, finished. */
const ORDER: Record<WorkerState, number> = { failed: 0, waiting: 1, running: 2, thinking: 3, queued: 4, done: 5 };
const byAttention = (ws: readonly MissionWorker[]): MissionWorker[] => ws.map((w, i) => [w, i] as const).sort((a, b) => ORDER[a[0].state] - ORDER[b[0].state] || a[1] - b[1]).map(([w]) => w);

const blank = (cols: number): Line => ({ runs: [r(' '.repeat(cols))] });

function idleLines(m: MissionModel): Line[] {
  const band = bandLines(m);
  const last = lastRunRuns(m.lastRun, runStateOf(m).flagged || (m.checks ?? []).some((c) => !c.ok)); // `all ok` never sits under a BLOCKED header, nor beside a failing check, busy lead or not
  const foot = footerLines(m);
  // The last run rides the core row when both fit one row (`verdicts ... last run 3 workers`), so a 110 and a 150 band draw the same rows (critique 11: 110 had no last-run row).
  // "Fit" is a fixed width (JOIN_MAX), not `cols`: the 110 body (105) and the docked 150 body (93) joined or split the same snapshot differently (critique 12 A3).
  const joinW = m.core?.length && last.length ? runsWidth(m.core) + 3 + runsWidth(last) : Infinity;
  const joined: Run[] = joinW <= Math.min(JOIN_MAX, m.cols) ? [...(m.core ?? []), r('   '), ...last] : [];
  const plan = (withLast: boolean) => {
    const lastRow: Line[] = withLast && !joined.length && last.length && m.maxRows > band.length ? [{ runs: last }] : [];
    const head = [...band, ...lastRow];
    const footRows = foot.length && m.maxRows >= head.length + 1 ? Math.min(foot.length, m.maxRows - head.length) : 0;  // two footer rows when both show; the key row outlasts the checks row
    const core = m.core?.length && m.maxRows >= head.length + 1 + footRows ? [{ runs: fitRuns(withLast && joined.length ? joined : m.core, m.cols) }] : [];
    return { head, footRows, core };
  };
  // The contract row outranks the last-run row: when only one fits, the band keeps the same rows at every width (critique 9, the 110 band had no contract row).
  let { head, footRows, core } = plan(true);
  if (m.core?.length && !core.length) ({ head, footRows, core } = plan(false));
  const room = m.maxRows - head.length - core.length - footRows;
  const board = m.boardRows && room >= 1 ? [{ runs: [], board: Math.min(m.boardRows, room) }] : [];
  return [...head, ...core, ...board, ...foot.slice(foot.length - footRows)];
}

function runningLines(m: MissionModel): Line[] {
  const shown = m.workersInHud ? [] : byAttention(m.workers); // the HUD's Subagents block lists them; the band keeps the counts
  const foot = footerLines(m);
  const band = bandLines(m);
  const boardWant = m.boardRows ?? 0;
  const board = boardWant && m.maxRows - band.length >= 4 ? Math.min(boardWant, m.maxRows - band.length - 3) : 0; // keep a worker, the message and the footer
  const plan = planRows(m.maxRows - board - (band.length - 2), shown.length, !!m.note, foot.length);
  const nameW = workerNameW(m);
  const head: Line[] = [...band, ...(board ? [{ runs: [], board }] : [])];
  const rows: Line[] = shown.slice(0, plan.lanes).map((w) => workerLine(w, m, nameW));
  const extras: Line[] = [...(plan.more ? [moreLine(shown.slice(plan.lanes), m.cols)] : []), ...(plan.ticker && m.note ? [noteLine(m.note, m.cols)] : [])];
  const tail: Line[] = foot.slice(foot.length - plan.footerRows); // the key row outlasts the checks row
  // Spare rows breathe: one blank under the band, then one between the workers and the message; the first to go.
  const spare = m.maxRows - (head.length - (board ? 1 : 0) + board) - rows.length - extras.length - tail.length;
  return [...head, ...(spare >= 1 ? [blank(m.cols)] : []), ...rows, ...(spare >= 2 && extras.length ? [blank(m.cols)] : []), ...extras, ...tail];
}

/** Mission Control rows for `m`, at most `maxRows`, each exactly `cols` cells (board slots aside). Below 80 columns
 * (or three rows, running) only the band shows. */
export function missionLines(m: MissionModel): Line[] {
  if (m.maxRows < 1) return [];
  const running = isRunning(m);
  const hud = hudWorkerRows(m, running);
  if (hud) {
    // The worker rows sit directly under the band row (no breathing blank between them); an idle band keeps its core row and footer under them.
    const lines = running || m.cols < MID ? [...hud.band, ...hud.rows, ...hud.after] : (() => { const idle = idleLines({ ...m, rich: false }); return [...idle.slice(0, hud.band.length), ...hud.rows, ...idle.slice(hud.band.length)]; })();
    let used = 0;
    return lines.filter((l) => (used += l.board ?? 1) <= m.maxRows).map((l) => (l.board || l.keys ? l : { ...l, runs: fitRuns(l.runs, m.cols) }));
  }
  if ((running && (m.cols < MID || m.maxRows < 3)) || (!running && m.cols < MID)) return bandLines({ ...m, rich: false });
  const lines = running ? runningLines(m) : idleLines(m);
  let used = 0;
  const kept = lines.filter((l) => (used += l.board ?? 1) <= m.maxRows); // a board slot counts as the rows it holds
  return kept.map((l) => (l.board || l.keys ? l : { ...l, runs: fitRuns(l.runs, m.cols) }));
}
