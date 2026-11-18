// readinfo.ts: how the gate and routing figures were last read (M6). The readers (register.ts runGates and buildCore) note each read here, the panel model asks for the ReadInfo the frames draw:
// `failed` makes a row say err / read failed, `ageSecs` against `refreshSecs` makes a figure say `~age`. Before this nothing in production set `read`, so err and stale could never show.
//   gates   atlas_gates.py run: failed when any group carries an error (missing script, nonzero exit, bad JSON). Refresh = the 30 s backstop run (register.ts GATES_MS).
//   routes  the team records and scope-matrix.json under .atlas/.run: failed when one is unreadable or not JSON. Refresh = the 5 s core tick (MUX_MS); a route carries no read time, so only `failed` is drawn for it.
//   hooks   the hook log is in memory (host/hook-log.ts): it cannot fail to read and has no refresh interval, so hooks are never marked failed or stale.
import type { ReadInfo } from './datastate';

export const GATES_REFRESH_SECS = 30;
export const ROUTES_REFRESH_SECS = 5;

export type ReadStamp = { at: number; failed: boolean };

/** The result of one gates read: failed when any group says it could not be read. */
export const gatesReadOf = (groups: readonly { error?: string }[], at: number): ReadStamp => ({ at, failed: groups.some((g) => !!g.error) });

const parses = (text: string): boolean => {
  try { JSON.parse(text); return true; } catch { return false; }
};

/** The result of one routes read. `null` is a file that was missing or unreadable (the caller stat'ed or read it and failed); an empty file is a write in progress, not a failure. */
export function routesReadOf(i: { matrix: string | null; teams: readonly { text: string | null }[] }, at: number): ReadStamp {
  const bad = i.matrix === null || (i.matrix.trim() !== '' && !parses(i.matrix)) || i.teams.some((t) => t.text === null || (t.text.trim() !== '' && !parses(t.text)));
  return { at, failed: bad };
}

let gates: ReadStamp | undefined;
let routes: ReadStamp | undefined;

export function resetReads(): void { gates = undefined; routes = undefined; }
export function noteGatesRead(groups: readonly { error?: string }[], at: number): void { gates = gatesReadOf(groups, at); }
export function noteRoutesRead(i: { matrix: string | null; teams: readonly { text: string | null }[] }, at: number): void { routes = routesReadOf(i, at); }

/** The ReadInfo at engine clock `now` (ms); undefined while nothing was read yet, so nothing is marked. Without `now` the age is left out (no figure is made up). */
export function readInfoOf(now?: number): ReadInfo | undefined {
  if (!gates && !routes) return undefined;
  const failed = { ...(gates?.failed ? { gates: true } : {}), ...(routes?.failed ? { routes: true } : {}) };
  return {
    ...(gates && now !== undefined ? { ageSecs: Math.max(0, Math.floor((now - gates.at) / 1000)), refreshSecs: GATES_REFRESH_SECS } : {}),
    ...(Object.keys(failed).length ? { failed } : {}),
  };
}
