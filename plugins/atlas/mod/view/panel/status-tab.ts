// status-tab.ts: the status tab of the redesigned side panel (approved mockup `status`): PHASE timeline, PLAN with its segmented bar, TEAM tally and one row per agent, SESSION key/value rows.
import { workerTally } from '../../data/tally';
import { lastText } from '../../data/lasttext';
import { cells, DONE_DOUBT, elapsedClock, stateRun, type MarkState, type Run, type Tone, type UiState } from '../../design/atlas-ui';
import { roleOf } from '../../design/theme';
import { dot, gatesOf, moving, nameOf, oneLine, r, stateMark, tallyOf, type PanelLine, type PanelModel, type PanelTodo, type PanelWorker, BLANK, phaseStand } from './panel-shared';
import { clipUi, col, g, head, kv, padR, roleRun, row, segBar, usable, w } from './tab-kit';
import { wordOf } from './pane/activity';
import { workersByTask } from './panel-rows-route';

type Stage = 'done' | 'current' | 'blocked' | 'pending' | 'skipped';
/** Where each phase stands: the stages the run entered are done, the lit one is current (blocked while the run is), the rest pending. */
function stages(m: PanelModel): Stage[] {
  const stand = phaseStand(m);
  const { seen, litAt, lastEntered } = stand;
  const kind = m.phase === 'done' && m.run?.kind !== 'blocked' ? 'done' : stand.kind; // G4: a done phase is a done run
  const lit = kind === 'done' || kind === 'idle' ? -1 : kind === 'blocked' ? Math.max(litAt, lastEntered, 0) : litAt >= 0 ? litAt : lastEntered; // G4: an unknown phase lights none
  const entered = (p: string, i: number): boolean => (m.phase === 'done' || (seen ? seen.has(p) : kind === 'idle' ? false : kind === 'done' || (litAt >= 0 && i < litAt)));
  return m.phases.map((p, i): Stage => (lit === i ? (kind === 'blocked' ? 'blocked' : 'current') : entered(p, i) ? 'done' : seen !== null && kind !== 'idle' && i < Math.max(lastEntered, lit) ? 'skipped' : 'pending'));
}

/** PHASE: dots joined by rules with the full stage name under each dot (never cut); where the names do not fit one row, `● name` chips wrap. */
/** The run's one state word at the head of PHASE: the band's own (blocked, done, working, idle). A refused Stop makes it `blocked` whatever the lead last declared. */
function runWord(m: PanelModel): Run[] {
  const ui = m.ui;
  const blocked = m.run?.kind === 'blocked' || m.phase === 'blocked' || !!tallyOf(gatesOf(m)).stop?.blocked;
  const kind = blocked ? 'blocked' : m.run?.kind ?? (m.phase === 'done' ? 'done' : m.lead?.state === 'running' || m.workers.some((x) => x.state === 'running') ? 'working' : 'idle');
  if (kind === 'blocked') return [{ ...stateRun('blocked', ui), t: `${stateRun('blocked', ui).t} `, bold: true }, r('blocked', 'bad', { bold: true })];
  if (kind === 'done') return [{ ...stateRun('done', ui), t: `${stateRun('done', ui).t} ` }, r('done', 'ok')];
  if (kind === 'working') return [{ ...stateMark('running', m, 'phase'), t: `${stateMark('running', m, 'phase').t} ` }, r('working', 'accent')];
  return [r('idle', 'muted')];
}
function phaseRows(m: PanelModel): PanelLine[] {
  const ui = m.ui;
  const title = head(m, 'PHASE', runWord(m));
  if (!m.phases.length) return [title, row(m, [r('no phases yet', 'dim')])];
  const st = stages(m);
  const glyph = (s: Stage): Run => {
    if (s === 'done') return r(g(ui, '●', '*'), 'ok', { bold: true });
    if (s === 'current') return r(g(ui, '◉', '@'), 'accent', { bold: true });
    if (s === 'blocked') return { ...stateRun('blocked', ui), bold: true };
    return r(s === 'skipped' ? g(ui, '–', '-') : g(ui, '○', 'o'), 'dim');
  };
  const nameTone = (s: Stage): { tone: Tone; bold?: boolean } => (s === 'current' ? { tone: 'accent', bold: true } : s === 'blocked' ? { tone: 'bad', bold: true } : s === 'done' ? { tone: 'sub' } : { tone: 'dim' });
  const U = usable(m);
  const n = m.phases.length;
  const lens = m.phases.map((p) => [...p].length);
  const need = Math.max(0, ...lens.slice(0, -1)) + 1;
  const last = lens[n - 1]!;
  const sw = n > 1 ? Math.min(14, Math.floor((U - last) / (n - 1))) : 0; // a segment is at most 14 cells: a wide pane keeps the timeline compact
  if (n > 1 && sw >= need) {
    const dots: Run[] = m.phases.flatMap((_, i): Run[] => [glyph(st[i]!), ...(i < n - 1 ? [r(g(ui, '─', '-').repeat(sw - 1), st[i] === 'done' ? 'ok' : 'dim')] : [])]);
    const names: Run[] = m.phases.map((p, i) => r(i < n - 1 ? padR(p, sw) : p, nameTone(st[i]!).tone, nameTone(st[i]!).bold ? { bold: true } : {}));
    return [title, BLANK, { runs: [r(' '), ...dots] }, { runs: [r(' '), ...names] }];
  }
  const items: Run[][] = m.phases.map((p, i) => [{ ...glyph(st[i]!), t: `${glyph(st[i]!).t} ` }, r(p, nameTone(st[i]!).tone, nameTone(st[i]!).bold ? { bold: true } : {})]);
  const rows: Run[][] = [[]];
  for (const it of items) {
    const cur = rows[rows.length - 1]!;
    if (cur.length && w(cur) + 2 + w(it) > U) rows.push([...it]);
    else cur.push(...(cur.length ? [r('  ')] : []), ...it);
  }
  return [title, BLANK, ...rows.map((x) => row(m, x))];
}

const secsOf = (m: PanelModel, t: PanelTodo): number | undefined => (t.owner ? m.workers.find((x) => x.name === t.owner)?.secs : undefined);
const TIME_W = 6;
/** The mark of a row: the state glyph, the spinner turning with the shared clock. */
const markOf = (m: PanelModel, s: UiState, id: string): Run => ({ ...stateMark(s as MarkState, m, id) });

/** A title cut to `room` cells; where the title names its owner in its own words (`T1 read a.py (alpha-explorer)`) the cut falls in the words before it, so the owner's name is never the part that is cut. */
function ownerKept(ui: PanelModel['ui'], label: string, owner: string | undefined, room: number): string {
  if (cells(label) <= room) return label;
  const paren = /\s\(([^()]+)\)$/.exec(label); // the owner a title names in a trailing `(name)`
  const i = owner && label.includes(owner) ? label.indexOf(owner) : paren ? paren.index + 2 : -1;
  if (i > 0) {
    const open = label[i - 1] === '(' ? i - 1 : i;
    const tail = label.slice(open);
    if (cells(tail) + 3 <= room) return `${clipUi(ui, label.slice(0, open).trimEnd(), room - cells(tail) - 1)} ${tail}`;
  }
  return label;
}
/** One plan row: glyph, label, owner (info), time flush right. */
/** G1: the HUD's doubt rule. A row the lead closed over a failed worker (`done` + `closed`) reads failed (red ✗), never the green done and never the word `closed`. */
const doubted = (t: PanelTodo): PanelTodo => (t.state === 'done' && t.word === DONE_DOUBT ? { ...t, state: 'failed', word: undefined } : t);
function planRow(m: PanelModel, t: PanelTodo, ow: number): PanelLine {
  // (the owner column is blank on a row whose title already names its owner)
  const ui = m.ui;
  const U = usable(m);
  const running = t.state === 'running';
  const tone: Tone = t.state === 'done' ? 'muted' : t.state === 'failed' ? 'bad' : t.state === 'blocked' ? 'warn' : t.state === 'queued' ? 'sub' : 'text';
  const secs = secsOf(m, t);
  const time = t.state !== 'queued' && secs !== undefined ? elapsedClock(secs) : '-';
  const timeTone: Tone = running ? 'text' : time === '-' ? 'dim' : 'muted';
  const labelW = Math.max(6, U - 1 - 2 - (ow ? ow : 0) - TIME_W);
  const key = `task:${t.id}`;
  const runs: Run[] = [
    r(' '), { ...markOf(m, t.state, t.id), t: `${markOf(m, t.state, t.id).t} ` },
    col(ui, ownerKept(ui, oneLine(t.label), t.owner, labelW - 2), labelW, tone, running ? { bold: true } : {}),
    ...(ow ? [col(ui, t.owner && !oneLine(t.label).includes(t.owner) ? t.owner : '', ow, 'info')] : []),
    col(ui, time, TIME_W, timeTone, running ? { bold: true } : {}, true),
  ];
  const out = moving(runs, key, t.state as MarkState, m);
  return { runs: [r(' '), ...out], press: { kind: 'toggle', key } };
}
/** A state word the glyph alone does not say (`returned`, a failed or blocked row's reason), as a dim line under its row when the pane has the room. */
function planDetail(m: PanelModel, t: PanelTodo): PanelLine[] {
  const word = t.word ?? (t.state === 'failed' || t.state === 'blocked' || t.state === 'waiting' ? wordOf(t.state) : '');
  const text = [word, t.state === 'failed' || t.state === 'blocked' ? oneLine(t.detail) : ''].filter(Boolean).join(` ${dot(m.ui)} `);
  if (!text) return [];
  const tone: Tone = t.state === 'failed' ? 'bad' : t.state === 'blocked' ? 'warn' : 'muted';
  return [row(m, [r(clipUi(m.ui, text, usable(m) - 6), tone)], [], undefined, 4)];
}
const expandedRows = (m: PanelModel, t: PanelTodo): PanelLine[] => (m.expanded === `task:${t.id}` ? [row(m, [r(clipUi(m.ui, `${t.id}${t.evidence ? ` · ${oneLine(t.evidence)}` : ''}`, usable(m) - 6), 'muted')], [], undefined, 4)] : []);

function planRows(m: PanelModel, cap = Infinity): PanelLine[] {
  const ui = m.ui;
  const todos = m.todos.map(doubted);
  const total = todos.length;
  if (!total) return [head(m, 'PLAN', [], [r('  no tasks yet', 'muted')])];
  const done = todos.filter((t) => t.state === 'done').length;
  const running = todos.filter((t) => t.state === 'running').length;
  const U = usable(m);
  const shown = todos.slice(0, Math.max(1, cap));
  // a title that names its owner in its own words prints the owner once (in the title): only the other rows need the owner column
  const longest = Math.max(0, ...shown.map((x) => (x.owner && !oneLine(x.label).includes(x.owner) ? cells(x.owner) : 0)));
  const ow = U >= 44 && longest > 0 ? Math.max(12, Math.min(24, longest + 2, U - 9 - 16)) : 0; // the owner column holds the longest owner whole, with its 2-cell gutter
  const more = total - shown.length;
  const fig = [r(`  ${done} of ${total}  `, 'sub'), ...segBar(ui, done, running, total)];
  return [
    head(m, 'PLAN', [], fig),
    ...shown.flatMap((t) => [planRow(m, t, ow), ...planDetail(m, t), ...expandedRows(m, t)]),
    ...(more > 0 ? [row(m, [r(`+${more} more`, 'dim')], [], undefined, 2)] : []),
  ];
}

/** The tally words of the team: `● 2 running  ✓ 3 done  ✗ 1 failed`, only the states that hold a worker. */
function tallyRuns(m: PanelModel, ws: readonly PanelWorker[]): Run[] {
  const t = workerTally(ws);
  const order: UiState[] = ['running', 'waiting', 'blocked', 'queued', 'done', 'failed'];
  return order.filter((s) => t[s] > 0).flatMap((s, i): Run[] => {
    const mk = stateRun(s as MarkState, m.ui);
    const tone: Tone = s === 'running' ? 'accent' : s === 'done' ? 'ok' : s === 'failed' ? 'bad' : s === 'blocked' ? 'warn' : 'sub';
    return [r(i ? '  ' : '  '), { ...mk, t: `${mk.t} `, tone }, r(`${t[s]} ${wordOf(s)}`, tone)];
  });
}
function teamRow(m: PanelModel, wk: PanelWorker): PanelLine {
  const ui = m.ui;
  const U = usable(m);
  const role = wk.role && wk.role !== 'unknown' ? wk.role : roleOf(undefined, wk.name);
  const roleW = U >= 50 ? 13 : 0;
  const longest = Math.max(10, ...m.workers.map((x) => cells(nameOf(x)) + 2));
  // G5: a wide pane keeps the longest name whole while 8 cells stay for the NOW column; the ellipsis is only for a name that truly does not fit
  const nameW = Math.min(longest, U >= 56 ? Math.max(24, U - 1 - 2 - roleW - TIME_W - 8) : U >= 44 ? 20 : Math.max(8, U - 1 - 2 - TIME_W));
  const nowW = Math.max(0, U - 1 - 2 - nameW - roleW - TIME_W);
  const key = `worker:${wk.name}`;
  const running = wk.state === 'running';
  const time = wk.secs !== undefined && wk.state !== 'queued' ? elapsedClock(wk.secs) : '-';
  const nowTone: Tone = wk.state === 'failed' ? 'bad' : 'muted';
  const mk = markOf(m, wk.state, wk.name);
  const runs: Run[] = [
    r(' '), { ...mk, t: `${mk.t} `, ...(running ? { bold: true } : {}) },
    col(ui, nameOf(wk), nameW, 'text', running ? { bold: true } : {}),
    ...(roleW ? [{ ...roleRun(padR(clipUi(ui, role, roleW - 2), roleW), role, ui) }] : []),
    ...(nowW >= 8 ? [col(ui, oneLine(lastText(wk.detail)), nowW, nowTone)] : []),
    col(ui, time, TIME_W, running ? 'text' : 'sub', {}, true),
  ];
  return { runs: [r(' '), ...moving(runs, key, wk.state as MarkState, m)], press: { kind: 'worker', key, name: wk.name } };
}
function teamDetail(m: PanelModel, wk: PanelWorker): PanelLine[] {
  if (m.expanded !== `worker:${wk.name}`) return [];
  const how = [wk.model, wk.tools !== undefined ? `${wk.tools} tool calls` : ''].filter(Boolean).join(' · ');
  const goal = oneLine(wk.goal);
  const last = oneLine(lastText(wk.detail)); // a project-directory slug never reaches the rows (lasttext)
  return [goal ? ['task', goal] : null, how ? ['model', how] : null, last ? ['last', last] : null]
    .filter((x): x is [string, string] => !!x)
    .map(([k, v]) => row(m, [r(padR(k, 6), 'muted'), r(clipUi(m.ui, v, usable(m) - 10), 'sub')], [], undefined, 4));
}
function teamRows(m: PanelModel, cap = Infinity): PanelLine[] {
  const ws = workersByTask(m); // one stable order, by task then dispatch: the SUBAGENTS table's own (a worker keeps its row whatever its state)
  if (!ws.length) return [head(m, 'TEAM', [], [r('  no agents yet', 'muted')])];
  const shown = ws.slice(0, Math.max(1, cap));
  const more = ws.length - shown.length;
  return [head(m, 'TEAM', [], tallyRuns(m, ws)), ...shown.flatMap((x) => [teamRow(m, x), ...teamDetail(m, x)]), ...(more > 0 ? [row(m, [r(`+${more} more`, 'dim')], [], undefined, 2)] : [])];
}

/** SESSION: what the mod really holds (uptime, branch, last run, release); nothing it does not have. */
function sessionRows(m: PanelModel): PanelLine[] {
  const h = m.health;
  if (!h) return [];
  const ui = m.ui;
  const rows: PanelLine[] = [];
  const up = h.upSecs;
  if (up !== undefined) rows.push(kv(m, '  uptime', [r(up >= 3600 ? `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m` : `${Math.floor(up / 60)}m`, 'text')], 12));
  if (h.branch) rows.push(kv(m, '  branch', [r(h.branch, 'text')], 12));
  if (h.last) {
    const ok = h.last.failed === 0;
    rows.push(kv(m, '  last run', [{ ...stateRun(ok ? 'done' : 'failed', ui), t: `${stateRun(ok ? 'done' : 'failed', ui).t} ${h.last.secs !== undefined ? elapsedClock(h.last.secs) : ''}`.trimEnd() }, r(`  ${h.last.done}/${h.last.total} done`, 'muted')], 12));
  }
  if (h.version) rows.push(kv(m, '  release', [r(h.version, 'text')], 12));
  return rows.length ? [head(m, 'SESSION'), ...rows] : [];
}

/** The whole status tab; the PLAN and TEAM lists give up rows (never the sections) when the pane is shorter than they are. */
export function statusRows(m: PanelModel, room: number): PanelLine[] {
  const build = (np: number, nt: number, session = true): PanelLine[] => {
    const parts = [phaseRows(m), planRows(m, np), teamRows(m, nt), ...(session ? [sessionRows(m)] : [])].filter((p) => p.length);
    return parts.flatMap((p, i) => (i ? [BLANK, ...p] : p));
  };
  let np = Infinity;
  let nt = Infinity;
  let rows = build(np, nt);
  if (room > 0) {
    np = m.todos.length;
    nt = m.workers.length;
    while (rows.length > room && (np > 3 || nt > 2)) {
      if (np > 3 && np >= nt) np--; else if (nt > 2) nt--; else np--;
      rows = build(np, nt);
    }
    // still too tall: the lists shrink to one row each, then SESSION goes; PHASE, PLAN and TEAM stay
    while (rows.length > room && (np > 1 || nt > 1)) { if (np > 1) np--; else nt--; rows = build(np, nt); }
    if (rows.length > room) rows = build(np, nt, false);
  }
  return rows;
}
