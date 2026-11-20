// Whole-tree guards over every non-test source under mod/, found by walking the tree and keyed by basename so they hold wherever a file lives.
// Each scan is paired with a floor on the number of files it saw: a guard that scans an empty or shrunken tree must fail, not pass.
//   M4  band-frame.ts and status-frame.ts are not a runtime import cycle.
//   M5  no hex colour literal outside the token file (atlas-ui.ts) and the files that own another palette.
//   M6  no value import of a name its source module exports only as a type (the host loader does not erase them).
//   M2  only look.ts (and the token file that defines it) reads the theme from the environment.
import { expect, test } from 'claude-code/testing';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOD_ROOT, modPath, modSources } from './fixtures/source-tree';

/** Floor on the non-test sources the walk sees (95 without `.d.ts` files, 98 with, when the guards were written). */
const MIN_SOURCES = 90;
/** Floor on the sources M5 scans after the own-palette files are set aside (81 when the guards were written). */
const MIN_HEX_SCANNED = 75;

const baseOf = (f: string): string => f.slice(f.lastIndexOf('/') + 1);

/** The runtime (value) edges of one source file: `import type` and all-`type` specifier lists are erased, `export ... from` stays. */
const runtimeEdges = (rel: string, all: readonly string[]): string[] => {
  const src = readFileSync(join(MOD_ROOT, rel), 'utf8');
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const out: string[] = [];
  const add = (spec: string): void => {
    const base = join('/', dir, spec).slice(1);
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) if (all.includes(base + ext)) return void out.push(base + ext);
  };
  for (const m of src.matchAll(/^import\s+(?!type\b)([^;]*?)\s+from\s+'(\.[^']*)'/gm)) {
    const names = m[1]!.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (names.some((n) => !n.startsWith('type '))) add(m[2]!);
  }
  for (const m of src.matchAll(/^export\s+(?!type\b)(?:\{[^}]*\}|\*)\s+from\s+'(\.[^']*)'/gm)) add(m[1]!);
  return out;
};

test('the source walk sees the whole tree (floor)', () => {
  expect(modSources().length).toBeGreaterThanOrEqual(MIN_SOURCES);
  expect(modSources({ dts: true }).length).toBeGreaterThanOrEqual(MIN_SOURCES);
});

test('M4: band-frame.ts and status-frame.ts are not a runtime import cycle', () => {
  const all = modSources();
  const band = modPath('band-frame.ts');
  const status = modPath('status-frame.ts');
  expect(all).toContain(band);
  expect(all).toContain(status);
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const walk = (f: string): boolean => runtimeEdges(f, all).some((n) => n === to || (!seen.has(n) && (seen.add(n), walk(n))));
    return walk(from);
  };
  expect([reaches(band, status), reaches(status, band)]).not.toEqual([true, true]);
  expect(reaches(band, band)).toBe(false);
});

test('M5: no hex colour literal outside the token file (atlas-ui.ts) and the files that own another palette', () => {
  const OWN_PALETTE = (f: string): boolean => baseOf(f) === 'atlas-ui.ts' || f === 'contract.ts' || f === 'data/personas.ts' || f.startsWith('sprites/') || f.startsWith('fixtures/') || /golden-(fixture|cases)\.ts$/.test(f);
  const scanned = modSources().filter((x) => !OWN_PALETTE(x));
  expect(scanned.length).toBeGreaterThanOrEqual(MIN_HEX_SCANNED);
  expect(scanned).toContain(modPath('theme.ts'));
  const stray: string[] = [];
  for (const f of scanned) {
    for (const m of readFileSync(join(MOD_ROOT, f), 'utf8').matchAll(/#[0-9a-fA-F]{6}\b/g)) stray.push(`${f}: ${m[0]}`);
  }
  expect(stray).toEqual([]);
});

test('M2: only look.ts (and the token file that defines it) reads the theme from the environment', () => {
  const sources = modSources({ dts: true });
  expect(sources.length).toBeGreaterThanOrEqual(MIN_SOURCES);
  expect(sources).toContain(modPath('look.ts'));
  const stray: string[] = [];
  for (const f of sources) {
    if (baseOf(f) === 'look.ts' || baseOf(f) === 'atlas-ui.ts') continue;
    const src = readFileSync(join(MOD_ROOT, f), 'utf8');
    if (/\buiFromEnv\b/.test(src)) stray.push(`${f}: uiFromEnv`);
    if (/hostEnv\(\)\s*\.\s*(ATLAS_|NO_COLOR|COLORTERM|COLORFGBG|LC_|LANG\b|TERM\b)/.test(src)) stray.push(`${f}: hostEnv() read`);
  }
  expect(stray).toEqual([]);
});

const VALUE_IMPORT = /^import\s+(?!type\b)\{([^}]*)\}\s+from\s+'(\.[^']*)'/gm;

function resolveImport(all: string[], rel: string, spec: string): string | undefined {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const base = join('/', dir, spec).slice(1);
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((e) => base + e).find((c) => all.includes(c));
}

// Local names a `{ a, b as c, type D }` clause imports as values (inline `type` entries dropped).
function valueNames(clause: string): string[] {
  const entries = clause.split(',').map((s) => s.trim()).filter((s) => s && !s.startsWith('type '));
  return entries.map((raw) => raw.split(/\s+as\s+/)[0]!);
}

function isTypeOnlyExport(tsrc: string, name: string): boolean {
  const isType = new RegExp(`export\\s+(?:type|interface)\\s+${name}\\b|export\\s+type\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(tsrc);
  const isValue = new RegExp(`export\\s+(?:declare\\s+)?(?:const|let|var|function|class|enum|abstract\\s+class)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(tsrc);
  return isType && !isValue;
}

function strayInImport(all: string[], rel: string, m: RegExpMatchArray): string[] {
  const target = resolveImport(all, rel, m[2]!);
  const tsrc = target ? readFileSync(join(MOD_ROOT, target), 'utf8') : '';
  return valueNames(m[1]!).filter((name) => target && isTypeOnlyExport(tsrc, name)).map((name) => `${rel}: ${name} (type-only in ${target})`);
}

function typeOnlyValueImports(all: string[], rel: string): string[] {
  const src = readFileSync(join(MOD_ROOT, rel), 'utf8');
  return [...src.matchAll(VALUE_IMPORT)].flatMap((m) => strayInImport(all, rel, m));
}

test('M6: no value import of a name its source module exports only as a type', () => {
  const all = modSources();
  expect(all.flatMap((rel) => typeOnlyValueImports(all, rel))).toEqual([]);
});
