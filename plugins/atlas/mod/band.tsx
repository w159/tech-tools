// band.tsx — the AbovePrompt band: one live, borderless row in three width tiers.
// Pure: `register.ts` hands it the snapshot, live workers, gate groups, columns and the spinner tick.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot } from './orchestra-types';
import { activeCount, type LiveWorker } from './data/live';
import { routeCounts } from './data/todos';
import { openGateCount } from './gates';
import type { GateGroup } from './pane/sidebar-types';
import { rowOf, type Segment } from './runs';
import { bar, chartRoom as C, contractGlyph, spin } from './theme';

export type BandModel = { snapshot: LiveSnapshot; live: LiveWorker[]; gates: GateGroup[]; columns: number; tick: number };

const FULL = 100;
const MID = 60;
const MAX_NAMED = 3;
const SEP: Segment = { t: ' · ', color: C.muted };

const age = (ms: number) => (ms < 60_000 ? `${Math.max(0, Math.floor(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m`);

function worker(w: LiveWorker, tick: number, now: number, ages: boolean): Segment {
  if (w.state === 'blocked') return { t: `⏸ ${w.name} awaits input`, color: C.warn };
  if (w.state === 'failed') return { t: `✗ ${w.name}`, color: C.fail };
  const tail = [w.tool, ages ? age(now - w.since) : null].filter(Boolean).join(' ');
  return { t: `${spin(tick)} ${w.name}${tail ? ` ${tail}` : ''}`, color: C.live };
}

export function bandTree(els: ClientElements, { snapshot: s, live, gates, columns, tick }: BandModel): RenderElement {
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const open = openGateCount(gates);
  const shown = live.filter((w) => w.state !== 'done');
  const count = `${done}/${total}`;
  const glyph = contractGlyph(s.contract.phases.find((p) => p.id === s.phase)?.glyph ?? '');
  const phase: Segment = { t: `${glyph} ${s.phase} ${count}`, color: C.focus, bold: true };
  const gate = (t: string): Segment => ({ t, color: C.fail });

  if (!shown.length) {
    const idle: Segment[] = [{ t: '⚑ idle', color: C.muted }, SEP, { t: `${s.phase} ${count}`, color: C.focus }, SEP,
      { t: `${open} open`, color: open ? C.fail : C.muted }];
    return rowOf(els, idle, columns);
  }
  if (columns < MID) {
    const parts: Segment[] = [phase, SEP, { t: `${activeCount(shown)} working`, color: C.live }];
    if (open) parts.push(SEP, gate(`✗${open}`));
    return rowOf(els, parts, columns);
  }
  const ages = columns >= FULL;
  const named = shown.slice(0, MAX_NAMED).map((w) => worker(w, tick, s.now, ages));
  const more = shown.length - MAX_NAMED;
  const parts: Segment[] = [phase, { t: ` ${bar((done / Math.max(1, total)) * 100, 5)}`, color: C.focus }];
  for (const w of named) parts.push(SEP, w);
  if (more > 0) parts.push({ t: ` +${more}`, color: C.muted });
  if (open) parts.push(SEP, gate(`✗${open} ${open === 1 ? 'gate' : 'gates'}`));
  if (ages) parts.push(SEP, { t: '▸ /atlas-cc', color: C.faint });
  return rowOf(els, parts, columns);
}
