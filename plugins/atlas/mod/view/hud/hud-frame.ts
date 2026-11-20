import { cells, clipEll, ellOf, markOf, PALETTE5, PALETTES, RETURNED, runsCells, stateGlyph, stateRun, surfaceHex, roleHex, type MarkState, type Run, type Tone, type Ui, type UiState } from '../../design/atlas-ui';
import { roleOf } from '../../design/theme';
import { blockSpark } from '../../design/chart';
import { noteWorkerFacts } from '../../data/live';
import { planFigure } from '../board/board-model';
import { animateBandRow, breathHex, flashFrame, sweepRuns } from '../../motion/rows';
import { calmRun, mixHex } from '../../motion/motion';
import { bottomRule, flat, gridWord, isFailedRow, markRun, NONE, overflowRow, planWindow, reasonOf, resultOf, KILLED, STOPPED, REASON_MIN, tallyStates, titleSpinOf, windowRows, type AgentRow, type BlockOpts, type SurfaceOpts, type TodoRow, actionOutcome, planCount } from './hud-model';

// ---- primitives ------------------------------------------------------------------------------------------------------

/** The faint tone of the box chrome and of empty cells (`-`): rules, borders, corners. */
const faint = (text: string, ui: Pick<Ui, 'theme'>): Run => ({ t: text, tone: 'dim', ...(ui.theme === 'latte' ? {} : { fg: PALETTE5.dim }) });
/** The dim text tone: column names, done rows, results. One step under the secondary tone, still legible. */
const dimText = (text: string, ui: Pick<Ui, 'theme'>, extra: Partial<Run> = {}): Run => ({ t: text, tone: 'muted', ...(ui.theme === 'latte' ? {} : { fg: PALETTE5.pending }), ...extra });
const t = (text: string, tone: Tone = 'text', extra: Partial<Run> = {}): Run => ({ t: text, tone, ...extra });
const titleRun = (text: string): Run => ({ t: text, tone: 'text', bold: true });

/** The fill of the focus row. */
const focusBg = (ui: Pick<Ui, 'theme'>): string => (ui.theme === 'latte' ? PALETTES.latte.queued_fill : PALETTE5.rule); // the one selection fill of every surface (xterm 236)

/** `text` in exactly `w` cells: cut with the ellipsis so it leaves a 2-cell gutter before the next column (a right-aligned or 3-cell column has no gutter), then padded. */
function fitCell(text: string, w: number, right: boolean, ell: string): string {
  const width = Math.max(0, w);
  if (width === 0) return "";
  const room = right || width <= 3 ? width : width - 2;
  const cut = cells(text) > room ? clipEll(text, Math.max(1, room), ell) : text;
  const gap = Math.max(0, width - cells(cut));
  return right ? ' '.repeat(gap) + cut : cut + ' '.repeat(gap);
}

/** Runs cut to at most `n` cells (by code point). */
function clipRuns(runs: readonly Run[], n: number): Run[] {
  const out: Run[] = [];
  let used = 0;
  for (const x of runs) {
    const w = cells(x.t);
    if (used + w <= n) { out.push(x); used += w; continue; }
    let cut = '';
    for (const ch of x.t) { if (used + cells(cut + ch) > n) break; cut += ch; }
    if (cut !== '') out.push({ ...x, t: cut });
    break;
  }
  return out;
}

/** A box's top edge in exactly `cols` cells: `╭─ TITLE ───── right ─╮`, the first `right` form that fits (else none). `flat`: no corners (`── TITLE ─────`), for a block drawn with no bottom rule. ASCII: `+- TITLE ---- right -+`. */
function boxTop(cols: number, title: string, forms: readonly (readonly Run[])[], ui: Ui, flat = false): Run[] {
  const rule = ui.ascii ? '-' : '─';
  const lead = ui.ascii ? (flat ? '-- ' : '+- ') : flat ? '── ' : '╭─ ';
  const corner = flat ? rule : ui.ascii ? '+' : '╮';
  const room = Math.max(0, cols - cells(lead) - 1 - 1);
  const head = [faint(lead, ui), titleRun(cells(title) > room ? clipEll(title, Math.max(1, room), ellOf(ui)) : title), faint(' ', ui)];
  for (const right of [...forms, [] as Run[]]) {
    const tail: Run[] = right.length ? [faint(' ', ui), ...right, faint(` ${rule}${corner}`, ui)] : [faint(`${rule}${corner}`, ui)];
    const used = runsCells(head) + runsCells(tail);
    const fill = cols - used;
    if (fill >= (right.length ? 1 : 0)) return [...head, ...(fill > 0 ? [faint(rule.repeat(fill), ui)] : []), ...tail];
  }
  return clipRuns(head, cols);
}

/** A body row in exactly `cols` cells: the left border (or the accent `▌` bar of the focus row), the content, blank fill, the right border. The focus row sits on the focus fill. */
function framed(content: readonly Run[], cols: number, ui: Ui, o: { focus?: boolean } = {}): Run[] {
  const inner = Math.max(0, cols - 2);
  const body = clipRuns(content, inner);
  const pad = inner - runsCells(body);
  const fill = o.focus && ui.color !== 'none' ? { bgHex: focusBg(ui) } : {};
  const left: Run = o.focus ? { t: ui.ascii ? '>' : '▌', tone: 'accent', bold: true, ...fill } : { ...faint(ui.ascii ? '|' : '│', ui), ...fill };
  const right: Run = { ...faint(ui.ascii ? '|' : '│', ui), ...fill };
  const rows: Run[] = [...body, ...(pad > 0 ? [t(' '.repeat(pad))] : [])].map((x) => (o.focus && ui.color !== 'none' ? { ...x, ...fill } : x)); // the same run objects at rest: a calm cell keeps its mark
  return [left, ...rows, right];
}

/** An empty block of the fixed shape: the closed box with one quiet row. */
const emptyBox = (o: SurfaceOpts, title: string, text: string): Run[][] => [boxTop(o.cols, title, [], o.ui), framed([t('  '), dimText(text, o.ui)], o.cols, o.ui), bottomRule(o.cols, o.ui)];

// ---- the TODO progress bar -------------------------------------------------------------------------------------------

const BAR_MAX = 12;
/** One cell per plan item (scaled past BAR_MAX), ordered done, failed, running, other open, queued: done green, failed red, running accent (it breathes under a motion ctx), queued faint. */
function planBar(rows: readonly TodoRow[], o: SurfaceOpts): Run[] {
  const { ui } = o;
  const on = ui.ascii ? '#' : '▰';
  const off = ui.ascii ? '-' : '▱';
  const count = (f: (r: TodoRow) => boolean): number => rows.filter(f).length;
  const groups: { n: number; tone: Tone; mark: string }[] = [
    { n: count((r) => r.state === 'done' && !isFailedRow(r)), tone: 'ok', mark: on },
    { n: count(isFailedRow), tone: 'bad', mark: ui.ascii ? '!' : on },
    { n: count((r) => r.state === 'running'), tone: 'accent', mark: on },
    { n: count((r) => (r.state === 'blocked' || r.state === 'waiting') && !isFailedRow(r)), tone: 'warn', mark: on },
    { n: count((r) => r.state === 'queued'), tone: 'dim', mark: off },
  ];
  const total = rows.length;
  const scale = total > BAR_MAX ? BAR_MAX / total : 1;
  const sized = groups.map((g) => ({ ...g, n: g.n === 0 ? 0 : Math.max(1, Math.round(g.n * scale)) }));
  let over = sized.reduce((n, g) => n + g.n, 0) - Math.min(total, BAR_MAX);
  for (let i = sized.length - 1; over > 0 && i >= 0; i--) { const cut = Math.min(over, Math.max(0, sized[i]!.n - 1)); sized[i]!.n -= cut; over -= cut; }
  const now = o.motion?.now;
  const flash = now === undefined ? -1 : Math.min(...rows.map((r) => (r.key === undefined ? 9 : flashFrame(o.motion!.entry(r.key), now) < 0 ? 9 : flashFrame(o.motion!.entry(r.key), now))));
  const fresh = flash === 0 || flash === 1; // a finished item's cell: bright and bold on the frame it finishes, bold in the done green on the next, then plain
  const out: Run[] = [];
  sized.forEach((g) => {
    if (g.n <= 0) return;
    if (g.tone === 'dim') { out.push(faint(g.mark.repeat(g.n), ui)); return; }
    if (g.tone === 'ok' && fresh && ui.color !== 'none') { out.push(t(g.mark.repeat(g.n - 1), 'ok'), t(g.mark, 'ok', { bold: true, ...(flash === 0 ? { fg: mixHex(PALETTES[ui.theme].ok, PALETTES[ui.theme].white, 0.5) } : {}) })); return; }
    if (g.tone === 'accent' && now !== undefined && ui.color !== 'none') { out.push(t(g.mark.repeat(g.n), 'accent', { fg: breathHex(now, ui) })); return; }
    out.push(t(g.mark.repeat(g.n), g.tone));
  });
  return out.filter((x) => x.t !== '');
}

// ---- TODO ------------------------------------------------------------------------------------------------------------

const LEAD = 3; // inside the borders: a blank, the glyph, a blank
const ITEM_MAX = 60;
const ITEM_W = 44;
const longest = (xs: readonly string[]): number => xs.reduce((n, x) => Math.max(n, cells(x)), 0);
/** The owner of a plan row: the agent that works it, by its display name; a retry names its live instance (`beta-explorer #2`). */
const ownerOf = (r: TodoRow): string => { const o = flat(r.owner ?? ''); return /\s#\d+$/.test(o) ? o : flat(r.agent ?? o); };
const timeOf = (r: TodoRow): string => flat(r.agentTime ?? '');
const isEmpty = (s: string): boolean => s === '' || s === NONE;

type TodoCols = { itemW: number; stateW: number; ownerW: number; timeW: number };
/** The TODO grid: ITEM takes what it needs (at most ITEM_MAX), then STATE, OWNER and TIME; OWNER shrinks, then goes, before ITEM is cut under 16 cells; a column nobody fills is not drawn. */
function todoCols(rows: readonly TodoRow[], cols: number): TodoCols {
  const avail = cols - 2 - LEAD - 1;
  const label = longest(rows.map((r) => flat(r.label)));
  const stateW = Math.max(10, longest(rows.map(gridWord)) + 2);
  const owners = rows.map(ownerOf).filter((x) => !isEmpty(x));
  const times = rows.map(timeOf).filter((x) => !isEmpty(x));
  const ownerWant = owners.length === 0 ? 0 : Math.max(18, Math.min(24, longest(owners) + 2));
  const timeWant = times.length === 0 ? 0 : cols >= 80 ? Math.max(7, longest(times)) : Math.max(5, longest(times));
  const want = Math.min(ITEM_MAX, Math.max(ITEM_W, label + 2)); // a fixed grid per width (frames never reflow as titles come and go); only a title past ITEM_W widens it
  const itemMin = Math.min(want, 16);
  const owner = ownerWant === 0 ? [0] : [ownerWant, Math.min(ownerWant, 14), Math.min(ownerWant, 10), 0];
  for (const ownerW of owner) {
    const itemW = avail - stateW - ownerW - timeWant;
    if (itemW >= itemMin) return { itemW: Math.min(itemW, Math.max(want, 6)), stateW, ownerW, timeW: timeWant };
  }
  const itemW = avail - stateW;
  if (itemW >= Math.min(want, 12)) return { itemW: Math.min(itemW, Math.max(want, 6)), stateW, ownerW: 0, timeW: 0 };
  const narrow = avail < 7 ? 0 : Math.min(stateW, 8); // under 13 cells there is no room for a state word: the glyph and the label stay
  return { itemW: Math.max(1, avail - narrow), stateW: narrow, ownerW: 0, timeW: 0 };
}

/** The tone and weight of a row's state word: green done, accent running, red failed, amber waiting, quiet queued. */
function stateWord(r: Pick<TodoRow, 'state' | 'word'>, text: string, ui: Ui, focus: boolean): Run {
  if (r.word === RETURNED) return t(text, 'sub', focus ? { bold: true } : {}); // a hand-back is no fault: the neutral word
  if (isFailedRow(r) || r.state === 'failed' || r.state === 'blocked') return t(text, 'bad', focus ? { bold: true } : {});
  if (r.state === 'running') return t(text, 'accent', focus ? { bold: true } : {});
  if (r.state === 'done') return t(text, 'ok', focus ? { bold: true } : {});
  if (r.state === 'waiting') return t(text, 'warn', focus ? { bold: true } : {});
  return dimText(text, ui);
}

/** The dim column-name cell of a box header: `h(text, width, right?)`. */
const headCell = (ui: Ui) => {
  const ell = ellOf(ui);
  return (text: string, w: number, right = false): Run => dimText(fitCell(text, w, right, ell), ui);
};

function todoHeader(lay: TodoCols, o: SurfaceOpts): Run[] {
  const { ui } = o;
  const h = headCell(ui);
  return framed([t(' '.repeat(LEAD)), h('ITEM', lay.itemW), h('STATE', lay.stateW), ...(lay.ownerW ? [h('OWNER', lay.ownerW)] : []), ...(lay.timeW ? [h('TIME', lay.timeW, true)] : [])], o.cols, ui);
}

function todoRow(r: TodoRow, o: SurfaceOpts, lay: TodoCols): Run[] {
  const { ui, cols } = o;
  const ell = ellOf(ui);
  const mark = markOf(r.state, r.word);
  const finished = r.state === 'done' && mark !== 'doubt';
  const queued = r.state === 'queued';
  const focus = r.focus && !queued;
  const bold = focus ? { bold: true } : {};
  const glyph = { ...markRun(mark, o), ...bold };
  const labelBase: Omit<Run, 't'> = finished ? { ...dimText('', ui) } : { tone: queued ? 'sub' : 'text', ...bold };
  const label = sweepRuns(fitCell(flat(r.label), lay.itemW, false, ell), labelBase, r.state === 'running' ? o.motion?.now : undefined, ui);
  const word = fitCell(gridWord(r), lay.stateW, false, ell);
  const owner = ownerOf(r);
  const time = timeOf(r);
  const cellOwner = (w: number): Run => {
    const text = fitCell(isEmpty(owner) ? NONE : owner, w, false, ell);
    return calmRun(isEmpty(owner) ? faint(text, ui) : finished ? dimText(text, ui) : t(text, owner === 'lead' ? 'sub' : 'blue')); // the owner never changes with the row's state; the lead is quiet, an agent's name reads blue
  };
  const cellTime = (w: number): Run => {
    const text = fitCell(isEmpty(time) ? NONE : time, w, true, ell);
    return calmRun(isEmpty(time) ? faint(text, ui) : finished ? dimText(text, ui) : t(text, 'text', bold)); // and its clock only freezes
  };
  const why = reasonOf(r);
  const grid = lay.itemW + lay.stateW + lay.ownerW + lay.timeW;
  const tailRoom = cols - 2 - LEAD - grid - 1 - 2;
  const body: Run[] = [t(' '), glyph, t(' '), ...label, stateWord(r, word, ui, focus)];
  let row: Run[];
  if (why === '') {
    row = [...body, ...(lay.ownerW ? [cellOwner(lay.ownerW)] : []), ...(lay.timeW ? [cellTime(lay.timeW)] : [])];
  } else if (tailRoom >= REASON_MIN) {
    row = [...body, ...(lay.ownerW ? [cellOwner(lay.ownerW)] : []), ...(lay.timeW ? [cellTime(lay.timeW)] : []), t('  '), dimText(clipEll(why, tailRoom, ell), ui)]; // a stuck row says why past its clock
  } else {
    const room = Math.max(1, lay.ownerW + lay.timeW || cols - 2 - LEAD - lay.itemW - lay.stateW - 1); // no room past the clock: the reason takes the owner and clock cells
    row = [...body, dimText(clipEll(why, room, ell), ui)];
  }
  const out = framed(row, cols, ui, { focus });
  return r.key === undefined ? out : animateBandRow(out, r.key, mark, o.motion, ui);
}

/** The count figure and the bar on the top rule, in the forms the width allows: `2/7 ▰▰▰▱▱▱▱`, then the figure alone. */
function todoTitle(rows: readonly TodoRow[], o: SurfaceOpts, flatTop: boolean): Run[] {
  const { ui } = o;
  const { failed, done, plain, failMark, figures } = planCount(rows, ui, stateGlyph('failed', ui));
  const bar = planBar(rows, o);
  const fig = (f: string): Run => t(f, 'sub');
  return boxTop(o.cols, 'TODO', [...figures.map((f) => [fig(f), t(' '), ...bar]), ...figures.map((f) => [fig(f)])], ui, flatTop);
}

export function todoBox(rows: readonly TodoRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  if (rows.length === 0) return o.reserve ? emptyBox(o, 'TODO', o.healthLine ? 'plan rows appear here' : 'no tasks yet') : [];
  const { ui, cols } = o;
  const flatTop = b.close === false || b.cap === 0; // a title alone has no box to close
  const top = todoTitle(rows, o, flatTop);
  if (b.cap === 0) return [top];
  const { shown, summary, counts } = planWindow(rows, b.cap, o.now, b.foldDone === true, ui, titleSpinOf(o));
  const lay = todoCols(rows, cols);
  const out: Run[][] = [top];
  if (b.header ?? b.spacers) out.push(todoHeader(lay, o));
  for (const r of shown) out.push(todoRow(r, o, lay));
  if (summary) out.push(framed(overflowRow(counts, ui, cols - 1, titleSpinOf(o)), cols, ui));
  if (b.close === true && out.length > 1) out.push(bottomRule(cols, ui));
  return out;
}

// ---- SUBAGENTS -------------------------------------------------------------------------------------------------------

const ACT_W = 10;
const ACT_CELLS = 8;
const CALLS_W = 6;
const FN_W = 4;

/** What one agent row says, before layout. */
type Facts = { a: AgentRow; name: string; role: string; state: string; now: string; act: string; calls: string; fn: string; time: string };

const fnOf = (a: AgentRow): string => /^(\d+) fn$/.exec(resultOf(a))?.[1] ?? NONE;
/** NOW / RESULT: the current call of a live agent, the outcome of a finished one (never a restatement of its FN figure), `stopped` for a failed one with nothing to say. */
function nowOf(a: AgentRow): string {
  const { action, outcome } = actionOutcome(a);
  if (a.state === 'queued') return NONE; // dispatched, not started: nothing to say yet
  if (a.state === 'failed') return outcome || STOPPED;
  if (a.state === 'done') return (resultOf(a) !== NONE && fnOf(a) !== NONE && /^\d+\s+(?:function|functions|fn)\b/i.test(outcome) ? '' : outcome) || action || 'finished';
  return outcome || action || 'working';
}
const isOpen = (s: UiState): boolean => s === 'running' || s === 'blocked' || s === 'waiting';

function factsOf(rows: readonly AgentRow[], o: SurfaceOpts): Facts[] {
  const { ui } = o;
  return rows.map((a): Facts => {
    const time = a.elapsed && a.elapsed !== NONE ? a.elapsed : NONE;
    const calls = a.calls !== undefined && a.calls > 0 ? String(a.calls) : NONE;
    noteWorkerFacts([flat(a.name), flat(a.id ?? '')], time, calls); // the worker cards print these two cells (data/live workerFacts)
    const name = flat(a.name) || flat(a.id ?? '') || 'agent';
    const role = roleOf(a.persona, name);
    const act = isOpen(a.state) && a.act !== undefined ? blockSpark(a.act, ACT_CELLS, { ascii: ui.ascii, min: 4 }) : '';
    return { a, name, role: role === 'unknown' ? '' : role, state: a.state === 'failed' && a.tool === KILLED ? KILLED : a.state, now: nowOf(a), act, calls, fn: fnOf(a), time };
  });
}

type AgentCols = { agentW: number; roleW: number; stateW: number; nowW: number; actW: number; callsW: number; fnW: number; timeW: number };
/** The SUBAGENTS grid: AGENT, ROLE, STATE, NOW / RESULT, ACT, CALLS, FN, TIME. Columns nobody fills are dropped; under width pressure CALLS and FN go first, then ACT, ROLE, then NOW. */
function agentCols(facts: readonly Facts[], cols: number): AgentCols {
  const avail = cols - 2 - LEAD - 1;
  const stateW = Math.max(10, longest(facts.map((f) => f.state)) + 2);
  const agentWant = Math.max(cols >= 80 ? 22 : 12, longest(facts.map((f) => f.name)) + 2); // a fixed grid per width; only a longer name widens it
  const roles = facts.map((f) => f.role).filter((x) => x !== '');
  const roleWant = roles.length === 0 ? 0 : Math.max(8, Math.min(13, longest(roles) + 2));
  const nowWant = Math.max(34, Math.min(60, longest(facts.map((f) => f.now)) + 2));
  const has = { act: facts.some((f) => f.act !== ''), calls: facts.some((f) => f.calls !== NONE), fn: facts.some((f) => f.fn !== NONE), time: facts.some((f) => f.time !== NONE) };
  const wide = cols >= 80;
  type Cfg = { role: boolean; act: boolean; calls: boolean; fn: boolean; timeW: number; now: boolean };
  const full: Cfg = { role: roleWant > 0, act: has.act, calls: has.calls, fn: has.fn, timeW: has.time ? Math.max(wide ? 7 : 5, longest(facts.map((f) => f.time))) : 0, now: true };
  const cfgs: Cfg[] = [full, { ...full, calls: false, fn: false }, { ...full, calls: false, fn: false, act: false }, { ...full, calls: false, fn: false, act: false, role: false }, { ...full, calls: false, fn: false, act: false, role: false, now: false }];
  for (const c of cfgs) {
    const roleW = c.role ? roleWant : 0;
    const actW = c.act ? ACT_W : 0;
    const callsW = c.calls ? CALLS_W : 0;
    const fnW = c.fn ? FN_W : 0;
    const rem = avail - stateW - roleW - actW - callsW - fnW - c.timeW;
    if (!c.now) return { agentW: Math.max(1, Math.min(agentWant, rem)), roleW, stateW, nowW: 0, actW, callsW, fnW, timeW: c.timeW };
    const nowMin = c.role ? 14 : 10; // ROLE goes before NOW / RESULT shrinks under 14 cells; the name keeps up to 20 whole cells before either gives
    if (rem >= Math.min(agentWant, 20) + nowMin) {
      const agentW = Math.min(agentWant, rem - nowMin);
      return { agentW, roleW, stateW, nowW: Math.min(nowWant, rem - agentW), actW, callsW, fnW, timeW: c.timeW };
    }
  }
  return { agentW: 1, roleW: 0, stateW, nowW: 0, actW: 0, callsW: 0, fnW: 0, timeW: 0 };
}

function agentHeader(lay: AgentCols, o: SurfaceOpts): Run[] {
  const { ui } = o;
  const h = headCell(ui);
  return framed([
    t(' '.repeat(LEAD)), h('AGENT', lay.agentW), ...(lay.roleW ? [h('ROLE', lay.roleW)] : []), h('STATE', lay.stateW), ...(lay.nowW ? [h(lay.nowW >= 16 ? 'NOW / RESULT' : 'NOW', lay.nowW)] : []),
    ...(lay.actW ? [h('ACT', lay.actW)] : []), ...(lay.callsW ? [h('CALLS', lay.callsW, true)] : []), ...(lay.fnW ? [h('FN', lay.fnW, true)] : []), ...(lay.timeW ? [h('TIME', lay.timeW, true)] : []),
  ], o.cols, ui);
}

/** What every cell of one agent row reads: the row's state flags, its bold, the ellipsis. */
type RowCtx = { ui: Ui; ell: string; bold: { bold?: boolean }; done: boolean; failed: boolean; focus: boolean; state: UiState };

function rowCtx(f: Facts, ui: Ui): RowCtx {
  const { a } = f;
  return { ui, ell: ellOf(ui), bold: a.focus ? { bold: true } : {}, done: a.state === 'done', failed: a.state === 'failed', focus: !!a.focus, state: a.state };
}

function agentGlyph(o: SurfaceOpts, c: RowCtx): Run {
  const { ui } = c;
  return c.state === 'running' ? { ...stateRun('running', ui, titleSpinOf(o)), ...(ui.ascii ? {} : { tone: 'accent' as const }), ...c.bold } : { ...stateRun(c.state, ui), ...c.bold };
}

function agentNameRun(f: Facts, lay: AgentCols, c: RowCtx): Run {
  return t(fitCell(f.name, lay.agentW, false, c.ell), c.done || c.failed ? 'sub' : 'text', c.bold);
}

function agentRoleRun(f: Facts, lay: AgentCols, c: RowCtx): Run {
  const roleFg = f.role === '' || c.failed ? undefined : roleHex(f.role, c.ui.color, c.ui.theme);
  return calmRun(f.role === '' ? faint(fitCell(NONE, lay.roleW, false, c.ell), c.ui) : t(fitCell(f.role, lay.roleW, false, c.ell), 'sub', roleFg ? { fg: roleFg } : {})); // a role never changes with the state
}

function agentStateWordRun(f: Facts, lay: AgentCols, c: RowCtx): Run {
  const text = fitCell(f.state, lay.stateW, false, c.ell);
  if (c.failed) return t(text, 'bad', c.bold);
  if (c.done) return t(text, 'ok', c.bold);
  if (c.state === 'running') return t(text, 'accent', c.bold);
  if (c.state === 'queued') return dimText(text, c.ui);
  return t(text, c.state === 'blocked' ? 'bad' : 'warn', c.bold);
}

function agentNowRun(f: Facts, lay: AgentCols, c: RowCtx): Run {
  const text = fitCell(f.now, lay.nowW, false, c.ell);
  if (c.failed) return t(text, 'bad');
  return c.done ? dimText(text, c.ui) : t(text, c.focus ? 'text' : 'sub');
}

/** A right-aligned figure (CALLS, FN, TIME): faint when empty, dim on a finished row, else `tone` (TIME reads `text` on a live row). */
function agentFigureRun(text: string, w: number, c: RowCtx, liveTone: Run['tone']): Run {
  const cell = fitCell(text, w, true, c.ell);
  if (text === NONE) return faint(cell, c.ui);
  return c.done || c.failed ? dimText(cell, c.ui) : t(cell, liveTone, c.bold);
}

function agentRow(f: Facts, o: SurfaceOpts, lay: AgentCols): Run[] {
  const { ui, cols } = o;
  const { a } = f;
  const c = rowCtx(f, ui);
  const liveFigure = c.focus ? 'text' : 'sub';
  const row: Run[] = [
    t(' '), agentGlyph(o, c), t(' '), agentNameRun(f, lay, c), ...(lay.roleW ? [agentRoleRun(f, lay, c)] : []), agentStateWordRun(f, lay, c), ...(lay.nowW ? [agentNowRun(f, lay, c)] : []),
    ...(lay.actW ? [t(f.act.padEnd(lay.actW), 'accent')] : []),
    ...(lay.callsW ? [agentFigureRun(f.calls, lay.callsW, c, liveFigure)] : []), ...(lay.fnW ? [agentFigureRun(f.fn, lay.fnW, c, liveFigure)] : []),
    ...(lay.timeW ? [agentFigureRun(f.time, lay.timeW, c, 'text')] : []),
  ];
  const out = framed(row, cols, ui, { focus: c.focus });
  return a.key === undefined ? out : animateBandRow(out, a.key, a.state as MarkState, o.motion, ui);
}

/** `● 2 running  ✓ 3 done  ✗ 1 failed`: only the parts that are not zero, in the order of the states that need a look first. */
function agentCounts(rows: readonly AgentRow[], ui: Ui, short: boolean): Run[] {
  const n = (s: UiState): number => rows.filter((r) => r.state === s).length;
  const parts: { s: UiState; glyph: string; tone: Tone; word: string }[] = [
    { s: 'running', glyph: ui.ascii ? '+' : '●', tone: 'accent', word: 'running' },
    { s: 'blocked', glyph: stateGlyph('blocked', ui), tone: 'bad', word: 'blocked' },
    { s: 'failed', glyph: stateGlyph('failed', ui), tone: 'bad', word: 'failed' },
    { s: 'waiting', glyph: stateGlyph('waiting', ui), tone: 'warn', word: 'waiting' },
    { s: 'queued', glyph: stateGlyph('queued', ui), tone: 'muted', word: 'queued' },
    { s: 'done', glyph: stateGlyph('done', ui), tone: 'ok', word: 'done' },
  ];
  return parts.filter((p) => n(p.s) > 0).flatMap((p, i): Run[] => [...(i > 0 ? [t(short ? ' ' : '  ')] : []), t(`${p.glyph} ${n(p.s)}${short ? '' : ` ${p.word}`}`, ui.ascii ? 'text' : p.tone)]);
}

/** The agents the box lists, in dispatch order. A queued dispatch is listed unless the block is merged with the plan (`queued: false`): there it is a child of the plan, not an agent. */
export function listedAgents(rows: readonly AgentRow[], merged = false): AgentRow[] {
  const all = rows.map((a, i) => ({ a, i })).filter((x) => !merged || x.a.state !== 'queued');
  return (merged ? all.sort((x, y) => (x.a.seq ?? x.i) - (y.a.seq ?? y.i) || x.i - y.i) : all).map((x) => x.a); // merged: dispatch order (seq) so a row never moves; else the order the caller gave
}

export function agentBox(rows: readonly AgentRow[], o: SurfaceOpts, b: BlockOpts): Run[][] {
  const { ui, cols } = o;
  const all = listedAgents(rows, b.queued === false);
  if (all.length === 0) return o.reserve ? emptyBox(o, 'SUBAGENTS', o.healthLine ? 'agents appear here' : 'none running yet') : [];
  const flatTop = b.close === false || b.cap === 0; // a title alone has no box to close
  const top = boxTop(cols, 'SUBAGENTS', [agentCounts(all, ui, false), agentCounts(all, ui, true)], ui, flatTop);
  if (b.cap === 0) return [top];
  const w = b.cap === undefined || b.cap >= all.length ? { shown: all, hidden: 0 } : windowRows(all, b.cap, o.now, false);
  const shown = all.filter((a) => w.shown.includes(a));
  const facts = factsOf(all, o);
  const lay = agentCols(facts, cols);
  const out: Run[][] = [top];
  if (b.header ?? b.spacers) out.push(agentHeader(lay, o));
  for (const f of facts) if (shown.includes(f.a)) out.push(agentRow(f, o, lay));
  const gone = w.hidden > 0 && b.quiet !== true ? tallyStates(all.filter((a) => !shown.includes(a))) : {};
  if (Object.keys(gone).length > 0) out.push(framed(overflowRow(gone, ui, cols - 1, titleSpinOf(o)), cols, ui));
  if (b.close === true && shown.length > 0) out.push(bottomRule(cols, ui));
  return out;
}
