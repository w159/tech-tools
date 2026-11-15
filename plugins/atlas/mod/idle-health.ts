// idle-health.ts: the health summary shown while Atlas has no run yet (wave 42). One pure model (`Health`) every surface reads: the band's segments, the HUD's expanded card, the side panel's rows.
// It holds only what the mod really has; a figure it does not have is left out, never made up.
import { elapsedClock, stateRun, type Run, type Ui } from './atlas-ui';
import { textWidth } from './theme';
import type { HookStats } from './hook-log';
import type { Pulse } from './pulse';
import { gaugeRuns, sparkRuns } from './spark';
import { rateLabel } from './pulse';
import { gateCounts, gateLine, gatesTotal } from './vocab';

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
  /** Team mode (`off`, `on`) as its own session item; when absent it is read from the tripwire gate's `Team mode: off` note (teamOf), which is then left out of the notes. */
  team?: string;
  /** The observed-only history (pulse.ts) the events, context and runs rows draw their shapes from; absent: flat baselines and `—`. */
  pulse?: Pulse;
  /** The side panel is drawn beside the transcript: it already says the gates, the uptime, the context, the events and the last run, so the band and the card say only what it does not. */
  panel?: boolean;
};

/** The raw inputs register.ts hands the band; band.tsx completes them from the snapshot, the gates and the run clocks. */
export type HealthIn = { panel?: boolean; /** The observed history (pulse.ts pulseOf); absent until register.ts wires it: the band then draws no events spark. */ pulse?: Pulse; upSecs?: number; version?: string; branch?: string; tokens?: number | null; window?: number | null; hooks?: HookStats; open?: boolean };

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

/** A row's fields in drawing order; `keep` says how long a field survives a narrow pane (the lowest goes first, a field is dropped whole, never cut). */
export type HealthField = { runs: Run[]; keep: number };
/** The same figures as rows for the HUD card and the panel rows. `fields` is the collapsed value; `detail` is what opening the row adds (lines of real data the collapsed value lacks; empty: nothing to expand). */
export type HealthRow = { id: 'events' | 'gates' | 'context' | 'runs' | 'session'; label: string; fields: HealthField[]; detail: string[]; /** The row's collapsed value as runs. */ runs: Run[] };

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

/** The team mode as its own item: the Health's `team`, else the value of the tripwire's `Team mode: off` gate note (the gate says it as a note; the surfaces say `team off` in the session row, never as a note). */
export const teamOf = (h: Pick<Health, 'gates' | 'team'>): string | undefined => h.team ?? h.gates.checks.map((c) => /^Team mode:\s*(.+)$/.exec(c.note ?? '')?.[1]?.trim()).find((x) => !!x);
/** A gate's note without the team line (that is the session row's `team off`). */
export const noteOf = (c: HealthCheck): string => (c.note && !/^Team mode:/.test(c.note) ? c.note : '');
/** One gate in the one vocabulary (vocab.gateLine): `● name 8 pass · 0 deny`, red when any line is denied (deny = lines that are not ok); `○ name not fired` in grey when the gate has no lines yet. No pass ratio. */
export function gateOf(c: HealthCheck, ui: Pick<Ui, 'ascii'>): { glyph: string; name: string; count: string; text: string; tone: Run['tone']; pass: number; deny: number; fired: boolean } {
  const n = gateCounts(c);
  const g = gateLine(c.id, n.pass, n.total, ui.ascii);
  return { glyph: g.glyph, name: c.id, count: g.count, text: g.text, tone: g.tone, pass: g.pass, deny: g.deny, fired: g.fired };
}

/** The gates in one figure: denials summed over the gates that fired (`deny`), how many fired and how many have not. Checks that carry no group data fall back to the one-line-each count of the Health's own totals. */
export function gatesSummary(h: Pick<Health, 'gates'>) {
  const cs = h.gates.checks;
  return cs.length > 0 ? gatesTotal(cs.map(gateCounts)) : gatesTotal(h.gates.total > 0 ? [{ pass: h.gates.green, total: h.gates.total }] : []);
}

/** A hook's own name in words: `session.measure` -> `context measured`; an unnamed one reads its dotted words (`tool.call Bash` -> `tool call Bash`). */
const EVENT_WORDS: Record<string, string> = { 'session.measure': 'context measured', 'turn.complete': 'turn finished', 'classic.Stop': 'stop check', 'prompt.submit': 'prompt sent', 'session.start': 'session started' };
export const humanEvent = (label: string): string => EVENT_WORDS[label] ?? label.replace(/[._]+/g, ' ');
/** Which of several events in one second names the row (the one that says most). */
const EVENT_RANK = ['turn.complete', 'classic.Stop', 'prompt.submit', 'tool.call', 'session.measure', 'session.start'];
const rankOf = (label: string): number => { const k = EVENT_RANK.indexOf(label.split(' ')[0]!); return k < 0 ? EVENT_RANK.length : k; };
/** How a recent event reads at a glance: `info` (a call, a prompt), `ok` (a turn that finished), `bad` (a label that says a denial, a block or a failure). */
export type Sev = 'info' | 'ok' | 'bad';
export const severityOf = (label: string): Sev => (/\b(block(ed)?|den(y|ied)|fail(ed|ure)?|refus(ed|al)|error)\b/i.test(label) ? 'bad' : label.startsWith('turn.complete') ? 'ok' : 'info');
const SEV_RANK: Record<Sev, number> = { info: 0, ok: 1, bad: 2 };
/** The recent list as rows: events of one second are one row (`turn finished · 3 events`; the same event twice is `tool call Bash x2`), newest first, at most `max` rows; `sev` is the worst severity of the row's events. */
export type RecentRow = { ageSecs: number; n: number; text: string; sev: Sev };
export function recentEvents(recent: readonly { label: string; ageSecs: number }[], max: number): RecentRow[] {
  const groups: { ageSecs: number; labels: string[] }[] = [];
  for (const e of recent) {
    const at = groups.at(-1);
    if (at && at.ageSecs === e.ageSecs) at.labels.push(e.label);
    else groups.push({ ageSecs: e.ageSecs, labels: [e.label] });
  }
  return groups.slice(0, Math.max(0, max)).map(({ ageSecs, labels }): RecentRow => {
    const best = [...labels].sort((a, b) => rankOf(a) - rankOf(b))[0]!;
    const n = labels.length;
    const text = n === 1 ? humanEvent(best) : labels.every((l) => l === best) ? `${humanEvent(best)} ×${n}` : `${humanEvent(best)} · ${n} events`;
    const sev = labels.map(severityOf).reduce((w, x) => (SEV_RANK[x] > SEV_RANK[w] ? x : w), 'info' as Sev);
    return { ageSecs, n, text, sev };
  });
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

/** `recent`: a recent-events list is drawn beside the rows, so the events row's detail leaves out the per-label counts that the list already says. `gauge`: the panel draws the context as its own gauge rows, so the health rows leave the context row (and the branch) out. `sparkW` / `gaugeW`: cells of the events spark (the panel's 20 buckets, the card's 28) and of the gauge's inner bar. */
export type RowOpts = { recent?: boolean; /** Messages on the channel: folded into the session row only when there are some. */ messages?: number; /** The panel's pinned footer says the version, so the session row does not. */ footer?: boolean; gauge?: boolean; sparkW?: number; gaugeW?: number };
/** The events spark's cells in the panel: one per 15 s bucket of the 5 minutes the pulse keeps. */
export const EVENTS_W = 20;
const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);
/** The health rows both the panel and the card read: events, gates, context, runs, session. Every shape is drawn from the pulse (observed this session); an empty one is a flat baseline and `—`, never a made-up figure. The run's own seconds are the band's alone (the runs row holds shapes and counts). */
export function healthRows(h: Health, ui: Ui, o: RowOpts = {}): HealthRow[] {
  const rows: HealthRow[] = [];
  const p = h.pulse;
  const f = (text: string, keep: number, tone: Run['tone'] = 'text'): HealthField => ({ runs: [r(text, tone)], keep });
  const add = (id: HealthRow['id'], label: string, fields: HealthField[]): void => { rows.push({ id, label, fields, runs: fields.flatMap((x) => x.runs), detail: healthDetail(h, id, o) }); };
  if (h.gates.checks.length > 0) {
    const g = gatesSummary(h);
    const mark = g.fired === 0 ? r(ui.ascii ? 'o' : '○', 'sub') : g.deny > 0 ? r(ui.ascii ? 'x' : '✗', 'bad') : r(ui.ascii ? '*' : '●', 'ok');
    add('gates', 'gates', [
      { runs: [mark, r(g.fired === 0 ? ' not fired' : g.deny > 0 ? ` ${g.deny} denied` : ' ok', g.tone)], keep: 9 },
      ...(g.fired > 0 && g.deny === 0 ? [f('0 denied', 8, 'sub')] : []),
      { runs: [r(plural(h.gates.checks.length, 'gate'), 'text')], keep: 6 },
      ...(g.notFired > 0 && g.fired > 0 ? [f(`${g.notFired} not fired`, 5, 'sub')] : []),
    ]);
  }
  const seen = h.hooks?.total ?? 0; // no pulse wired yet: the hooks' own session count is real, and the baseline stays flat
  const lastEvent = h.hooks?.lastEventSecs;
  const rate = p ? rateLabel(p.events) : seen > 0 ? plural(seen, 'event') : '0/5m';
  add('events', 'events', [
    { runs: [...sparkRuns(p?.events ?? [], o.sparkW ?? EVENTS_W, ui), r('  '), r(rate, rate.startsWith('0/') ? 'muted' : 'text')], keep: 9 },
    ...(lastEvent !== undefined ? [f(`last ${agoText(lastEvent)}`, 4, 'sub')] : []),
  ]);
  if (!o.gauge) {
    const pct = h.ctxPct;
    const detail = pct === undefined ? (ui.ascii ? '-' : '—') : h.tokens !== undefined ? (h.window !== undefined ? `${Math.round(pct)}% · ${tokenText(h.tokens)} of ${tokenText(h.window)}` : `${Math.round(pct)}% · ${tokenText(h.tokens)} tokens`) : `${Math.round(pct)}%`;
    add('context', 'context', [{ runs: [...gaugeRuns(pct, o.gaugeW ?? 20, ui), r(` ${detail}`, pct === undefined ? 'muted' : 'text')], keep: 9 }]);
  }
  const done = p?.runs ?? [];
  const lastRun = done.at(-1);
  const okGlyph = ui.ascii ? '*' : '●';
  add('runs', 'runs', done.length
    ? [
        { runs: [...done.flatMap((x, i): Run[] => [...(i ? [r(' ')] : []), r(okGlyph, x.ok ? 'ok' : 'bad')]), r('  '), r(plural(done.length, 'run'))], keep: 9 },
        f(`last ${elapsedClock(lastRun!.secs)}`, 7),
        ...(h.last?.endedAgo !== undefined ? [f(`${agoText(h.last.endedAgo)} ago`, 5, 'sub')] : []),
      ]
    : [{ runs: [r(ui.ascii ? 'o' : '○', 'muted'), r(' no runs this session', 'muted')], keep: 9 }]);
  const team = teamOf(h);
  const sessionFields: HealthField[] = [
    ...(h.upSecs !== undefined ? [f(`up ${elapsedClock(h.upSecs)}`, 9)] : []),
    ...(h.branch && !o.gauge ? [f(h.branch, 7)] : []),
    ...(team ? [f(`team ${team}`, 8)] : []),
    ...(h.version && !o.footer && !o.gauge ? [f(`atlas ${h.version}`, 4)] : []),
    ...(p?.cost ? [f(`cost $${p.cost.usd.toFixed(2)}`, 5)] : []), // the host's own measure: absent when the host sent none
    ...(o.messages ? [f(plural(o.messages, 'message'), 2, 'sub')] : []),
  ];
  if (sessionFields.length) add('session', 'session', sessionFields);
  return rows;
}

/** One summary line for the empty TODO and SUBAGENTS boxes: `● gates ok · ctx 18%` or `✗ 2 denied · ctx 18%`; empty when the mod has neither figure. */
export function healthLine(h: Health, ui: Ui): string {
  const g = gatesSummary(h);
  const gateBit = g.fired + g.notFired === 0 ? [] : g.fired === 0 ? [`${ui.ascii ? 'o' : '○'} gates not fired`] : g.deny > 0 ? [`${ui.ascii ? 'x' : '✗'} ${g.deny} denied`] : [`${ui.ascii ? '*' : '●'} gates ok`];
  const bits = [...gateBit, ...(h.ctxPct !== undefined ? [`ctx ${Math.round(h.ctxPct)}%`] : [])];
  return bits.join(' · ');
}

/** What opening a row adds, from data the mod holds and the collapsed value lacks: no line restates the row. An empty list means the row has nothing more to show (it is not expandable). */
export function healthDetail(h: Health, id: HealthRow['id'], o: RowOpts = {}): string[] {
  if (id === 'gates') {
    // One schema per check, the one vocabulary `● name n/m`; a note the gate gave is its own indented line under it (never glued on).
    return h.gates.checks.flatMap((c) => [gateOf(c, { ascii: false }).text, ...(noteOf(c) ? [`${NOTE_INDENT}${noteOf(c)}`] : [])]);
  }
  if (id === 'session') return o.gauge && h.version && !o.footer ? [`atlas ${h.version}`] : []; // the panel draws the tokens and the branch as rows of their own; the card's session row says everything in its fields
  if (id === 'context') {
    if (h.tokens === undefined) return [];
    return [h.window !== undefined ? `${grouped(h.tokens)} of ${grouped(h.window)} tokens in the window` : `${grouped(h.tokens)} tokens in the window`, 'measured on the last response, not a session total'];
  }
  if (id === 'events') {
    const by = (h.hooks?.byLabel ?? []).filter((e) => !o.recent || e.n > 1); // a label seen once is a line of the recent list: only a count says more than it
    const words = by.map((e) => `${humanEvent(e.label)} ${e.n}`);
    return Array.from({ length: Math.min(3, Math.ceil(words.length / 2)) }, (_, k) => words.slice(k * 2, k * 2 + 2).join('   '));
  }
  // runs: how each worker of the last run ended (its duration is the band's run clock, never repeated here)
  return (h.last?.workers ?? []).map((w) => `${w.name} ${w.state}`);
}
