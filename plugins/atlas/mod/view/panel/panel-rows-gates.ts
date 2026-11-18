// panel-rows-gates.ts: panel-layout split (audit 4.3, stage S14): gates and core bodies.
import { checkOff, gateDot, gateLine } from '../../design/vocab';
import { cells, GRID_LEAD, gridPlan, stateRun, gateMark, type Run, type Tone, type Ui, type UiState } from '../../design/atlas-ui';
import { clipE } from '../board/board-model';
import { hasCore, plannedText, tok, type CoreModel, type Verdict } from '../../data/core';
import { type PanelModel, type PanelLine, line, fitRuns, r, type PanelGateLine, oneLine, dot, moving, type PanelGate, groupFailing, groupPending, gridRow, groupMark, groupOk, countedGates, gatesOf, sep, rowWidth, coreMark, label, BLANK } from './panel-shared';
import { wrap, GATE_WORD_W, tall, spareRows, SPILL_BELOW } from './panel-rows-route';
import { emptyTab, GATES_SKEL, emptyHint, CORE_SKEL } from './panel-rows-team';
import { headerRows } from './panel-tabs';

const note = (t: string, m: PanelModel): PanelLine => line(fitRuns([r(`    ${t}`, 'muted')], m.cols));
/** The one reading of `verified n/m` that the gates tab (`Verified finding recorded`) and the core tab (`verified n/m`) both draw: the verified done items over the plan's items (never a
 * dispatch row's count: 5 plan items read `0/5`, not `0/8`). `waived`: the figure is short and Stop's own gate passes, so the run needs no verified finding (`not required`). Null without a core. */
export function verifiedFigure(m: Pick<PanelModel, 'todos' | 'gates' | 'core'>): { ok: number; total: number; waived: boolean } | null {
  const t = m.core?.contract.verifiedDone;
  if (!t || !t.total) return null;
  const total = m.todos.length > 0 ? m.todos.length : t.total;
  const ok = Math.min(t.ok, total);
  return { ok, total, waived: ok < total && m.gates.some((g) => g.lines.some((l) => l.id === VERIFIED_GATE && l.ok)) };
}
const VERIFIED_GATE = 'b'; // atlas_gates.py: `Verified finding recorded`

function gateLineRows(m: PanelModel, ln: PanelGateLine): PanelLine[] {
  const key = `gate:${ln.id}`;
  const open = m.expanded === key;
  const [first = '', ...more] = wrap(oneLine(ln.label), Math.max(8, m.cols - 6));
  const extra = open ? [ln.detail, ln.fix ? `fix: ${ln.fix} (press to copy)` : undefined].filter((x): x is string => !!x) : [];
  // The verified line says what the core tab says (one source, verifiedFigure): a short figure the Stop gate waives is `◇ 0/5 not required`, never a green `●` beside a core `verified 0/5`.
  const vf = ln.id === VERIFIED_GATE ? verifiedFigure(m) : null;
  const waived = !!vf?.waived;
  // Round 3 (E5): a check that is off (`Team mode: off`) is the grey `○` of a gate that has not fired, never the green dot.
  const off = ln.ok && checkOff(ln.label, ln.detail);
  const dot = gateDot(ln.ok ? 1 : 0, ln.ok ? 0 : 1, { off }, m.ui.ascii);
  const mk = ln.pending || waived ? stateRun('queued', m.ui) : off ? { t: dot.glyph, tone: dot.tone } : ln.ok ? stateRun('done', m.ui) : gateMark(m.ui);
  const figure = waived && vf ? `${vf.ok}/${vf.total} not required` : '';
  const beside = figure && cells(first) + GRID_LEAD + 2 + 2 + cells(figure) <= m.cols - 1;
  return [
    // Design rev 5, C2: a check hangs under its group's title: the mark sits at the title's first letter, the label two cells on.
    // A row with nothing to open (no detail, no fix) is a leaf: no press, so no caret (round 3, E8).
    line(moving([r(' '.repeat(GRID_LEAD)), { ...mk, t: `${mk.t} ` }, r(first), ...(beside ? [r(`  ${figure}`, 'muted')] : [])], key, ln.ok && !waived ? 'done' : waived ? 'queued' : 'blocked', m), ln.detail || ln.fix ? { kind: 'toggle', key, ...(open && ln.fix ? { copy: ln.fix } : {}) } : undefined),
    ...(figure && !beside ? [note(`  ${figure}`, m)] : []),
    ...more.map((t) => note(`  ${t}`, m)), ...extra.map((t) => note(`  ${oneLine(t)}`, m)),
  ];
} // `passing` and `warning`
/** `8 pass · 0 deny`: the group's checks in the one vocabulary (mod/design/vocab.ts), the value column of every group (a count per group, dim while the group passes, warn while it fails). */
const gateValue = (g: PanelGate, ui: Ui): string => {
  if (!g.lines.length) return '';
  // Critique 19 C4: the header contract is judged over replies, not lines: its own tally (the transcript's), never `0/1` beside 7 chips. Round 2 (D4): the one vocabulary, `8 pass · 0 deny`, never a ratio.
  const tally = g.id === 'header' ? /^(\d+) of (\d+)$/.exec(g.lines.find((l) => l.id === 'header-matched')?.detail ?? '') : null;
  const pass = tally ? Number(tally[1]) : g.lines.length - groupFailing(g);
  const total = tally ? Number(tally[2]) : g.lines.length;
  return gateLine('', pass, total, ui.ascii).count;
};
function gateGroupRows(m: PanelModel, g: PanelGate, nameW: number, showValue: boolean, all = false): PanelLine[] {
  const bad = groupFailing(g);
  const key = `group:${g.id}`;
  const first = g.lines.find((l) => !l.ok);
  const open = all || m.expanded === key || g.lines.some((l) => m.expanded === `gate:${l.id}`);
  // What is wrong follows the word: the first fix, else (while the group is closed) the failing check's name. Once the checks are listed the name is
  // their own row, never said twice; a passing group says nothing here (a check's detail belongs to its row, never beside another's name).
  const tail = g.error ? `unavailable: ${oneLine(g.error)}` : bad ? oneLine(first?.fix ?? (open ? '' : first?.label)) : '';
  const pend = groupPending(g);
  const word = bad || g.error ? 'warning' : pend ? 'pending' : 'passing';
  // The green count is the right-aligned value; the tail follows the word when it fits whole, else wraps under.
  const value = showValue ? gateValue(g, m.ui) : '';
  const fixed = GRID_LEAD + nameW + 2 + GATE_WORD_W + (value ? cells(value) + 1 : 0) + 1;
  const fits = !tail || cells(tail) <= m.cols - fixed;
  const runs = gridRow({
    cols: m.cols, ui: m.ui, mark: groupMark(g, m.ui),
    name: { t: oneLine(g.title), bold: true }, nameW, gap: 2, word: { t: word, tone: bad || g.error ? 'warn' : pend ? 'muted' : 'ok' }, wordW: GATE_WORD_W,
    ...(fits && tail ? { detail: { t: tail } } : {}), ...(value ? { value: { t: value, tone: bad ? 'warn' as const : 'muted' as const } } : {}),
  });
  return [
    line(fitRuns(moving(runs, key, groupOk(g) ? 'done' : 'blocked', m), m.cols), { kind: 'toggle', key }),
    ...(!showValue && gateValue(g, m.ui) ? [note(gateValue(g, m.ui), m)] : []),
    ...(fits ? [] : wrap(tail, Math.max(8, m.cols - 6)).map((t) => note(t, m))),
    ...(open ? g.lines.flatMap((l) => gateLineRows(m, l)) : []),
  ];
}
export function gatesBody(m: PanelModel): PanelLine[] {
  const gs = countedGates(gatesOf(m)); // the groups the tally counts: one with no data is not a gate yet
  if (!gs.length) return m.run ? emptyTab(m, 'GATES', '0 gates', GATES_SKEL) : emptyHint(m, 'no gates reported yet');
  const valueW = Math.max(0, ...gs.map((g) => cells(gateValue(g, m.ui))));
  const longest = Math.min(24, Math.max(1, ...gs.map((g) => cells(oneLine(g.title)))));
  // The failing count is the first column to go: the name keeps its whole width, the count moves into the row below.
  const plan = gridPlan(m.cols, { names: gs.map((g) => oneLine(g.title)), word: GATE_WORD_W, gap: 2, value: valueW, optional: true, min: longest, max: 24 });
  const nameW = plan.nameW;
  const build = (all: ReadonlySet<string>): PanelLine[] => gs.flatMap((g) => gateGroupRows(m, g, nameW, plan.valueW > 0, all.has(g.id)));
  const base = build(new Set());
  if (!tall(m)) return base;
  // A tall pane: the rows left open the groups' checks, the failing groups first, each group whole or not at all.
  let spare = spareRows(m, base.length);
  const all = new Set<string>();
  for (const g of [...gs.filter((x) => !groupOk(x)), ...gs.filter(groupOk)]) {
    const cost = m.expanded === `group:${g.id}` ? 0 : g.lines.flatMap((l) => gateLineRows(m, l)).length;
    if (cost && cost <= spare) { all.add(g.id); spare -= cost; }
  }
  return all.size ? build(all) : base;
}
// ---- core (contract, verdicts, offload, route) ------------------------------------------------------------------------------------

const heading = (title: string, figures: Run[], m: PanelModel): PanelLine => line(fitRuns([r(`${' '.repeat(GRID_LEAD)}${title}`, 'muted', { bold: true }), ...(figures.length ? [r('  '), ...figures] : [])], m.cols));
const tallyTone = (ok: number, total: number): Tone => (!total ? 'muted' : ok === total ? 'text' : 'warn');
const joinSep = (parts: Run[], ui: Ui): Run[] => parts.flatMap((p, i) => (i ? [sep(ui), p] : [p]));
/** A heading and its figures, wrapped by whole figure: a figure that does not fit moves to the next row (indented under the first), it is never cut. */
function flowHeading(title: string, parts: readonly string[], m: PanelModel): PanelLine[] {
  const indent = GRID_LEAD + cells(title) + 2; // the heading sits in the name column like every other tab's rows (critique 14: flush against the border)
  const rows: Run[][] = [[r(`${' '.repeat(GRID_LEAD)}${title}`, 'muted', { bold: true }), r('  ')]];
  let used = indent;
  for (const p of parts) {
    const first = used === indent;
    if (cells(p) > m.cols - indent) { // a figure wider than the row wraps on its words, it is never cut mid-phrase
      const [head, ...rest] = wrap(p, Math.max(8, m.cols - indent), 3);
      if (!first) rows.push([r(' '.repeat(indent))]);
      rows[rows.length - 1]!.push(r(head ?? '', 'text'));
      for (const t of rest) rows.push([r(' '.repeat(indent)), r(t, 'text')]);
      used = m.cols;
      continue;
    }
    const w = cells(p) + (first ? 0 : 2);
    if (!first && used + w > m.cols) { rows.push([r(' '.repeat(indent))]); used = indent; }
    rows[rows.length - 1]!.push(r(used === indent ? p : `, ${p}`, 'text'));
    used += used === indent ? cells(p) : w;
  }
  return rows.map((runs) => line(fitRuns(runs, m.cols)));
}
const VERDICT: Record<Verdict['status'], { s: UiState; word: string; tone: Tone }> = {
  verified: { s: 'done', word: 'verified', tone: 'ok' },
  rejected: { s: 'failed', word: 'refuted', tone: 'bad' },
  'needs-evidence': { s: 'blocked', word: 'needs evidence', tone: 'warn' },
};
const VERDICT_WORD_W = Math.max(...Object.values(VERDICT).map((v) => v.word.length));
const VERDICT_ID_W = 15;
/** Rows each core section lists by default (the newest); a tall pane trades them against its height (coreBody). */
const VERDICT_CAP = 8;
const OFFLOAD_CAP = 8;
const TEAM_CAP = 6;
/** The first of `forms` (richest first) that fits `room` cells, else the last: a sentence is shortened on purpose before it is cut or wrapped (critique 14, the 110-column pane). */
const pickForm = (forms: readonly string[], room: number): string => forms.find((f) => cells(f) <= room) ?? forms[forms.length - 1]!;
/** A row and the sentence that follows it: beside the row when the whole sentence fits the cells left, else wrapped on its words onto the rows under it, indented
 * (critique 14, the 110-column pane: `5 done withou...` was cut while the sentence fits a row of its own). Nothing is ever cut with `...`. */
function withRoom(runs: Run[], text: string, m: PanelModel): PanelLine[] {
  if (!text) return [line(fitRuns(runs, m.cols))];
  if (cells(text) + 1 <= m.cols - rowWidth(runs)) return [line(fitRuns([...runs, r(` ${text}`, 'muted')], m.cols))];
  return [line(fitRuns(runs, m.cols)), ...wrap(text, Math.max(8, m.cols - GRID_LEAD - 1), 4).map((t) => line(fitRuns([r(`${' '.repeat(GRID_LEAD)}${t}`, 'muted')], m.cols)))];
}
/** `contract`: `evidence` and `verified`, each `glyph name  n/m` over the plan's items (the denominator of the band's `todo n/m`; the done items when the pane has no
 * plan). The header tally counts replies, a different unit: it lives on the gates tab (Header contract), not here. */
function contractRows(c: CoreModel, m: PanelModel): PanelLine[] {
  const { evidence: e } = c.contract;
  const plan = m.todos.length;
  // The plan's items are the denominator and the cap of every figure (never `8 of 8` over a 5-item plan: dispatch rows are not items); the verified figure is the gates tab's own (verifiedFigure).
  const over = (t: { ok: number; total: number }): { ok: number; total: number } => (plan > 0 && t.total > 0 ? { ok: Math.min(t.ok, plan), total: plan } : t);
  const vf = verifiedFigure(m);
  // A figure short of its plan says why, in the row: `evidence 0/5  5 done without evidence`, `verified 0/5  0 verified findings so far`. The verified row is present for every plan, so the
  // gates and core tabs always carry the verified count against the plan denominator (critique 12 B1, B6: a bare zero beside `todo 5/5` read as a defect).
  const why = (name: string, t: { ok: number; total: number }): string => (!t.total || t.ok === t.total ? '' : name === 'evidence' ? `${t.total - t.ok} done without evidence` : `${c.ledger.verified} verified finding${c.ledger.verified === 1 ? '' : 's'} so far`);
  // [name, the figure shown over the plan, the done items' own tally (the mark and the tone read it: amber when one lacks evidence), waived]
  const items: [string, { ok: number; total: number }, { ok: number; total: number }, boolean][] = [
    ['evidence', over(e), e, e.total > 0 && e.ok < e.total && m.gates.some((g) => g.lines.some((l) => l.id === 'a' && l.ok))],
    ['verified', vf ?? over(c.contract.verifiedDone), c.contract.verifiedDone, !!vf?.waived],
  ];
  const shown = over(e);
  return [
    // Critique 18 A5: a plain heading with its own figure (`done items  5 of 5`), never the bare word `contract` over two rows.
    heading('done items', [r(e.total > 0 || plan > 0 ? `${plan > 0 ? Math.min(e.total, plan) : e.total} of ${plan > 0 ? plan : e.total}` : 'none yet', 'muted')], m),
    ...items.flatMap(([name, t, own, waived]): PanelLine[] => {
      const runs = gridRow({
        cols: m.cols, ui: m.ui, mark: coreMark(!own.total || waived ? 'queued' : own.ok === own.total ? 'done' : 'blocked', m.ui),
        name: { t: name }, nameW: 8, word: { t: t.total ? `${t.ok}/${t.total}` : 'none yet', tone: waived ? 'muted' : tallyTone(own.ok, own.total) }, wordW: 8,
      });
      return withRoom(runs, waived ? (name === 'evidence' ? 'not required for this run' : `${why(name, t)}, not required for this run`) : why(name, t), m); // a waived verified row keeps the true count: the verdict line the live scorer reads (gates metric 66.7 at 95c4a588)
    }),
  ];
}
function verdictRows(c: CoreModel, m: PanelModel, cap = VERDICT_CAP): PanelLine[] {
  const l = c.ledger;
  const none = l.verified + l.refuted + l.pending === 0;
  const figures = none
    ? joinSep([r('no verdicts yet', 'muted'), ...(l.unchecked ? [r(`${l.unchecked} unchecked`, 'warn')] : [])], m.ui)
    : joinSep([
      r(`${l.verified} verified`, l.verified ? 'ok' : 'muted'), r(`${l.refuted} refuted`, l.refuted ? 'bad' : 'muted'),
      ...(l.pending ? [r(`${l.pending} open`, 'warn')] : []), ...(l.unchecked ? [r(`${l.unchecked} unchecked`, 'warn')] : []),
    ], m.ui);
  const shown = c.verdicts.slice(-cap);
  const owners = c.claims.filter((x) => x.status === 'DONE' && x.matched === null);
  const plan = gridPlan(m.cols, { names: [...shown.map((v) => oneLine(v.id)), ...owners.map((x) => x.owner)], word: VERDICT_WORD_W, min: 6, max: VERDICT_ID_W });
  const rows = shown.flatMap((v): PanelLine[] => {
    const look = VERDICT[v.status];
    const key = `core:v:${v.id}`;
    const checked = c.claims.find((x) => x.matched === v.id);
    const open = m.expanded === key;
    const detail = open ? [checked ? `checks the done claim of ${checked.owner}` : 'no worker claim before it', `by ${v.by}`, `evidence: ${oneLine(v.evidence) || 'none recorded'}`] : [];
    const verdictRow = (withTitle: boolean): Run[] => gridRow({
      cols: m.cols, ui: m.ui, mark: coreMark(look.s, m.ui), name: { t: oneLine(v.id) }, nameW: plan.nameW,
      word: { t: look.word, tone: look.tone, bold: v.status === 'rejected' }, wordW: VERDICT_WORD_W, ...(withTitle ? { detail: { t: oneLine(v.title) } } : {}),
    });
    // A pane narrower than SPILL_BELOW (the 110-column pane) puts the title beside the verdict when it fits, else on the rows under it: never cut with `...`.
    const head = m.cols < SPILL_BELOW ? withRoom(verdictRow(false), oneLine(v.title), m) : [line(fitRuns(verdictRow(true), m.cols))];
    return [
      { ...head[0]!, press: { kind: 'toggle', key } },
      ...head.slice(1),
      ...detail.map((t) => line(fitRuns([r(`    ${t}`, 'muted')], m.cols))),
    ];
  });
  const unchecked = owners.map((x) => line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: gateMark(m.ui), name: { t: x.owner }, nameW: plan.nameW,
    word: { t: 'unchecked', tone: 'warn' }, wordW: VERDICT_WORD_W, detail: { t: 'says done, no verdict yet' },
  }), m.cols)));
  return [heading('verdicts', figures, m), ...(rows.length || unchecked.length || none ? [...rows, ...unchecked] : [line([r('    no verdict recorded yet', 'muted')])])];
}
/** Offload in plain words: what each worker read, and what it returned to the lead. Figures keep their whole width; the name column gives way. */
function offloadRows(c: CoreModel, m: PanelModel, cap = OFFLOAD_CAP): PanelLine[] {
  const o = c.offload;
  const pct = o.kept > 0 && o.returned <= o.kept ? Math.max(1, Math.round((o.returned / o.kept) * 100)) : null;
  const nothing = o.kept === 0 && o.returned === 0;
  const gone = m.workers.filter((w) => w.state === 'done' || w.state === 'failed').length; // in-process workers keep no token log: they returned, the figure is absent
  const head = flowHeading('reading', nothing ? [gone ? pickForm([`${gone} worker${gone === 1 ? '' : 's'} finished`, `${gone} finished`], m.cols - GRID_LEAD - cells('reading') - 2) :'workers have read and returned nothing yet'] :[`${tok(o.kept)} tokens read by workers`, `${tok(o.returned)} returned to the lead`, ...(pct !== null ? [`${pct}% of what they read`] : [])], m);
  const ws = o.workers.slice(-cap);
  if (!ws.length) return head;
  const model = (w: (typeof ws)[number]): string => clipE((w.model ?? '?').replace(/^claude-/, ''), 12);
  const cost = (w: (typeof ws)[number]): string => (w.costUsd === null ? '' : `$${w.costUsd.toFixed(2)}`);
  const col = (label: string, f: (w: (typeof ws)[number]) => string): ((w: (typeof ws)[number]) => string) => {
    const wd = Math.max(...ws.map((w) => cells(f(w))));
    return (w) => `${label} ${f(w).padStart(wd)}`;
  };
  const peak = col('peak', (w) => tok(w.peak));
  const read = col('read', (w) => tok(w.kept));
  const back = col('returned', (w) => tok(w.returned));
  const dollars = (w: (typeof ws)[number]): string => cost(w).padStart(Math.max(...ws.map((x) => cells(cost(x)))));
  // Richest first; the first form that leaves the name column 10 cells (or the longest name) is the one every row uses.
  const forms: { word: boolean; cells: ((w: (typeof ws)[number]) => string)[] }[] = [
    { word: true, cells: [peak, read, back, dollars] }, { word: false, cells: [read, back, dollars] }, { word: false, cells: [read, back] }, { word: false, cells: [back] },
  ];
  const names = ws.map((w) => w.name);
  const need = Math.min(10, Math.max(...names.map(cells)));
  const text = (f: (typeof forms)[number], w: (typeof ws)[number]): string => f.cells.map((x) => x(w)).filter(Boolean).join('  ');
  const form = forms.find((f) => m.cols - GRID_LEAD - (f.word ? 13 : 0) - Math.max(...ws.map((w) => cells(text(f, w)))) - 1 >= need) ?? forms[forms.length - 1]!;
  const vw = Math.max(...ws.map((w) => cells(text(form, w))));
  const plan = gridPlan(m.cols, { names, word: form.word ? 12 : 0, value: vw, min: need, max: 18 });
  return [...head, ...ws.map((w) => line(fitRuns(gridRow({
    cols: m.cols, ui: m.ui, mark: null, name: { t: w.name }, nameW: plan.nameW,
    ...(form.word ? { word: { t: model(w), tone: 'sub' as const }, wordW: 12 } : {}), value: { t: text(form, w), tone: 'text' },
  }), m.cols)))];
}
/** The seat row's figure is how many agents ran; a seat that has not run yet shows its planned count. */
const seatCount = (s: { count: number; ran: readonly string[] }): number => (s.ran.length || s.count);
const SEAT_WORD_W = 10; // `as planned`

/** The dispatch plan against what ran: a row per team (class/effort, name, transport), a row per seat with the verdict `as planned`, `drift` or `not run`. */
function dispatchRows(c: CoreModel, m: PanelModel, cap = TEAM_CAP): PanelLine[] {
  const teams = c.routes.slice(-cap).reverse();
  // One source for the heading and the rows: an in-process route is a dispatch group, never a tmux team (its row says `no tmux team`), so it is counted apart.
  const inProc = teams.filter((rt) => rt.transport === 'in-process').length;
  const tmux = teams.length - inProc;
  const dispatched = teams.reduce((n, rt) => n + rt.seats.reduce((k, s) => k + seatCount(s), 0), 0); // every worker the dispatches ran (critique 17 A6: `dispatches 1 this session` after 3 workers ran)
  const head = heading(tmux === 0 && inProc > 0 ? 'dispatches' : 'teams', teams.length ? [r(inProc > 0 && tmux > 0 ? `${tmux} tmux, ${inProc} in-process` : `${tmux === 0 ? dispatched || teams.length : teams.length} this session`, 'muted')] : [], m);
  const inProcessNote = (): PanelLine[] => (c.inProcess ? [] : wrap('in-process dispatches are not shown here', Math.max(8, m.cols - 4)).map((t) => note(t, m)));
  if (!teams.length) return [head, note('no team this session', m), ...inProcessNote()];
  const seatName = (s: { count: number; ran: readonly string[]; role: string }): string => `  ${seatCount(s)} ${s.role}${seatCount(s) === 1 ? '' : 's'}`; // plain words: `3 explorers`, never `3x explorer` (critique 18 A5)
  const names = teams.flatMap((rt) => rt.seats.map(seatName));
  const { nameW } = gridPlan(m.cols, { names, word: SEAT_WORD_W, min: 8, max: 16 });
  const withDetail = (runs: Run[], forms: string | readonly string[]): PanelLine[] => {
    const used = rowWidth(runs);
    const all = typeof forms === 'string' ? [forms] : forms;
    const text = all.find((f) => cells(f) + 1 <= m.cols - used) ?? pickForm(all, m.cols - 6); // beside the row when a form fits, else the form that fits a row of its own
    const fits = cells(text) + 1 <= m.cols - used;
    return [line(fitRuns(fits ? [...runs, r(` ${text}`, 'muted')] : runs, m.cols)), ...(fits ? [] : wrap(text, Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m)))];
  };
  const rows = teams.flatMap((rt): PanelLine[] => {
    const teamName = `${rt.cls} team (${rt.effort} effort)`; // plain words, never the `class/effort` scope token
    // A team that ran differently says what happened, in words: `planned audit team (low effort), ran 3 explorers` (data/core plannedText, the band's wording).
    const headName = rt.drift.length ? plannedText(rt) : teamName;
    const headLines = cells(headName) <= m.cols - GRID_LEAD ? [headName] : wrap(headName, Math.max(8, m.cols - GRID_LEAD), 3); // a name wider than the pane wraps on its words, it is never cut
    const team = gridRow({ cols: m.cols, ui: m.ui, mark: rt.drift.length ? gateMark(m.ui) : null, name: { t: headLines[0]!, bold: true }, nameW: Math.min(cells(headLines[0]!), Math.max(1, m.cols - GRID_LEAD)) });
    const headMore = headLines.slice(1).map((t) => line(fitRuns([r(' '.repeat(GRID_LEAD)), r(t, 'text', { bold: true })], m.cols)));
    const seats = rt.seats.flatMap((s): PanelLine[] => {
      const same = s.ran.every((x) => x.toLowerCase().includes(s.model.toLowerCase()) || s.model === 'inherit');
      const over = s.ran.length > s.count;
      // The heading already says `3 explorers ran, the plan said 1`: a second row `3 explorers too many` said the count twice (critique 21). The seat keeps only what the heading does not, the plan's model.
      if (rt.drift.length && over) return wrap(`planned on ${s.model}, ${s.effort} effort`, Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m));
      const used = [...new Set(s.ran.map((x) => x.replace(/^claude-/, '')))].join(', ');
      const [st, word, tone]: [UiState, string, Tone] = !s.ran.length ? ['queued', 'not run', 'muted'] : same && !over ? ['done', 'as planned', 'ok'] : ['blocked', over ? 'too many' : 'changed', 'warn']; // plain words (critique 17 A6); amber like the gates tab's routing warning: a team that ran differently is a warning, not a failure (critique 14)
      // Plain words, no `model/effort` token: `3 explorers ran, 1 planned (haiku, low effort)`; a seat that ran another model reads `ran on opus, planned haiku, low effort`.
      const plan = `${s.model}, ${s.effort} effort`;
      // The heading above already says `3 explorers ran, the plan said 1`: the seat row says what was asked for, in two short forms (critique 18 A5: no `3x`, no `3 ran, plan said 1 (haiku)`).
      // Critique 19 C4: the heading says the counts (`3 explorers ran, the plan said 1`); an over-run seat names only what the heading does not, the model and effort that were planned.
      const detail = !s.ran.length ? `not run yet, planned ${plan}` : over ? `planned on ${s.model}, ${s.effort} effort` : same ? `ran ${used}, ${s.effort} effort` : `ran on ${used}, planned ${plan}`;
      const runs = gridRow({ cols: m.cols, ui: m.ui, mark: coreMark(st, m.ui), name: { t: seatName(s) }, nameW, word: { t: word, tone }, wordW: SEAT_WORD_W });
      return withDetail(runs, over ? [detail, `planned on ${s.model}`] : detail);
    });
    // In-process routes have no team name or isolation to show: the sentence says how the workers ran.
    const how = rt.transport === 'in-process' ? [`workers ran in-process (no tmux team), up to ${rt.maxParallel} at once`, `ran in-process, up to ${rt.maxParallel} at once`] : `${rt.name || rt.teamId}  ${[rt.transport ?? 'transport unknown', rt.isolation].filter(Boolean).join(', ')}, max ${rt.maxParallel}`;
    const howRows = wrap(pickForm(typeof how === 'string' ? [how] : how, m.cols - 6), Math.max(8, m.cols - 6)).map((t) => note(`  ${t}`, m));
    return [...(headMore.length ? [line(fitRuns(team, m.cols)), ...headMore, ...howRows] : withDetail(team, how)), ...seats];
  });
  return [head, ...rows, ...inProcessNote()];
}
export function coreBody(m: PanelModel): PanelLine[] {
  if (!hasCore(m.core)) return m.run ? emptyTab(m, 'CORE', '0 verdicts', CORE_SKEL) : emptyHint(m, 'no verdicts, workers or gates yet');
  const c = m.core;
  const build = (v: number, o: number, t: number): PanelLine[] => [...contractRows(c, m), BLANK, ...verdictRows(c, m, v), BLANK, ...offloadRows(c, m, o), BLANK, ...dispatchRows(c, m, t)];
  const base = build(VERDICT_CAP, OFFLOAD_CAP, TEAM_CAP);
  const room = m.rows - headerRows(m).length - 1; // one foot row stays free
  const have = [c.verdicts.length, c.offload.workers.length, c.routes.length];
  const spill = Math.max(have[0]! - VERDICT_CAP, have[1]! - OFFLOAD_CAP, have[2]! - TEAM_CAP);
  if (!tall(m) || (base.length <= room && spill <= 0)) return base;
  // A tall pane: the sections list as many rows as the pane holds. The same extra count for all three (negative: fewer than the default when the
  // default overflows; one row of each stays) by bisection, then one more row at a time to whichever section still has data and room.
  const caps = (k: number): [number, number, number] => [Math.max(1, VERDICT_CAP + k), Math.max(1, OFFLOAD_CAP + k), Math.max(1, TEAM_CAP + k)];
  let lo = 1 - Math.max(VERDICT_CAP, OFFLOAD_CAP, TEAM_CAP); // down to one row of each section, however wrapped words lengthen the rest
  let hi = Math.max(0, spill);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build(...caps(mid)).length <= room) lo = mid; else hi = mid - 1;
  }
  const at = caps(lo);
  for (let i = 0; i < 3; i++) {
    if (at[i]! >= have[i]!) continue;
    const next = [...at] as [number, number, number];
    next[i] = at[i]! + 1;
    if (build(...next).length <= room) at[i] = next[i]!;
  }
  return build(...at);
}
