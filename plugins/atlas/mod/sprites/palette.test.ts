// Contract tests for the persona creature palette: structural invariants plus a pinned golden of the shipped data.
import { expect, test } from 'claude-code/testing';
import { ALIASES, CREATURES, PROP_LEGEND, PROPS } from './palette';

const HEX = /^#[0-9a-f]{6}$/;

// Pinned golden, one row per creature: species, color, accent, ears, hat, prop, wide, shell, catchphrase.
const GOLDEN_CREATURES: Record<string, unknown[]> = {
  lead: ['Maestro Lion', '#e8b04a', '#ff6b6b', 'round', 'crown', 'baton', false, false, 'Everyone, from the top.'],
  explorer: ['Lantern Fox', '#56d4dd', '#ffd84a', 'cat', 'none', 'lantern', false, false, 'Mapping the terrain.'],
  implementer: ['Hammer Bear', '#52c872', '#f2994a', 'round', 'hardhat', 'hammer', true, false, 'Measure twice, patch once.'],
  verifier: ['Squint Owl', '#ff7570', '#ffd84a', 'horn', 'none', 'magnifier', true, false, 'Trust, but verify.'],
  runner: ['Sprint Hare', '#f2994a', '#f2f4f8', 'bunny', 'none', 'stopwatch', false, false, 'Already done. Next?'],
  planner: ['Blueprint Penguin', '#62b8e6', '#2f6fb0', 'none', 'cap', 'scroll', false, false, 'Slice it thin.'],
  'completeness-critic': ['Nitpick Bat', '#c2528f', '#ffd84a', 'cat', 'visor', 'checklist', false, false, 'What did we miss?'],
  'db-prober': ['Probe Mole', '#f2c040', '#ff5a52', 'round', 'beret', 'probe', false, false, 'Just a quick query.'],
  'ui-runtime-tester': ['Pixel Axolotl', '#f472b6', '#9be7ff', 'fin', 'none', 'cursor', true, false, 'Click it. Break it.'],
  'docs-curator': ['Quill Moth', '#b5a3fa', '#ffd84a', 'ant', 'none', 'quill', false, false, "If it isn't written, it didn't ship."],
  'docs-auditor': ['Drift Hedgehog', '#c88a5a', '#52c872', 'none', 'cap', 'book', false, false, 'Docs drift. I count.'],
  armada: ['Fleet Gull', '#9a8cf0', '#ff6b6b', 'fin', 'cap', 'flag', false, false, 'Fleet reporting in.'],
  unknown: ['Mystery Blob', '#8a8f98', '#f2f4f8', 'none', 'none', 'qmark', true, false, 'Who dis?'],
};

const GOLDEN_ALIASES: Record<string, string> = {
  reviewer: 'completeness-critic', critic: 'completeness-critic', rls: 'db-prober', schema: 'db-prober', naming: 'db-prober',
  uitester: 'ui-runtime-tester', main: 'lead', 'main thread': 'lead', orchestrator: 'lead', curator: 'docs-curator',
  auditor: 'docs-auditor', dbprober: 'db-prober',
};

const GOLDEN_LEGEND: Record<string, string> = {
  g: '#ffd84a', w: '#f2f4f8', s: '#9aa4b2', b: '#a9743f', r: '#ff5a52', n: '#52c872', y: '#fff3a0', c: '#9be7ff', d: '#4a5060',
};

const GOLDEN_PROPS: Record<string, { art: string[]; work: number[][] }> = {
  baton: { art: ['..y', '..w', '.w.', 'b..'], work: [[0, -1], [-1, 0], [0, 1], [1, 0]] },
  lantern: { art: ['.s.', 'dyd', 'dyd', '.d.'], work: [[-2, 0], [0, 1], [2, 0], [0, 1]] },
  hammer: { art: ['sss', 'sss', '.b.', '.b.'], work: [[0, -3], [0, -1], [0, 2], [0, -1]] },
  magnifier: { art: ['sss', 'scs', 'sss', '.b.'], work: [[-2, 0], [0, -1], [-1, 1], [0, 0]] },
  stopwatch: { art: ['.s.', 'sws', 'sws', '.s.'], work: [[0, 0], [0, -1], [0, 0], [0, 1]] },
  scroll: { art: ['aaa', 'wdw', 'wdw', 'aaa'], work: [[0, 0], [0, 1], [0, 2], [0, 1]] },
  checklist: { art: ['www', 'rdw', 'wnw', 'www'], work: [[0, 0], [0, 1], [0, 0], [0, 1]] },
  key: { art: ['ggg', 'g.g', '.g.', '.gg'], work: [[0, 0], [1, 1], [0, 2], [-1, 1]] },
  probe: { art: ['.a.', '.s.', '.s.', '.s.'], work: [[0, -1], [0, 0], [0, 1], [0, 0]] },
  cursor: { art: ['w..', 'ww.', 'www', '.dw'], work: [[-2, 2], [0, 1], [1, 0], [0, 1]] },
  quill: { art: ['..w', '.ww', 'wa.', 'a..'], work: [[0, 0], [0, 1], [-1, 0], [0, 1]] },
  book: { art: ['aaa', 'awa', 'awa', 'aaa'], work: [[0, 0], [0, -1], [0, 0], [0, -1]] },
  grid: { art: ['sss', 'sds', 'sss', 'sds'], work: [[0, 0], [0, 1], [0, 0], [0, 1]] },
  tag: { art: ['aa.', 'aaa', 'awa', 'aaa'], work: [[0, 0], [0, 1], [0, 2], [0, 1]] },
  flag: { art: ['baa', 'baa', 'b..', 'b..'], work: [[0, 0], [1, 0], [0, 0], [-1, 0]] },
  qmark: { art: ['sss', '..s', '.s.', '.d.'], work: [[0, 0], [0, -1], [0, 0], [0, 1]] },
};

test('every creature has valid colours, a species, a catchphrase and a known prop', () => {
  for (const [k, c] of Object.entries(CREATURES)) {
    expect([k, HEX.test(c.color), HEX.test(c.accent)]).toEqual([k, true, true]);
    expect(c.species.length).toBeGreaterThan(0);
    expect(c.catchphrase.length).toBeGreaterThan(0);
    expect([k, c.prop in PROPS]).toEqual([k, true]);
  }
  expect(CREATURES.unknown).toBeDefined(); // fallback creature for unmatched personas
  expect(CREATURES.lead).toBeDefined();
});

test('each persona has its own body colour', () => {
  const colours = Object.values(CREATURES).map((c) => c.color);
  expect(new Set(colours).size).toBe(colours.length);
});

test('the shipped creature table matches the golden, in display order', () => {
  const got = Object.fromEntries(Object.entries(CREATURES).map(([k, c]) => [k, [c.species, c.color, c.accent, c.ears, c.hat, c.prop, !!c.wide, !!c.shell, c.catchphrase]]));
  expect(got).toEqual(GOLDEN_CREATURES);
  expect(Object.keys(CREATURES)).toEqual(Object.keys(GOLDEN_CREATURES));
});

test('every alias resolves to a real creature and matches the golden', () => {
  for (const [alias, target] of Object.entries(ALIASES)) expect([alias, target in CREATURES]).toEqual([alias, true]);
  expect(ALIASES).toEqual(GOLDEN_ALIASES);
});

test('prop legend colours are valid single-char keys and match the golden', () => {
  for (const [ch, hex] of Object.entries(PROP_LEGEND)) expect([ch, ch.length, HEX.test(hex)]).toEqual([ch, 1, true]);
  expect(PROP_LEGEND).toEqual(GOLDEN_LEGEND);
});

test('every prop is a 4x3 template over the legend (or "." / "a") with four work offsets', () => {
  for (const [k, p] of Object.entries(PROPS)) {
    expect([k, p.art.length]).toEqual([k, 4]);
    for (const row of p.art) {
      expect([k, row.length]).toEqual([k, 3]);
      for (const ch of row) expect([k, ch === '.' || ch === 'a' || ch in PROP_LEGEND]).toEqual([k, true]);
    }
    expect([k, p.work.length]).toEqual([k, 4]);
    for (const w of p.work) expect([k, w.length]).toEqual([k, 2]);
  }
});

test('the shipped prop table matches the golden, in order', () => {
  expect(JSON.parse(JSON.stringify(PROPS))).toEqual(GOLDEN_PROPS);
  expect(Object.keys(PROPS)).toEqual(Object.keys(GOLDEN_PROPS));
});
