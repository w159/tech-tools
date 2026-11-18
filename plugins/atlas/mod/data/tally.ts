// tally.ts: the ONE worker and phase tally. The band (mission-layout), the side panel (panel-layout) and the HUD (hud-surface) each
// counted workers on their own and disagreed: the band folded `thinking` into running, the panel did not; the panel listed states
// in a different order than the HUD. Every surface now calls these.
import type { UiState } from '../atlas-ui';
import { tallyOf, type Tally } from './live';

/** A worker state as a surface may hold it: `thinking` is a running worker. */
export type TallyState = UiState | 'thinking';

export const tallyStateOf = (s: TallyState): UiState => (s === 'thinking' ? 'running' : s);

/** Workers per state. The only counting function: surfaces differ in how they word and order the counts, never in the counts. */
export const workerTally = (workers: readonly { state: TallyState }[]): Tally => tallyOf(workers.map((w) => tallyStateOf(w.state)));

/** The non-zero counts in `order`, as [state, count] pairs. `keep`: a state shown even at zero (the panel's `0 running`). */
export function tallyParts(t: Readonly<Tally>, order: readonly UiState[], keep?: UiState): [UiState, number][] {
  return order.filter((s) => t[s] > 0 || s === keep).map((s): [UiState, number] => [s, t[s]]);
}

/** `2/5`: the place of the lit phase on the rail. A phase not on the rail, or none, reads as the first; a finished run (`index` past the end) as the last. */
export function phaseFigure(phaseCount: number, index: number): string {
  return `${Math.min(Math.max(0, index) + 1, phaseCount)}/${phaseCount}`;
}
