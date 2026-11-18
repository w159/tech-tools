// The code copy of the contract stays equal to the contract file (the host cannot import the JSON itself), and the mod parser reads the shared header corpus the gate reads.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'claude-code/testing';
import contract from '../contracts/operating-contract.json';
import corpus from '../contracts/header-corpus.json';
import { HEADER_FIRST_LINE_PATTERN, PHASE_TABLE, firstHeaderLine } from './contract-pattern';
import { leadOf, displayDelta } from './transcript/leadheader';

test('HEADER_FIRST_LINE_PATTERN equals contracts/operating-contract.json headerFirstLinePattern', () => {
  expect(HEADER_FIRST_LINE_PATTERN).toBe((contract as { headerFirstLinePattern: string }).headerFirstLinePattern);
  expect(HEADER_FIRST_LINE_PATTERN).not.toBe('');
});

test('PHASE_TABLE equals contracts/operating-contract.json phases (id, glyph, label, tone, cell)', () => {
  expect(PHASE_TABLE).toEqual((contract as { phases: unknown[] }).phases);
});

test('every phase has a fixed-case label and its own tone', () => {
  expect(new Set(PHASE_TABLE.map((p) => p.tone)).size).toBe(PHASE_TABLE.length);
  for (const p of PHASE_TABLE) expect(p.label).toBe(p.label.toLowerCase());
});

// Every non-test source under mod/ and omp/ except the table's own file. A copy is a file whose code lines (comments skipped) carry two or more distinct phase glyphs: a table, however it is keyed.
const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'node_modules' ? [] : sourcesUnder(join(dir, e.name))) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
const glyphsInCode = (src: string): string[] => {
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  return PHASE_TABLE.map((p) => p.glyph).filter((g) => code.includes(g));
};

test('no mod or omp source file other than contract-pattern.ts holds a phase glyph table of its own', () => {
  const offenders: string[] = [];
  for (const root of ['.', '../omp']) {
    for (const f of sourcesUnder(new URL(root, import.meta.url).pathname)) {
      if (f.endsWith('/mod/contract-pattern.ts') || f.endsWith('/live_fixture.ts')) continue; // the table itself; a snapshot fixture (data, not a lookup)
      if (glyphsInCode(readFileSync(f, 'utf8')).length >= 2) offenders.push(f);
    }
  }
  expect(offenders).toEqual([]);
});

test('the scan sees a table: a source with two phase glyphs on code lines is flagged, a comment is not', () => {
  expect(glyphsInCode("const T = { a: '🔍', b: '🏁' }").length).toBe(2);
  expect(glyphsInCode("// 🔍 🏁 in a comment\n * 🔧 ⛔").length).toBe(0);
});

test('firstHeaderLine takes the first non-empty line, stripped of ASCII whitespace', () => {
  expect(firstHeaderLine('\n  \n  a b  \nc')).toEqual({ line: 'a b', rest: 'c' });
  expect(firstHeaderLine('')).toEqual({ line: '', rest: '' });
  expect(firstHeaderLine('\r\n\v\n\f \nx\r\ny')).toEqual({ line: 'x', rest: 'y' });
});

test('firstHeaderLine breaks on \\n only and strips no Unicode whitespace (the gate does the same)', () => {
  expect(firstHeaderLine('a b\nc').line).toBe('a b');
  expect(firstHeaderLine('a\vb\nc').line).toBe('a\vb');
  for (const ch of ['\u00a0', '\u0085', '\ufeff', '\u2028', '\u001c']) expect([ch, firstHeaderLine(`${ch}x`).line]).toEqual([ch, `${ch}x`]);
});

type Case = { name: string; text: string; match: boolean; phase: string | null };
for (const c of (corpus as { cases: Case[] }).cases) {
  test(`header corpus (mod): ${c.name}`, () => {
    const lead = leadOf(c.text, HEADER_FIRST_LINE_PATTERN);
    expect([lead !== null, lead?.phase ?? null]).toEqual([c.match, c.phase]);
  });
}

test('header corpus: the pattern alone agrees with the corpus on the stripped first non-empty line', () => {
  const re = new RegExp(HEADER_FIRST_LINE_PATTERN);
  for (const c of (corpus as { cases: Case[] }).cases) expect([c.name, re.test(firstHeaderLine(c.text).line)]).toEqual([c.name, c.match]);
});

test('the plain streaming rewrite keeps working: contract line out, display line in, for both brands and after a blank line', () => {
  expect(displayDelta('ATLAS | 🔧 implement 3/5 | wiring', HEADER_FIRST_LINE_PATTERN)).toBe('ATLAS 🔧 implement 3/5 | wiring');
  expect(displayDelta('**ATLAS** | 🔧 implement | wiring\nbody', HEADER_FIRST_LINE_PATTERN)).toBe('ATLAS 🔧 implement | wiring\nbody');
  expect(displayDelta('\nATLAS | 🏁 done | ok\nbody', HEADER_FIRST_LINE_PATTERN)).toBe('\nATLAS 🏁 done | ok\nbody');
  expect(displayDelta('ATLAS | implement | wiring', HEADER_FIRST_LINE_PATTERN)).toBeNull();
  expect(displayDelta('plain text\nATLAS | 🔧 implement | x', HEADER_FIRST_LINE_PATTERN)).toBeNull();
});
