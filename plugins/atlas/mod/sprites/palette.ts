// Persona creature specs for the half-block sprite library (sprites/api.ts).
// One entry per persona: body colour (mid-tone, readable on dark and light terminals),
// accent, silhouette parts, held prop and catchphrase. Pure data: no imports.

export type Ears = 'none' | 'round' | 'cat' | 'bunny' | 'horn' | 'ant' | 'fin';
export type Hat = 'none' | 'crown' | 'hardhat' | 'cap' | 'visor' | 'beret';
export type PropKind =
  | 'baton' | 'lantern' | 'hammer' | 'magnifier' | 'stopwatch' | 'scroll' | 'checklist' | 'key'
  | 'probe' | 'cursor' | 'quill' | 'book' | 'grid' | 'tag' | 'flag' | 'qmark';

export interface Creature {
  species: string;
  color: string;
  accent: string;
  catchphrase: string;
  ears: Ears;
  hat: Hat;
  prop: PropKind;
  /** 'wide' head (extra cheek columns) and/or 'shell' torso (turtle). */
  wide?: boolean;
  shell?: boolean;
}

export const CREATURES: Record<string, Creature> = {
  lead: { species: 'Maestro Lion', color: '#e8b04a', accent: '#ff6b6b', catchphrase: 'Everyone, from the top.', ears: 'round', hat: 'crown', prop: 'baton' },
  explorer: { species: 'Lantern Fox', color: '#56d4dd', accent: '#ffd84a', catchphrase: 'Mapping the terrain.', ears: 'cat', hat: 'none', prop: 'lantern' },
  implementer: { species: 'Hammer Bear', color: '#52c872', accent: '#f2994a', catchphrase: 'Measure twice, patch once.', ears: 'round', hat: 'hardhat', prop: 'hammer', wide: true },
  verifier: { species: 'Squint Owl', color: '#ff7570', accent: '#ffd84a', catchphrase: 'Trust, but verify.', ears: 'horn', hat: 'none', prop: 'magnifier', wide: true },
  runner: { species: 'Sprint Hare', color: '#f2994a', accent: '#f2f4f8', catchphrase: 'Already done. Next?', ears: 'bunny', hat: 'none', prop: 'stopwatch' },
  planner: { species: 'Blueprint Penguin', color: '#62b8e6', accent: '#2f6fb0', catchphrase: 'Slice it thin.', ears: 'none', hat: 'cap', prop: 'scroll' },
  'completeness-critic': { species: 'Nitpick Bat', color: '#c2528f', accent: '#ffd84a', catchphrase: 'What did we miss?', ears: 'cat', hat: 'visor', prop: 'checklist' },
  'rls-privilege-audit': { species: 'Lock Badger', color: '#d98324', accent: '#ffd84a', catchphrase: 'Who can read that?', ears: 'round', hat: 'none', prop: 'key', wide: true },
  'db-prober': { species: 'Probe Mole', color: '#f2c040', accent: '#ff5a52', catchphrase: 'Just a quick query.', ears: 'round', hat: 'beret', prop: 'probe' },
  'ui-runtime-tester': { species: 'Pixel Axolotl', color: '#f472b6', accent: '#9be7ff', catchphrase: 'Click it. Break it.', ears: 'fin', hat: 'none', prop: 'cursor', wide: true },
  'docs-curator': { species: 'Quill Moth', color: '#b5a3fa', accent: '#ffd84a', catchphrase: "If it isn't written, it didn't ship.", ears: 'ant', hat: 'none', prop: 'quill' },
  'docs-auditor': { species: 'Drift Hedgehog', color: '#c88a5a', accent: '#52c872', catchphrase: 'Docs drift. I count.', ears: 'none', hat: 'cap', prop: 'book' },
  'schema-inventory': { species: 'Table Turtle', color: '#2fbd9f', accent: '#f2f4f8', catchphrase: 'Every table, accounted for.', ears: 'none', hat: 'none', prop: 'grid', shell: true },
  'naming-glossary-audit': { species: 'Tag Parrot', color: '#e8825a', accent: '#52c872', catchphrase: 'Call it what it is.', ears: 'horn', hat: 'none', prop: 'tag' },
  armada: { species: 'Fleet Gull', color: '#9a8cf0', accent: '#ff6b6b', catchphrase: 'Fleet reporting in.', ears: 'fin', hat: 'cap', prop: 'flag' },
  unknown: { species: 'Mystery Blob', color: '#8a8f98', accent: '#f2f4f8', catchphrase: 'Who dis?', ears: 'none', hat: 'none', prop: 'qmark', wide: true },
};

/** Extra spellings -> creature key (personas.ts names are matched directly). */
export const ALIASES: Record<string, string> = {
  reviewer: 'completeness-critic', critic: 'completeness-critic', rls: 'rls-privilege-audit',
  schema: 'schema-inventory', naming: 'naming-glossary-audit', uitester: 'ui-runtime-tester',
  main: 'lead', 'main thread': 'lead', orchestrator: 'lead', curator: 'docs-curator', auditor: 'docs-auditor',
  dbprober: 'db-prober',
};

/** Prop template pixels: rows of legend chars, '.' transparent, 'a' = persona accent. */
export const PROP_LEGEND: Record<string, string> = {
  g: '#ffd84a', w: '#f2f4f8', s: '#9aa4b2', b: '#a9743f', r: '#ff5a52', n: '#52c872',
  y: '#fff3a0', c: '#9be7ff', d: '#4a5060',
};

export const PROPS: Record<PropKind, { art: string[]; work: [number, number][] }> = {
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
