// The panel-layout.ts split (plan S14, audit 4.3): the seven panel modules import each other only downward, and the facade holds no code.
import { expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';

/** In layer order: a module may import only modules before it. */
const MODS = ['panel-shared', 'panel-tabs', 'panel-cards', 'panel-rows-route', 'panel-rows-team', 'panel-rows-gates', 'panel-body'] as const;
const read = (name: string): string => readFileSync(`${import.meta.dir}/${name}.ts`, 'utf8');

/** The sibling panel modules a module imports at runtime (`import type` and all-`type` lists are erased). */
const siblings = (name: string): string[] => {
  const out: string[] = [];
  for (const m of read(name).matchAll(/^(?:import|export)\s+(?!type\b)([^;]*?)\s+from\s+'\.\/([\w-]+)'/gm)) {
    const names = m[1]!.replace(/[{}*]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => !n.startsWith('type ')) && (MODS as readonly string[]).includes(m[2]!)) out.push(m[2]!);
  }
  return out;
};

test('the panel modules form no import cycle (file level)', () => {
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

test('imports only point down the layer order, and panel-shared imports no sibling', () => {
  expect(siblings('panel-shared')).toEqual([]);
  MODS.forEach((m, i) => { for (const n of siblings(m)) expect([m, MODS.indexOf(n as (typeof MODS)[number]) < i]).toEqual([m, true]); });
  for (const m of MODS) expect(read(m)).not.toMatch(/from '\.\/panel-layout'/); // the facade is for outside importers only
});

test('every panel module stays under 700 lines', () => {
  for (const m of MODS) expect(read(m).split('\n').length).toBeLessThanOrEqual(700);
});

test('panel-layout.ts is a thin facade: re-exports only, no declarations', () => {
  const facade = read('panel-layout');
  expect(facade.split('\n').length).toBeLessThan(150);
  expect(facade).not.toMatch(/^(?:export\s+)?(?:const|let|function|class)\s/m);
  expect(facade).not.toMatch(/^\s*let\s/m);
});
