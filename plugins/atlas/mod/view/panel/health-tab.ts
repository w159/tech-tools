// health-tab.ts: the health tab of the redesigned side panel (approved mockup `health`): SESSION state, context / hook / tools / denials rows with thin bars and sparklines, the RUNS summary and bar chart, the last runs.
// Every figure is one the mod already computes (data/metrics, data/pulse, data/idle-health); a figure it does not have reads `—`, never an invented one.
import { elapsedClock, stateRun, type Run, type Tone } from '../../design/atlas-ui';
import { blockSpark } from '../../design/chart';
import { agoText, gatesFailed, tokenText, type Health } from '../../data/idle-health';
import { P95_MIN_SAMPLES, runFigures, runsOf } from '../../data/metrics';
import { ctxLevel, latencyLevel } from '../band/band-frame';
import { BLANK, dot, r, type PanelLine, type PanelModel } from './panel-shared';
import { bar, g, head, kv, padL, row, usable } from './tab-kit';

const DASH = '—';
const KEY_W = 11;
const dash = (m: PanelModel): string => (m.ui.ascii ? '-' : DASH);

/** The one state word of the session: the worst of what the mod measures. */
function sessionState(m: PanelModel, h: Health): { text: string; tone: Tone; mark: Run } {
  const ui = m.ui;
  const denied = h.gates.denied ?? h.gates.checks.filter((c) => !c.ok).length;
  if (gatesFailed(h)) return { text: `${denied || 1} denied`, tone: 'bad', mark: stateRun('failed', ui) };
  if ((h.ctxPct ?? 0) >= 90) return { text: 'context full', tone: 'bad', mark: stateRun('failed', ui) };
  if ((h.ctxPct ?? 0) >= 70 || latencyLevel(h.hooks?.latency?.p50 ?? 0) !== 'ok') return { text: 'degraded', tone: 'warn', mark: stateRun('blocked', ui) };
  return { text: 'healthy', tone: 'ok', mark: stateRun('done', ui) };
}
/** The one ramp of the band's slots (band-frame ctxLevel / latencyLevel), as a tone. */
const level = (l: 'ok' | 'warn' | 'bad'): Tone => l;
const ctxTone = (pct: number): Tone => level(ctxLevel(pct));

/** Events per minute (the newest four 15-second buckets) and the busiest minute, from the pulse. */
function toolRate(h: Health): { now: number; peak: number; series: number[] } | undefined {
  const ev = h.pulse?.events;
  if (!ev || !ev.length) return undefined;
  const sum4 = (i: number): number => ev.slice(Math.max(0, i - 3), i + 1).reduce((n, x) => n + x, 0);
  const sums = ev.map((_, i) => sum4(i));
  return { now: sums[sums.length - 1]!, peak: Math.max(...sums), series: ev.slice(-14) };
}

/** The runs chart: one bar per run (the newest that fit), ok green and failed red, the y axis labelled with its maximum and 0. */
function runsChart(m: PanelModel, h: Health, height: number): PanelLine[] {
  const ui = m.ui;
  const all = runsOf(h);
  if (!all.length) return [];
  const U = usable(m);
  const axisW = Math.max(5, ...all.map((x) => elapsedClock(x.secs).length)) + 1;
  const n = Math.min(all.length, Math.max(4, Math.floor((U - axisW - 4) / 2)));
  const runs = all.slice(-n);
  const max = Math.max(1, ...runs.map((x) => x.secs));
  const lv = runs.map((x) => Math.max(1, Math.ceil((x.secs / max) * height)));
  const out: PanelLine[] = [];
  for (let k = height; k >= 1; k--) {
    const lab = k === height ? elapsedClock(max) : k === 1 ? '0' : '';
    const cellsRuns: Run[] = runs.map((x, i) => r(`${lv[i]! >= k ? g(ui, '▇', '#') : ' '} `, x.ok ? 'ok' : 'bad'));
    out.push({ runs: [r(' '), r(`${padL(lab, axisW)} ${k === 1 ? g(ui, '┤', '+') : g(ui, '│', '|')} `, 'dim'), ...cellsRuns] });
  }
  out.push({ runs: [r(' '), r(`${' '.repeat(axisW)} ${g(ui, '└', '+')}${g(ui, '─', '-').repeat(n * 2)}`, 'dim')] });
  out.push(row(m, [r(' '.repeat(axisW + 2) + 'oldest', 'muted')], [r('newest', 'muted')]));
  return out;
}

/** The context row: a bar and percentage, plus the token detail when the width allows. */
function contextRow(m: PanelModel, h: Health, U: number): PanelLine {
  const ui = m.ui;
  const pct = h.ctxPct ?? h.pulse?.ctx.at(-1)?.pct;
  const detail = h.tokens !== undefined && h.window !== undefined ? `${tokenText(h.tokens)} / ${tokenText(h.window)}` : '';
  const pctText = pct === undefined ? dash(m) : `${Math.round(pct)}%`;
  const fixed = 2 + padL(pctText, 4).length + (detail ? 2 + detail.length : 0);
  const barW = Math.max(6, Math.min(24, U - KEY_W - fixed));
  return kv(m, 'context', [
    ...(pct === undefined ? [r(g(ui, '━', '-').repeat(barW), 'dim')] : bar(ui, pct, barW, ctxTone(pct))),
    r(`  ${pctText}`, pct === undefined ? 'muted' : 'text', pct === undefined ? {} : { bold: true }),
    ...(detail && U - KEY_W - barW - fixed >= 0 ? [r(`  ${detail}`, 'muted')] : []),
  ], KEY_W);
}

/** The p95 figure: a dash until the handler has enough samples. */
function p95Run(m: PanelModel, lat: { p95: number; n: number }): Run {
  if (lat.n < P95_MIN_SAMPLES) return r(dash(m), 'muted');
  const lv = level(latencyLevel(lat.p95));
  return r(`${lat.p95}ms`, lv === 'ok' ? 'text' : lv);
}

/** The hook latency row: p50, p95 and a sparkline of the recent handler times. */
function hookRow(m: PanelModel, h: Health, sparkW: number): PanelLine {
  const lat = h.hooks?.latency;
  const ring = (h.hooks?.recent ?? []).filter((x) => x.ms !== undefined).map((x) => x.ms!).reverse();
  return kv(m, 'hook p50', lat
    ? [r(`${lat.p50}ms`, level(latencyLevel(lat.p50)), { bold: true }), r('   p95 ', 'muted'), p95Run(m, lat), ...(sparkW >= 6 && ring.length ? [r('    '), r(blockSpark(ring, sparkW, { ascii: m.ui.ascii, min: 20 }), 'ok')] : [])]
    : [r(dash(m), 'muted'), r('  no handler samples yet', 'dim')], KEY_W);
}

/** The tools-per-minute row: the current rate, the peak and a sparkline. */
function toolsRow(m: PanelModel, h: Health, sparkW: number): PanelLine {
  const rate = toolRate(h);
  return kv(m, 'tools/min', rate
    ? [r(`${rate.now}`, 'text', { bold: true }), r(`   peak ${rate.peak}`, 'muted'), ...(sparkW >= 6 ? [r('    '), r(blockSpark(rate.series, sparkW, { ascii: m.ui.ascii }), 'info')] : [])]
    : [r(dash(m), 'muted')], KEY_W);
}

/** The denials row: the count, when the last one happened and a one-bucket sparkline. */
function denialsRow(m: PanelModel, h: Health, sparkW: number): PanelLine {
  const denied = h.gates.denied ?? h.gates.checks.filter((c) => !c.ok).length;
  const at = h.denyAgeSecs;
  const dseries = at !== undefined && h.pulse ? Array.from({ length: 14 }, (_, i) => (13 - i === Math.floor(at / 15) ? 1 : 0)) : [];
  return kv(m, 'denials', [
    r(`${denied}`, denied ? 'bad' : 'text', { bold: true }),
    r(at !== undefined ? `    last ${agoText(at)} ago` : denied ? '' : '    none this session', 'muted'),
    ...(dseries.length && sparkW >= 6 ? [r('  '), r(blockSpark(dseries, sparkW, { ascii: m.ui.ascii, min: 1 }), 'bad')] : []),
  ], KEY_W);
}

/** The RUNS header: the count, median and p90, and the failed count when there is one. */
function runsHeader(m: PanelModel, runs: { secs: number; ok: boolean }[]): PanelLine {
  const ui = m.ui;
  const f = runFigures(runs.map((x) => x.secs));
  const failed = runs.filter((x) => !x.ok).length;
  return head(m, 'RUNS', [], [r(`   ${runs.length} run${runs.length === 1 ? '' : 's'} ${dot(ui)} med ${elapsedClock(f.med)} ${dot(ui)} p90 ${elapsedClock(f.p90)}`, 'muted'), ...(failed ? [r(` ${dot(ui)} `, 'muted'), r(`${failed} failed`, 'bad')] : [])]);
}

/** The "last" row: the three newest runs, newest first. */
function lastRunsRow(m: PanelModel, runs: { secs: number; ok: boolean }[]): PanelLine {
  const ui = m.ui;
  const lastRuns = runs.slice(-3).reverse();
  return row(m, [r('last  ', 'muted'), ...lastRuns.flatMap((x, i): Run[] => [r(i ? '   ' : ''), { ...stateRun(x.ok ? 'done' : 'failed', ui), t: `${stateRun(x.ok ? 'done' : 'failed', ui).t} ` }, r(elapsedClock(x.secs), x.ok ? 'text' : 'sub')])]);
}

/** The RUNS section: the summary, the bar chart and the last runs, or the empty line. */
function runsSection(m: PanelModel, h: Health, room: number, used: number): PanelLine[] {
  const runs = runsOf(h);
  if (!runs.length) return [head(m, 'RUNS', [], [r('   no runs yet', 'muted')])];
  const chartH = room > 0 ? Math.max(3, Math.min(7, room - (used + 1) - 8)) : 7;
  return [runsHeader(m, runs), BLANK, ...runsChart(m, h, chartH), BLANK, lastRunsRow(m, runs)];
}

/** `budget` is how many rows the figures may take: the RUNS chart is left out when it would not fit (the gates share the pane). */
export function healthRows(m: PanelModel, room: number, budget = Infinity): PanelLine[] {
  const h = m.health;
  if (!h) return [];
  const U = usable(m);
  const st = sessionState(m, h);
  const sparkW = Math.min(14, Math.max(0, U - KEY_W - 22));
  const rows: PanelLine[] = [
    head(m, 'SESSION', [{ ...st.mark, t: `${st.mark.t} `, tone: st.tone, bold: true }, r(st.text, st.tone, { bold: true })]), BLANK,
    contextRow(m, h, U), BLANK,
    hookRow(m, h, sparkW), toolsRow(m, h, sparkW), denialsRow(m, h, sparkW), BLANK,
  ];
  const runs = runsSection(m, h, room, rows.length);
  if (rows.length + runs.length <= budget) rows.push(...runs);
  return rows;
}
