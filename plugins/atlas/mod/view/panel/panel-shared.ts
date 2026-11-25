// panel-shared.ts: panel-layout split (audit 4.3, stage S14): shared types, run/line helpers, the gate group predicates and the note stamp cache every other panel module reads.
import type { ReadInfo } from '../../data/datastate';
import { type Health } from '../../data/idle-health';
import { cells, elapsedClock, GRID_LEAD, gridRow as gridRowAt, rowWordTone, spinFrameOf, stateRun, gateMark, warnMark, type MarkState, type Run, type Tone, type Ui, type UiState } from '../../design/atlas-ui';
import { animateRow, type MotionCtx } from '../../motion/motion';
import { ELLIPSIS, clipE } from '../board/board-model';
import { type CoreModel } from '../../data/core';
import { gateTally, STOP_LINE, withCoreTally } from '../../data/runstate';
import { displayName } from '../hud/hud';
import type { GateGroup } from './pane/sidebar-types';
import type { BoredView } from './bored-types';
import { ageWord, KILLED } from './pane/activity';

export type PanelTab = 'route' | 'team' | 'channel' | 'bored' | 'core';
export type PanelTodo = { id: string; label: string; state: UiState; /** The state word as drawn when it differs from `state`'s own (`returned`). */ word?: string; owner?: string; detail?: string; evidence?: string | null };
export type PanelWorker = { name: string; role?: string; state: UiState; model?: string; task?: string; /** The dispatch description (`name: what to do`): the HUD's source for the one name every surface shows (displayName). */ goal?: string; detail: string; secs?: number; /** When the worker started and when its run ended (or now), in the snapshot clock's ms: the board's Gantt places its bar by them. */ startMs?: number; endMs?: number; tools?: number; /** Start times of the worker's tool calls, in the snapshot clock's ms: the team tab's activity sparkline. */ calls?: readonly number[]; /** Wave 38 (critique 37: the side panel listed ghost, beta, alpha under SUBAGENTS' alpha, ghost, beta): the agent's place in the order it was dispatched, the HUD's own `seq` (hud.ts agentModel). */ seq?: number };
export type PanelGateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string; /** Only Stop decides it (data/runstate withPending): drawn `◇`. */ pending?: boolean };
export type PanelGate = { id: string; title: string; error?: string; lines: PanelGateLine[] };
export type PanelNote = { at: string; /** The post's time in ms, for its relative age. */ ms?: number; from: string; to?: string; kind?: string; text: string; lead?: boolean };
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
  /** Wave 34 (critique 33: every phase green at done): the rail phases the run actually entered, in the order it entered them (pane/sidebar-model enteredOf). Absent (omp, fixtures): the rail's own order decides. */
  entered?: readonly string[];
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
  /** Wave 37 (critique 36: `no events yet` after three agents finished): the workers that finished, one event each, stamped with the instant they ended. The status view's events list them with the notes; no other tab does. */
  finishes?: readonly PanelNote[];
  /** Wave 38 (critique 37: `no events yet · 0 messages` while three agents ran): the workers that started, one event each, stamped with the instant their dispatch started. */
  starts?: readonly PanelNote[];
  /** Motion view (mod/motion/motion.ts): rows with an entry are drawn mid-transition. Absent: the resting render. */
  motion?: MotionCtx | undefined;
  /** The band's own run state and run clock (wave 31): `kind` is runStateOf(band).kind, `secs` the figure the band prints (`working 0:28`, `done . 0:58`), `startMs` the run's start on the snapshot clock.
   * Present: the phase row prints exactly the band's glyph and word, and every total on the panel reads `secs`. Absent (omp, fixtures): the panel derives its own. */
  /** `frame`: the spinner frame index (0..9) the band turns for this render: the phase mark draws it, so band and panel show one glyph (truth 41). */
  run?: { kind: 'working' | 'idle' | 'done' | 'blocked'; secs?: number; startMs?: number; frame?: number };
  /** Wave 42: the idle health (register.ts builds it from the band's own inputs): an idle status view with no agent draws these rows, each a pressable row that opens 1-3 detail lines, instead of `no agents yet` and `no events yet`. Absent: the view as before. */
  health?: Health;
  /** M6: how the gate and routing figures were read (data/readinfo.ts); absent: nothing is marked err or stale. */
  read?: ReadInfo;
  /** The board view (the Claude pane's `board` tab; `tab` stays `route` for the shared chrome): the frame path draws the board in its place. */
  board?: boolean;
  /** Rows the user flipped from their default open or closed state (gate groups, workers, board items; mod/view/panel/tabs-frame.ts), kept for the session. */
  flips?: readonly string[];
  /** The bored tab's live ASCII Theater stream (slice 3 owns the view); absent: nothing connected yet. */
  bored?: BoredView;
};
/** A row a press acts on: `toggle` opens or closes `key`; `worker` also picks `name` as the message recipient; `copy` is
 * what a second press on an open row copies. */
export type Press = { kind: 'toggle' | 'worker' | 'flip' | 'compose' | 'goto'; key: string; name?: string; copy?: string };
export type PanelLine = { runs: Run[]; press?: Press };
// ---- run helpers ---------------------------------------------------------------------------------------------------

export const r = (t: string, tone: Tone = 'text', o: Partial<Run> = {}): Run => ({ t, tone, ...o });
export const line = (runs: Run[], press?: Press): PanelLine => (press ? { runs, press } : { runs });
export const BLANK: PanelLine = { runs: [] };
/** A row's runs mid-transition when the model carries a motion view (key: the row's entry; accent: the state that leads). */
export const moving = (runs: Run[], key: string, accent: MarkState, m: Pick<PanelModel, 'motion' | 'ui'>): Run[] => animateRow(runs, key, accent, m.motion, m.ui, { reveal: false }); // a new row never blanks its name while it appears (critique 26: `◒                running`)
export const rowWidth = (runs: readonly Run[]): number => runs.reduce((n, x) => n + cells(x.t), 0);
export const pad = (t: string, n: number): string => t + ' '.repeat(Math.max(0, n - cells(t)));
const cut = (t: string, n: number): string => pad(clipE(t, n), n);
/** The grammar row with every name cut at its end: a name is never cut in the middle on the panel. */
export const gridRow = (spec: Parameters<typeof gridRowAt>[0]): Run[] => {
  // Every cut is a `…` (wave 24): the name and the word are cut here, the detail's own `...` (atlas-ui gridRow) is swapped after.
  const name = { ...spec.name, t: clipE(spec.name.t, Math.max(0, spec.nameW)) };
  const word = spec.word && spec.wordW ? { ...spec.word, t: clipE(spec.word.t, spec.wordW) } : spec.word;
  // `...` is three cells and `…` one: a swapped detail keeps its width (two spaces) while a value column follows, so the right-hand column stays aligned.
  const runs = gridRowAt({ nameCut: 'end', ...spec, name, ...(word ? { word } : {}) });
  return runs.map((x, i) => (x.t.length > 3 && x.t.endsWith('...') ? { ...x, t: `${x.t.slice(0, -3)}${ELLIPSIS}${i < runs.length - 1 ? '  ' : ''}` } : x));
};
export const oneLine = (t: string | undefined | null): string => (t ?? '').replace(/\s+/g, ' ').trim();
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
export const frameOf = (m: Pick<PanelModel, 'now' | 'tick'>, id = ''): number => (m.now !== undefined ? spinFrameOf(m.now, id) : m.tick);
/** The mark of a core-tab row: a `blocked` state there is a warning (a team off plan, evidence missing, a claim no verdict backs), so it keeps the amber triangle; blocked work is the red square (critique 16 A2). */
export const coreMark = (s: UiState, ui: Ui): Run => (s === 'blocked' ? warnMark(ui) : stateRun(s, ui));
/** The state glyph of agent `id` on its row. */
/** One spinner on every row: the circle quarters the capture scorer reads by glyph on the plan rows (route tab `T1`.., GLYPH_STATE4); it reads a team row by its WORD (`\S` for the glyph), so the same marks serve the agents lines. */
/** A working mark is the accent (141) on every row of the panel, the colour of the band's own spinner (critique 28: the panel's spinners were 252). */
export const accentRun = (x: Run, s: MarkState, ui: Ui): Run => (s === 'running' && !ui.ascii ? { ...x, tone: 'accent' } : x);
export const stateMark = (s: MarkState, m: Pick<PanelModel, 'ui' | 'now' | 'tick' | 'run'>, id = ''): Run => accentRun(stateRun(s, m.ui, id === 'phase' ? spinIdx(m) : frameOf(m, id)), s, m.ui); // truth 41: the phase mark turns the frame the run was built with (the band's own index), never a reading of its own
/** The one name every surface shows for an agent (mod/view/hud/hud.ts displayName); the real name stays the key, the recipient and the spinner id. */
export const nameOf = (w: PanelWorker): string => oneLine(displayName(w.name, w.role ?? '', w.goal)) || ELLIPSIS; // a worker is never a blank cell: whole name, or `…` (critique 22: `◐ running` with no AGENT)
/** Widest name column an agent row may take: the whole name is kept, the columns after it give way (a name is never cut in the middle). */
export const nameCap = (cols: number): number => Math.max(18, Math.min(40, cols - GRID_LEAD - 2 - 7 - 6));
/** `◐ ` and friends: the state glyph run followed by a space. */
export const mark = (s: MarkState, m: Pick<PanelModel, 'ui' | 'now' | 'tick' | 'run'>, id = ''): Run => {
  const g = stateMark(s, m, id); // a working mark here is the band's spinner in 141, the same circle quarters as the per-task rows (todoRows)
  return { ...g, t: `${g.t} ` };
};
/** The gates figure, from the one definition the band uses (mod/data/runstate.ts): a group with no data is neither green nor a check. */
/** The gates as every row reads them: the header contract line comes from the core row's own tally (one evaluation). */
export const gatesOf = (m: Pick<PanelModel, 'gates' | 'core'>): readonly PanelGate[] => withCoreTally(m.gates, m.core);
export const tallyOf = (gs: readonly PanelGate[]) => gateTally(gs as unknown as readonly GateGroup[]);
/** The groups the tally counts, in their order. */
export const countedGates = (gs: readonly PanelGate[]): PanelGate[] => {
  const ids = new Set(tallyOf(gs).checks.map((c) => c.id as string));
  return gs.filter((g) => ids.has(g.id)).map((g) => (g.lines.some((l) => l.id === STOP_LINE) ? { ...g, lines: g.lines.filter((l) => l.id !== STOP_LINE) } : g)); // the Stop verdict is a record, not a gate row
};
/** Label column: one cell in (the tab indent, like the strip and the headings) and eight cells wide at every width, so `agents` keeps a blank before its figure. */
export const label = (t: string, _cols: number): Run => r(pad(` ${t}`, 8), 'muted');
export const dot = (ui: Ui): string => (ui.ascii ? '|' : '·');
export const sep = (ui: Ui): Run => r(` ${dot(ui)} `, 'muted');
export const WIDE = 100;
// ---- route ------------------------------------------------------------------------------------------------------------

export const groupOk = (g: PanelGate): boolean => !g.error && g.lines.every((l) => l.ok);
/** A group that passes but for conditions only Stop decides: `◇ pending`, neither the green mark nor the warning. */
export const groupPending = (g: PanelGate): boolean => groupOk(g) && g.lines.some((l) => l.pending);
export const groupMark = (g: PanelGate, ui: Ui): Run => (groupPending(g) ? stateRun('queued', ui) : groupOk(g) ? stateRun('done', ui) : gateMark(ui));
export const groupFailing = (g: PanelGate): number => g.lines.filter((l) => !l.ok).length;
/** The spinner index of this render, the one the stepper and the phase mark both turn: the frame the run was built with (the band's own index, register.ts paneFrame), else the clock's (`spinFrameOf(now)`, the band's spinClock reading), else the tick. */
export const spinIdx = (m: Pick<PanelModel, 'now' | 'tick' | 'run'>): number => m.run?.frame ?? (m.now !== undefined ? spinFrameOf(m.now) : m.tick);
// ---- channel ------------------------------------------------------------------------------------------------------------------

export const noteText = (m: PanelModel, n: PanelNote): string => {
  const kind = n.kind === 'blocked' || n.kind === 'failed' || n.kind === 'handoff' || n.kind === 'done';
  return `${n.to && n.to !== 'all' && !kind ? `${m.ui.ascii ? '>' : '▸'} ${n.to} ` : ''}${oneLine(n.text)}`;
};
/** A post's state: a blocked or failed one is the blocked or failed mark and says so in a word (`failed` always sits beside a `■`); a hand-off or done reads done. */
export function noteState(n: PanelNote): { state: UiState | null; word: string } {
  if (n.kind === 'failed') return { state: 'failed', word: KILLED };
  if (n.kind === 'blocked') return { state: 'blocked', word: 'blocked' };
  if (n.kind === 'handoff' || n.kind === 'done') return { state: 'done', word: n.kind };
  return { state: null, word: '' };
}
export const noteTone = (word: string): Tone => (word === KILLED ? rowWordTone('failed') : word === 'blocked' ? rowWordTone('blocked') : 'ok');
/** A post's time as the run's own clock (wave 31, critique 29: `01:30:26` and a `0s` age column on every row): `+0:17`, seconds from the run's start (the band's run, else the first post). A post with no time of its own keeps its stamp. */
const runStart = (m: PanelModel): number | undefined => m.run?.startMs ?? (m.notes.every((n) => n.ms !== undefined) && m.notes.length ? Math.min(...m.notes.map((n) => n.ms!)) : undefined);
// Wave 37 (critique 36: one event read +0:20, then +0:19, then +0:18): the band's run start is the snapshot clock less the run's elapsed time, so it moves on once the run stops counting. An event is stamped once, when
// first drawn, and the stamp is kept with it: the same event reads the same on every later frame.
const stamps = new Map<string, string>();
const STAMPS_MAX = 400;
export const forgetStamps = (): void => { stamps.clear(); };
export const stampOf = (m: PanelModel, n: PanelNote, ageW = 0): string => {
  if (!m.run) return `${n.at}${ageW ? `  ${ageOfNote(m, n).padStart(ageW)}` : ''}`; // omp keeps the post's own clock time and its age
  const t0 = runStart(m);
  if (n.ms === undefined || t0 === undefined) return n.at;
  const key = `${m.channel}|${n.from}|${n.kind ?? ''}|${n.text}|${n.ms}`;
  const kept = stamps.get(key);
  if (kept !== undefined) return kept;
  const fresh = `+${elapsedClock(Math.max(0, (n.ms - t0) / 1000))}`;
  stamps.set(key, fresh);
  if (stamps.size > STAMPS_MAX) stamps.delete(stamps.keys().next().value as string);
  return fresh;
};
/** A post's age beside its time: `20s`. The Claude pane (`m.run`) draws the time relative to the run and no age column. */
export const ageOfNote = (m: PanelModel, n: PanelNote): string => (n.ms !== undefined && m.now !== undefined ? ageWord(m.now - n.ms) : '');
/** Where the run stands on the phase rail: the run kind (a finished plan at rest is `done`), the phases it entered, the lit phase's index and the last entered one's. */
export function phaseStand(m: Pick<PanelModel, 'todos' | 'run' | 'entered' | 'phases' | 'phase'>) {
  const finished = m.todos.length > 0 && m.todos.every((t) => t.state === 'done'); // a finished plan at rest is the end of the run: the strip shows where the run got to, not a lit `research`
  const kind = m.run?.kind === 'idle' && finished ? 'done' : m.run?.kind ?? 'working';
  const seen = m.entered ? new Set(m.entered) : null;
  const litAt = m.phases.indexOf(m.phase);
  const lastEntered = seen ? m.phases.reduce((k, p, i) => (seen.has(p) ? i : k), -1) : -1;
  return { kind, seen, litAt, lastEntered };
}
