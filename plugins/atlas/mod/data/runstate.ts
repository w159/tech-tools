// runstate.ts: the one derivation of run state that the band, the checks row and the side panel share. Pure.
//   gates  = every gate group that holds data (lines or an error), the header contract included.
//   checks = those same groups, one entry each (a group is ok when no line fails and it has no error).
// So `3/4 green` on the gates tab and `checks ... 3 ok` on the band are the same figure.
import { groupOpenCount } from '../gates';
import { textWidth } from '../theme';
import type { GateGroup } from '../pane/sidebar-types';
import { clip, type UiState } from '../atlas-ui';
import { todoState } from './todos';
import { plannedText, type Route } from './core';

/** The lead is mid-turn: a plan row reads `running` (the HUD's TODO rule, todoState). One that only its returned owner keeps open does not count. First hit wins, no allocation. */
export const planBusy = (items: readonly { status: string; owner?: string | null }[], owners: ReadonlyMap<string, UiState>): boolean =>
  items.some((it) => todoState(it.status, it.owner ? owners.get(it.owner) : undefined).state === 'running');

/** The lead is mid-turn on its OWN work: a tool in flight (`working`) or a model step between tools (`thinking`), as the host's tool.call / turn.step hooks record it
 * (data/orchestration activity.lead). The live host lists no worker and no plan row for a lead that only runs a shell command, so planBusy alone read `idle` then
 * (critique 11, f0025). A finished (`done`), aborted (`idle`) or failed turn is not busy. */
export const leadBusy = (s: { activity?: Readonly<Record<string, { mood?: string } | undefined>> }): boolean => {
  const mood = s.activity?.lead?.mood;
  return mood === 'working' || mood === 'thinking';
};

/** `name`: only on a failing check, what the blocked reason calls it (the failing line's own words). */
/** `pending`: the group's only failing lines are conditions Stop alone decides (`Todos drained`, `Team gate`); it counts as not failing and reads `◇ pending` until Stop decides (critique 16 A4). */
export type GateCheck = { id: string; ok: boolean; name?: string; pending?: true };
/** `stop`: the completion gate's last Stop verdict for this session (the `stop-verdict` line atlas_gates.py reads from completion_gate_core's record): `gates` are the
 * refusing gates' names, lowercased. null when no Stop has been recorded. Only a blocked Stop makes the band BLOCKED. */
export type StopVerdict = { blocked: boolean; gates: string[] };
export type GateTally = { total: number; green: number; failing: string[]; names: string[]; checks: GateCheck[]; stop: StopVerdict | null };

/** The id of the informational line that carries the Stop verdict: a record, never a check or a gate. */
export const STOP_LINE = 'stop-verdict';

/** The header contract is a check from the first frame, before any reply has been matched: it is pending then (never a failure), so a `3/3` never becomes `x/4` (critique 14). */
const hasData = (g: GateGroup): boolean => g.lines.some((l) => l.id !== STOP_LINE) || !!g.error || g.id === 'header';

const NAME_MAX = 16;
/** The completion gate's lines that only Stop can decide: `i` (Todos drained: a plan has open rows all run long) and `s` (Team gate: red once the second in-process dispatch lands, green
 * again the moment its one advisory is used). Read mid-run they flip a clean run's figure 4/4, 3/4, 2/4, 3/4 (critique 16 A4, live-150-e4a8186a-1 f0034 to f0094), so until a Stop has
 * refused they read PENDING: `ok` with `pending` set, drawn `◇`, never counted as a failure and never as a green mark. A refused Stop makes them real again. */
export const STOP_ONLY_LINES: ReadonlySet<string> = new Set(['i', 's']);
export const isPendingLine = (l: unknown): boolean => !!(l as { pending?: boolean }).pending;
export function withPending<G extends { id: string; lines: readonly unknown[] }>(groups: readonly G[]): readonly G[] {
  if (stopOf(groups as unknown as readonly GateGroup[])?.blocked) return groups;
  return groups.map((g) => {
    if (g.id !== 'completion') return g;
    const lines = g.lines as readonly { id: string; ok: boolean }[];
    return lines.some((l) => !l.ok && STOP_ONLY_LINES.has(l.id)) ? { ...g, lines: lines.map((l) => (!l.ok && STOP_ONLY_LINES.has(l.id) ? { ...l, ok: true, pending: true } : l)) } : g;
  });
}

/** The header contract as ONE evaluation: the core row's `n of m` replies that opened with the ATLAS header (the transcript's tally) also decides the gates tab's
 * `Header contract` line, so `header 6 of 8` amber beside `Header contract passing` can not happen. A header group without a tally, or a tally with no replies yet, keeps its own line. */
export function withHeaderTally<G extends { id: string; lines: readonly unknown[] }>(groups: readonly G[], header: { ok: number; total: number } | null | undefined): readonly G[] {
  if (!header || header.total <= 0) return groups;
  const line = { id: 'header-matched', label: 'Replies with header matched', ok: header.ok >= header.total, detail: `${header.ok} of ${header.total}` };
  return groups.map((g) => (g.id === 'header' ? { ...g, lines: [line] } : g));
}

/** The id of the line the core's dispatch plan adds to the routing group. */
export const DISPATCH_LINE = 'dispatch-plan';

/** The core model's two verdicts as ONE evaluation for every gates figure (the band's checks row, the side panel's tab, the route tab, omp): the header contract (withHeaderTally)
 * and the dispatch plan. A route that ran differently from its plan (the core row's red `off plan`) fails the routing group with a line that says how, so `■ 3x explorer off plan`
 * beside `Tool routing passing` and `● routing` can not happen (critique 12 B2). A core without a drifted route changes nothing. */
export function withCoreTally<G extends { id: string; lines: readonly unknown[] }>(groups: readonly G[], core: { contract: { header: { ok: number; total: number } }; routes: readonly Pick<Route, 'cls' | 'effort' | 'seats' | 'drift'>[] } | null | undefined): readonly G[] {
  const withHeader = withPending(withHeaderTally(groups, core?.contract.header));
  const drifted = [...(core?.routes ?? [])].reverse().find((rt) => rt.drift.length > 0); // the newest drifted route, the one the core row names
  if (!drifted) return withHeader;
  const line = { id: DISPATCH_LINE, label: 'Dispatches followed the plan', ok: false, detail: plannedText(drifted) };
  return withHeader.map((g) => (g.id === 'routing' ? { ...g, lines: [...g.lines, line] } : g));
}

/** What a failing group is called in a reason: its first failing line lowercased (`team gate`) when that is short, else the group id. */
function reasonName(g: GateGroup): string {
  const label = g.error ? '' : (g.lines.find((l) => !l.ok)?.label ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return label !== '' && textWidth(label) <= NAME_MAX ? label : g.id;
}

/** The gates figure for every surface: the side panel's `green of total`, the band's checks row and its blocked reason. `failing` holds group ids, `names` the reason words. */
export function gateTally(raw: readonly GateGroup[]): GateTally {
  const groups = withPending(raw); // idempotent: withCoreTally has already applied it to the groups every surface draws
  const data = groups.filter(hasData);
  const checks = data.map((g): GateCheck => (groupOpenCount(g) === 0 ? { id: g.id, ok: true, ...(g.lines.some(isPendingLine) ? { pending: true as const } : {}) } : { id: g.id, ok: false, name: reasonName(g) }));
  const failing = checks.filter((c) => !c.ok).map((c) => c.id);
  return { total: checks.length, green: checks.length - failing.length, failing, names: checks.filter((c) => !c.ok).map((c) => c.name!), checks, stop: stopOf(groups) };
}

/** One refusing gate's word, lowercased; a bare gate letter (`r`) or the stand-in `gate` never reaches the band: it reads `stop refused`. */
const plainStop = (x: string): string => {
  const w = x.trim().toLowerCase();
  return w === '' ? '' : /^[a-z]$/.test(w) || w === 'gate' ? 'stop refused' : w;
};

/** The Stop verdict line in any group; `Last Stop blocked` + `Team gate, Todos drained` reads as blocked by `team gate`, `todos drained`. */
function stopOf(groups: readonly GateGroup[]): StopVerdict | null {
  for (const g of groups) {
    const l = g.lines.find((x) => x.id === STOP_LINE);
    if (l) return l.label.endsWith('blocked') ? { blocked: true, gates: (l.detail ?? '').split(',').map((x) => plainStop(x)).filter(Boolean) } : { blocked: false, gates: [] };
  }
  return null;
}

/** The open dispatch row's title, in cells, inside `dispatch <title> open`. */
const DISPATCH_TITLE_MAX = 22;
const clipCells = (t: string, n: number): string => clip(t.replace(/\s+/g, ' ').trim(), n);

/** Longest joined reason the band spells out; past it the count stands in (`3 reasons`). */
const REASON_MAX = 28;

/** Why a band is blocked, after `blocked:` and in plain words: the lead declared it (`needs you`), or the Stop gate refused the stop and said why
 * (`1 todo open`, `team gate`, `team gate, todos drained`). One string at every width: a crowded row drops the reason whole, never rewords it. */
export function blockReasons(declared: boolean, stopGates: readonly string[], dispatchTitle?: string): { long: string; short: string } {
  // The open row Stop refused on is a dispatch row the plan does not list: name it by its plan row's title (`dispatch T2 read ghost.py open`) instead of a count the band's todo figure would have to invent.
  const named = dispatchTitle ? `dispatch ${clipCells(dispatchTitle, DISPATCH_TITLE_MAX)} open` : '';
  // Critique 17 A4: a declared block keeps naming the open row Stop refused on, so the reason does not flip to `needs you` when the lead's own header arrives (stoprun-150-3, f0097 to the board tab).
  if (declared && !(named && stopGates.some((g) => /\bopen\b|todos? drained/.test(g)))) return { long: 'needs you', short: 'needs you' };
  if (stopGates.length === 0) return { long: 'needs you', short: 'needs you' };
  const gates = named ? stopGates.reduce<string[]>((acc, g) => (/\bopen\b|todos? drained/.test(g) ? (acc.includes(named) ? acc : [...acc, named]) : [...acc, g]), []) : stopGates;
  const joined = gates.join(', ');
  const one = textWidth(joined) <= REASON_MAX || (named && gates.length === 1) ? joined : `${gates.length} reasons`;
  return { long: one, short: one };
}

/** A failing check while the Stop gate did not refuse is a warning, never BLOCKED: `tripwire warning`, `2 gates warning`. */
export const warningText = (failing: readonly string[]): string => `${failing.length === 1 ? failing[0] : `${failing.length} gates`} warning`;

/** Workers that really ran: the host-listed ones plus every dispatch row's owner (the host forgets a finished worker). */
export function ranWorkers(listed: readonly string[], dispatchOwners: readonly string[]): string[] {
  return [...new Set([...listed, ...dispatchOwners])];
}
