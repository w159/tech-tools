// tabs-frame.ts: the side panel's other tabs of the approved frame spec (critics/mock-final.md section 5: G1-G3 gates, T1-T3 team, D1-D3 board, C1-C3 chat, K1-K3 core), as rows of runs.
// Pure, like status-frame.ts, and built from the same kit and section builders: a tab shows its own content first, then the dock (ACTIVITY, CONTEXT, HOOKS; spec 2.4e) directly beneath it, the free rows at
// the bottom, the footer pinned to the last row (and, on chat, the compose chip above it).
//
// One control idiom (2.3): a row that expands in place (a gate group, a worker, a board item) is one chip spanning the usable width with its numbers inside the fill (2.4c); a failing or blocked row is an
// alert chip. Nothing else here is clickable except the chat compose chip. Rows carry a `press`: `flip` (expand or collapse the row; the key is remembered for the session), `compose`.
//
// Overflow (2.8): the content collapses its expanded rows first (the oldest done item first), then the CONTEXT section goes, then the content is cut with `+N more`; the HOOKS feed takes every row left
// (at least two while the dock has room), and two blank rows (three on chat) stay above the footer.
import { elapsedClock, type Run, type Ui, type UiState } from './atlas-ui';
import type { CoreModel } from './data/core';
import { teamOf, type Health } from './idle-health';
import { activityRows, contextRows, footerRow, frameKit, hookFeed, hooksRows, promptedOf, type Kit, type StatusGate, type StatusIn } from './status-frame';
import { fitText, textWidth } from './theme';
import { checkOff, gateCounts } from './vocab';

export type TabId = 'team' | 'channel' | 'gates' | 'core' | 'board';
export type TabPress = { kind: 'flip' | 'compose'; key: string; name?: string };
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
  /** Keys the user flipped from their default (open to closed, closed to open); remembered for the session. */
  flips: readonly string[];
  /** A blank row first: the header leaves none above the body (below 100 columns). */
  lead: boolean;
};

const BLANKS = 2;
const HOOKS_MIN = 2;
const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);

type Part = { lines: TabLine[]; /** Rows that collapse, in the order they give way (oldest done first). */ order: string[] };
const plain = (runs: Run[]): TabLine => ({ runs });

/** The 8-cell gauge of a count (`▰▰▱▱▱▱▱▱`): at least one cell once anything counts, never full before everything does. */
function gauge(kit: Kit, done: number, total: number, cells = 8): Run[] {
  const { g, violet, dim } = kit;
  if (total <= 0) return [dim(g('▱', '-').repeat(cells))];
  const raw = Math.round((done / total) * cells);
  const on = done <= 0 ? 0 : done >= total ? cells : Math.max(1, Math.min(cells - 1, raw));
  return [...(on ? [violet(g('▰', '#').repeat(on), 1)] : []), ...(on < cells ? [dim(g('▱', '-').repeat(cells - on))] : [])];
}

// ---- empty tabs (J) ------------------------------------------------------------------------------------------------------------------------
// An empty tab is never one line over a void: the ribbon, the one live fact, a dim skeleton of what will appear (column names and two placeholder rows) and the last run's figures.

/** The dim skeleton: a column-name row, then placeholder rows (`rows` of them, dots where the data will go). */
function skeleton(kit: Kit, head: [string, string], rows: readonly [string, string][], mark = '○'): Run[][] {
  const { g, dim, row } = kit;
  const dots = (n: number): string => g('·', '.').repeat(Math.max(1, n));
  const w = Math.max(8, kit.u - 4 - 12);
  return [
    row([dim(head[0])], [dim(head[1])]),
    ...rows.map(([name, right]) => row([dim(`${mark === ' ' ? ' ' : g(mark, 'o')} ${name} ${dots(w - textWidth(name) - 4)}`)], [dim(right)])),
  ];
}

/** `last run 0:05 · 6/6 · 6 hooks`: the last finished run's figures, only what the mod holds; none before a run. */
function lastRunRow(a: TabIn, kit: Kit): Run[][] {
  const l = a.health.last;
  if (!l || l.secs === undefined) return [];
  const hooks = a.health.hooks?.byLabel?.length ?? 0;
  const parts = [`last run ${elapsedClock(l.secs)}`, ...(l.total > 0 ? [`${l.done}/${l.total}`] : []), ...(hooks > 0 ? [`${hooks} ${hooks === 1 ? 'hook' : 'hooks'}`] : [])];
  return [kit.row([kit.dim(parts.join(' · '))])];
}

const WORD: Record<UiState, string> = { running: 'working', done: 'done', failed: 'failed', blocked: 'blocked', waiting: 'waiting', queued: 'queued' } as Record<UiState, string>;
const stateGlyph = (kit: Kit, s: UiState): string => (s === 'done' ? kit.g('●', '*') : s === 'failed' || s === 'blocked' ? kit.g('■', 'x') : s === 'running' ? kit.g('◆', '#') : kit.g('○', 'o'));
const alertOf = (s: UiState): boolean => s === 'failed' || s === 'blocked';

/** The oldest-done-first order in which rows give way: done rows by position, then the rest from the last. */
const giveWay = (items: readonly { key: string; done: boolean }[]): string[] => [...items.filter((x) => x.done).map((x) => x.key), ...items.filter((x) => !x.done).map((x) => x.key).reverse()];

// ---- gates ---------------------------------------------------------------------------------------------------------------------------------

function gatesPart(a: TabIn, kit: Kit, collapsed: ReadonlySet<string>, prompted: boolean): Part {
  const { g, dim, txt, red, row, ribbon, metaText, chip } = kit;
  const h = a.health;
  const flips = new Set(a.flips);
  const lines: TabLine[] = [plain(ribbon('GATES', metaText('checks   ok fail')))];
  const order: { key: string; done: boolean }[] = [];
  for (const c of h.gates.checks) {
    const n = gateCounts(c);
    const deny = n.total - n.pass;
    const fired = n.total > 0 && (prompted || deny > 0);
    const key = `gate:${c.id}`;
    const grp = a.gates.find((x) => x.id === c.id);
    const canOpen = !!grp && grp.lines.length > 0;
    const open = canOpen && (fired !== flips.has(key)) && !collapsed.has(key);
    if (open && !flips.has(key) && deny === 0) order.push({ key, done: true });
    const armed = c.lines ?? n.total;
    const right = fired ? `${String(n.pass).padStart(2)} ${String(deny).padStart(4)}` : armed > 0 ? `${armed} armed` : 'armed';
    const mark = deny > 0 ? g('■', 'x') : fired ? g('●', '*') : g('○', 'o');
    lines.push({ runs: chip(`${canOpen ? (open ? g('▾', 'v') : g('▸', '>')) : ' '} ${mark} ${c.id}`, right, deny > 0 ? 'alert' : 'idle'), ...(canOpen ? { press: { kind: 'flip', key } } : {}) });
    if (!open || !grp) continue;
    // I: identical rows merge into one (`×8`); the verdict sits in a fixed right column (cut at its end, never at its start); the label takes the rest and is cut at its END with `…`.
    const merged: { l: (typeof grp.lines)[number]; n: number }[] = [];
    for (const l of grp.lines) {
      const same = merged.find((m) => m.l.ok === l.ok && m.l.label === l.label && (m.l.detail ?? '').trim() === (l.detail ?? '').trim() && (m.l.fix ?? '') === (l.fix ?? ''));
      if (same) same.n++;
      else merged.push({ l, n: 1 });
    }
    const vw = Math.min(18, Math.max(0, ...merged.map((m) => textWidth((m.l.detail ?? '').trim()))));
    merged.forEach(({ l, n }, i) => {
      const last = i === merged.length - 1;
      const off = l.ok && checkOff(l.label, l.detail);
      const detail = fitText((l.detail ?? '').trim(), vw);
      const times = n > 1 ? ` ×${n}` : '';
      const room = Math.max(4, kit.u - 9 - (detail ? vw + 2 : 0)); // a row without a verdict keeps the whole width
      const label = `${fitText(l.label, Math.max(1, room - textWidth(times)))}${times}`;
      const branch = dim(`${last ? g('└', '+') : g('├', '+')} `);
      if (!l.ok) {
        lines.push(plain(row([branch, red(g('■', 'x')), txt(` ${label}`, { fg: kit.k.bad, tone: 'bad' })], detail ? [red(detail)] : [], 5)));
        if (l.fix) lines.push(plain(row([dim(`${last ? ' ' : g('│', '|')}   fix: ${l.fix}`)], [], 5)));
      } else {
        lines.push(plain(row([branch, off || !fired ? dim(g('○', 'o')) : kit.green(g('●', '*')), txt(` ${label}`)], detail ? [dim(detail)] : [], 5)));
      }
    });
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
  if (!ws.length) {
    lines.push(
      plain(kit.blank), plain(row([txt(`team ${team ?? 'off'} · 0 workers`)])), plain(kit.blank),
      ...skeleton(kit, ['worker', 'state'], [['w1', 'queued'], ['w2', 'queued']]).map(plain),
      ...(lastRunRow(a, kit).length ? [plain(kit.blank)] : []), ...lastRunRow(a, kit).map(plain),
    );
    return { lines, order: [] };
  }
  const order: { key: string; done: boolean }[] = [];
  for (const w of ws) {
    const key = `worker:${w.name}`;
    const isOpen = flips.has(key) ? false : !collapsed.has(key);
    if (isOpen) order.push({ key, done: w.state === 'done' });
    const word = `${WORD[w.state] ?? w.state}${w.secs !== undefined && w.state !== 'queued' ? ` ${elapsedClock(w.secs)}` : ''}`;
    lines.push({ runs: chip(`${isOpen ? g('▾', 'v') : g('▸', '>')} ${stateGlyph(kit, w.state)} ${w.name}`, word, alertOf(w.state) ? 'alert' : 'idle'), press: { kind: 'flip', key, name: w.name } });
    if (isOpen) {
      const detail = [w.model, w.detail].filter(Boolean).join(' · ');
      lines.push(plain(row([dim(`${g('└', '+')} ${fitText(detail || w.state, Math.max(4, kit.u - 7))}`)], [], 4)));
    }
  }
  return { lines, order: giveWay(order) };
}

// ---- board ---------------------------------------------------------------------------------------------------------------------------------

function boardPart(a: TabIn, kit: Kit, collapsed: ReadonlySet<string>): Part {
  const { g, dim, txt, red, row, ribbon, chip } = kit;
  const flips = new Set(a.flips);
  const items = a.todos;
  const done = items.filter((t) => t.state === 'done').length;
  const lines: TabLine[] = [plain(ribbon('BOARD', items.length ? [...gauge(kit, done, items.length), dim(` ${done}/${items.length}`)] : []))];
  if (!items.length) {
    lines.push(
      plain(row([txt('0 items')])), plain(kit.blank),
      ...skeleton(kit, ['item', 'owner  time'], [['T1', 'worker  0:00'], ['T2', 'worker  0:00']]).map(plain),
      ...(lastRunRow(a, kit).length ? [plain(kit.blank)] : []), ...lastRunRow(a, kit).map(plain),
    );
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
    lines.push({ runs: chip(`${isOpen ? g('▾', 'v') : g('▸', '>')} ${stateGlyph(kit, t.state)} ${t.label}`, right, alertOf(t.state) ? 'alert' : 'idle'), press: { kind: 'flip', key } });
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
    lines.push(
      plain(row([txt(`0 notes · ${a.people} ${a.people === 1 ? 'member' : 'members'}`)])), plain(kit.blank),
      ...skeleton(kit, ['time   from', 'note'], [['--:--  lead', '········'], ['--:--  worker', '········']], ' ').map(plain),
      ...(lastRunRow(a, kit).length ? [plain(kit.blank)] : []), ...lastRunRow(a, kit).map(plain),
    );
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
  const { g, dim, txt, row, ribbon, metaText } = kit;
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
    lines.push(
      plain(row([txt('0 verdicts')])), plain(kit.blank),
      ...skeleton(kit, ['check', 'figure'], [['verdicts', g('—', '-')], ['kept out', g('—', '-')], ['workers', g('—', '-')]], ' ').map(plain),
      ...(lastRunRow(a, kit).length ? [plain(kit.blank)] : []), ...lastRunRow(a, kit).map(plain),
    );
    return { lines, order: [] };
  }
  const label = (t: string): Run => dim(t.padEnd(9));
  const field = (l: string, left: Run[], right: Run[] = []): TabLine => plain(row([label(l), ...left], right));
  if (a.todos.length) lines.push(field('items done', gauge(kit, doneN, a.todos.length), [txt(`${doneN} of ${a.todos.length}`)]));
  if (verdictText) lines.push(field('verdicts', [txt(verdictText)]));
  if (read > 0) lines.push(field('kept out', gauge(kit, out, read), [txt(`${tok(out)} of ${tok(read)} tok`)]));
  if (tmux || local) lines.push(field('workers', [txt([tmux ? `${tmux} tmux` : '', local ? `${local} local` : ''].filter(Boolean).join(' · '))]));
  return { lines, order: [] };
}

// ---- the dock ------------------------------------------------------------------------------------------------------------------------------

/** One tab as rows (each starts with the gutter cell): the tab's content, ACTIVITY, CONTEXT and HOOKS beneath it, the footer on the last row. */
export function tabFrame(a: TabIn): TabLine[] {
  const u = Math.max(20, a.cols - 2);
  const kit = frameKit(a.ui, u);
  const h = a.health;
  const prompted = promptedOf(a.kind, h);
  const chat = a.tab === 'channel';
  const feed = hookFeed(h);
  const activity = activityRows(kit, h).map(plain);
  const context = contextRows(kit, h).map(plain);
  const footer = footerRow(kit, h);
  const compose: TabLine = { runs: kit.chip(`${kit.g('✎', '>')} message the ${a.recipient ?? 'lead'}`, '', 'idle', textWidth(`✎ message the ${a.recipient ?? 'lead'}`) + 2), press: { kind: 'compose', key: 'compose', ...(a.recipient ? { name: a.recipient } : {}) } };
  const build = (collapse: number, take: number): Part => {
    const none = new Set<string>();
    const first = a.tab === 'gates' ? gatesPart(a, kit, none, prompted) : a.tab === 'team' ? teamPart(a, kit, none) : a.tab === 'board' ? boardPart(a, kit, none) : a.tab === 'core' ? corePart(a, kit) : chatPart(a, kit, take);
    if (collapse <= 0 || !first.order.length) return first;
    const gone = new Set(first.order.slice(0, collapse));
    const again = a.tab === 'gates' ? gatesPart(a, kit, gone, prompted) : a.tab === 'team' ? teamPart(a, kit, gone) : boardPart(a, kit, gone);
    return { lines: again.lines, order: first.order };
  };
  const lead = a.lead ? 1 : 0;
  const foot = footer.length ? 1 : 0;
  const tail = foot + BLANKS + (chat ? 2 : 0); // the footer, the blank rows above it, on chat the compose chip and one more blank
  const hooksMin = Math.min(HOOKS_MIN, feed.length);
  const used = (content: number, withCtx: boolean, hooks: number): number => lead + content + 1 + activity.length + 1 + (withCtx && context.length ? context.length + 1 : 0) + 1 + hooks;
  let part = build(0, 0);
  let withCtx = context.length > 0;
  let want = a.room > 0 ? feed.length : Math.min(feed.length, 5);
  if (a.room > 0) {
    const avail = a.room - tail;
    if (chat) {
      // Chat: the newest notes that fit; the dock keeps its context while it can.
      const fixed = (ctx: boolean): number => used(1, ctx, hooksMin) - 1;
      const roomFor = (ctx: boolean): number => avail - fixed(ctx) - 1;
      part = build(0, roomFor(withCtx));
      if (roomFor(true) < 4 && context.length) { withCtx = false; part = build(0, roomFor(false)); }
    } else {
      const max = part.order.length;
      let pick = -1;
      for (let k = 0; k <= max; k++) {
        const p = build(k, 0);
        if (used(p.lines.length, true, hooksMin) <= avail) { part = p; pick = k; break; }
      }
      if (pick < 0) {
        withCtx = false;
        part = build(max, 0);
        const keep = Math.max(2, avail - used(0, false, hooksMin) - 1);
        if (part.lines.length > keep) part = { lines: [...part.lines.slice(0, keep - 1), plain(kit.row([kit.dim(`+${part.lines.length - keep + 1} more`)]))], order: [] };
      }
    }
    want = Math.max(0, Math.min(feed.length, avail - used(part.lines.length, withCtx, 0)));
    if (feed.length > 0 && want < hooksMin && used(part.lines.length, withCtx, hooksMin) <= avail) want = hooksMin;
  }
  const sections: TabLine[][] = [part.lines, activity, ...(withCtx && context.length ? [context] : []), hooksRows(kit, h, feed, want).map(plain)];
  const body: TabLine[] = [...(a.lead ? [plain(kit.blank)] : []), ...sections.flatMap((s, i) => [...s, ...(i < sections.length - 1 ? [plain(kit.blank)] : [])])];
  if (a.room > 0) {
    const cap = a.room - foot - (chat ? 1 : 0);
    const cut = body.slice(0, cap);
    return [...cut, ...Array.from({ length: Math.max(0, cap - cut.length) }, () => plain(kit.blank)), ...(chat ? [compose] : []), ...(foot ? [plain(footer)] : [])];
  }
  return [...body, plain(kit.blank), ...(chat ? [compose] : []), ...(foot ? [plain(footer)] : [])];
}

/** The text of a frame, trailing spaces trimmed (the goldens and the tests compare it). */
export const tabText = (rows: readonly TabLine[]): string[] => rows.map((l) => l.runs.map((x) => x.t).join('').trimEnd());
