// idle-health.ts: the health summary shown while Atlas has no run yet (wave 42). One pure model (`Health`) every surface reads: the band's segments, the HUD's expanded card, the side panel's rows.
// It holds only what the mod really has; a figure it does not have is left out, never made up.
import { elapsedClock, stateRun, type Run, type Ui } from './atlas-ui';
import { textWidth } from './theme';
import { clickRun } from './clickable';
import type { HookStats } from './hook-log';

export type HealthLast = { secs?: number; done: number; total: number; agents: number; failed: number; /** Whole seconds since the run ended (a clock with no zone read as a time of day only to its owner): drawn `ended 3m ago`. */ endedAgo?: number; /** Each worker of the run with how it ended and how long it ran. */ workers?: readonly { name: string; state: string; secs?: number }[] };
/** One gate group: its mark, and (from the gate groups the mod reads) how many of its lines pass and the first line's own words. */
export type HealthCheck = { id: string; ok: boolean; pending?: boolean; title?: string; lines?: number; pass?: number; note?: string };
export type Health = {
  gates: { total: number; green: number; checks: readonly HealthCheck[] };
  /** Context used, 0..100; absent when unknown. Both this and `tokens` are the host's measure of the LAST response (`session.measure` context.percent / context.tokens): the input side now in the window, not a session total. */
  ctxPct?: number;
  /** Input tokens the last response was answered over (the figure `ctxPct` is a share of). */
  tokens?: number;
  /** The model's context window in tokens (`session.measure` context.window), when the host gave it. */
  window?: number;
  /** The events this session's hooks saw (hook-log.ts). */
  hooks?: HookStats;
  upSecs?: number;
  branch?: string;
  version?: string;
  last?: HealthLast;
  /** The card is open (the band's button reads `▾ health`). */
  open?: boolean;
  /** Handlers are wired: the band draws the clickable button. */
  button?: boolean;
  /** The side panel is drawn beside the transcript: it already says the gates, the uptime, the context, the events and the last run, so the band and the card say only what it does not. */
  panel?: boolean;
};

/** The raw inputs register.ts hands the band; band.tsx completes them from the snapshot, the gates and the run clocks. */
export type HealthIn = { panel?: boolean; upSecs?: number; version?: string; branch?: string; tokens?: number | null; window?: number | null; hooks?: HookStats; open?: boolean };

const r = (t: string, tone: Run['tone'] = 'text', o: Partial<Run> = {}): Run => ({ t, tone, ...o });
const glue = (): Run => r(' · ', 'sub');

/** `42k`, `1.2M`, `850`. */
export const tokenText = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
const grouped = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const gatesFailed = (h: Pick<Health, 'gates'>): boolean => h.gates.checks.some((c) => !c.ok);
/** The one glyph of the gates figure: `■` when any failed, `◇` when only Stop decides, else `●`. */
export const gatesMark = (h: Pick<Health, 'gates'>, ui: Ui): Run => stateRun(gatesFailed(h) ? 'failed' : h.gates.checks.some((c) => c.pending) ? 'queued' : 'done', ui);

/** `12s`, `3m`, `2h`: a whole-number age. */
export const agoText = (secs: number): string => (secs < 60 ? `${Math.max(0, Math.floor(secs))}s` : secs < 3600 ? `${Math.floor(secs / 60)}m` : `${Math.floor(secs / 3600)}h`);
/** The one wording of the context figure on every surface: `context 6%`. The tokens it is made of and the window are the session row's detail, never beside it. */
export const ctxText = (h: Pick<Health, 'ctxPct'>): string => (h.ctxPct === undefined ? '' : `context ${Math.round(h.ctxPct)}%`);

/** The band's segments, in priority order: each is a list of runs (the painter lays each on its own fill). The button is last and never dropped while any form shows. */
export type BandSegments = { gates: Run[]; ctxFull: Run[]; ctxShort: Run[]; up: Run[]; event: Run[]; last: Run[]; button: Run[] };
export function bandSegments(h: Health, ui: Ui, lastRun: { secs?: number; done: number; total: number } | undefined): BandSegments {
  const own = !h.panel; // the side panel beside the transcript says the figures itself: the band keeps only its state and the button
  const gates = own && h.gates.total > 0 ? [gatesMark(h, ui), r(` gates ${h.gates.green}/${h.gates.total}`)] : [];
  const ctxFull = own && ctxText(h) ? [r(ctxText(h))] : [];
  const ctxShort = own && h.ctxPct !== undefined ? [r(`ctx ${Math.round(h.ctxPct)}%`)] : [];
  const up = own && h.upSecs !== undefined ? [r(`up ${elapsedClock(h.upSecs)}`, 'sub')] : [];
  const event: Run[] = []; // the events and the last run are the band's second line (bandDetail), not a segment of its first
  const last: Run[] = [];
  void lastRun;
  const button = h.button ? [clickRun('health', !!h.open, ui, 'band:health')] : [];
  return { gates, ctxFull, ctxShort, up, event, last, button };
}

/** The band's second line while no side panel shows (a terminal under 144 columns docks none unasked): the last run and the events the hooks saw, `last run none · 1 event · last 7s ago`. Empty when the panel is drawn (it has them) or the mod has neither. */
export function bandDetail(h: Health, lastRun: { secs?: number; done: number; total: number } | undefined): Run[] {
  if (h.panel) return [];
  const ev = h.hooks;
  const run = lastRun && lastRun.secs !== undefined ? `last run ${elapsedClock(lastRun.secs)}${lastRun.total > 0 ? ` · ${lastRun.done}/${lastRun.total} done` : ''}` : 'last run none';
  const bits = [run, ...(ev && ev.total > 0 ? [plural(ev.total, 'event')] : []), ...(ev?.lastEventSecs !== undefined ? [`last ${agoText(ev.lastEventSecs)} ago`] : [])];
  return [r(bits.join(' · '), 'sub')];
}

/** A row's fields in drawing order; `keep` says how long a field survives a narrow pane (the lowest goes first, a field is dropped whole, never cut). */
export type HealthField = { runs: Run[]; keep: number };
/** The same figures as rows for the HUD card and the panel rows. `fields` is the collapsed value; `detail` is what opening the row adds (lines of real data the collapsed value lacks; empty: nothing to expand). */
export type HealthRow = { id: 'hooks' | 'gates' | 'session' | 'last'; label: string; fields: HealthField[]; detail: string[]; /** The gates row's mark, for a fold to the count alone. */ runs: Run[] };

/** The fields that fit `room` cells joined by ` · `, dropping the lowest `keep` first and never cutting a field; the first field is always kept. */
export function fitFields(fields: readonly HealthField[], room: number): Run[] {
  const live = fields.filter((f) => f.runs.length > 0);
  const width = (fs: readonly HealthField[]): number => fs.reduce((n, f, i) => n + (i ? 3 : 0) + f.runs.reduce((w, x) => w + textWidth(x.t), 0), 0);
  let kept = live;
  while (kept.length > 1 && width(kept) > room) {
    const low = kept.reduce((lo, f, i) => (f.keep < kept[lo]!.keep || (f.keep === kept[lo]!.keep && i > lo) ? i : lo), 0);
    kept = kept.filter((_, i) => i !== low);
  }
  return kept.flatMap((f, i) => [...(i ? [glue()] : []), ...f.runs]);
}

/** A gate note's line in the detail list: indented, so it reads as the note of the check above it. */
export const NOTE_INDENT = '  ';

/** A hook's own name in words: `session.measure` -> `context measured`; an unnamed one reads its dotted words (`tool.call Bash` -> `tool call Bash`). */
const EVENT_WORDS: Record<string, string> = { 'session.measure': 'context measured', 'turn.complete': 'turn finished', 'classic.Stop': 'stop check', 'prompt.submit': 'prompt sent', 'session.start': 'session started' };
export const humanEvent = (label: string): string => EVENT_WORDS[label] ?? label.replace(/[._]+/g, ' ');
/** Which of several events in one second names the row (the one that says most). */
const EVENT_RANK = ['turn.complete', 'classic.Stop', 'prompt.submit', 'tool.call', 'session.measure', 'session.start'];
const rankOf = (label: string): number => { const k = EVENT_RANK.indexOf(label.split(' ')[0]!); return k < 0 ? EVENT_RANK.length : k; };
/** The recent list as rows: events of one second are one row (`turn finished · 3 events`; the same event twice is `tool call Bash x2`), newest first, at most `max` rows. */
export type RecentRow = { ageSecs: number; n: number; text: string };
export function recentEvents(recent: readonly { label: string; ageSecs: number }[], max: number): RecentRow[] {
  const out: RecentRow[] = [];
  for (const e of recent) {
    const at = out.at(-1);
    if (at && at.ageSecs === e.ageSecs) { (at as RecentRow & { labels: string[] }).labels.push(e.label); at.n++; } else out.push({ ageSecs: e.ageSecs, n: 1, text: '', labels: [e.label] } as RecentRow & { labels: string[] });
  }
  return out.slice(0, Math.max(0, max)).map((row) => {
    const labels = (row as RecentRow & { labels: string[] }).labels;
    const best = [...labels].sort((a, b) => rankOf(a) - rankOf(b))[0]!;
    const text = row.n === 1 ? humanEvent(best) : labels.every((l) => l === best) ? `${humanEvent(best)} ×${row.n}` : `${humanEvent(best)} · ${row.n} events`;
    return { ageSecs: row.ageSecs, n: row.n, text };
  });
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const seconds = (n: number | undefined): string => (n === undefined ? '' : elapsedClock(n));

/** `recent`: a recent-events list is drawn beside the rows, so the hooks row leaves out the age of the last event and the per-label counts that the list already says. */
export type RowOpts = { recent?: boolean; /** Messages on the channel: folded into the session row only when there are some. */ messages?: number; /** The panel's pinned footer says the version, so the session detail does not. */ footer?: boolean; /** The panel draws the context as its own gauge row: the session row leaves the figure out. */ gauge?: boolean };
export function healthRows(h: Health, ui: Ui, o: RowOpts = {}): HealthRow[] {
  const rows: HealthRow[] = [];
  const f = (text: string, keep: number, tone: Run['tone'] = 'text'): HealthField => ({ runs: [r(text, tone)], keep });
  const ev = h.hooks;
  const hooksFields: HealthField[] = [{ runs: [stateRun('done', ui), r(ev && ev.total > 0 ? ` ${plural(ev.total, 'event')}` : ' loaded')], keep: 9 }, ...(ev?.lastEventSecs !== undefined && !o.recent ? [f(`last ${agoText(ev.lastEventSecs)} ago`, 5, 'sub')] : [])];
  rows.push({ id: 'hooks', label: 'hooks', fields: hooksFields, runs: hooksFields.flatMap((x) => x.runs), detail: healthDetail(h, 'hooks', o) });
  if (h.gates.total > 0) {
    const checks = h.gates.checks.reduce((n, c) => n + (c.lines ?? 0), 0);
    const fields: HealthField[] = [{ runs: [gatesMark(h, ui), r(` ${h.gates.green}/${h.gates.total} green`)], keep: 9 }, ...(checks > 0 ? [f(`${plural(h.gates.checks.reduce((n, c) => n + (c.pass ?? 0), 0), 'check')} pass`, 3, 'sub')] : [])];
    rows.push({ id: 'gates', label: 'gates', fields, runs: [gatesMark(h, ui), r(` ${h.gates.green}/${h.gates.total} green`, 'sub')], detail: healthDetail(h, 'gates', o) });
  }
  const sessionFields: HealthField[] = [
    ...(h.upSecs !== undefined ? [f(`up ${elapsedClock(h.upSecs)}`, 9)] : []),
    ...(h.ctxPct !== undefined ? (o.gauge ? [] : [f(ctxText(h), 8)]) : h.tokens !== undefined ? [f(`${tokenText(h.tokens)} tok`, 8)] : []),
    ...(o.messages ? [f(plural(o.messages, 'message'), 2, 'sub')] : []),
  ]; // the branch and the version are the row's detail, not its value: opening the row is how you see them
  if (sessionFields.length) rows.push({ id: 'session', label: 'session', fields: sessionFields, runs: sessionFields.flatMap((x) => x.runs), detail: healthDetail(h, 'session', o) });
  const l = h.last;
  const lastFields: HealthField[] = l
    ? [
        ...(l.secs !== undefined ? [f(seconds(l.secs), 9)] : []),
        ...(l.failed > 0 ? [f(`${l.failed} failed`, 8, 'warn')] : []),
        ...(l.endedAgo !== undefined ? [f(`ended ${agoText(l.endedAgo)} ago`, 5)] : []),
        ...(l.agents > 0 ? [f(plural(l.agents, 'agent'), 4)] : []),
        ...(l.total > 0 ? [f(`${l.done}/${l.total} todos`, 3)] : []),
      ]
    : [{ runs: [r('none this session', 'muted')], keep: 9 }];
  rows.push({ id: 'last', label: 'last run', fields: lastFields, runs: lastFields.flatMap((x) => x.runs), detail: healthDetail(h, 'last', o) });
  return rows;
}

/** One summary line for the empty TODO and SUBAGENTS boxes: `● gates 4/4 · ctx 18%`; empty when the mod has neither figure. */
export function healthLine(h: Health, ui: Ui): string {
  const bits = [...(h.gates.total > 0 ? [`${gatesMark(h, ui).t} gates ${h.gates.green}/${h.gates.total}`] : []), ...(h.ctxPct !== undefined ? [`ctx ${Math.round(h.ctxPct)}%`] : [])];
  return bits.join(' · ');
}

/** What opening a row adds, from data the mod holds and the collapsed value lacks: no line restates the row. An empty list means the row has nothing more to show (it is not expandable). */
export function healthDetail(h: Health, id: HealthRow['id'], o: RowOpts = {}): string[] {
  if (id === 'gates') {
    // One schema per check: `name state n/m pass`; a note the gate gave is its own indented line under it (never glued on).
    return h.gates.checks.flatMap((c) => {
      const state = c.ok ? (c.pending ? 'pending' : 'green') : 'failed';
      const count = c.lines !== undefined && c.lines > 0 ? ` ${c.pass ?? 0}/${c.lines} pass` : '';
      return [`${c.id} ${state}${count}`, ...(c.note ? [`${NOTE_INDENT}${c.note}`] : [])];
    });
  }
  if (id === 'session') {
    const out: string[] = [];
    if (o.gauge) return h.version && !o.footer ? [`atlas ${h.version}`] : []; // the panel draws the tokens and the branch as rows of their own
    if (h.tokens !== undefined) out.push(h.window !== undefined ? `${grouped(h.tokens)} of ${grouped(h.window)} tokens in the window` : `${grouped(h.tokens)} tokens in the window`);
    if (h.tokens !== undefined) out.push('measured on the last response, not a session total');
    if (h.branch) out.push(`branch ${h.branch}`);
    if (h.version && !o.footer) out.push(`atlas ${h.version}`);
    return out;
  }
  if (id === 'hooks') {
    const by = (h.hooks?.byLabel ?? []).filter((e) => !o.recent || e.n > 1); // a label seen once is a line of the recent list: only a count says more than it
    const words = by.map((e) => `${humanEvent(e.label)} ${e.n}`);
    const lines = Array.from({ length: Math.min(3, Math.ceil(words.length / 2)) }, (_, k) => words.slice(k * 2, k * 2 + 2).join('   '));
    return lines;
  }
  const l = h.last;
  if (!l) return [];
  return (l.workers ?? []).map((w) => `${w.name} ${w.state}${w.secs !== undefined ? ` ${elapsedClock(w.secs)}` : ''}`);
}
