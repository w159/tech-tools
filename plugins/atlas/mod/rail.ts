// rail.ts: the one phase rail. The Claude Code band, the HUD's rich rail, the side panel and the omp mission panel all list
// the same phase ids and light the same one, because they all ask this module. A rail is the operating contract's phases
// without the three that are not steps: `validate` (an optional pass, not every plan has it), `blocked` (a state) and
// `done` (the end: every step reads complete, the lit index is the rail's length).
import type { Contract } from './contract';

/** Phases that are not rail steps. */
export const RAIL_SKIP: ReadonlySet<string> = new Set(['validate', 'blocked', 'done']);

/** The contract's rail when a host has not read one (omp before it loads the file): contracts/operating-contract.json `phases` minus RAIL_SKIP (omp/rail.test.ts keeps the two equal). */
export const RAIL_DEFAULT: readonly string[] = ['research', 'theory', 'test', 'implement', 'verify'];

/** The rail ids of a list of contract phase ids, in contract order. An empty or absent list is the default rail. */
export const railIds = (phases?: readonly string[]): string[] => {
  const ids = (phases ?? []).filter((id) => !RAIL_SKIP.has(id));
  return ids.length ? ids : [...RAIL_DEFAULT];
};

/** The rail of a snapshot contract. */
export const contractRail = (c: Pick<Contract, 'phases'>): string[] => railIds(c.phases.map((p) => p.id as string));

export type Rail = {
  /** Rail step ids in order. */
  ids: string[];
  /** The lit step; `done` once the run is done. */
  phase: string;
  /** 0-based lit index; `ids.length` when the phase is `done` (every step complete). */
  index: number;
};

/** The lit step of `phase` on `ids`: the phase itself when it is a step, `done` for the finished run, else the last step the
 * caller saw (a `blocked` or `validate` reply never leaves the rail with nothing lit), else the first. */
export function railOf(ids: readonly string[], phase: string, last?: string | null): Rail {
  const steps = [...ids];
  if (phase === 'done') return { ids: steps, phase: 'done', index: steps.length };
  const lit = steps.includes(phase) ? phase : last && steps.includes(last) ? last : steps[0] ?? phase;
  return { ids: steps, phase: lit, index: Math.max(0, steps.indexOf(lit)) };
}

/** `2/4`: the 1-based lit step over the rail length (the last step once the run is done). */
export const railNo = (r: Rail): string => `${Math.min(r.index + 1, r.ids.length)}/${r.ids.length}`;
