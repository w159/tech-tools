// runstate.ts: the one derivation of run state that the band, the checks row and the side panel share. Pure.
//   gates  = every gate group that holds data (lines or an error), the header contract included.
//   checks = those same groups, one entry each (a group is ok when no line fails and it has no error).
// So `3 of 4 green` on the gates tab and `checks ... 3 ok` on the band are the same figure.
import { groupOpenCount } from '../gates';
import { textWidth } from '../theme';
import type { GateGroup } from '../pane/sidebar-types';

/** `name`: only on a failing check, what the blocked reason calls it (the failing line's own words). */
export type GateCheck = { id: string; ok: boolean; name?: string };
export type GateTally = { total: number; green: number; failing: string[]; names: string[]; checks: GateCheck[] };

const hasData = (g: GateGroup): boolean => g.lines.length > 0 || !!g.error;

const NAME_MAX = 16;
/** What a failing group is called in a reason: its first failing line lowercased (`team gate`) when that is short, else the group id. */
function reasonName(g: GateGroup): string {
  const label = g.error ? '' : (g.lines.find((l) => !l.ok)?.label ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return label !== '' && textWidth(label) <= NAME_MAX ? label : g.id;
}

/** The gates figure for every surface: the side panel's `green of total`, the band's checks row and its blocked reason. `failing` holds group ids, `names` the reason words. */
export function gateTally(groups: readonly GateGroup[]): GateTally {
  const data = groups.filter(hasData);
  const checks = data.map((g): GateCheck => (groupOpenCount(g) === 0 ? { id: g.id, ok: true } : { id: g.id, ok: false, name: reasonName(g) }));
  const failing = checks.filter((c) => !c.ok).map((c) => c.id);
  return { total: checks.length, green: checks.length - failing.length, failing, names: checks.filter((c) => !c.ok).map((c) => c.name!), checks };
}

/** Why a band is blocked: the lead declared it (`needs you`) or checks fail. `short` is the form for a crowded row. */
export function blockReasons(declared: boolean, failing: readonly string[]): { long: string; short: string } {
  if (declared || failing.length === 0) return { long: 'needs you', short: 'needs you' };
  // One string at every width (a crowded row drops the reason whole, never rewords it): `team gate failing`, `2 gates failing`.
  const one = failing.length === 1 ? `${failing[0]} failing` : `${failing.length} gates failing`;
  return { long: one, short: one };
}

/** Workers that really ran: the host-listed ones plus every dispatch row's owner (the host forgets a finished worker). */
export function ranWorkers(listed: readonly string[], dispatchOwners: readonly string[]): string[] {
  return [...new Set([...listed, ...dispatchOwners])];
}
