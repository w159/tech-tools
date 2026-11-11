// runstate.ts: the one derivation of run state that the band, the checks row and the side panel share. Pure.
//   gates  = every gate group that holds data (lines or an error), the header contract included.
//   checks = those same groups, one entry each (a group is ok when no line fails and it has no error).
// So `3 of 4 green` on the gates tab and `checks ... 3 ok` on the band are the same figure.
import { groupOpenCount } from '../gates';
import type { GateGroup } from '../pane/sidebar-types';

export type GateCheck = { id: string; ok: boolean };
export type GateTally = { total: number; green: number; failing: string[]; checks: GateCheck[] };

const hasData = (g: GateGroup): boolean => g.lines.length > 0 || !!g.error;

/** The gates figure for every surface: the side panel's `green of total`, the band's checks row and its blocked reason. */
export function gateTally(groups: readonly GateGroup[]): GateTally {
  const checks = groups.filter(hasData).map((g): GateCheck => ({ id: g.id, ok: groupOpenCount(g) === 0 }));
  const failing = checks.filter((c) => !c.ok).map((c) => c.id);
  return { total: checks.length, green: checks.length - failing.length, failing, checks };
}

/** Why a band is blocked: the lead declared it (`needs you`) or checks fail. `short` is the form for a crowded row. */
export function blockReasons(declared: boolean, failing: readonly string[]): { long: string; short: string } {
  if (declared || failing.length === 0) return { long: 'needs you', short: 'needs you' };
  if (failing.length === 1) return { long: `${failing[0]} failing`, short: failing[0]! };
  return { long: `${failing.length} checks failing`, short: `${failing.length} failing` };
}

/** Workers that really ran: the host-listed ones plus every dispatch row's owner (the host forgets a finished worker). */
export function ranWorkers(listed: readonly string[], dispatchOwners: readonly string[]): string[] {
  return [...new Set([...listed, ...dispatchOwners])];
}
