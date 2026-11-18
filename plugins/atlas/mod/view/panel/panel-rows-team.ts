// panel-rows-team.ts: panel-layout split (audit 4.3, stage S14): team and channel bodies and the empty-state skeletons.
import { workerTally } from '../../data/tally';
import { ROW_AT, teamOf } from '../../data/idle-health';
import { cells, GLYPH5, GLYPH5_ASCII, GRID_LEAD, gridPlan, rowWordTone, stateRun, UI_STATES, type Run, type UiState } from '../../design/atlas-ui';
import { ELLIPSIS, clipE } from '../board/board-model';
import { blockReasons } from '../../data/runstate';
import { sparkBraille, sparkOf, sparkOver, totalsOf, wordOf } from './pane/activity';
import { type PanelWorker, oneLine, type PanelModel, type PanelLine, pad, dot, line, fitRuns, r, nameOf, WIDE, gridRow, stateMark, moving, BLANK, noteText, stampOf, noteState, tallyOf, gatesOf, type PanelNote, noteTone, ageOfNote } from './panel-shared';
import { shortAge, lastFit, ageOf, runWindow, secHead, workersByTask, dimLine, tall, spareRows, wrap } from './panel-rows-route';
import { headerRows, channelLabel } from './panel-tabs';
 // `0:14`: the one clock of an agent's run (atlas-ui elapsedClock)

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
/** The Team tab's columns, one set for every row (wave 30): `glyph name  role  state word  elapsed  activity`. Columns give way in this order: the role, then the activity sparkline (12 cells, then 8, then none), then the elapsed time;
 * the name is cut last, with `…`. */
type TeamGrid = { nameW: number; roleW: number; wordW: number; ageW: number; sparkW: number; /** The run's window on the snapshot clock: every sparkline is drawn over it, so a cell is the same moment on every row. */ win?: { from: number; to: number } };
// The role column says what the name does not: `ghost-explorer` already starts with its role, so that row leaves the column blank rather than print the word twice.
const roleOf = (w: PanelWorker): string => (w.role && w.role !== 'unknown' && w.role !== w.name && !nameOf(w).toLowerCase().startsWith(w.role.toLowerCase()) ? w.role : '');
const SPARK_W = 12;
function teamGrid(m: PanelModel, ws: readonly PanelWorker[]): TeamGrid {
  const longest = Math.max(6, ...ws.map((w) => cells(nameOf(w))));
  const wordW = Math.max(4, ...ws.map((w) => cells(wordOf(w.state))));
  const roleW = Math.min(11, Math.max(0, ...ws.map((w) => cells(roleOf(w)))));
  const ageW = Math.max(0, ...ws.map((w) => cells(ageOf(w))));
  const room = m.cols - 1 - GRID_LEAD; // right margin, then the glyph cells
  const need = (c: { role: boolean; age: boolean; spark: number }): number => 2 + wordW + (c.role && roleW ? 2 + roleW : 0) + (c.age && ageW ? 2 + ageW : 0) + (c.spark ? 2 + c.spark : 0);
  const forms = [{ role: true, age: true, spark: SPARK_W }, { role: false, age: true, spark: SPARK_W }, { role: false, age: true, spark: 8 }, { role: false, age: true, spark: 0 }, { role: false, age: false, spark: 0 }];
  for (const c of forms) {
    if (longest + need(c) <= room) return { nameW: longest, roleW: c.role ? roleW : 0, wordW, ageW: c.age ? ageW : 0, sparkW: c.spark, ...(m.run ? runWindow(m, ws) : {}) };
  }
  return { nameW: Math.max(6, room - need(forms[forms.length - 1]!)), roleW: 0, wordW, ageW: 0, sparkW: 0 };
}
/** One agent as one row; its detail rows (what it was asked, its model, its last step) open only on a press. */
function workerRows(m: PanelModel, w: PanelWorker, g: TeamGrid, focus: boolean): PanelLine[] {
  const key = `worker:${w.name}`;
  const used = GRID_LEAD + g.nameW + 2 + g.wordW + (g.roleW ? 2 + g.roleW : 0) + (g.ageW ? 2 + g.ageW : 0) + (g.sparkW ? 2 + g.sparkW : 0);
  const wide = m.cols >= WIDE;
  const room = m.cols - 1 - used - 2;
  const said = wide && room >= 8 ? lastFit(w, room) : '';
  const last = said === wordOf(w.state) ? '' : said; // a failed worker's `failed` after its state word says it twice (wave 33)
  const spark = g.sparkW && w.state !== 'queued' ? (g.win ? (m.run ? sparkBraille(w.calls, g.win.from, g.win.to, g.sparkW, m.ui.ascii) : sparkOver(w.calls, g.win.from, g.win.to, w.startMs, w.endMs, g.sparkW, m.ui.ascii)) : sparkOf(w.calls, w.startMs, w.endMs, g.sparkW, m.ui.ascii)) : ' '.repeat(g.sparkW); // wave 34: the Claude pane's activity is braille (one spinner family), over the run's window
  const tail: Run[] = [
    ...(g.roleW ? [r('  '), r(pad(clipE(roleOf(w), g.roleW), g.roleW), 'sub')] : []),
    r('  '), r(pad(wordOf(w.state), g.wordW), rowWordTone(w.state)), // the one word tone of every surface (atlas-ui rowWordTone)
    ...(g.ageW ? [r('  '), r(pad(ageOf(w), g.ageW), 'muted')] : []),
    ...(g.sparkW ? [r('  '), r(spark, w.state === 'running' ? 'accent' : w.state === 'failed' ? 'bad' : 'sub')] : []),
    ...(last ? [r('  '), r(last, 'muted')] : []),
  ];
  const runs = gridRow({ cols: m.cols, ui: m.ui, focus, mark: stateMark(w.state, m, w.name), name: { t: nameOf(w), bold: true }, nameW: g.nameW, tail });
  const out = [line(fitRuns(moving(runs, key, w.state, m), m.cols), { kind: 'worker', key, name: w.name })];
  if (m.expanded === key) {
    out.push(...workerDetail(m, w));
    out.push(line(fitRuns([r(`    ${lastFit(w, m.cols - 4) || wordOf(w.state)}`, 'muted')], m.cols)));
    if (w.secs !== undefined) out.push(line(fitRuns([r(`    running ${shortAge(w.secs)}${w.tools !== undefined ? ` ${dot(m.ui)} ${w.tools} tool calls` : ''}`, 'muted')], m.cols)));
  }
  return out;
}
/** Wave 34 (critique 33: an unlabelled histogram): the time axis under the activity column, `0:00` at its left edge and the run's length at its right, aligned to the sparkline's own cells. Only where the rows draw the run's window. */
function sparkAxis(m: PanelModel, g: TeamGrid): PanelLine[] {
  if (!m.run || !g.win || !g.sparkW) return [];
  const lead = GRID_LEAD + g.nameW + 2 + g.wordW + (g.roleW ? 2 + g.roleW : 0) + (g.ageW ? 2 + g.ageW : 0) + 2; // the cell the sparkline starts in (workerRows)
  const end = shortAge((g.win.to - g.win.from) / 1000);
  const start = shortAge(0);
  const both = g.sparkW >= cells(start) + cells(end) + 1;
  const text = both ? `${start}${' '.repeat(g.sparkW - cells(start) - cells(end))}${end}` : end.padStart(g.sparkW);
  return [line(fitRuns([r(' '.repeat(lead)), r(text, 'dim')], m.cols))];
}
/** The team's totals under its rows: `workers  0 running · 2 done · 1 killed` and `total  0:27 · 9 worker calls` (the run from the first start to the last end). Running always reads; the other states only when not zero. */
function leadSummary(m: PanelModel): PanelLine[] {
  const counts = workerTally(m.workers);
  const n = (s: UiState): number => counts[s];
  const tally = (all: boolean): string => UI_STATES.filter((s) => (all && s === 'running') || n(s)).map((s) => `${n(s)} ${wordOf(s)}`).join(` ${dot(m.ui)} `);
  const head = `${' '.repeat(GRID_LEAD)}workers  `;
  const parts = cells(head) + cells(tally(true)) <= m.cols - 1 ? tally(true) : tally(false) || tally(true); // a narrow pane drops the `0 running` before it cuts a figure
  const t = totalsOf(m.workers, m.lead);
  if (m.run?.secs !== undefined && m.workers.length) t.secs = m.run.secs; // the band's run clock: one total on every surface (critique 29: board 0:14, team 0:24, band 1:00)
  const total = `${shortAge(t.secs)}${t.calls ? ` ${dot(m.ui)} ${t.calls} worker calls` : ''}`;
  const key = (k: string): Run => r(' '.repeat(GRID_LEAD) + pad(k, 9), 'text', { bold: true });
  return [
    line(fitRuns([r(' '.repeat(GRID_LEAD)), r('workers  ', 'text', { bold: true }), r(parts, 'muted')], m.cols)), // in the name column, under the lead's own row
    ...(m.workers.length && t.secs > 0 ? [line(fitRuns([key('total'), r(total, 'muted')], m.cols))] : []),
  ];
}
/** The last posts of the channel under a tab's rows (`recent`): time to the second, who, what. As many as the pane has rows for. */
export function recentRows(m: PanelModel, spare: number): PanelLine[] {
  const room = Math.min(m.notes.length, spare - 2, 8);
  if (room < 1) return [];
  const ordered = m.notes.every((n) => n.ms !== undefined) ? [...m.notes].sort((x, y) => x.ms! - y.ms!) : m.notes; // a kill row is stamped with the kill instant: time order, not build order
  const posts = ordered.slice(-room);
  const who = Math.min(18, Math.max(...posts.map((n) => cells(n.from))));
  return [BLANK, line(fitRuns([r(' '.repeat(GRID_LEAD)), r('recent', 'text', { bold: true })], m.cols)), ...posts.map((n): PanelLine => {
    const text = oneLine(noteText(m, n));
    const lead = r(' '.repeat(GRID_LEAD));
    const time = r(m.run ? `${stampOf(m, n).padEnd(7)}  ` : n.at ? `${n.at}  ` : ' '.repeat(10), 'dim');
    const name = r(pad(clipE(n.from, who), who) + '  ', noteState(n).state === 'failed' ? 'bad' : 'sub');
    const left = m.cols - 1 - GRID_LEAD - cells(time.t) - cells(name.t);
    return line(fitRuns([lead, time, name, r(left > 3 ? clipE(text, left).replace(ELLIPSIS, m.ui.ascii ? '~' : ELLIPSIS) : '', 'muted')], m.cols));
  })];
}
/** The lead as the band would read it: while the band is BLOCKED (the lead declared it, or the Stop gate's last verdict refused the stop) the lead is not `done`; it
 * reads blocked, with the reason the band gives. A failing check alone never blocks it (the band says warning then). Any other state is the lead's own. */
function leadOf(m: PanelModel): PanelWorker | undefined {
  const lead = m.lead;
  if (!lead) return lead;
  const stop = tallyOf(gatesOf(m)).stop;
  const declared = m.phase === 'blocked';
  // Wave 35 (critique 34: `lead done` under a blocked band): the band's own state decides. An open dispatch row holds the run with no Stop refusal and no declaration; the lead reads blocked then too, whatever it was doing.
  if (m.run?.kind === 'blocked' && lead.state !== 'failed') return { ...lead, state: 'blocked', detail: declared || stop?.blocked ? blockReasons(declared, stop?.gates ?? ['gate']).long : 'run blocked' };
  if (lead.state !== 'done') return lead;
  if (!declared && !stop?.blocked) return lead;
  return { ...lead, state: 'blocked', detail: blockReasons(declared, stop?.gates ?? ['gate']).long };
}
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
/** Round 3 (E12): an empty tab on the Claude pane is its ribbon, the one live fact, and what will appear drawn as dim skeleton rows; the footer is pinned under it (bodyLines). The fact rides the ribbon where it fits, else its own row. */
export function emptyTab(m: Pick<PanelModel, 'cols' | 'ui'>, title: string, fact: string, skeleton: readonly string[]): PanelLine[] {
  const fits = m.cols - 2 >= 3 + title.length + 1 + 1 + [...fact].length + 1 + 2 + 1;
  return [secHead(title, fits ? fact : '', m), ...(fits ? [] : [line(fitRuns([r(' '.repeat(ROW_AT)), r(fact, 'muted')], m.cols))]), ...skeleton.map((t) => line(fitRuns([r(' '.repeat(ROW_AT)), r(t, 'dim')], m.cols)))];
}
export const SKEL = '···········';
const TEAM_SKEL = ['agent        state     time', `○ ${SKEL}  ·······   ·:··`, `○ ${SKEL}  ·······   ·:··`];
const CHANNEL_SKEL = ['time    from         message', `·:··    ${SKEL}  ··················`, `·:··    ${SKEL}  ··················`];
export const GATES_SKEL = ['gate          result', '○ completion   0 pass · 0 deny', '○ tripwire     0 pass · 0 deny'];
export const CORE_SKEL = ['evidence   0 of 0 done items', 'verified   0 of 0 done items', 'verdicts   0 verified · 0 refuted', 'reading    0 tokens read by workers'];
const teamFact = (m: PanelModel, n: number): string => [m.health ? teamOf(m.health) ? `team ${teamOf(m.health)}` : '' : '', `${n} ${n === 1 ? 'worker' : 'workers'}`].filter(Boolean).join(' · ');
export function teamBody(m: PanelModel): PanelLine[] {
  const mates = m.mates ?? [];
  const lead = leadOf(m);
  const workers = workersByTask(m);
  // The lead's own activity is the whole team's: every worker's calls over the run, so its sparkline reads the pace of the run.
  const teamCalls = [...(m.lead?.calls ?? []), ...m.workers.flatMap((w) => w.calls ?? [])];
  const leadRow = lead ? { ...lead, calls: teamCalls, ...(m.run?.secs !== undefined ? { secs: m.run.secs } : {}), ...(m.run?.startMs !== undefined ? { startMs: m.run.startMs } : {}) } : undefined; // wave 32: the lead's time is the band's run clock (critique 30: lead 0:26, board 0:57)
  const everyone = [...(leadRow ? [leadRow] : []), ...workers, ...mates];
  if (!everyone.length) return m.run ? emptyTab(m, 'TEAM', teamFact(m, 0), TEAM_SKEL) : emptyHint(m, 'nobody dispatched yet');
  const alone = !!leadRow && !m.workers.length && !mates.length;
  const g = alone ? { ...teamGrid(m, everyone), sparkW: 0 } : teamGrid(m, everyone); // the lead alone has no pace to draw: no braille run until a worker gives it data
  const focusName = m.recipient && everyone.some((w) => w.name === m.recipient) ? m.recipient : workers.find((w) => w.state === 'running')?.name;
  const rows = (ws: readonly PanelWorker[]): PanelLine[] => ws.flatMap((w) => workerRows(m, w, g, w.name === focusName));
  if (leadRow && !m.workers.length && !mates.length) return m.run ? [secHead('TEAM', teamFact(m, 0), m), ...rows([leadRow]), ...emptyTab(m, '', '', TEAM_SKEL.slice(1)).slice(1)] : [...rows([leadRow]), dimLine(m, 'no workers yet')]; // nothing ran: the lead's row and one labelled line, no empty time axis and no `0 running` total (the pulse, health and recent figures are the status tab's alone: round 2, D14)
  const hint = !m.workers.length && !mates.length ? emptyHint(m, 'nobody dispatched yet') : [];
  const head = [...(leadRow ? rows([leadRow]) : []), ...hint, ...rows(workers), ...rows(mates), ...sparkAxis(m, g)];
  const body = [...head, ...(m.lead ? [BLANK, ...leadSummary(m)] : [])]; // one row per agent, at every height
  const failedNames = new Set(m.workers.filter((w) => w.state === 'failed').map((w) => w.name)); // a failure its row already says is not a post again (wave 33)
  const posts = { ...m, notes: m.notes.filter((n) => !(n.kind === 'failed' && failedNames.has(n.from)) && !/^(T\d+|row) failed\b/.test(n.text)) };
  return [...body, ...(tall(m) ? recentRows(posts, spareRows(m, body.length)) : [])]; // the last posts only on a tall pane: a short one stays one row per agent
}
/** A post as one row; `bare` leaves the text off (the rows under it read the whole message). */
function noteRow(m: PanelModel, n: PanelNote, g: { nameW: number; wordW: number; timeW: number; ageW?: number }, bare = false): PanelLine {
  const { state, word } = noteState(n);
  const ageW = g.ageW ?? 0;
  const runs = gridRow({
    cols: m.cols, ui: m.ui, mark: state ? stateRun(state, m.ui) : null,
    name: { t: n.from, bold: true }, nameW: g.nameW, gap: 2,
    ...(g.wordW ? { word: word ? { t: word, tone: noteTone(word) } : { t: '' }, wordW: g.wordW } : {}),
    ...(bare || noteText(m, n).trim() === word ? {} : { detail: { t: noteText(m, n), tone: 'text' as const } }),
    ...(g.timeW ? { value: { t: stampOf(m, n, ageW), tone: 'muted' as const } } : {}),
  });
  // The time keeps the secondary grey, the age is the dim 240 after it (wave 30).
  const last = runs[runs.length - 1];
  if (g.timeW && ageW && last && last.t === stampOf(m, n, ageW)) runs.splice(runs.length - 1, 1, r(n.at, 'muted'), r('  ', 'muted'), r(ageOfNote(m, n).padStart(ageW), 'dim'));
  return line(fitRuns(runs, m.cols));
}
const NOTE_LINES = 4; // rows one message may take on a tall pane
const NOTE_LINES_SHORT = 2; // rows one message may take on a short pane
const NOTE_INLINE_MIN = 20; // cells of text a one-row post needs beside its whole name; less and the post takes two rows

// Wave 30 (critique 28): the generated `#lc-...` slug is no part of the view. The head row says `this run` once; a named channel keeps its `#name` in the ribbon.
/** Under the log (wave 31, critique 29: the channel tab was 80% empty): what the posts add up to, from the notes the tab already holds. A count per kind (`6 posts · 1 failed · 1 blocked`). Wave 33: the `last by sender`
 * block is gone (critique 31: it repeated the log's own rows). */
function channelSummary(m: PanelModel, spare: number): PanelLine[] {
  if (!m.notes.length || spare < 3) return [];
  const kinds = new Map<string, number>();
  for (const n of m.notes) { const w = noteState(n).word; if (w) kinds.set(w, (kinds.get(w) ?? 0) + 1); }
  const counts = [`${m.notes.length} ${m.notes.length === 1 ? 'post' : 'posts'}`, ...[...kinds].map(([w, c]) => `${c} ${w}`)].join(` ${dot(m.ui)} `);
  const out: PanelLine[] = [BLANK, line(fitRuns([r(' '.repeat(GRID_LEAD)), r('posts  ', 'text', { bold: true }), r(counts, 'muted')], m.cols))];
  return [...out, ...senderRows(m, spare - out.length)];
}
/** Wave 34 (critique 33: the channel tab was 90% blank): under the counts, one row per sender: how many posts it made, when its last one came and what it said. Only what the notes hold; the newest sender first, as many as the room allows. */
function senderRows(m: PanelModel, spare: number): PanelLine[] {
  const room = Math.min(spare - 3, 8);
  if (room < 1) return [];
  const by = new Map<string, { n: number; last: PanelNote; at: number }>();
  m.notes.forEach((n, i) => { const k = by.get(n.from); by.set(n.from, { n: (k?.n ?? 0) + 1, last: n, at: i }); });
  const senders = [...by].sort((x, y) => y[1].at - x[1].at).slice(0, room);
  const who = Math.min(18, Math.max(...senders.map(([name]) => cells(name))));
  const count = Math.max(...senders.map(([, v]) => cells(`${v.n} ${v.n === 1 ? 'post' : 'posts'}`)));
  const stamp = Math.max(...senders.map(([, v]) => cells(stampOf(m, v.last))));
  return [BLANK, line(fitRuns([r(' '.repeat(GRID_LEAD)), r('senders', 'text', { bold: true })], m.cols)), ...senders.map(([name, v]): PanelLine => {
    const head = [r(' '.repeat(GRID_LEAD)), r(pad(clipE(name, who), who) + '  ', noteState(v.last).state === 'failed' ? 'bad' : 'sub'), r(pad(`${v.n} ${v.n === 1 ? 'post' : 'posts'}`, count) + '  ', 'muted'), r(pad(stampOf(m, v.last), stamp) + '  ', 'dim')];
    const left = m.cols - 1 - head.reduce((k, x) => k + cells(x.t), 0);
    return line(fitRuns([...head, r(left > 3 ? clipE(oneLine(noteText(m, v.last)), left) : '', 'muted')], m.cols));
  })];
}
/** Wave 38 (critique 37: the channel tab at 0 messages was `○ no messages` in an empty pane): the senders block still says who is on the channel: each worker (dispatch order) with the time of its last sign of life on the run's clock and its last status line. Only what the workers hold. */
function quietSenders(m: PanelModel): PanelLine[] {
  const ws = workersByTask(m).filter((w) => w.state !== 'queued');
  const room = Math.min(8, m.rows - headerRows(m).length - 6);
  if (!ws.length || room < 1) return [];
  const at = (w: PanelWorker): number | undefined => (w.state === 'done' || w.state === 'failed' ? w.endMs : [...(w.calls ?? [])].sort((a, b) => b - a)[0] ?? w.startMs);
  const shown = ws.slice(0, room);
  const who = Math.min(18, Math.max(...shown.map((w) => cells(nameOf(w)))));
  const rows = shown.map((w): PanelLine => {
    const ms = at(w);
    const time = ms === undefined ? '' : stampOf(m, { at: '', ms, from: w.name, kind: 'status', text: '' });
    const head = [r(' '.repeat(GRID_LEAD)), r(pad(clipE(nameOf(w), who), who) + '  ', w.state === 'failed' ? 'bad' : 'sub'), r(pad(time, 6) + ' ', 'dim')];
    const left = m.cols - 1 - head.reduce((k, x) => k + cells(x.t), 0);
    return line(fitRuns([...head, r(left > 3 ? clipE(lastFit(w, left), left) : '', 'muted')], m.cols));
  });
  return [BLANK, line(fitRuns([r(' '.repeat(GRID_LEAD)), r('senders', 'text', { bold: true })], m.cols)), ...rows];
}
export const channelBody = (m: PanelModel): PanelLine[] => {
  const log = channelLog(m);
  return [...log, ...(m.run && tall(m) ? channelSummary(m, m.rows - 1 - headerRows(m).length - log.length) : [])];
};
function channelLog(m: PanelModel): PanelLine[] {
  const ind = ' '.repeat(GRID_LEAD); // the indent every other tab's rows have: the name column (critique 11: the channel head sat one cell from the border)
  const count = `${m.people} ${m.people === 1 ? 'person' : 'people'}${m.unread ? ` ${dot(m.ui)} ${m.unread} unread` : ''}`;
  const title = channelLabel(m.channel);
  const head = line(fitRuns([r(`${ind}${title}  `, 'text', { bold: true }), r(count, 'muted')], m.cols));
  // Wave 32 (critique 30: `no messages yet` floated mid-pane over 90% blank): an empty channel is one left-aligned row straight under the head, the pane fill carries the surface to the foot.
  if (!m.notes.length && m.run) {
    const senders = quietSenders(m);
    return [secHead('CHANNEL', '0 messages', m), head, ...(senders.length ? senders : emptyTab(m, '', '', CHANNEL_SKEL).slice(1))];
  }
  if (!m.notes.length) {
    const senders = quietSenders(m);
    if (senders.length) return [head, ...senders, BLANK, dimLine(m, '0 messages')]; // truth 39 (live-110-1 tab-channel: `○ no messages` over a senders block): with senders shown the count sits under them, in the footer's own words
    return [head, line(fitRuns([r(`${ind}${m.ui.ascii ? GLYPH5_ASCII.idle : GLYPH5.idle} no messages`, 'dim')], m.cols))];
  } // wave 36 (critique 35: the channel tab about 95% empty): nothing said is one dim line under the head, never a block of blank rows; the status view's footer carries `0 messages`
  const wide = m.cols >= WIDE;
  const avail = tall(m) ? m.rows - headerRows(m).length - 2 : m.rows - 4; // a tall pane: the head, the log and the foot row make exactly the pane
  const ageW = !m.run && m.cols >= 50 ? Math.max(0, ...m.notes.map((n) => cells(ageOfNote(m, n)))) : 0;
  const timeW = m.cols >= 50 ? Math.max(0, ...m.notes.map((n) => cells(stampOf(m, n, ageW)))) : 0;
  const hasKind = m.notes.some((n) => noteState(n).word !== '');
  // Names are whole: the name column is the longest name that leaves the word and time columns their room (never `ghost-exp...`).
  const plan = gridPlan(m.cols, { names: m.notes.map((n) => n.from), word: hasKind ? 7 : 0, gap: 2, value: timeW, optional: true, min: 4, max: wide ? 24 : 30 });
  const g = { nameW: plan.nameW, wordW: plan.wordW, timeW: plan.valueW, ageW: plan.valueW ? ageW : 0 };
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
