// band.tsx — the AbovePrompt band: one live, borderless row in three width tiers.
// Pure: `register.ts` hands it the snapshot, live workers, gate groups, columns and the spinner tick.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot } from './orchestra-types';
import { activeCount, type LiveWorker } from './data/live';
import { routeCounts } from './data/todos';
import { openGateCount } from './gates';
import type { GateGroup } from './pane/sidebar-types';
import { rowOf, type Segment } from './runs';
import { barParts, chartRoom as C, contractGlyph, fitText, meterColor, spin } from './theme';

export type BandModel = { snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number };

const FULL = 100;
const MID = 60;
const MAX_NAMED = 3;
const BRAND_PILL: Segment = { t: ' ATLAS ', color: C.focus, inverse: true, bold: true };
const SEP: Segment = { t: ' · ', color: C.muted };

const age = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m`);

function worker(w: LiveWorker, m: { tick: number; now: number; full: boolean; phase: string; room: number }): Segment {
  if (w.state === 'blocked') return { t: `⏸ ${w.name} awaits input`, color: C.warn };
  if (w.state === 'failed') return { t: `✗ ${w.name}`, color: C.fail };
  const target = m.full && w.tool && w.target ? fitText(w.target, m.room) : null;
  const tail = [m.full ? w.tool : null, target, age(m.now - w.startedAt)].filter(Boolean).join(' ');
  return { t: `${spin(m.tick, m.phase)} ${w.name} ${tail}`, color: C.live };
}

/** The nothing-live row. 'done' lingers as the phase after a final reply: not worth printing while idle. */
function idleParts(phase: string, count: string, open: number): Segment[] {
  return [{ t: open ? '⚑ blocked' : '⚑ idle', color: open ? C.fail : C.muted }, SEP,
    ...(phase === 'done' ? [] : [{ t: `${phase} ${count}`, color: C.focus }, SEP]),
    { t: `${open} open`, color: open ? C.fail : C.muted }];
}

export function bandTree(els: ClientElements, { snapshot: s, live, gates, columns, tick }: BandModel): RenderElement {
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const open = openGateCount(gates);
  const shown = live.filter((w) => w.state !== 'done' && w.state !== 'parked'); // parked workers are resting, not live work
  const count = `${done}/${total}`;
  const glyph = contractGlyph(s.contract.phases.find((p) => p.id === s.phase)?.glyph ?? '');
  const phase: Segment = { t: `${glyph} ${s.phase} ${count}`, color: C.focus, bold: true };
  const gate = (t: string): Segment => ({ t, color: C.fail });

  const brand: Segment[] = columns >= MID ? [BRAND_PILL] : [];
  if (!shown.length) return rowOf(els, [...brand, ...idleParts(s.phase, count, open)], columns);
  if (columns < MID) {
    const parts: Segment[] = [phase, SEP, { t: `${activeCount(shown)} working`, color: C.live }];
    if (open) parts.push(SEP, gate(`✗${open}`));
    return rowOf(els, parts, columns);
  }
  const full = columns >= FULL;
  const wm = { tick, now: s.now, full, phase: s.phase, room: 16 };
  const named = shown.slice(0, MAX_NAMED).map((w) => worker(w, wm));
  const more = shown.length - MAX_NAMED;
  const pct = (done / Math.max(1, total)) * 100;
  const [fill, rest] = barParts(pct, 5);
  const parts: Segment[] = [...brand, phase, { t: ` ${fill}`, color: total ? meterColor(pct) : C.focus }, { t: rest, color: C.muted }];
  for (const w of named) parts.push(SEP, w);
  if (more > 0) parts.push({ t: ` +${more}`, color: C.muted });
  if (open) parts.push(SEP, gate(`✗${open} ${open === 1 ? 'gate' : 'gates'}`));
  if (full) parts.push(SEP, { t: '▸ /atlas-cc', color: C.faint });
  return rowOf(els, parts, columns);
}
