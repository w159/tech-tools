// panel-rows-route.ts: panel-layout split (audit 4.3, stage S14): route (status) body rows and the stepper.
import { phaseFigure } from '../../data/tally';
import { ROW_AT, type Health } from '../../data/idle-health';
import { PALETTE5, PALETTES, phaseGlyph, cells, countRuns, GLYPH5, GLYPH5_ASCII, elapsedClock, GRID_LEAD, todoMeter, gridPlan, markOf, motionState, RETURNED, rowWordTone, stateRun, UI_STATES, gateMark, type MarkState, type Run, type Tone } from '../../design/atlas-ui';
import { sharedSpinFrame, type MotionItem } from '../../motion/motion';
import { ELLIPSIS, clipE, labelCut, planFigure } from '../board/board-model';
import { clipWords, lastText } from '../../data/lasttext';
import { sectionRibbon, sortAgents } from '../hud/hud-surface';
import { GOTO_PREFIX, statusFrame } from '../hud/status-frame';
import { KILLED, sparkBraille, wordOf } from './pane/activity';
import { type PanelModel, type PanelLine, phaseStand, r, dot, mark, line, label, tallyOf, gatesOf, countedGates, groupPending, groupOk, rowWidth, sep, WIDE, frameOf, accentRun, type PanelTodo, oneLine, stateMark, gridRow, moving, fitRuns, type PanelWorker, nameOf, BLANK, nameCap, type PanelGate, groupFailing, groupMark, stampOf, pad, noteState, noteText, spinIdx, type PanelNote } from './panel-shared';
import { gatesFigure, headerRows } from './panel-tabs';

/** Truth 41: the run the panel prints (kind, total, spinner frame) is built by register.ts from the band's own inputs and the band's own pure functions (band.tsx bandKindOf, band-motion readRun, the shared spin frame): nothing is copied from what the band last drew, so the two cannot differ for one now. */
const withBandRun = (m: PanelModel): PanelModel => m;
/** `phase   research   2/4`: the lit phase and its place on the rail. While the Stop gate refused the stop (or the lead declared it) the phase is `blocked` with no rail
 * number: never `done 5/5` beside a blocked band (critique 16 A3, stoprun f0090). */
function phaseRow(m0: PanelModel, named = true): PanelLine {
  const m = withBandRun(m0);
  // Wave 31 (critique 29: `phase ● done` under a working band, `◒ research` after done, `● done` under an idle band): the band's own state (data/runstate via band.tsx) is printed as the band prints it.
  if (m.run) {
    const ph = named && m.phase && m.phase !== 'blocked' && m.phase !== 'done' ? r(` ${dot(m.ui)} ${m.phase}`, 'dim') : null;
    const tail = m.run.kind === 'working' ? (ph ? [ph] : []) : []; // idle reads as the band does: `○ idle 0:39`
    const lead = (kind: 'blocked' | 'done' | 'working', st: MarkState): Run => ({ ...mark(st, m, 'phase'), t: `${phaseGlyph(kind, m.run?.frame ?? (m.now !== undefined ? sharedSpinFrame(m.now) : m.tick), m.ui.ascii)} ` }); // truth 41: the band's own glyph function
    if (m.run.kind === 'blocked') return line([label('phase', m.cols), lead('blocked', 'blocked'), r('blocked', 'bad', { bold: true })]);
    if (m.run.kind === 'done') return line([label('phase', m.cols), lead('done', 'done'), r('done', 'ok', { bold: true })]);
    if (m.run.kind === 'working') return line([label('phase', m.cols), lead('working', 'running'), r('working', 'accent', { bold: true }), ...tail]);
    return line([label('phase', m.cols), r(`${phaseGlyph('idle', 0, m.ui.ascii)} `, 'muted'), r('idle', 'muted'), ...tail]);
  }
  // Critique 18 A4: the same state the band draws: a refused Stop makes the phase `blocked` whatever the lead's last header said (`research`, `done`), and the lead's own ask of the user does too (the header phase is `blocked`).
  const blocked = m.phase === 'blocked' || !!tallyOf(gatesOf(m)).stop?.blocked;
  // Wave 30 (critique 28: `phase  done` was a plain 252 word): the phase word wears its state glyph, `◐ working`, `● done`, `○ idle`, `▲ blocked`, the same marks as the band.
  const working = m.lead?.state === 'running' || m.workers.some((w) => w.state === 'running');
  if (blocked) return line([label('phase', m.cols), mark('blocked', m, 'phase'), r('blocked', 'bad', { bold: true })]);
  if (m.phase === 'done') return line([label('phase', m.cols), mark('done', m, 'phase'), r('done', rowWordTone('done'))]);
  // Critique 17 A5: the phase word alone (`phase implement`): a rail number beside it (`research 1/5`) read as the same kind of figure as the todo `n/m` and went stale beside the chip.
  if (working) return line([label('phase', m.cols), mark('running', m, 'phase'), r(m.phase)]);
  return line([label('phase', m.cols), r(`${m.ui.ascii ? GLYPH5_ASCII.queued : GLYPH5.idle} `, 'muted'), r('idle', 'muted'), r(` ${dot(m.ui)} ${m.phase}`, 'muted')]);
}
/** `gates   ● lint   ● test   ▲ doctor   ok`; names that do not fit fold to the word alone: `ok` or `1 denied`, never a pass ratio (round 2, D4). */
function gatesRow(m: PanelModel): PanelLine | null {
  const t = tallyOf(gatesOf(m));
  const gs = countedGates(gatesOf(m));
  if (!t.total) return null;
  const word = gatesFigure(m).text;
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
  const segs = UI_STATES.filter((s) => m.workers.some((w) => w.state === s)).map((s) => countRuns(s, m.workers.filter((w) => w.state === s).length, m.ui, m.now !== undefined ? sharedSpinFrame(m.now) : frameOf(m)).map((x, i) => (i === 0 ? accentRun(x, s, m.ui) : { ...x, t: x.t.replace(/ failed$/, ` ${KILLED}`) })));
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
/** The task with its owner in the title (`T1 read alpha.py (alpha-explorer)`): the narrow pane has no owner column, so the name rides the title and is never the part that is cut. */
const withOwnerInTitle = (t: PanelTodo): PanelTodo => {
  const label = oneLine(t.label);
  return t.owner && !label.includes(oneLine(t.owner)) ? { ...t, label: `${label} (${oneLine(t.owner)})` } : t;
};
/** A title cut to `width` cells that keeps its trailing `(owner)` whole: the task text gives way (`T1 read a… (alpha-explorer)`), then the plan id alone beside the name; the name is never cut or dropped. */
const keepOwnerCut = (label: string, width: number): string => {
  const m = /^(.*?)( \([\w.-]+\))$/.exec(label);
  if (cells(label) <= width || !m) return label;
  const head = m[1]!;
  const tail = m[2]!;
  const room = width - cells(tail);
  if (room >= 6) return `${clipE(head, room)}${tail}`;
  const first = `${head.split(' ')[0]!}${tail}`;
  return cells(first) <= width ? first : clipE(tail.trim().slice(1, -1), width); // the task gives way entirely before the name is cut
};
const TODO_GAP = 2; // cells between a title and its state word where the title spills (critique 14: `...(alpha... done` had one); the one-row grammar keeps its single cell
export const SPILL_BELOW = 50; // panes narrower than this (the 110-column pane is 37) draw a title that cannot sit beside its state whole, state under it

function todoRows(m: PanelModel, t: PanelTodo, w: { nameW: number; valueW: number; wordW: number; shown?: string; doubtWord?: boolean }): PanelLine[] {
  const key = `task:${t.id}`;
  const full = oneLine(t.label);
  // Critique 19 C4: a done row whose worker was killed says so in words, as the HUD does (`closed · worker killed`), not only in amber: in the state cell where the pane gave it the room (`w.doubtWord`),
  // else (the narrow pane, where the row spills) the word follows the title on its own line. From 100 columns the reason column says it.
  const doubt = markOf(t.state, t.word) === 'doubt';
  // Wave 30 (critique 28): a closed row reads `■ killed` in error 203 at every width, one word: the long `closed · worker killed` took 22 cells of the pane and cut the titles to 13.
  const spelled = doubt;
  const wordRun = { t: doubt ? KILLED : t.word ?? wordOf(t.state), tone: rowWordTone(t.state, t.word) };
  const settled = t.state === 'done' && markOf(t.state, t.word) !== 'doubt'; // a done row whose worker failed (critique 17 A1) is not struck through
  const nameCell = { tone: settled ? 'sub' as const : 'text' as const }; // a done title is dim, never struck through (the HUD draws none; critique 22)
  const accent = markOf(t.state, t.word);
  const glyph = stateMark(doubt ? 'failed' : accent, m, t.owner || t.id);
  // A title that does not fit beside its state word is drawn whole and its state follows it (critique 14, the 110-column pane: `T1 read alpha.py (alpha...` was cut
  // while the title fit the pane). A pane from SPILL_BELOW columns keeps the one-row form: it has the room.
  const room = m.cols - GRID_LEAD - (w.wordW + 1) - (w.valueW ? w.valueW + 1 : 0); // the title column's widest possible width
  const spill = false; // a row is one line at every width (critique 26: the killed row wrapped at 110 columns): the task is cut with `…`, the name and the state never wrap
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
export const tall = (m: PanelModel): boolean => m.rows >= TALL;
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
export const spareRows = (m: PanelModel, used: number): number => m.rows - headerRows(m).length - used - 1;
/** A worker's last step as every `last` text shows it: no list marker, backtick or absolute path (`lastText`), ended on a whole word within `room` cells; empty when no word fits. */
export const lastFit = (w: PanelWorker, room: number): string => clipWords(lastText(w.detail), Math.max(0, room));
/** An agent row under the route tab's `agents` row: glyph, whole name, state word, from 100 columns what it is doing. */
function routeAgentRow(m: PanelModel, w: PanelWorker, nameW: number): PanelLine {
  const tone: Tone = rowWordTone(w.state);
  const last = m.cols >= WIDE ? lastFit(w, m.cols - 2 - (GRID_LEAD + nameW + 1 + WORD_W) - 1) : '';
  return line(fitRuns(moving([r('  '), ...gridRow({ cols: m.cols - 2, ui: m.ui, mark: stateMark(w.state, m, w.name), name: { t: nameOf(w), bold: true }, nameW, word: { t: wordOf(w.state), tone }, wordW: WORD_W, ...(last ? { detail: { t: last } } : {}) })], `worker:${w.name}`, w.state, m), m.cols));
}
/** The Claude pane's route tab (`m.run` set: the HUD above the prompt lists the plan and the agents; omp has no HUD and keeps the full list below) is a summary, not a second HUD (critique 29: the full TODO and agent lists on the panel repeated the HUD rows 9-15 of the same frame): the phase as the band reads it, the gates figure, one count per agent state and
 * the plan's figure. The plan rows and the agent rows live on the HUD above the prompt, the whole board on the `board` tab, each agent on the `team` tab. */
function routeSummary(m: PanelModel): PanelLine[] {
  const rows: PanelLine[] = [phaseRow(m)];
  const gates = gatesRow(m);
  if (gates) rows.push(gates);
  rows.push(...agentsRows(m));
  if (!m.todos.length) rows.push(todoCount(m)); // `todo  no tasks yet`; with a plan its figure is the plan header's meter below
  if (!m.todos.length && !m.workers.length) { rows.push(BLANK, ...indentedHint(m, 'add one with /todo add')); return rows; } // the `todo` row above already says `no tasks yet`
  // Wave 34 (critique 33: the plan rows repeated the HUD's own, and disagreed with it): the route tab is the run's phases, the entered ones green. The plan lives in the HUD above the prompt and on the board tab.
  rows.push(BLANK, line(fitRuns([r(`${' '.repeat(GRID_LEAD)}timeline`, 'muted', { bold: true })], m.cols)), ...phaseChain(m));
  return rows;
}
/** Wave 32 (critique 30: the route tab was four stat lines and a sentence pointing at other tabs): the run as a timeline, from the data the panel already holds. The first row is the phase chain,
 * `● research › ◐ implement 0:28 › ◇ verify` (past phases done, the lit one wearing the band's mark and the run clock, the rest queued); under it one row per plan row, `◐ T1 read alpha.py   +0:00`,
 * with the time its owner started, relative to the run's start. */
function phaseChain(m: PanelModel, compact: boolean | 'short' | 'one' | 'auto' = false, clock = true): PanelLine[] {
  if (compact === 'auto') {
    const wide = (c: boolean | 'short'): boolean => { const x = phaseChainRuns(m, c, true, false); return x.length > 0 && rowWidth(x[0]!.runs) > m.cols; };
    return phaseChain(m, wide(false) ? 'one' : false, false); // whole names, else only the current stage and its place (`research 1/5`); the phase row above carries the run clock
  }
  return phaseChainRuns(m, compact, false, clock);
}
/** A stage's short name for a narrow pane: `research` -> `rsch`, `theory` -> `thy`, `implement` -> `impl`, `verify` -> `ver`; a name of four letters or fewer stays. */
const SHORT_STAGE: Record<string, string> = { research: 'rsch', theory: 'thy', implement: 'impl', verify: 'ver', review: 'rev', design: 'dsgn', document: 'docs', deliver: 'ship' };
export const stageShort = (p: string): string => SHORT_STAGE[p] ?? (cells(p) <= 4 ? p : p.slice(0, 4));
function phaseChainRuns(m0: PanelModel, compact: boolean | 'short' | 'one', raw: boolean, clock = true): PanelLine[] {
  const m = withBandRun(m0);
  if (!m.phases.length) return [];
  // The lit phase: the rail's own, or (a blocked reply names no phase) the last one the run entered.
  const { kind, seen, litAt, lastEntered } = phaseStand(m);
  // Truth 40 (stoprun-150-1 f0111:7): a blocked run's mark sits on the phase the run was in when it blocked, the last one it entered, not on an earlier header phase (`▲ research › ● implement`).
  const lit = kind === 'done' ? -1 : kind === 'blocked' ? Math.max(litAt, lastEntered) : litAt >= 0 ? litAt : lastEntered;
  const runs: Run[] = [r(' '.repeat(GRID_LEAD))];
  if (compact === 'one') { // a narrow pane: the current stage and its place on the rail, nothing else (`● research 1/5`)
    const at = lit >= 0 ? lit : kind === 'done' ? m.phases.length - 1 : Math.max(0, lastEntered);
    const g: Run = lit < 0 ? (kind === 'done' ? stateRun('done', m.ui) : { t: m.ui.ascii ? GLYPH5_ASCII.idle : GLYPH5.idle, tone: 'muted' }) : kind === 'blocked' ? stateMark('blocked', m, 'phase') : kind === 'idle' ? { t: m.ui.ascii ? GLYPH5_ASCII.idle : GLYPH5.idle, tone: 'muted' } : stateMark('running', m, 'phase');
    runs.push({ ...g, t: `${g.t} ` }, r(m.phases[at]!, kind === 'idle' ? 'dim' : 'text', kind === 'idle' ? {} : { bold: true }), r(` ${phaseFigure(m.phases.length, at)}`, 'dim'));
    return [line(raw ? runs : fitRuns(runs, m.cols))];
  }
  const enteredAt = (p: string, i: number): boolean => (seen ? seen.has(p) : kind === 'done' || (litAt >= 0 && i < litAt)); // a phase is green only once the run was in it (never from the final status)
  const named = (_p: string, i: number): boolean => !compact || compact === 'short' || lit === i;
  m.phases.forEach((p, i) => {
    if (i) runs.push(r(compact === 'short' || named(p, i) || named(m.phases[i - 1]!, i - 1) ? ` ${m.ui.ascii ? '>' : '›'} ` : ' ', 'dim')); // one separator at every width (`›`); only the dots-only form, which names nothing, runs its marks together
    const cur = lit === i;
    const entered = enteredAt(p, i);
    const g: Run = cur ? (kind === 'blocked' ? stateMark('blocked', m, 'phase') : kind === 'idle' ? { t: m.ui.ascii ? GLYPH5_ASCII.idle : GLYPH5.idle, tone: 'muted' } : stateMark('running', m, 'phase')) : entered ? stateRun('done', m.ui) : { t: m.ui.ascii ? '.' : '\u00b7', tone: 'dim' };
    if (compact === 'short' && !cur) { runs.push(...(entered ? [{ ...g, t: `${g.t} ` }] : []), r(stageShort(p), entered ? 'sub' : 'dim')); return; } // a narrow pane names the lit phase whole; the rest by their short stage name (a phase not entered yet has a name and no mark: its mark beside the `›` read `› ·`)
    if (compact && !cur) { runs.push(g); return; } // narrower still: the rest are their dot
    const rest = cur || entered; // a phase not entered yet is its name alone, dim
    // At rest nothing is live: the whole chain is dim, the phase the run stopped in included (a bold lit `research` under `idle` read as a running phase).
    runs.push(...(rest ? [{ ...g, t: `${g.t} ` }] : []), r(p, cur ? (kind === 'idle' ? 'dim' : 'text') : entered ? 'sub' : 'dim', cur && kind !== 'idle' ? { bold: true } : {}));
  });
  return [line(raw ? runs : fitRuns(runs, m.cols))];
}
function routeBodyFull(m: PanelModel): PanelLine[] {
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
    if (running.length) rows.push(BLANK, ...running.slice(0, bodyRows(m, rows.length)).map((w) => line(gridRow({ cols: m.cols, ui: m.ui, mark: stateMark('running', m, w.name), name: { t: nameOf(w) }, nameW, detail: { t: lastFit(w, m.cols - (GRID_LEAD + nameW) - 1) } }))));
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
  let ordered = narrow ? m.todos.map(withOwnerInTitle) : m.todos; // the Board's order (plan rows as the board lists them), not regrouped by state
  const layout = (os: readonly PanelTodo[]) => {
    // The owner column goes first (critique 12 A2): a row whose title already names its owner (`T1 read alpha.py (alpha-explorer)`) prints no second copy, so the title keeps the room.
    const widest = narrow ? 0 : Math.min(m.cols >= WIDE ? 28 : OWNER_W, Math.max(0, ...os.filter(ownerColumn).map((t) => cells(oneLine(t.owner)))));
    // The title column is as wide as the longest title the pane has room for (the state word follows it on every row, so the words line up); only a title past the room is cut, in the middle.
    // Critique 19 C4: a pane that can keep a whole title beside `closed · worker killed` spells it in the state cell; a narrower one (and the 100+ reason column) does not.
    const doubtWord = false;
    const todoWordW = os.reduce((n, t) => Math.max(n, cells(markOf(t.state, t.word) === 'doubt' ? KILLED : t.word ?? wordOf(t.state))), WORD_W); // 8 while a row reads `returned`
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
  const shownTitles = labelCut(ordered.map((t) => oneLine(t.label)), plan.nameW).map((x, i) => keepOwnerCut(oneLine(ordered[i]!.label), plan.nameW) !== oneLine(ordered[i]!.label) ? keepOwnerCut(oneLine(ordered[i]!.label), plan.nameW) : x);
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
// ---- status (wave 35) ------------------------------------------------------------------------------------------------------------

/** The status view's agent rows and events: at most this many of each (a short pane gives them up first). */
const STATUS_AGENTS = 8;
const STATUS_EVENTS = 5;
/** Braille cells of an agent's activity over the run. */
const STATUS_SPARK = 12;
export const dimLine = (m: PanelModel, text: string): PanelLine => line(fitRuns([r(' '.repeat(GRID_LEAD)), r(text, 'dim')], m.cols));
/** One row per agent: its mark, whole name, 12 braille cells of its calls over the run's window, and its time. */
function statusAgentRows(m: PanelModel, ws: readonly PanelWorker[]): PanelLine[] {
  const win = runWindow(m, ws).win;
  const ages = ws.map((w) => ageOf(w));
  const ageW = Math.max(0, ...ages.map((a) => cells(a)));
  const nameW = Math.max(6, Math.min(Math.max(...ws.map((w) => cells(nameOf(w)))), m.cols - 1 - GRID_LEAD - (2 + STATUS_SPARK) - (ageW ? 2 + ageW : 0)));
  return ws.map((w, i): PanelLine => {
    const spark = w.state === 'queued' || !win ? ' '.repeat(STATUS_SPARK) : sparkBraille(w.calls, win.from, win.to, STATUS_SPARK, m.ui.ascii);
    const tail: Run[] = [r('  '), r(spark, w.state === 'running' ? 'accent' : w.state === 'failed' ? 'bad' : 'sub'), ...(ageW ? [r('  '), r(ages[i]!.padStart(ageW), 'muted')] : [])];
    return line(fitRuns(moving(gridRow({ cols: m.cols, ui: m.ui, mark: stateMark(w.state, m, w.name), name: { t: nameOf(w), bold: true }, nameW, tail }), `worker:${w.name}`, w.state, m), m.cols));
  });
}
/** The gates checklist: one row per counted group, its mark and a word; the figure beside the heading is the band's `gates n/m` (data/runstate gateTally over withCoreTally, the same call). */
function statusGateRows(m: PanelModel, gs: readonly PanelGate[]): PanelLine[] {
  const nameW = Math.min(18, Math.max(...gs.map((g) => cells(oneLine(g.title)))));
  return gs.map((g): PanelLine => {
    const bad = groupFailing(g);
    const word = bad || g.error ? 'warning' : groupPending(g) ? 'pending' : 'passing';
    const first = g.lines.find((l) => !l.ok);
    // Wave 36 (critique 35: `Tool routing  warning  Dispatches followed the plan`): a check's label names what it checks, so beside a `warning` it reads as the check that is not met (`not met: ...`), never as a passing sentence; a fix or detail the gate gave says more and is used first.
    const tail = bad && first ? oneLine(first.fix ?? first.detail ?? `not met: ${first.label}`) : '';
    return line(fitRuns(gridRow({ cols: m.cols, ui: m.ui, mark: groupMark(g, m.ui), name: { t: oneLine(g.title), bold: true }, nameW, gap: 2, word: { t: word, tone: bad || g.error ? 'warn' : groupPending(g) ? 'muted' : 'ok' }, wordW: GATE_WORD_W, ...(tail ? { detail: { t: tail } } : {}) }), m.cols));
  });
}
/** The newest `n` posts of the run, oldest first, each `+0:23  who  what`: time on the run's clock, never the wall clock. Wave 36 (critique 35: `no events yet` over a board that listed `+0:19 ghost-explorer failed`): the posts are
 * the board's `recent` list (`m.notes`, the failure rows included); the status view holds no plan row that says a failure for it, so none is left out. */
function statusEventRows(m: PanelModel, n: number): PanelLine[] {
  const all = statusEvents(m);
  const ordered = all.every((x) => x.ms !== undefined) ? [...all].sort((a, b) => a.ms! - b.ms!) : all;
  const posts = ordered.slice(-n);
  const who = Math.min(14, Math.max(0, ...posts.map((x) => cells(x.from))));
  return posts.map((x): PanelLine => {
    const time = r(`${stampOf(m, x).padEnd(6)} `, 'dim');
    const name = r(`${pad(clipE(x.from, who), who)}  `, noteState(x).state === 'failed' ? 'bad' : 'sub');
    const left = m.cols - 1 - GRID_LEAD - cells(time.t) - cells(name.t);
    return line(fitRuns([r(' '.repeat(GRID_LEAD)), time, name, r(left > 3 ? clipE(oneLine(noteText(m, x)), left).replace(ELLIPSIS, m.ui.ascii ? '~' : ELLIPSIS) : '', 'muted')], m.cols));
  });
}
/** The status view (Claude pane): the run on one screen, from data the panel already holds and nothing invented. Phase and clock, an activity line per agent, the gates checklist, the last five events. A section with no data is one dim line. */
/** Wave 42: the idle status view's health block: one row per figure. A row with real detail is a toggle (`▸ gates  ● 4/4 green`) and opens to its detail lines; a row with none is plain text, not a control. */
const GATE_DETAIL_ROOM = 2;
/** A detail line fitted to `room` cells: trailing ` · ` parts go whole before any word is cut. */
function fitDetail(text: string, room: number): string {
  let t = text;
  while (cells(t) > room && t.includes(' · ')) t = t.slice(0, t.lastIndexOf(' · '));
  return cells(t) > room ? clipE(t, room) : t;
}
// ---- the status grid (S3) ---------------------------------------------------------------------------------------------------------------
/** The grid of the status view: section headers in cell 2, rows in cell 4, one value column from cell 12; the slots are the same at idle, working and done. */
const HEAD_AT = 2;
const RECENT_SLOTS = 3;
/** Section headers of the status view are inert labels in dim uppercase (`PHASE`, `PULSE`, `HEALTH`, `RECENT`, the case of the card's `HEALTH` ribbon): plain text, never a press. */
const sect = (title: string, m: PanelModel, figures: Run[] = []): PanelLine => line(fitRuns([r(`${' '.repeat(HEAD_AT)}${title.toUpperCase()}`, 'muted', { bold: true }), ...(figures.length ? [r('  '), ...figures] : [])], m.cols));
/** Round 2 (D12): a pending stage reads one step above `dim` (the dim ink is 2.7:1 on the panel, this one about 3.9:1); the glyph and the name share it. */
const PENDING_INK = { mocha: PALETTE5.pending, latte: PALETTES.latte.line } as const;
/** The phases as full stage names, one glyph each, wrapping to a second row where they do not fit (round 3, E9: one widget form at every width, never dots and never an abbreviation): `● research ◐ theory ○ test`.
 * A stage the run passed is a green `●` and stays one after the run ends, until the next prompt starts; the current one is the band's spinner in the accent; a pending one is `○`. */
function stepperRows(m: PanelModel): PanelLine[] {
  const lead = r(' '.repeat(ROW_AT));
  if (!m.phases.length) return [line([lead, r('no phases yet', 'dim')])];
  const { kind, seen, litAt, lastEntered } = phaseStand(m);
  const lit = kind === 'done' || kind === 'idle' ? -1 : kind === 'blocked' ? Math.max(litAt, lastEntered, 0) : litAt >= 0 ? litAt : Math.max(0, lastEntered); // a working run always turns one stage: the band's spinner has a place on the panel
  // The stages the run entered stay done once it ends (done or idle after a run) until the next prompt clears them; a fresh idle pane has entered none.
  const entered = (p: string, i: number): boolean => (seen ? seen.has(p) : kind === 'idle' ? false : kind === 'done' || (litAt >= 0 && i < litAt));
  const ink = PENDING_INK[m.ui.theme === 'latte' ? 'latte' : 'mocha'];
  const dim = (t: string): Run => ({ t, tone: 'dim', ...(m.ui.color === 'none' ? {} : { fg: ink }) });
  const skipped = (i: number): boolean => seen !== null && kind !== 'idle' && lit !== i && !entered(m.phases[i]!, i) && i < Math.max(lastEntered, lit);
  const glyph = (p: string, i: number): Run => (lit === i ? (kind === 'blocked' ? stateRun('blocked', m.ui) : { t: phaseGlyph('working', spinIdx(m), m.ui.ascii), tone: 'accent' }) : entered(p, i) ? stateRun('done', m.ui) : skipped(i) ? dim(m.ui.ascii ? '-' : '–') : dim(m.ui.ascii ? GLYPH5_ASCII.queued : GLYPH5.idle));
  const named = (p: string, i: number): Run => (lit === i ? r(p, 'text', { bold: true }) : entered(p, i) ? r(p, 'sub') : dim(p));
  const items = m.phases.map((p, i): Run[] => [{ ...glyph(p, i), t: `${glyph(p, i).t} ` }, named(p, i)]);
  const room = Math.max(8, m.cols - 1 - ROW_AT);
  const rows: Run[][] = [[]];
  for (const it of items) {
    const cur = rows[rows.length - 1]!;
    const w = rowWidth(it);
    if (cur.length && rowWidth(cur) + 1 + w > room) rows.push([...it]);
    else cur.push(...(cur.length ? [r(' ')] : []), ...it);
  }
  return rows.map((x) => line(fitRuns([lead, ...x], m.cols)));
}
/** A section header: the flat ribbon (`── ACTIVITY ───── 6 in 5m ──`) inside the pane's one-cell gutter. */
export const secHead = (title: string, figure: string, m: Pick<PanelModel, 'cols' | 'ui'>): PanelLine => line([r(' '), ...sectionRibbon(title, figure, Math.max(4, m.cols - 2), m.ui)]);
/** The footer of the status view and of the other Claude pane tabs, pinned to the pane's last row: `atlas 17.24.0 · master`, the session cost flush right when the host measured one. Real figures only; empty when the mod has none of them. */
function healthFooter(h: Health): string {
  return [h.version ? `atlas ${h.version}` : '', h.branch ?? ''].filter(Boolean).join(' · ');
}
export const footerLine = (m: PanelModel, h?: Health): PanelLine | null => {
  const t = h ? healthFooter(h) : '';
  if (!t) return null;
  const cost = h?.pulse?.cost ? `cost $${h.pulse.cost.usd.toFixed(2)}` : '';
  const gap = m.cols - 1 - HEAD_AT - cells(t) - cells(cost);
  return line(fitRuns([r(' '.repeat(HEAD_AT)), r(t, 'dim'), ...(cost && gap >= 2 ? [r(' '.repeat(gap)), r(cost, 'dim')] : [])], m.cols));
};
/** The status view (spec frames S1-S8): NOW, ACTIVITY, CONTEXT, RUNS, GATES and the elastic HOOKS, the footer on the last row (mod/view/hud/status-frame.ts). */
function statusLines(m: PanelModel, h: Health): PanelLine[] {
  const rows = statusFrame({
    cols: m.cols, room: m.rows > 0 ? m.rows - headerRows(m).length : 0, ui: m.ui, kind: m.run?.kind ?? 'idle', phases: m.phases, phase: m.phase,
    spin: phaseGlyph('working', spinIdx(m), m.ui.ascii), ...(m.now !== undefined ? { now: m.now } : {}),
    todos: { done: m.todos.filter((t) => t.state === 'done').length, total: m.todos.length }, gates: m.gates, health: h, lead: m.cols < 100, ...(m.read ? { read: m.read } : {}), ...(m.read ? { read: m.read } : {}),
    ...(m.entered ? { entered: m.entered } : {}),
  });
  return rows.map((x) => { const to = x.find((y) => y.press?.startsWith(GOTO_PREFIX))?.press; return line(fitRuns(x, m.cols), to ? { kind: 'goto', key: to.slice(GOTO_PREFIX.length) } : undefined); }); // the `+N more ›` chip of a short pane opens the view that holds what it dropped
}
function statusBody(m: PanelModel): PanelLine[] {
  const ws = workersByTask(m);
  if (m.health && (m.run?.kind === 'idle' || m.run?.kind === 'working' || m.run?.kind === 'done' || m.run?.kind === 'blocked')) return statusLines(m, m.health);
  const gs = countedGates(gatesOf(m));
  const phase = [sect('phase', m), ...stepperRows(m)];
  const room = Math.max(4, m.rows - headerRows(m).length - 1);
  let nA = Math.min(ws.length, STATUS_AGENTS);
  let nE = Math.min(statusEventCount(m), STATUS_EVENTS);
  const nG = gs.length;
  const total = (): number => phase.length + 1 + 1 + Math.max(1, nA) + (ws.length > nA ? 1 : 0) + 1 + 1 + Math.max(1, nG) + 1 + 1 + Math.max(1, nE) + 1 + 1;
  while (total() > room && (nE > 0 || nA > 1)) { if (nE > 0) nE--; else nA--; }
  const agents = ws.length ? statusAgentRows(m, ws.slice(0, nA)) : [dimLine(m, 'no agents yet')];
  const gates = nG ? statusGateRows(m, gs) : [dimLine(m, 'no gates reported yet')];
  const events = nE > 0 ? statusEventRows(m, nE) : [dimLine(m, statusEventCount(m) ? 'events fold on a short pane' : 'no events yet')];
  return [
    ...phase, BLANK,
    sect('agents', m, ws.length ? [r(`${ws.length}`, 'muted')] : []), ...agents, ...(ws.length > nA ? [dimLine(m, `+${ws.length - nA} more on the team tab`)] : []), BLANK,
    sect('gates', m, gatesFigure(m).fired ? [r(gatesFigure(m).text, gatesFigure(m).tone)] : []), ...gates, BLANK,
    sect('events', m), ...events, BLANK,
    dimLine(m, `${m.notes.length} ${m.notes.length === 1 ? 'message' : 'messages'}`), // wave 36: the channel's own count, one dim footer row (an empty channel says `0 messages`)
  ];
}
/** Every event of the run: the channel's notes and the workers' finishes, a finish left out where the worker already posted its own done row. */
const statusEvents = (m: PanelModel): readonly PanelNote[] => [...(m.starts ?? []), ...m.notes, ...(m.finishes ?? []).filter((f) => !m.notes.some((x) => x.from === f.from && (x.kind === 'done' || x.kind === 'handoff')))];
const statusEventCount = (m: PanelModel): number => statusEvents(m).length;
/** The route tab is the status view (wave 35): the dense status view on the Claude pane (it has the HUD), the full plan and agent list everywhere else. */
const routeBody = (m: PanelModel): PanelLine[] => (m.run ? statusBody(m) : routeBodyFull(m));
// ---- team (subagents by name and state) -----------------------------------------------------------------------------------

export const shortAge = (secs: number): string => elapsedClock(secs);
// A queued agent has not started: it has no elapsed time to show.
export const ageOf = (w: PanelWorker): string => (w.secs !== undefined && w.state !== 'queued' ? shortAge(w.secs) : '');
/** The run from its first start to its last end (or now, while it works): the one axis every team sparkline shares. */
export function runWindow(m: PanelModel, ws: readonly PanelWorker[]): { win?: { from: number; to: number } } {
  const starts = ws.map((w) => w.startMs).filter((x): x is number => typeof x === 'number');
  const ends = ws.map((w) => w.endMs).filter((x): x is number => typeof x === 'number');
  if (!starts.length) return {};
  const from = m.run?.startMs !== undefined ? Math.min(m.run.startMs, ...starts) : Math.min(...starts);
  // Wave 36 (critique 35: the axis ended at 0:34 under a band at 0:31): where the band says its run clock, the window is exactly that long.
  const band = m.run?.secs !== undefined && m.run.kind !== 'idle' ? from + m.run.secs * 1000 : 0;
  return { win: { from, to: Math.max(from + 1000, band, ...(band ? [] : [m.now !== undefined && m.run?.kind === 'working' ? m.now : 0, ...ends])) } };
}
/** The workers in the HUD's order (hud-surface sortAgents): by the earliest plan row (T1 before T2) each owns, whatever its state, those that own none after, then as
 * given (start order). The plan row number is its place in `m.todos` (the board's order); a worker whose row names no owner falls back to its own `T3` tag. */
export function workersByTask(m: Pick<PanelModel, 'todos' | 'workers'>): PanelWorker[] {
  // Wave 38: the SUBAGENTS table lists agents in dispatch order (AgentRow.seq); where every worker carries it, so does every list of the panel (one that has none yet, a queued dispatch, follows the others).
  if (m.workers.some((w) => w.seq !== undefined)) return m.workers.map((w, i) => ({ w, i })).sort((a, b) => (a.w.seq ?? Infinity) - (b.w.seq ?? Infinity) || a.i - b.i).map((x) => x.w);
  const tag = (w: PanelWorker): number[] => { const n = /^T(\d+)$/i.exec(w.task ?? '')?.[1]; return n ? [Number(n)] : []; };
  return sortAgents(m.workers.map((w) => { const owned = m.todos.flatMap((t, i) => (t.owner === w.name ? [i + 1] : [])); return { w, tasks: owned.length ? owned : tag(w) }; })).map((x) => x.w);
}
/** An empty tab's one sentence, indented like the rows it stands in for and wrapped to the pane (critique 15: an unindented `(no state)` lead-in was the only thing at the margin). */
/** A hint under a row that already says the pane is empty (the route tab's todo row): indented like the rows it stands in for, wrapped to the pane. */
const indentedHint = (m: PanelModel, text: string): PanelLine[] => wrap(text, Math.max(8, m.cols - GRID_LEAD), 3).map((l) => line([r(' '.repeat(GRID_LEAD)), r(l, 'muted')]));
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
export const GATE_WORD_W = 7;
