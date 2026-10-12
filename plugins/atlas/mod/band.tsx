// band.tsx — the AbovePrompt band: a round-bordered section (3 rows) like the sidebar's, or one line when narrow;
// content is one native line led by the lead's badge chip and the
// phase glyph, then `<phase> n of m`, working agents, open gates. Pure: `register.ts`
// hands it the snapshot, the gate count and the spinner tick.
import type { ClientElements, RenderElement } from 'claude-code';
import type { LiveSnapshot } from './orchestra-types';
import { routeCounts } from './data/todos';
import { leadMood } from './pane/sidebar-team';
import { fromSprite, rowOf, type Segment } from './runs';
import { badge } from './sprites/api';
import { chartRoom as C, spin } from './theme';

export type BandModel = { snapshot: LiveSnapshot; openGates: number; columns: number; maxRows?: number; tick?: number };

// Same threshold as the sidebar; the border needs 3 rows of the host's maxRows (d.ts AbovePrompt.maxRows).
const BORDER_MIN_COLUMNS = 40;
const BORDERED_ROWS = 3;

const WORKING = new Set(['running', 'spawning']);

export function bandTree(els: ClientElements, { snapshot: s, openGates, columns, maxRows = BORDERED_ROWS, tick = 0 }: BandModel): RenderElement {
  const { done, total } = routeCounts(s.todoGroups, s.contract);
  const mood = leadMood(s);
  const working = s.squad.filter((a) => WORKING.has(a.state)).length;
  const glyph = s.contract.phases.find((p) => p.id === s.phase)?.glyph ?? '◉';
  const runs: Segment[] = [
    ...badge('lead', mood, mood === 'working' ? tick : 0, 'Lead agent').map(fromSprite),
    { t: ` ${glyph} `, color: C.focus, bold: true },
    { t: `${s.phase} ${done} of ${total}`, color: C.focus, bold: true },
    working ? { t: `   ${spin(tick)} ${working} working`, color: C.live } : { t: '   0 working', color: C.muted },
    openGates
      ? { t: `   ${openGates} ${openGates === 1 ? 'gate' : 'gates'} open`, color: C.fail }
      : { t: '   all clear', color: C.ok },
  ];
  if (columns < BORDER_MIN_COLUMNS || maxRows < BORDERED_ROWS) return rowOf(els, runs, columns);
  // Border takes one column each side.
  return els.Box({ flexDirection: 'column', flexShrink: 0, borderStyle: 'round', borderColor: C.border, width: columns,
    children: [rowOf(els, runs, columns - 2)] });
}
