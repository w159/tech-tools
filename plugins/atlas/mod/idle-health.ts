// idle-health.ts: the health summary shown while Atlas has no run yet (wave 42). One pure model (`Health`) every surface reads: the band's segments, the HUD's expanded card, the side panel's rows.
// It holds only what the mod really has; a figure it does not have is left out, never made up.
import { elapsedClock, stateRun, type Run, type Ui } from './atlas-ui';
import { clickRun } from './clickable';

export type HealthLast = { secs?: number; done: number; total: number; agents: number; failed: number; /** Local wall time the run ended, `9:27 PM`. */ endedAt?: string };
export type Health = {
  gates: { total: number; green: number; checks: readonly { id: string; ok: boolean; pending?: boolean }[] };
  /** Context used, 0..100; absent when unknown. */
  ctxPct?: number;
  tokens?: number;
  upSecs?: number;
  branch?: string;
  version?: string;
  last?: HealthLast;
  /** The card is open (the band's button reads `▾ health`). */
  open?: boolean;
  /** Handlers are wired: the band draws the clickable button. */
  button?: boolean;
};

/** The raw inputs register.ts hands the band; band.tsx completes them from the snapshot, the gates and the run clocks. */
export type HealthIn = { upSecs?: number; version?: string; branch?: string; tokens?: number | null; open?: boolean };

const r = (t: string, tone: Run['tone'] = 'text', o: Partial<Run> = {}): Run => ({ t, tone, ...o });
const glue = (): Run => r(' · ', 'sub');

/** `42k`, `1.2M`, `850`. */
export const tokenText = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);
const grouped = (n: number): string => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const gatesFailed = (h: Pick<Health, 'gates'>): boolean => h.gates.checks.some((c) => !c.ok);
/** The one glyph of the gates figure: `■` when any failed, `◇` when only Stop decides, else `●`. */
export const gatesMark = (h: Pick<Health, 'gates'>, ui: Ui): Run => stateRun(gatesFailed(h) ? 'failed' : h.gates.checks.some((c) => c.pending) ? 'queued' : 'done', ui);

/** The band's segments, in priority order: each is a list of runs (the painter lays each on its own fill). The button is last and never dropped while any form shows. */
export type BandSegments = { gates: Run[]; ctxFull: Run[]; ctxShort: Run[]; up: Run[]; last: Run[]; button: Run[] };
export function bandSegments(h: Health, ui: Ui, lastRun: { secs?: number; done: number; total: number } | undefined): BandSegments {
  const gates = h.gates.total > 0 ? [gatesMark(h, ui), r(` gates ${h.gates.green}/${h.gates.total}`)] : [];
  const ctx = h.ctxPct !== undefined ? `ctx ${Math.round(h.ctxPct)}%` : '';
  const ctxFull = ctx ? [r(h.tokens !== undefined ? `${ctx} · ${tokenText(h.tokens)} tok` : ctx)] : [];
  const ctxShort = ctx ? [r(ctx)] : [];
  const up = h.upSecs !== undefined ? [r(`up ${elapsedClock(h.upSecs)}`, 'sub')] : [];
  const last = lastRun && lastRun.secs !== undefined ? [r(`last run ${elapsedClock(lastRun.secs)}${lastRun.total > 0 ? ` · ${lastRun.done}/${lastRun.total} done` : ''}`, 'sub')] : [];
  const button = h.button ? [clickRun('health', !!h.open, ui, 'band:health')] : [];
  return { gates, ctxFull, ctxShort, up, last, button };
}

/** The same figures as rows of `label value` text, for the HUD card and the panel rows. `label` is padded by the caller. */
export type HealthRow = { id: 'hooks' | 'gates' | 'session' | 'last'; label: string; runs: Run[] };
export function healthRows(h: Health, ui: Ui): HealthRow[] {
  const rows: HealthRow[] = [];
  rows.push({ id: 'hooks', label: 'hooks', runs: [stateRun('done', ui), r(' loaded'), ...(h.version ? [glue(), r(`atlas ${h.version}`, 'sub')] : [])] });
  if (h.gates.total > 0) {
    const names = h.gates.checks.flatMap((c, i): Run[] => [...(i ? [r(' ')] : []), stateRun(c.ok ? (c.pending ? 'queued' : 'done') : 'failed', ui), r(` ${c.id}`)]);
    rows.push({ id: 'gates', label: 'gates', runs: [...names, r(`  ${h.gates.green}/${h.gates.total}`, 'sub')] });
  }
  const bits = [
    ...(h.upSecs !== undefined ? [`up ${elapsedClock(h.upSecs)}`] : []),
    ...(h.ctxPct !== undefined ? [`ctx ${Math.round(h.ctxPct)}%`] : []),
    ...(h.tokens !== undefined ? [`${tokenText(h.tokens)} tokens`] : []),
    ...(h.branch ? [`branch ${h.branch}`] : []),
  ];
  if (bits.length) rows.push({ id: 'session', label: 'session', runs: bits.flatMap((b, i) => [...(i ? [glue()] : []), r(b, i ? 'text' : 'text')]) });
  const l = h.last;
  const lastBits = l
    ? [...(l.secs !== undefined ? [elapsedClock(l.secs)] : []), ...(l.total > 0 ? [`${l.done}/${l.total} todos`] : []), `${l.agents} agent${l.agents === 1 ? '' : 's'}`, `${l.failed} failed`, ...(l.endedAt ? [`ended ${l.endedAt}`] : [])]
    : [];
  rows.push({ id: 'last', label: 'last run', runs: l ? lastBits.flatMap((b, i) => [...(i ? [glue()] : []), r(b)]) : [r('none this session', 'muted')] });
  return rows;
}

/** One summary line for the empty TODO and SUBAGENTS boxes: `● gates 4/4 · ctx 18%`; empty when the mod has neither figure. */
export function healthLine(h: Health, ui: Ui): string {
  const bits = [...(h.gates.total > 0 ? [`${gatesMark(h, ui).t} gates ${h.gates.green}/${h.gates.total}`] : []), ...(h.ctxPct !== undefined ? [`ctx ${Math.round(h.ctxPct)}%`] : [])];
  return bits.join(' · ');
}

/** The detail lines under an open panel row (1 to 3, from data the mod holds). */
export function healthDetail(h: Health, id: HealthRow['id']): string[] {
  if (id === 'gates') {
    const words = h.gates.checks.map((c) => `${c.id} ${c.ok ? (c.pending ? 'pending' : 'green') : 'failed'}`);
    return Array.from({ length: Math.min(3, Math.ceil(words.length / 2)) }, (_, k) => words.slice(k * 2, k * 2 + 2).join('   '));
  }
  if (id === 'session') return [...(h.tokens !== undefined ? [`${grouped(h.tokens)} tokens`] : []), ...(h.ctxPct !== undefined ? [`${Math.round(h.ctxPct)}% of context`] : []), ...(h.branch ? [`branch ${h.branch}`] : [])].slice(0, 3);
  if (id === 'hooks') return [h.version ? `atlas ${h.version}` : 'atlas', 'hooks module loaded, mod drawing'].slice(0, 2);
  const l = h.last;
  return l ? [`${l.agents} agent${l.agents === 1 ? '' : 's'}, ${l.failed} failed`, ...(l.endedAt ? [`ended ${l.endedAt}`] : [])] : ['no run has ended in this session'];
}
