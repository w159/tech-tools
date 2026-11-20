// gates-tab.ts: the gates tab of the redesigned side panel (approved mockup `gates`): the passed / denied header, a grid of gate names with their mark, DENIED cards (red rule, code, reason, fix) and a TIMELINE of checks.
// Gate rows are the groups' own lines (the one gate evaluation, data/runstate); the timeline is the hook events the pulse counted, with the last denial marked.
import { cells, stateRun, type Run, type Tone } from '../../design/atlas-ui';
import { agoText } from '../../data/idle-health';
import { dataCell, dataStateOf } from '../../data/datastate';
import { BLANK, countedGates, gatesOf, moving, oneLine, r, type PanelGate, type PanelGateLine, type PanelLine, type PanelModel } from './panel-shared';
import { clipUi, col, g, head, row, usable, wrapWords } from './tab-kit';
import { gatesFigure } from './panel-tabs';

type Entry = { label: string; ok: boolean; pending: boolean; line?: PanelGateLine; group: PanelGate };
const entriesOf = (m: PanelModel): Entry[] =>
  countedGates(gatesOf(m)).flatMap((gr) =>
    gr.error && !gr.lines.length ? [{ label: gr.title || gr.id, ok: false, pending: false, group: gr } as Entry]
      : gr.lines.map((l): Entry => ({ label: l.label || l.id, ok: l.ok, pending: !!l.pending, line: l, group: gr })));

function cardRows(m: PanelModel, e: Entry, ago: string): PanelLine[] {
  const ui = m.ui;
  const U = usable(m);
  const bar = (tone: Tone = 'bad', bold = false): Run => r(`${g(ui, '▌', '|')} `, tone, bold ? { bold: true } : {});
  const detail = e.line ? oneLine(e.line.detail) : `unavailable: ${oneLine(e.group.error)}`; // a group whose source could not be read says so
  const fix = oneLine(e.line?.fix);
  const out: PanelLine[] = [{ runs: [r(' '), ...lrCard(m, [bar('bad', true), r(clipUi(ui, e.label, Math.max(4, U - 2 - ago.length - 4)), 'bad', { bold: true })], ago ? [r(ago, 'dim')] : [])] }];
  if (detail) for (const t of wrapWords(ui, detail, Math.max(8, U - 2), 6)) out.push({ runs: [r(' '), bar(), r(t, 'text')] });
  // the fix line: a press opens it, a second press copies the command (the row's `copy`)
  if (fix) out.push({ runs: [r(' '), bar(), r('fix  ', 'muted'), r(clipUi(ui, fix, Math.max(4, U - 2 - 5)), 'cyan')], press: { kind: 'toggle', key: `fix:${e.group.id}:${e.line?.id ?? ''}`, copy: fix } });
  return out;
}
/** A card's header row without the leading gutter (the caller adds it): left part, the time flush right. */
function lrCard(m: PanelModel, left: Run[], right: Run[]): Run[] {
  const U = usable(m);
  const lw = left.reduce((n, x) => n + [...x.t].length, 0);
  const rw = right.reduce((n, x) => n + [...x.t].length, 0);
  return [...left, ...(rw ? [r(' '.repeat(Math.max(1, U - lw - rw))), ...right] : [])];
}

/** The timeline of checks over the last five minutes: a tick per 15-second bucket that saw hook events, the bucket of the last denial `┃` red. */
function timeline(m: PanelModel): PanelLine[] {
  const ui = m.ui;
  const h = m.health;
  const ev = h?.pulse?.events;
  if (!h || !ev || !ev.length) return [];
  const n = Math.min(ev.length, Math.max(8, usable(m) - 4));
  const buckets = ev.slice(-n);
  const denied = h.denyAgeSecs !== undefined ? n - 1 - Math.floor(h.denyAgeSecs / 15) : -1;
  const ticks: Run[] = buckets.map((v, i) => (i === denied ? r(g(ui, '┃', '#'), 'bad', { bold: true }) : v > 0 ? r(g(ui, '│', '|'), 'ok') : r(g(ui, '·', '.'), 'dim')));
  const mins = Math.max(1, Math.round((n * 15) / 60));
  return [
    BLANK,
    head(m, 'TIMELINE', [], [r('  each tick one gate check', 'muted')]),
    { runs: [r('  '), ...ticks] },
    row(m, [r(`-${mins}m`, 'muted')], [r('now', 'muted')], undefined, 1),
  ];
}

const markOf = (m: PanelModel, s: 'done' | 'failed'): string => stateRun(s, m.ui).t;

/** The GATES header and its blank: passed / denied counts, and how the gates were read. */
function gatesHeader(m: PanelModel, es: Entry[], denied: Entry[]): PanelLine[] {
  const ui = m.ui;
  const fig = gatesFigure(m);
  const passed = es.filter((e) => e.ok && !e.pending).length;
  const right: Run[] = [r(`${markOf(m, 'done')} ${passed}`, 'ok', { bold: true }), r(`   ${markOf(m, 'failed')} ${fig.deny || denied.length}`, 'bad', { bold: true })];
  // M6: how the gates were read: a failed read is `err`, a snapshot older than its refresh interval is `~` with its real age
  const rd = m.read;
  const state = rd ? dataStateOf({ has: true, failed: !!rd.failed?.gates, ...(rd.ageSecs !== undefined ? { ageSecs: rd.ageSecs } : {}), ...(rd.refreshSecs !== undefined ? { refreshSecs: rd.refreshSecs } : {}) }) : undefined;
  const readMark = state ? dataCell(state, ui.ascii) : '';
  return [head(m, 'GATES', right, [r('  this run', 'muted'), ...(readMark ? [r(` ${readMark}`, state!.kind === 'error' ? 'bad' : 'warn')] : [])]), BLANK];
}

/** Identical rows (one label, one verdict) are one cell with a `×N` count: `Native Read calls ×4`. */
function gridCells(es: Entry[]): { e: Entry; n: number }[] {
  const grid: { e: Entry; n: number }[] = [];
  for (const e of es) {
    const p = grid[grid.length - 1];
    if (p && p.e.label === e.label && p.e.ok === e.ok && p.e.pending === e.pending && !p.e.line?.detail && !e.line?.detail) p.n++;
    else grid.push({ e, n: 1 });
  }
  return grid;
}

/** One grid cell: the mark and the gate name; a gate that changes state eases in (mod/motion). */
function gridCellRuns(m: PanelModel, e: Entry, label: string, cw: number): Run[] {
  const ui = m.ui;
  const mark = e.pending ? stateRun('queued', ui) : stateRun(e.ok ? 'done' : 'failed', ui);
  const cell: Run[] = [{ ...mark, t: `${mark.t} `, ...(e.ok ? {} : { bold: true }) }, col(ui, label, cw - 2, e.ok ? 'sub' : 'bad')];
  return e.line ? moving(cell, `gate:${e.line.id}`, e.ok ? 'done' : 'blocked', m) : cell;
}

/** The grid: as many columns as the width holds, each `✓ name`. */
function gateGrid(m: PanelModel, es: Entry[]): PanelLine[] {
  const ui = m.ui;
  const U = usable(m);
  const grid = gridCells(es);
  const labelOf = (e: Entry, n: number): string => (n > 1 ? `${e.label} ${g(ui, '×', 'x')}${n}` : e.label);
  const longest = Math.max(...grid.map(({ e, n }) => cells(labelOf(e, n))));
  // as many columns as the width holds without cutting the longest name (a narrow pane lists one gate per row)
  const ncols = Math.max(1, Math.min(4, Math.floor((U - 1) / 14), Math.floor((U - 2) / (longest + 4))));
  const cw = Math.floor((U - 2) / ncols);
  const out: PanelLine[] = [];
  for (let i = 0; i < grid.length; i += ncols) {
    const cellRuns = grid.slice(i, i + ncols).flatMap(({ e, n }) => gridCellRuns(m, e, labelOf(e, n), cw));
    out.push({ runs: [r('  '), ...cellRuns] });
  }
  return out;
}

/** The DENIED section: a card per denied gate, the newest denial's age on the first. */
function deniedSection(m: PanelModel, denied: Entry[]): PanelLine[] {
  const rows: PanelLine[] = [BLANK, head(m, 'DENIED')];
  if (!denied.length) rows.push(row(m, [r(`${markOf(m, 'done')} nothing denied`, 'ok')], [], undefined, 1));
  const ago = m.health?.denyAgeSecs !== undefined ? `${agoText(m.health.denyAgeSecs)} ago` : '';
  denied.forEach((e, i) => rows.push(BLANK, ...cardRows(m, e, i === 0 ? ago : '')));
  return rows;
}

export function gatesRows(m: PanelModel): PanelLine[] {
  const es = entriesOf(m);
  if (!es.length) return [head(m, 'GATES'), BLANK, row(m, [r('no gates reported yet', 'muted')], [], undefined, 1)];
  const denied = es.filter((e) => !e.ok);
  return [...gatesHeader(m, es, denied), ...gateGrid(m, es), ...deniedSection(m, denied), ...timeline(m)];
}
