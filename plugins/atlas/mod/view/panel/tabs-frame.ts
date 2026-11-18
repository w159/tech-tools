// tabs-frame.ts: the side panel's other tabs of the approved frame spec (critics/mock-final.md section 5: G1-G3 gates, T1-T3 team, D1-D3 board, C1-C3 chat, K1-K3 core), as rows of runs.
// Pure, like status-frame.ts, and built from the same kit and the same section builders (statusActivityRows, statusRunsRows, statusHooksRows, statusRecentRows, statusGatesRows, the GATES table columns).
// Round Y2b, Z4: a tab shows its own body plus the shared sections beneath it, and the elastic one takes every remaining row so no tab ends with more than one blank row above the footer (a log that runs out
// stops there): board RUNS as a multi-row bar chart of the recorded runs; team a worker slot table, ACTIVITY at the pane's fixed chart height, then RECENT; channel RECENT; core GATES with their lines
// expanded, then RECENT; gates HOOKS, then RECENT. The footer is pinned to the last row (and, on chat, the compose field above it). A tab with nothing to show draws its ribbon and one honest line (what will appear, what triggers it), never a filler row.
//
// One control idiom (2.3, Y2c): a row that expands in place (a worker, a board item) is one chip spanning the usable width with its numbers inside the fill (2.4c); a gate group row carries the chip fill on its
// caret cell; a failing or blocked row is an alert chip. Rows carry a `press`: `flip` (expand or collapse the row; the key is remembered for the session), `compose`, `goto` (open another view).
//
// Overflow (2.8, Y2a): the content collapses its expanded rows first (the oldest done item first); then the shared section goes whole (never cut mid-way) and the body ends in a chip `+N more ›` that opens the
// view holding it; spare rows go to the shared section (the chart grows, the RECENT log lengthens); two blank rows (three on chat) stay above the footer.
import { dataWord } from '../../data/datastate';
import { elapsedClock, type Run, type Ui, type UiState } from '../../design/atlas-ui';
import type { CoreModel } from '../../data/core';
import { teamOf, type Health } from '../../data/idle-health';
import { chartRows, footerRow, frameKit, GATE_COL, gateHead, gateLastSecs, hookFeed, lastCellText, moreRow, promptedOf, statusActivityRows, statusHooksRows, statusRecentRows, statusRunsChart, type Kit, type ReadInfo, type StatusGate, type StatusIn } from '../hud/status-frame';
import { fitText, textWidth } from '../../design/theme';
import { checkOff, gateCounts } from '../../design/vocab';

export type TabId = 'team' | 'channel' | 'gates' | 'core' | 'board';
export type TabPress = { kind: 'flip' | 'compose' | 'goto'; key: string; name?: string };
export type TabLine = { runs: Run[]; press?: TabPress };

export type TabWorker = { name: string; role?: string; state: UiState; model?: string; detail: string; secs?: number };
export type TabTodo = { id: string; label: string; state: UiState; owner?: string; detail?: string; evidence?: string | null };
export type TabNote = { at: string; from: string; kind?: string; text: string };

export type TabIn = {
  tab: TabId;
  /** The panel's width in cells (gutter + U usable + margin). */
  cols: number;
  /** Rows the body may fill, footer included (0: unknown, no limit). */
  room: number;
  ui: Ui;
  kind: StatusIn['kind'];
  health: Health;
  gates: readonly StatusGate[];
  workers: readonly TabWorker[];
  /** The lead's run clock in seconds (the Team tab's first row). */
  leadSecs?: number;
  todos: readonly TabTodo[];
  notes: readonly TabNote[];
  channel: string;
  people: number;
  /** Who a message goes to (the compose chip's name); null: the lead. */
  recipient: string | null;
  core?: CoreModel | null;
  /** M6: how the gate and hook figures were read (snapshot age against refresh interval, failed read); absent: nothing is marked. */
  read?: ReadInfo;
  /** Keys the user flipped from their default (open to closed, closed to open); remembered for the session. */
  flips: readonly string[];
  /** A blank row first: the header leaves none above the body (below 100 columns). */
  lead: boolean;
};

const BLANKS = 1;
/** Z4: the rows the RUNS chart of the board tab never goes below (its rule, two chart rows and the x labels). */
const RUNS_MIN = 4;
const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);

type Part = { lines: TabLine[]; /** Rows that collapse, in the order they give way (oldest done first). */ order: string[] };
const plain = (runs: Run[]): TabLine => ({ runs });

/** The 8-cell gauge of a count (`▰▰▱▱▱▱▱▱`): at least one cell once anything counts, never full before everything does. Y2d: green once everything counts, else neutral. */
function gauge(kit: Kit, done: number, total: number, cells = 8): Run[] {
  const { g, dim, green, txt } = kit;
  if (total <= 0) return [dim(g('▱', '-').repeat(cells))];
  const raw = Math.round((done / total) * cells);
  const on = done <= 0 ? 0 : done >= total ? cells : Math.max(1, Math.min(cells - 1, raw));
  const fill = g('▰', '#').repeat(on);
  return [...(on ? [done >= total ? green(fill) : txt(fill)] : []), ...(on < cells ? [dim(g('▱', '-').repeat(cells - on))] : [])];
}

// ---- empty tabs ----------------------------------------------------------------------------------------------------------------------------
// An empty tab draws its ribbon and one honest line: what will appear here and what makes it appear. The longest wording that fits the width is used; nothing is drawn as a placeholder.

/** The first wording of `variants` that fits the usable width as one row (the last one is cut at its end when none does). */
function oneLine(kit: Kit, variants: readonly string[]): Run[] {
  const room = kit.u - 4;
  const text = variants.find((t) => textWidth(t) <= room) ?? fitText(variants[variants.length - 1]!, room);
  return kit.row([kit.txt(text)]);
}

/** AA6: one raised chip spanning the usable width, `left` and `right` inside its fill (the semantic colours of the runs stay, the fill is the chip's); `alert` is the failing row's tile. The row presses as a whole (the caller's `press`). */
function chipRow(kit: Kit, left: readonly Run[], right: readonly Run[], alert = false): Run[] {
  const bg = alert ? kit.k.alertBg : kit.k.chipBg;
  const paint = (x: Run): Run => ({ ...x, bgHex: bg, hover: true });
  const gap = Math.max(0, kit.u - 2 - kit.w(left) - kit.w(right));
  return [kit.sp(1), paint(kit.sp(1)), ...left.map(paint), paint(kit.sp(gap)), ...right.map(paint), paint(kit.sp(1))];
}

const WORD: Record<UiState, string> = { running: 'working', done: 'done', failed: 'failed', blocked: 'blocked', waiting: 'waiting', queued: 'queued' } as Record<UiState, string>;
const stateGlyph = (kit: Kit, s: UiState): string => (s === 'done' ? kit.g('●', '*') : s === 'failed' || s === 'blocked' ? kit.g('■', 'x') : s === 'running' ? kit.g('◆', '#') : kit.g('○', 'o'));
const alertOf = (s: UiState): boolean => s === 'failed' || s === 'blocked';
/** Y2d: a state's mark and word colour inside a chip: done green, anything running or waiting neutral, queued grey (a failing row is an alert chip as a whole). */
const stateInk = (kit: Kit, s: UiState): { fg: string; tone: Run['tone'] } => (s === 'done' ? { fg: kit.k.ok, tone: 'ok' } : s === 'queued' ? { fg: kit.k.dim, tone: 'sub' } : { fg: kit.k.text, tone: 'text' });

/** The oldest-done-first order in which rows give way: done rows by position, then the rest from the last. */
const giveWay = (items: readonly { key: string; done: boolean }[]): string[] => [...items.filter((x) => x.done).map((x) => x.key), ...items.filter((x) => !x.done).map((x) => x.key).reverse()];

// ---- gates ---------------------------------------------------------------------------------------------------------------------------------

/** A gate line's value column: a short figure (`0`, `2/4`, `3 open`), `on`/`off`, `ok`, or `—`; never a sentence (the sentence of a failing line hangs under it). */
export function gateValue(l: { label: string; ok: boolean; detail?: string }, none = '—'): string {
  const d = (l.detail ?? '').trim();
  if (!l.ok) return 'deny';
  if (checkOff(l.label, d)) return 'off';
  let m: RegExpMatchArray | null;
  if ((m = d.match(/^(on|off)$/i))) return m[1]!.toLowerCase();
  if ((m = d.match(/^(\d+)\s+of\s+(\d+)/))) return `${m[1]}/${m[2]}`;
  if ((m = d.match(/^(\d+)\s+direct calls.*limit\s+(\d+)/))) return `${m[1]}/${m[2]}`;
  if ((m = d.match(/^(\d+)\s+open/))) return `${m[1]} open`;
  if ((m = d.match(/^(\d+)\b/))) return m[1]!;
  if ((m = d.match(/^declared phase:\s*(\S+)/))) return fitText(m[1]!, 8);
  if (/^not an orchestrat/i.test(d)) return none;
  return 'ok';
}

/** The text every line of a group shares after its figure (`as of the last ingest (Stop, ...)`): drawn once under the group. */
function sharedNote(lines: readonly { ok: boolean; detail?: string }[]): string {
  const rest = lines.filter((l) => l.ok).map((l) => (l.detail ?? '').trim().replace(/^\d+\s+/, '')).filter((t) => t.length > 0 && !/^(on|off)$/i.test(t));
  const first = rest[0];
  return first !== undefined && rest.length >= 2 && rest.every((t) => t === first) ? first : '';
}

/** `force`: every group with lines opens (the core tab's GATES), not only the ones that fired; a flip still toggles it. */
function gatesPart(a: TabIn, kit: Kit, collapsed: ReadonlySet<string>, prompted: boolean, force = false): Part {
  const { g, dim, txt, red, green, sp, row, ribbon, metaText, on } = kit;
  const h = a.health;
  const flips = new Set(a.flips);
  const pad = (t: string): string => t.padStart(GATE_COL);
  const none = g('—', '-');
  const lines: TabLine[] = [plain(ribbon('GATES', metaText(`${gateHead()} `)))];
  const order: { key: string; done: boolean }[] = [];
  for (const c of h.gates.checks) {
    const n = gateCounts(c);
    const deny = n.total - n.pass;
    const fired = n.total > 0 && (prompted || deny > 0);
    const key = `gate:${c.id}`;
    const grp = a.gates.find((x) => x.id === c.id);
    const failed = !!a.read?.failed?.gates || !!grp?.error;
    const canOpen = !!grp && grp.lines.length > 0;
    const open = canOpen && ((fired || force) !== flips.has(key)) && !collapsed.has(key);
    if (open && !flips.has(key) && deny === 0) order.push({ key, done: true });
    const lastSecs = fired ? gateLastSecs(h, c) : undefined;
    const right: Run[] = fired
      ? [n.pass > 0 ? green(pad(String(n.pass))) : dim(pad('0')), deny > 0 ? red(pad(String(deny))) : dim(pad('0')), dim(pad(lastCellText(lastSecs, none, a.read, failed)))]
      : [dim(pad('0')), dim(pad('0')), dim(pad(lastCellText(undefined, none, a.read, failed)))];
    const mark = deny > 0 ? red(g('■', 'x')) : fired ? green(g('●', '*')) : dim(g('○', 'o'));
    // AA6: a group that opens is one raised chip across the row (`▸`/`▾` inside the fill, the numbers inside it too; the alert tile on a failing group); a group with nothing under it is a plain row; the row presses as a whole
    const caret = canOpen ? (open ? g('▾', 'v') : g('▸', '>')) : ' ';
    if (canOpen) lines.push({ runs: chipRow(kit, [on(caret, kit.k.chipFg, { tone: 'accent' }), sp(1), mark, fired ? txt(` ${c.id}`) : dim(` ${c.id}`)], right, deny > 0), press: { kind: 'flip', key } });
    else lines.push({ runs: row([sp(3), sp(1), mark, fired ? txt(` ${c.id}`) : dim(` ${c.id}`)], right, 0) });
    if (!open || !grp) continue;
    // identical rows merge into one (`×8`); the value column is short and right-aligned (flush with the chip's own numbers); the label takes the rest and is cut at its END with `…`.
    const merged: { l: (typeof grp.lines)[number]; n: number }[] = [];
    for (const l of grp.lines) {
      const same = merged.find((m) => m.l.ok === l.ok && m.l.label === l.label && (m.l.detail ?? '').trim() === (l.detail ?? '').trim() && (m.l.fix ?? '') === (l.fix ?? ''));
      if (same) same.n++;
      else merged.push({ l, n: 1 });
    }
    const note = sharedNote(grp.lines);
    const vw = Math.min(8, Math.max(2, ...merged.map((m) => textWidth(gateValue(m.l, none)))));
    merged.forEach(({ l, n }, i) => {
      const last = i === merged.length - 1;
      const off = l.ok && checkOff(l.label, l.detail);
      const value = gateValue(l, none).padStart(vw);
      const times = n > 1 ? ` ×${n}` : '';
      const label = `${fitText(l.label, Math.max(4, kit.u - 5 - 4 - vw - 2 - textWidth(times)))}${times}`;
      const branch = dim(`${last && !note ? g('└', '+') : g('├', '+')} `);
      if (!l.ok) {
        lines.push(plain(row([branch, red(g('■', 'x')), txt(` ${label}`, { fg: kit.k.bad, tone: 'bad' })], [red(value), sp(1)], 5)));
        const why = (l.detail ?? '').trim();
        if (why) lines.push(plain(row([dim(`${last && !note ? ' ' : g('│', '|')}   ${fitText(why, Math.max(4, kit.u - 12))}`)], [], 5)));
        if (l.fix) lines.push(plain(row([dim(`${last && !note ? ' ' : g('│', '|')}   fix: ${l.fix}`)], [], 5)));
      } else {
        const v = off ? dim(value) : /^\d+\/\d+$|^\d+ open$/.test(value.trim()) || value.trim() === 'ok' || value.trim() === 'on' ? green(value) : dim(value);
        lines.push(plain(row([branch, off || !fired ? dim(g('○', 'o')) : green(g('●', '*')), txt(` ${label}`)], [v, sp(1)], 5)));
      }
    });
    if (note) {
      const shown = textWidth(note) <= kit.u - 9 ? note : note.replace(/\s*\(.*\)\s*$/, ''); // the parenthesis goes before a word is cut
      lines.push(plain(row([dim(`${g('└', '+')} ${fitText(shown, Math.max(4, kit.u - 9))}`)], [], 5)));
    }
  }
  return { lines, order: giveWay(order) };
}

// ---- team ----------------------------------------------------------------------------------------------------------------------------------

function teamPart(a: TabIn, kit: Kit, collapsed: ReadonlySet<string>): Part {
  const { g, dim, txt, row, ribbon, metaText, chip } = kit;
  const h = a.health;
  const flips = new Set(a.flips);
  const ws = a.workers;
  const working = ws.filter((w) => w.state === 'running').length;
  const team = teamOf(h);
  const meta = ws.length ? `${ws.length} ${ws.length === 1 ? 'worker' : 'workers'}${working ? ` · ${working} working` : ''}` : team && team !== 'off' ? `team ${team}` : 'off';
  const lines: TabLine[] = [plain(ribbon('TEAM', metaText(meta)))];
  const secs = h.upSecs ?? a.leadSecs; // the lead's clock is the session's (spec 2.10: `up` from the session start)
  lines.push(plain(row([txt(g('◉', '@')), txt(' lead'), ...(h.branch ? [dim(` · ${h.branch}`)] : [])], secs !== undefined ? [dim(elapsedClock(secs))] : [])));
  // Z4: the worker slot table, from what the mod recorded: the team mode, whether tmux is there, the configured team size (the largest `max` of a recorded team); a figure the mod does not hold reads `—`, never a guess
  const size = Math.max(0, ...(a.core?.routes ?? []).map((r) => r.maxParallel));
  const none = g('—', '-');
  const slot = (l: string, v: Run[]): TabLine => plain(row([dim(l.padEnd(9)), ...v]));
  lines.push(slot('mode', [team ? (team === 'on' ? txt(team) : dim(team)) : dim(none)]));
  lines.push(slot('tmux', [h.tmux === undefined ? dim(none) : h.tmux ? kit.green('yes') : dim('no')]));
  lines.push(slot('slots', size > 0 ? [txt(`${size} configured`), dim(` · ${working} in use`)] : [dim('none recorded')]));
  if (!ws.length) {
    lines.push(plain(oneLine(kit, ['no workers yet · they appear when the lead dispatches a subagent', 'no workers yet · a dispatch adds one', 'no workers yet · dispatch adds'])));
    return { lines, order: [] };
  }
  const order: { key: string; done: boolean }[] = [];
  for (const w of ws) {
    const key = `worker:${w.name}`;
    const isOpen = flips.has(key) ? false : !collapsed.has(key);
    if (isOpen) order.push({ key, done: w.state === 'done' });
    const word = `${WORD[w.state] ?? w.state}${w.secs !== undefined && w.state !== 'queued' ? ` ${elapsedClock(w.secs)}` : ''}`;
    const ink = stateInk(kit, w.state);
    lines.push({ runs: chip(`${isOpen ? g('▾', 'v') : g('▸', '>')} ${stateGlyph(kit, w.state)} ${w.name}`, word, alertOf(w.state) ? 'alert' : 'idle', kit.u, { right: ink, mark: { at: 2, ...ink } }), press: { kind: 'flip', key, name: w.name } });
    if (isOpen) {
      const detail = [w.model, w.detail].filter(Boolean).join(' · ');
      lines.push(plain(row([dim(`${g('└', '+')} ${fitText(detail || w.state, Math.max(4, kit.u - 7))}`)], [], 4)));
    }
  }
  return { lines, order: giveWay(order) };
}

// ---- board ---------------------------------------------------------------------------------------------------------------------------------

function boardPart(a: TabIn, kit: Kit, collapsed: ReadonlySet<string>): Part {
  const { g, dim, red, row, ribbon, chip } = kit;
  const flips = new Set(a.flips);
  const items = a.todos;
  const done = items.filter((t) => t.state === 'done').length;
  const lines: TabLine[] = [plain(ribbon('BOARD', items.length ? [...gauge(kit, done, items.length), dim(` ${done}/${items.length}`)] : []))];
  if (!items.length) {
    lines.push(plain(oneLine(kit, ['no items yet · items appear when the lead sets a plan', 'no items yet · appear when a plan is set', 'no items yet · a plan adds'])));
    return { lines, order: [] };
  }
  const worker = (o?: string) => (o ? a.workers.find((w) => w.name === o) : undefined);
  const ownerOf = (t: TabTodo): string => (t.owner ? (worker(t.owner)?.role && worker(t.owner)?.role !== 'unknown' ? worker(t.owner)!.role! : t.owner) : '—');
  const timeOf = (t: TabTodo): string => { const w = worker(t.owner); return w?.secs !== undefined && t.state !== 'queued' ? elapsedClock(w.secs) : '—'; };
  const ownerW = Math.min(10, Math.max(...items.map((t) => textWidth(ownerOf(t)))));
  const timeW = Math.max(...items.map((t) => textWidth(timeOf(t))));
  const order: { key: string; done: boolean }[] = [];
  for (const t of items) {
    const key = `item:${t.id}`;
    const isOpen = flips.has(key) ? false : !collapsed.has(key);
    if (isOpen) order.push({ key, done: t.state === 'done' });
    const own = fitText(ownerOf(t), ownerW);
    const right = `${own}${' '.repeat(Math.max(0, ownerW - textWidth(own)))} ${timeOf(t).padStart(timeW)}`;
    const ink = stateInk(kit, t.state);
    lines.push({ runs: chip(`${isOpen ? g('▾', 'v') : g('▸', '>')} ${stateGlyph(kit, t.state)} ${t.label}`, right, alertOf(t.state) ? 'alert' : 'idle', kit.u, { right: { fg: kit.k.text, tone: 'text' }, mark: { at: 2, ...ink } }), press: { kind: 'flip', key } });
    if (!isOpen) continue;
    const w = worker(t.owner);
    const said = (t.evidence ?? '').replace(/\s+/g, ' ').trim() || (t.detail ?? '').replace(/^blocked: /, 'BLOCKED: ');
    const text = t.state === 'done' ? said || 'done'
      : t.state === 'queued' ? `queued · ${t.owner ? `owner ${t.owner}` : 'no owner yet'}`
        : alertOf(t.state) ? said || (t.state === 'failed' ? 'FAILED' : 'BLOCKED')
          : `${t.owner ? `claimed by ${t.owner}` : 'running'}${w?.secs !== undefined ? ` · ${elapsedClock(w.secs)}` : ''}`;
    const bad = alertOf(t.state) || /^(BLOCKED|FAILED)\b/.test(text);
    const body = `${g('└', '+')} ${fitText(text, Math.max(4, kit.u - 7))}`;
    lines.push(plain(row([bad ? red(body) : dim(body)], [], 4)));
  }
  return { lines, order: giveWay(order) };
}

// ---- chat ----------------------------------------------------------------------------------------------------------------------------------

const clockOf = (at: string): string => (/^\d\d:\d\d(:\d\d)?$/.test(at) ? at.slice(0, 5) : at);

/** The chat's notes newest at the foot, two rows each (`12:04 lead`, then the text); `fit`: how many rows the content may take (0: all). */
function chatPart(a: TabIn, kit: Kit, take: number): Part {
  const { dim, txt, red, row, ribbon, metaText } = kit;
  const name = a.channel.startsWith('#') ? a.channel : `#${a.channel}`;
  const n = a.notes.length;
  const lines: TabLine[] = [plain(ribbon('CHAT', metaText(`${name}${n ? ` · ${n} ${n === 1 ? 'note' : 'notes'}` : ''}`)))];
  if (!n) {
    lines.push(plain(oneLine(kit, [`no notes yet · notes appear when the lead or a worker posts to ${name}`, 'no notes yet · appear when someone posts', 'no notes yet · a post adds one'])));
    return { lines, order: [] };
  }
  const shown = take > 0 ? Math.max(1, Math.min(n, Math.floor(take / 2))) : n;
  const notes = a.notes.slice(n - shown);
  if (shown < n) lines.push(plain(row([dim(`+${n - shown} earlier`)])));
  for (const x of notes) {
    lines.push(plain(row([dim(clockOf(x.at)), txt(` ${x.from}`)])));
    const bad = x.kind === 'blocked' || x.kind === 'failed';
    const body = fitText(x.text.replace(/\s+/g, ' ').trim(), Math.max(4, kit.u - 6));
    lines.push(plain(row([bad ? red(body) : txt(body)], [], 6)));
  }
  return { lines, order: [] };
}

// ---- core ----------------------------------------------------------------------------------------------------------------------------------

const tok = (n: number): string => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

function corePart(a: TabIn, kit: Kit): Part {
  const { dim, txt, green, red, amber, row, ribbon, metaText } = kit;
  const c = a.core;
  const doneN = a.todos.filter((t) => t.state === 'done').length;
  const verified = c?.verdicts.filter((v) => v.status === 'verified').length ?? 0;
  const rejected = c?.verdicts.filter((v) => v.status === 'rejected').length ?? 0;
  const needs = c?.verdicts.filter((v) => v.status === 'needs-evidence').length ?? 0;
  const verdictText = [verified ? `${verified} verified` : '', rejected ? `${rejected} rejected` : '', needs ? `${needs} need evidence` : ''].filter(Boolean).join(' · ');
  const read = c?.offload.kept ?? 0;
  const out = c ? Math.max(0, c.offload.kept - c.offload.returned) : 0;
  const tmux = sum((c?.routes ?? []).filter((r) => r.transport === 'tmux').map((r) => sum(r.seats.map((s) => s.count))));
  const local = sum((c?.routes ?? []).filter((r) => r.transport !== 'tmux').map((r) => sum(r.seats.map((s) => s.count))));
  const lines: TabLine[] = [plain(ribbon('CORE', verdictText ? metaText(verdictText) : []))];
  if (!verdictText && !read && !tmux && !local) {
    lines.push(plain(oneLine(kit, ['no verdicts yet · they appear when a verifier stamps a finding', 'no verdicts yet · a verifier adds them', 'no verdicts yet · verifiers add'])));
    return { lines, order: [] };
  }
  const label = (t: string): Run => dim(t.padEnd(9));
  const field = (l: string, left: Run[], right: Run[] = []): TabLine => plain(row([label(l), ...left], right));
  // Y2d: the verdict counts wear the semantic ramp (green verified, red rejected, amber needs evidence), the words between them are neutral
  const verdictRuns: Run[] = [
    ...(verified ? [green(`${verified} verified`)] : []),
    ...(rejected ? [...(verified ? [txt(' · ')] : []), red(`${rejected} rejected`)] : []),
    ...(needs ? [...(verified || rejected ? [txt(' · ')] : []), amber(`${needs} need evidence`)] : []),
  ];
  if (a.todos.length) lines.push(field('items done', gauge(kit, doneN, a.todos.length), [txt(`${doneN} of ${a.todos.length}`)]));
  if (verdictText) lines.push(field('verdicts', verdictRuns));
  if (read > 0) lines.push(field('kept out', gauge(kit, out, read), [txt(`${tok(out)} of ${tok(read)} tok`)]));
  if (tmux || local) lines.push(field('workers', [txt([tmux ? `${tmux} tmux` : '', local ? `${local} local` : ''].filter(Boolean).join(' · '))]));
  return { lines, order: [] };
}

/** AA7: the core tab's routing data: one row per recorded route (its name, the class and effort it ran at, how it ran); nothing when the mod recorded none. */
function routingPart(a: TabIn, kit: Kit): Run[][] {
  const { dim, txt, row, ribbon, metaText } = kit;
  // M6: a failed read of the routes says so; an empty list (nothing recorded) still draws nothing. A route record carries no read time, so no age can be shown for it.
  if (a.read?.failed?.routes) return [ribbon('ROUTING'), row([dim(dataWord({ kind: 'error' }))])];
  const routes = a.core?.routes ?? [];
  if (!routes.length) return [];
  const out: Run[][] = [ribbon('ROUTING', metaText(`${routes.length} ${routes.length === 1 ? 'route' : 'routes'}`))];
  for (const r of routes.slice(0, 6)) {
    const how = `${r.cls}/${r.effort} · ${r.transport ?? dataWord({ kind: 'empty' })}`;
    out.push(row([txt(fitText(r.name, Math.max(4, kit.u - 6 - textWidth(how))))], [dim(how)]));
  }
  return out;
}

// ---- the frame -----------------------------------------------------------------------------------------------------------------------------

/** The view that holds each shared section when a short pane drops it (`route` is the status tab). */
const HOLDER: Record<TabId, string> = { board: 'route', team: 'route', channel: 'route', core: 'route', gates: 'route' };

/** One tab as rows (each starts with the gutter cell): the tab's content, then its ONE shared section (Y2b), the footer on the last row. A short pane drops the shared section whole and ends the body in `+1 more ›` (Y2a). */
export function tabFrame(a: TabIn): TabLine[] {
  const u = Math.max(20, a.cols - 2);
  const kit = frameKit(a.ui, u);
  const h = a.health;
  const prompted = promptedOf(a.kind, h);
  const chat = a.tab === 'channel';
  const feed = hookFeed(h);
  const footer = footerRow(kit, h);
  const name = a.recipient ?? 'lead';
  const label = `${kit.g('✎', '>')} message the ${name}`;
  const chipW = textWidth(label) + 2;
  const fieldW = Math.max(0, u - chipW - 1);
  // AA6: the compose line is the chip, then a bordered one-row input field (dim box, a visible cursor cell at its start)
  const box = (n: number): Run[] => (n >= 4 ? [kit.dim(kit.g('│', '|')), kit.on(kit.g('▌', '|'), kit.k.chipFg, { tone: 'accent' }), kit.sp(n - 3), kit.dim(kit.g('│', '|'))] : n > 0 ? [kit.dim(kit.g('▁', '_').repeat(n))] : []);
  const compose: TabLine = { runs: [...kit.chip(label, '', 'idle', chipW), ...(fieldW > 0 ? [kit.sp(1), ...box(fieldW)] : [])], press: { kind: 'compose', key: 'compose', ...(a.recipient ? { name: a.recipient } : {}) } };
  const build = (collapse: number, take: number): Part => {
    const none = new Set<string>();
    const first = a.tab === 'gates' ? gatesPart(a, kit, none, prompted) : a.tab === 'team' ? teamPart(a, kit, none) : a.tab === 'board' ? boardPart(a, kit, none) : a.tab === 'core' ? corePart(a, kit) : chatPart(a, kit, take);
    if (collapse <= 0 || !first.order.length) return first;
    const gone = new Set(first.order.slice(0, collapse));
    const again = a.tab === 'gates' ? gatesPart(a, kit, gone, prompted) : a.tab === 'team' ? teamPart(a, kit, gone) : boardPart(a, kit, gone);
    return { lines: again.lines, order: first.order };
  };
  /** The tab's own second section at `extra` rows beyond the least that can stand (`shared(0)`): the elastic ones take them (the RUNS chart grows to its cap, the channel log lengthens). */
  // AA7: each tab owns its sections and no other tab repeats them: RECENT only on status and channel, GATES and HOOKS on gates, ROUTING on core, ACTIVITY on team, RUNS on board
  const routing = (): TabLine[] => routingPart(a, kit).map(plain);
  const shared = (extra: number): TabLine[] => {
    switch (a.tab) {
      case 'board': return statusRunsChart(kit, h, RUNS_MIN - 2 + Math.max(0, extra)).map(plain);
      case 'team': return statusActivityRows(kit, h, chartRows(a.room)).map(plain);
      case 'channel': return feed.length ? statusRecentRows(kit, h, feed, Math.min(feed.length, Math.max(2, 2 + extra))).map(plain) : [];
      case 'core': return routing();
      default: return statusHooksRows(kit, h, undefined, a.read).map(plain);
    }
  };
  const lead = a.lead ? 1 : 0;
  const foot = footer.length ? 1 : 0;
  const tail = foot + BLANKS + (chat ? 1 : 0); // the footer and a blank row above it; on chat the compose field too
  let part = build(0, 0);
  let sec: TabLine[] = shared(0);
  let more = false;
  let moreCount = 1; // sections dropped (rows, when the content itself is cut)
  if (a.room > 0) {
    const avail = a.room - tail;
    const fit = (c: Part, withShared: boolean): number => lead + c.lines.length + (withShared ? 1 + sec.length : 0);
    if (chat) {
      // the newest notes that fit beside the RECENT log (two rows at least); with no room for it the log goes whole and the notes take the rows
      const find = (withShared: boolean): Part | null => {
        for (let take = Math.max(2, avail); take >= 2; take--) { const c = build(0, take); if (lead + c.lines.length + (withShared ? 1 + sec.length : more ? 2 : 0) <= avail) return c; }
        return null;
      };
      const withSec = sec.length ? find(true) : null;
      if (withSec) part = withSec;
      else {
        more = sec.length > 0;
        sec = [];
        part = find(false) ?? build(0, 2);
      }
    } else {
      const max = part.order.length;
      let pick: Part | null = null;
      for (let k = 0; k <= max && !pick; k++) { const c = build(k, 0); if (fit(c, sec.length > 0) <= avail) { pick = c; } }
      if (pick) part = pick;
      else {
        more = sec.length > 0;
        const base = build(max, 0);
        for (let k = 0; k <= max; k++) { const c = build(k, 0); if (lead + c.lines.length + (more ? 2 : 0) <= avail) { pick = c; break; } }
        if (pick) { part = pick; sec = []; }
        else {
          // not even the content fits: whole sections cannot help, the last rows give way behind a chip that counts them
          sec = []; more = true;
          const keep = Math.max(2, avail - lead - 2);
          part = base.lines.length > keep ? { lines: base.lines.slice(0, keep), order: [] } : base;
          const hidden = base.lines.length - part.lines.length;
          moreCount = Math.max(1, hidden);
        }
      }
    }
    // Z4: the spare rows go to the elastic section (the chart grows, the logs lengthen) until the tab reaches the footer or its data runs out
    if (sec.length && !more) {
      const spare = avail - fit(part, true);
      if (spare > 0) { const next = shared(Math.min(spare, 60)); if (fit(part, true) - sec.length + next.length <= avail) sec = next; }
    }
  }
  const sections: TabLine[][] = [part.lines, ...(sec.length ? [sec] : [])];
  const target = HOLDER[a.tab];
  const moreLine: TabLine[] = more ? [plain(kit.blank), { runs: moreRow(kit, moreCount, target), press: { kind: 'goto', key: target } }] : [];
  const body: TabLine[] = [...(a.lead ? [plain(kit.blank)] : []), ...sections.flatMap((s, i) => [...s, ...(i < sections.length - 1 ? [plain(kit.blank)] : [])]), ...moreLine];
  if (a.room > 0) {
    const cap = a.room - foot - (chat ? 1 : 0);
    const cut = body.slice(0, cap);
    return [...cut, ...Array.from({ length: Math.max(0, cap - cut.length) }, () => plain(kit.blank)), ...(chat ? [compose] : []), ...(foot ? [plain(footer)] : [])];
  }
  return [...body, plain(kit.blank), ...(chat ? [compose] : []), ...(foot ? [plain(footer)] : [])];
}

/** The text of a frame, trailing spaces trimmed (the goldens and the tests compare it). */
export const tabText = (rows: readonly TabLine[]): string[] => rows.map((l) => l.runs.map((x) => x.t).join('').trimEnd());
