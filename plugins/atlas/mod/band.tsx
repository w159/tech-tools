// band.tsx — the AbovePrompt band: one native line led by the lead's badge chip and the
// phase glyph, then `<phase> n of m`, working agents, open gates. Pure: `register.ts`
// hands it the snapshot, the gate count and the spinner tick.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot } from './orchestra-types';
import { routeCounts } from './data/todos';
import { fromSprite, rowOf, type Segment } from './runs';
import { badge } from './sprites/api';
import { chartRoom as C, spin } from './theme';

export type BandModel = { snapshot: LiveSnapshot; openGates: number; columns: number; tick?: number };

const WORKING = new Set(['running', 'spawning']);

export function bandTree(els: ClientElements, { snapshot: s, openGates, columns, tick = 0 }: BandModel): RenderElement {
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const working = s.squad.filter((a) => WORKING.has(a.state)).length;
  const glyph = s.contract.phases.find((p) => p.id === s.phase)?.glyph ?? '◉';
  const runs: Segment[] = [
    ...badge('lead', working ? 'working' : 'idle', tick).map(fromSprite),
    { t: ` ${glyph} `, color: C.focus, bold: true },
    { t: `${s.phase} ${done} of ${total}`, color: C.focus, bold: true },
    working ? { t: `   ${spin(tick)} ${working} working`, color: C.live } : { t: '   0 working', color: C.muted },
    openGates
      ? { t: `   ${openGates} ${openGates === 1 ? 'gate' : 'gates'} open`, color: C.fail }
      : { t: '   all clear', color: C.ok },
  ];
  return rowOf(els, runs, columns);
}
