// The code copy of the contract stays equal to the contract file (the host cannot import the JSON itself), and the mod parser reads the shared header corpus the gate reads.
import { readFileSync } from 'node:fs';
import { expect, test } from 'claude-code/testing';
import contract from '../contracts/operating-contract.json';
import corpus from '../contracts/header-corpus.json';
import { HEADER_FIRST_LINE_PATTERN, PHASE_TABLE, firstHeaderLine } from './contract-pattern';
import { leadOf, displayDelta } from './transcript/leadheader';

test('HEADER_FIRST_LINE_PATTERN equals contracts/operating-contract.json headerFirstLinePattern', () => {
  expect(HEADER_FIRST_LINE_PATTERN).toBe((contract as { headerFirstLinePattern: string }).headerFirstLinePattern);
  expect(HEADER_FIRST_LINE_PATTERN).not.toBe('');
});

test('PHASE_TABLE equals contracts/operating-contract.json phases (id, glyph, label, tone)', () => {
  expect(PHASE_TABLE).toEqual((contract as { phases: unknown[] }).phases);
});

test('every phase has a fixed-case label and its own tone', () => {
  expect(new Set(PHASE_TABLE.map((p) => p.tone)).size).toBe(PHASE_TABLE.length);
  for (const p of PHASE_TABLE) expect(p.label).toBe(p.label.toLowerCase());
});

test('no mod file other than contract-pattern.ts holds an inline phase glyph table', () => {
  const src = readFileSync(new URL('./transcript/leadheader.ts', import.meta.url), 'utf8');
  for (const p of PHASE_TABLE) expect([p.id, src.includes(p.glyph)]).toEqual([p.id, false]);
});

test('firstHeaderLine takes the first non-empty line, stripped', () => {
  expect(firstHeaderLine('\n  \n  a b  \nc')).toEqual({ line: 'a b', rest: 'c' });
  expect(firstHeaderLine('')).toEqual({ line: '', rest: '' });
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
