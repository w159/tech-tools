// gates.ts — pure shaping of the sidebar's Gates data: the atlas_gates.py JSON, the
// last-reply header check, and the open-gate count shared by the sidebar and the band.
import type { GateGroup } from './pane/sidebar';

/** Result of testing the last answer's first line against the contract header pattern. */
export type HeaderCheck = { matched: boolean; phase: string | null } | null;

const GROUP_IDS: readonly string[] = ['completion', 'tripwire', 'routing'];

const optionalString = (key: string, value: unknown): Record<string, string> =>
  typeof value === 'string' ? { [key]: value } : {};

const isLine = (l: any): boolean => typeof l?.id === 'string' && typeof l.label === 'string' && typeof l.ok === 'boolean';

const isGroup = (g: any): boolean => GROUP_IDS.includes(g?.id) && typeof g.title === 'string' && Array.isArray(g.lines);

function parseLine(l: any): GateGroup['lines'][number] {
  if (!isLine(l)) throw new Error('bad line');
  return { id: l.id, label: l.label, ok: l.ok, ...optionalString('detail', l.detail), ...optionalString('fix', l.fix) };
}

function parseGroup(g: any): GateGroup {
  if (!isGroup(g)) throw new Error('bad group');
  return { id: g.id, title: g.title, lines: g.lines.map(parseLine), ...optionalString('error', g.error) };
}

/** Groups from `atlas_gates.py --json` stdout; throws on anything that is not the documented shape. */
export function parseGates(stdout: string): GateGroup[] {
  const doc = JSON.parse(stdout) as { groups?: unknown };
  if (!Array.isArray(doc.groups)) throw new Error('no groups array');
  return doc.groups.map(parseGroup);
}

/** A missing script, nonzero exit or bad JSON shows as one group with an error and no lines. */
export const gatesError = (reason: string): GateGroup => ({ id: 'completion', title: 'Gates', lines: [], error: reason });

/** The `header` group: whether the last reply opened with the contract header, and its declared phase. */
export function headerGroup(check: HeaderCheck): GateGroup {
  if (check === null) return { id: 'header', title: 'Header contract', lines: [] };
  return {
    id: 'header',
    title: 'Header contract',
    lines: [{
      id: 'header-matched',
      label: 'Last reply header matched',
      ok: check.matched,
      detail: check.matched ? `declared phase: ${check.phase ?? 'unknown'}` : 'first line did not match the ATLAS header pattern',
    }],
  };
}

/** Open items in one group: its failing lines, plus one when its source could not be read. */
export const groupOpenCount = (g: GateGroup): number => g.lines.filter((l) => !l.ok).length + (g.error ? 1 : 0);

/** The one open-gate figure the band and the sidebar header both show. */
export const openGateCount = (groups: readonly GateGroup[]): number =>
  groups.reduce((n, g) => n + groupOpenCount(g), 0);
