// The register.ts split (plan section 7.3): the seven host modules import each other only in one direction, and the entry file holds no state.
import { expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';

const MODS = ['atoms', 'agents', 'poll', 'core-tick', 'handlers', 'frame', 'bored', 'hooks'] as const;
const read = (name: string): string => readFileSync(`${import.meta.dir}/${name}.ts`, 'utf8');

/** The sibling modules a host module imports at runtime (`import type` and all-`type` lists are erased). */
const siblings = (name: string): string[] => {
  const out: string[] = [];
  for (const m of read(name).matchAll(/^(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+'\.\/([\w-]+)'/gm)) {
    const names = m[1]!.replace(/[{}*]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => !n.startsWith('type ')) && (MODS as readonly string[]).includes(m[2]!)) out.push(m[2]!);
  }
  return out;
};

test('the host modules form no import cycle (file level)', () => {
  const graph = Object.fromEntries(MODS.map((m) => [m, siblings(m)]));
  expect(Object.values(graph).flat().length).toBeGreaterThan(8); // the walk saw real edges, not an empty graph
  const state = new Map<string, 1 | 2>();
  const cycle: string[] = [];
  const visit = (m: string, trail: string[]): void => {
    if (state.get(m) === 2 || cycle.length) return;
    if (state.get(m) === 1) return void cycle.push(...trail, m);
    state.set(m, 1);
    for (const n of graph[m]!) visit(n, [...trail, m]);
    state.set(m, 2);
  };
  for (const m of MODS) visit(m, []);
  expect(cycle).toEqual([]);
});

test('atoms imports no sibling and nothing imports hooks', () => {
  expect(siblings('atoms')).toEqual([]);
  for (const m of MODS) expect(siblings(m)).not.toContain('hooks');
});

test('every host module stays under 600 lines', () => {
  for (const m of MODS) expect(read(m).split('\n').length).toBeLessThanOrEqual(600);
});

test('register.ts is a thin entry: no let, no atom, no state', () => {
  const entry = readFileSync(`${import.meta.dir}/../register.ts`, 'utf8');
  expect(entry.split('\n').length).toBeLessThan(120);
  expect(entry).not.toMatch(/^\s*let\s/m);
  expect(entry).not.toMatch(/\batom\(/);
});
