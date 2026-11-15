// status-frame.ts: the side panel's status tab of the approved frame spec (critics/mock-final.md frames S1-S8), as runs. Pure: the panel hands it the run state, the phase list and the health figures.
//
// Grid (spec 2.1): every row is `gutter + U usable cells` (the host draws the border before it and the margin after it); a ribbon starts at usable col 1, body content at col 5 (indent 4), numbers
// are right-aligned to col U. The sections, in order: NOW (state head, phase stepper `●●◆○○○ 3/6`, the `doing` line or the denial), ACTIVITY (20 buckets x 15 s as 3 rows of eighth blocks, the
// `0└5m───now` axis and the stats column), CONTEXT (gauge `▰▱`, `~N turns left`, `+Nk/turn`; absent before the first measure), RUNS (after the first run), GATES (checks ok fail), HOOKS (the elastic
// section: every free row), then the footer pinned to the last row. One blank row separates sections; spare rows are blank at the bottom, never between sections.
//
// Overflow (2.8): HOOKS rows shrink first (one row stays), then RUNS goes, then gate child rows collapse to group rows. NOW and the denial line never shrink.
// Colour (2.4): green only for measured passes, amber for ctx >= 70 % or a hook p50 >= 50 ms, red for denial and failure, violet ramp 97/141/183 for the bars.
import { elapsedClock, type Run, type Ui } from './atlas-ui';
import { bandLook } from './band-frame';
import { WIRED_HOOKS } from './hook-log';
import { agoText, gatesSummary, severityOf, teamOf, tokenText, type Health } from './idle-health';
import { ctxDelta, ctxRunway, RATE_BUCKETS } from './pulse';
import { fitText, textWidth } from './theme';
import { gateCounts } from './vocab';

/** Buckets of the activity chart: 20 x 15 s = the 5 minutes every surface counts. */
export const STATUS_BUCKETS = RATE_BUCKETS;
/** Rows of the activity chart (eighth blocks, 8 levels each). */
const CHART_ROWS = 3;
const CHART_AT = 7; // usable col of the first bucket
const INDENT = 4;
const GAUGE_W = 12;
const BLOCKS = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const BLOCKS_ASCII = [' ', '_', '.', ',', '-', ':', '=', '+', '#'];

export type StatusGateLine = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
export type StatusGate = { id: string; title: string; error?: string; lines: readonly StatusGateLine[] };
export type StatusIn = {
  /** The panel's width in cells: gutter + U usable cells + margin. */
  cols: number;
  /** Rows the body may fill, footer included (0: unknown, no limit). */
  room: number;
  ui: Ui;
  kind: 'idle' | 'working' | 'done' | 'blocked';
  /** The phase list, the current phase (an unknown or `blocked` one lights none) and the glyph the spinner shows this frame. */
  phases: readonly string[];
  phase: string;
  spin: string;
  /** Shared clock reading in ms: the idle heartbeat reads it. */
  now?: number;
  todos: { done: number; total: number };
  /** The gate groups as the panel holds them: the failing lines (label, detail, fix) of a failing group are its child rows. */
  gates: readonly StatusGate[];
  health: Health;
  /** A blank row first: the header leaves none above the body (below 100 columns). */
  lead: boolean;
};

const HEART = ['◌', '◎', '◌', '◌'] as const;
const HEART_ASCII = ['.', 'o', '.', '.'] as const;
const HEART_MS = 400;

const sum = (xs: readonly number[]): number => xs.reduce((n, x) => n + x, 0);

/** The status body as rows of runs (each starts with the gutter cell); the first row is blank when `lead`, the last is the footer. */
export function statusFrame(a: StatusIn): Run[][] {
  const { ui, health: h } = a;
  const k = bandLook(ui);
  const ascii = ui.ascii;
  const u = Math.max(20, a.cols - 2);
  const g = (full: string, plain: string): string => (ascii ? plain : full);
  const on = (t: string, fg: string, o: Partial<Run> = {}): Run => ({ t, tone: 'text', fg, ...o });
  const dim = (t: string, o: Partial<Run> = {}): Run => on(t, k.dim, { tone: 'sub', ...o });
  const txt = (t: string, o: Partial<Run> = {}): Run => on(t, k.text, o);
  const green = (t: string): Run => on(t, k.ok, { tone: 'ok' });
  const red = (t: string, o: Partial<Run> = {}): Run => on(t, k.bad, { tone: 'bad', ...o });
  const amber = (t: string): Run => on(t, k.warn, { tone: 'warn' });
  const violet = (t: string, i = 1): Run => on(t, k.ramp[i]!, { tone: 'accent' });
  const w = (runs: readonly Run[]): number => sum(runs.map((x) => textWidth(x.t)));
  const sp = (n: number): Run => ({ t: ' '.repeat(Math.max(0, n)), tone: 'text' });

  /** One row: gutter, `at` blank cells, `left`, the gap, `right` flush to col U (the left side gives way when they do not both fit). */
  const row = (left: readonly Run[], right: readonly Run[] = [], at = INDENT): Run[] => {
    const rw = w(right);
    const room = u - at - (rw ? rw + 1 : 0);
    let l = [...left];
    if (w(l) > room) {
      let over = w(l) - Math.max(1, room);
      l = l.map((x, i) => {
        if (i < l.length - 1 || over <= 0) return x;
        const t = fitText(x.t, Math.max(1, textWidth(x.t) - over));
        over = 0;
        return { ...x, t };
      });
    }
    return [sp(1 + at), ...l, ...(rw ? [sp(u - at - w(l) - rw)] : []), ...right];
  };
  const ribbon = (title: string, meta: readonly Run[] = []): Run[] => {
    const head = ` ${title} `;
    const rule = (n: number): Run => on(g('─', '-').repeat(n), k.rule, { tone: 'dim' });
    const fit = w(meta) > 0 && u - 2 - textWidth(head) - 1 - w(meta) >= 2 ? meta : [];
    const fill = u - 2 - textWidth(head) - (fit.length ? 1 + w(fit) : 0);
    return [sp(1), rule(2), on(head, k.work, { tone: 'accent', bold: true }), rule(Math.max(0, fill)), ...(fit.length ? [sp(1), ...fit] : [])];
  };
  const metaText = (t: string): Run[] => [dim(t)];
  const blank: Run[] = [];

  // ---- NOW ----
  const kind = a.kind;
  const denied = Math.max(0, h.gates.denied ?? gatesSummary(h).deny);
  const fireAt = kind === 'working' || kind === 'blocked' || h.denyAgeSecs === undefined || h.denyAgeSecs < 60;
  const failing = a.gates.flatMap((x) => x.lines.filter((l) => !l.ok).map((l) => ({ group: x.id, ...l })));
  const showDenial = denied > 0 && fireAt;
  const idx = a.phases.indexOf(a.phase);
  const stepper = (): Run[] => {
    if (!a.phases.length) return [];
    const upTo = kind === 'done' ? a.phases.length : idx < 0 ? 0 : idx;
    const cells: Run[] = a.phases.map((_, i): Run => (i < upTo ? green(g('●', '*')) : i === idx && kind !== 'done' ? violet(g('◆', '#'), 1) : dim(g('○', 'o'))));
    const n = kind === 'done' ? a.phases.length : idx < 0 ? 0 : idx + 1;
    return [...cells, dim(` ${n}/${a.phases.length}`)];
  };
  const toolsRun = h.hooks?.runTools;
  const lastRun = h.pulse?.runs.at(-1);
  /** A prompt reached the mod or a run ended: before that the gates are armed, not measured (2.5), and the head says no prompt yet. */
  const prompted = kind !== 'idle' || (h.hooks?.byLabel ?? []).some((e) => e.label === 'prompt.submit') || !!lastRun;
  const now: Run[][] = [];
  if (kind === 'idle') {
    const beat = a.now === undefined || ui.color === 'none' ? 0 : Math.floor(a.now / HEART_MS) % HEART.length;
    const noPrompt = !prompted;
    now.push(ribbon('NOW'));
    now.push(row([dim(ascii ? HEART_ASCII[beat]! : HEART[beat]!), txt(' idle'), dim(` · ${noPrompt ? 'no prompt yet' : lastRun ? `last run ${elapsedClock(lastRun.secs)}` : 'ready'}`)]));
    const team = teamOf(h);
    now.push(row([dim(`armed: ${h.gates.checks.length} gates · ${WIRED_HOOKS.length} hooks${team ? ` · team ${team}` : ''}`)]));
  } else {
    now.push(ribbon('NOW', h.upSecs !== undefined ? metaText(`up ${elapsedClock(h.upSecs)}`) : []));
    const head: Run[] = kind === 'done' ? [green(g('●', '*')), txt(' done', { bold: true })]
      : kind === 'blocked' ? [red(g('■', 'x')), txt(' blocked', { bold: true })]
        : [violet(a.spin, 2), txt(` ${a.phase && idx >= 0 ? a.phase : 'working'}`, { bold: true })];
    now.push(row(head, stepper()));
    if (showDenial) {
      const first = failing[0];
      const what = first ? first.label.replace(/\s+calls?$/i, '') : '';
      now.push(row([red(`${g('■', 'x')} ${denied} ${denied === 1 ? 'call' : 'calls'} denied${what ? ` · ${what}` : ''}`)]));
      if (first?.fix) now.push(row([dim(`fix: ${first.fix}`)]));
    } else {
      const parts = kind === 'done'
        ? [...(toolsRun !== undefined ? [`${toolsRun} ${toolsRun === 1 ? 'tool' : 'tools'}`] : []), ...(h.last?.endedAgo !== undefined ? [`ended ${agoText(h.last.endedAgo)} ago`] : [])]
        : [...(h.hooks?.runTool ? [h.hooks.runTool.replace(/^mcp__.*__/, '')] : []), ...(toolsRun !== undefined ? [`${toolsRun} ${toolsRun === 1 ? 'tool' : 'tools'}`] : []), ...(a.todos.total > 0 ? [`item ${a.todos.done}/${a.todos.total} done`] : [])];
      if (parts.length) now.push(row([dim(parts.join(' · '))]));
    }
  }

  // ---- ACTIVITY ----
  const events = [...new Array<number>(Math.max(0, STATUS_BUCKETS - (h.pulse?.events.length ?? 0))).fill(0), ...(h.pulse?.events ?? []).slice(-STATUS_BUCKETS)];
  const total = sum(events);
  const peak = Math.max(0, ...events);
  const scale = Math.max(4, peak);
  const level = (v: number): number => (v <= 0 ? 0 : Math.max(1, Math.min(CHART_ROWS * 8, Math.round((v / scale) * CHART_ROWS * 8))));
  const ramp = ascii ? BLOCKS_ASCII : BLOCKS;
  const lastSecs = h.hooks?.lastEventSecs;
  const stats: Run[][] = [
    [txt(`${total} ev`)],
    [dim(`peak ${peak}/15s`)],
    [dim(lastSecs !== undefined ? `last ${agoText(lastSecs)}` : 'no calls')],
  ];
  const activity: Run[][] = [ribbon('ACTIVITY', metaText('hook events · 5 min'))];
  for (let r = 0; r < CHART_ROWS; r++) {
    const bottom = CHART_ROWS - 1 - r; // 0 = the bottom row
    const cellsOf: Run[] = events.map((v, i): Run => {
      const lv = Math.max(0, Math.min(8, level(v) - bottom * 8));
      if (lv === 0) return bottom === 0 && v <= 0 ? on(g('─', '-'), k.rule, { tone: 'dim' }) : { t: ' ', tone: 'text' };
      return on(ramp[lv]!, k.ramp[Math.min(2, Math.floor((i * 3) / events.length))]!, { tone: 'accent' });
    });
    activity.push(row(cellsOf, stats[r]!, CHART_AT - 1));
  }
  activity.push(row([dim(`0${g('└', '+')}`), dim('5m'), dim(g('─', '-').repeat(STATUS_BUCKETS - 5)), dim('now')], [], INDENT));

  // ---- CONTEXT ----
  const ctxs = h.pulse?.ctx ?? [];
  const pct = h.ctxPct ?? ctxs.at(-1)?.pct;
  const context: Run[][] = [];
  if (pct !== undefined) {
    const tokens = h.tokens ?? ctxs.at(-1)?.tokens;
    const window = h.pulse?.window ?? h.window;
    const meta = tokens !== undefined ? `${tokenText(tokens)}${window !== undefined ? ` of ${tokenText(window)}` : ' tokens'}` : '';
    const hot = pct >= 70;
    const filled = pct > 0 ? Math.max(1, Math.min(GAUGE_W, Math.round((pct / 100) * GAUGE_W))) : 0;
    const gauge: Run[] = [hot ? amber(g('▰', '#').repeat(filled)) : violet(g('▰', '#').repeat(filled), 1), dim(g('▱', '-').repeat(GAUGE_W - filled))].filter((x) => x.t !== '');
    const runway = h.pulse ? ctxRunway({ ctx: ctxs, ...(window !== undefined ? { window } : {}) }) : undefined;
    context.push(ribbon('CONTEXT', meta ? metaText(meta) : []));
    context.push(row([...gauge, hot ? amber(` ${Math.round(pct)}%`) : txt(` ${Math.round(pct)}%`)], runway !== undefined ? [dim(`~${runway} ${runway === 1 ? 'turn' : 'turns'} left`)] : []));
    const delta = h.pulse ? ctxDelta({ ctx: ctxs }) : undefined;
    if (delta) {
      const tail = ctxs.slice(-5);
      const top = Math.max(...tail.map((s) => s.tokens));
      const spark: Run[] = tail.length >= 3 ? [violet(tail.map((s) => ramp[Math.max(1, Math.min(8, Math.ceil((s.tokens / top) * 8)))]!).join(''), 1), sp(1)] : [];
      context.push(row([...spark, dim(delta)]));
    }
  }

  // ---- RUNS ----
  const runs = h.pulse?.runs ?? [];
  const runsSec: Run[][] = [];
  if (runs.length) {
    const longest = Math.max(1, ...runs.map((x) => x.secs));
    const kept = runs.slice(-12);
    const bars: Run[] = kept.map((x) => on(ramp[Math.max(1, Math.min(8, Math.round((x.secs / longest) * 7) + 1))]!, x.ok ? k.ramp[1]! : k.bad, { tone: x.ok ? 'accent' : 'bad' }));
    const sorted = runs.map((x) => x.secs).sort((p, q) => p - q);
    const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]! : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);
    const failed = runs.filter((x) => !x.ok).length;
    runsSec.push(ribbon('RUNS', metaText(`${runs.length} ${runs.length === 1 ? 'run' : 'runs'}`)));
    runsSec.push(row([...bars, sp(2), dim(`med ${elapsedClock(med)} · max ${elapsedClock(longest)}${failed ? ' · ' : ''}`), ...(failed ? [red(`${failed} failed`)] : [])]));
  }

  // ---- GATES ----
  const checks = h.gates.checks;
  const gatesSec = (children: boolean): Run[][] => {
    const out: Run[][] = [ribbon('GATES', metaText('checks   ok fail'))];
    for (const c of checks) {
      const n = gateCounts(c);
      const deny = n.total - n.pass;
      const fired = n.total > 0 && (prompted || deny > 0);
      const mark = deny > 0 ? red(g('■', 'x')) : fired ? green(g('●', '*')) : dim(g('○', 'o'));
      const armed = c.lines ?? n.total;
      const right: Run[] = fired ? [txt(`${n.pass} `), deny > 0 ? red(String(deny).padStart(4)) : txt(String(deny).padStart(4))] : [dim(armed > 0 ? `${armed} armed` : 'armed')];
      out.push(row([mark, txt(` ${c.id}`)], right));
      if (deny > 0 && children) {
        const grp = a.gates.find((x) => x.id === c.id);
        const bad = (grp?.lines ?? []).filter((l) => !l.ok);
        bad.forEach((l, i) => {
          const last = i === bad.length - 1;
          const detail = (l.detail ?? '').trim();
          const rw = detail ? textWidth(detail) + 2 : 0;
          const label = fitText(l.label, Math.max(4, u - 9 - rw));
          out.push(row([dim(`${last ? g('└', '+') : g('├', '+')} `), red(g('■', 'x')), txt(` ${label}`)], detail ? [red(detail)] : [], 5));
          if (l.fix) out.push(row([dim(`${last ? ' ' : g('│', '|')}   fix: ${l.fix}`)], [], 5));
        });
      }
    }
    return out;
  };

  // ---- HOOKS ----
  const total0 = h.hooks?.total ?? 0;
  const lat = h.hooks?.latency;
  const hookMeta: Run[] = [dim(`${total0} seen`), ...(lat ? (lat.n >= 20 ? [dim(' · '), lat.p50 >= 50 ? amber(`p50 ${lat.p50}ms`) : dim(`p50 ${lat.p50}ms`), dim(` · p95 ${lat.p95}ms`)] : [dim(' · '), lat.p50 >= 50 ? amber(`${lat.p50}ms`) : dim(`${lat.p50}ms`)]) : [])];
  const feed = (() => {
    const out: { label: string; ageSecs: number; n: number; ms?: number }[] = [];
    for (const e of h.hooks?.recent ?? []) {
      const at = out.at(-1);
      if (at && at.label === e.label && at.ageSecs === e.ageSecs) { at.n++; if (e.ms !== undefined) at.ms = Math.max(at.ms ?? 0, e.ms); }
      else out.push({ label: e.label, ageSecs: e.ageSecs, n: 1, ...(e.ms !== undefined ? { ms: e.ms } : {}) });
    }
    return out;
  })();
  const hookRow = (e: (typeof feed)[number]): Run[] => {
    const right: Run[] = e.ms !== undefined ? [e.ms >= 50 ? amber(`${e.ms}ms`) : dim(`${e.ms}ms`)] : [];
    const text = `${e.label}${e.n > 1 ? ` ×${e.n}` : ''}`;
    const bad = severityOf(e.label) === 'bad';
    return row([dim(agoText(e.ageSecs).padStart(3)), sp(2), bad ? red(text) : txt(text)], right);
  };

  // ---- the footer ----
  const footer: Run[] = (() => {
    const left = [h.version ? `atlas ${h.version}` : '', h.branch ?? ''].filter(Boolean).join(' · ');
    if (!left) return blank;
    return row([dim(left)], h.pulse?.cost ? [dim(`cost $${h.pulse.cost.usd.toFixed(2)}`)] : []);
  })();

  // ---- the stack: HOOKS shrink first, then RUNS, then gate children (2.8) ----
  const hooksSec = (rows: number): Run[][] => [ribbon('HOOKS', hookMeta), ...feed.slice(0, rows).map(hookRow)];
  const stack = (withRuns: boolean, children: boolean, ctxRows: number): Run[][][] => [now, activity, ...(context.length ? [context.slice(0, ctxRows)] : []), ...(withRuns && runsSec.length ? [runsSec] : []), gatesSec(children)];
  const lead = a.lead ? 1 : 0;
  const foot = footer.length ? 1 : 0;
  const used = (s: Run[][][], hooks: number): number => lead + sum(s.map((x) => x.length)) + s.length /* a blank after each */ + 1 + hooks + foot;
  const want = a.room > 0 ? feed.length : Math.min(feed.length, 5);
  let sections = stack(true, true, 3);
  let hookRows = want;
  if (a.room > 0) {
    const levels: [boolean, boolean, number][] = [[true, true, 3], [false, true, 3], [false, false, 3], [false, false, 2]];
    let pick = 0;
    for (; pick < levels.length - 1; pick++) {
      sections = stack(...levels[pick]!);
      if (used(sections, Math.min(1, feed.length)) <= a.room) break;
    }
    sections = stack(...levels[pick]!);
    hookRows = Math.max(0, Math.min(want, a.room - used(sections, 0)));
    if (feed.length > 0 && hookRows < 1 && used(sections, 1) <= a.room) hookRows = 1;
  }
  const body: Run[][] = [...(a.lead ? [blank] : []), ...[...sections, hooksSec(hookRows)].flatMap((s, i, all) => [...s, ...(i < all.length - 1 ? [blank] : [])])];
  if (a.room > 0) {
    const cap = a.room - foot;
    const cut = body.slice(0, cap);
    return [...cut, ...Array.from({ length: Math.max(0, cap - cut.length) }, () => blank), ...(foot ? [footer] : [])];
  }
  return [...body, ...(foot ? [blank, footer] : [])];
}
