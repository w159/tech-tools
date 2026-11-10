// D9: one done glyph. Every surface (mod and omp) takes the mark from mod/theme.ts (DONE_GLYPH), so no renderer carries its own copy.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DONE_GLYPH, contractGlyph } from '../mod/theme';

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? (n === 'fixtures' || n === 'node_modules' ? [] : walk(p)) : [p];
});
const sources = (dir: string, skip: RegExp): string[] =>
  walk(dir).filter((p) => /\.(ts|tsx)$/.test(p) && !/\.(test|golden-cases|golden-fixture)\./.test(p) && !skip.test(p));

describe('D9 done glyph', () => {
  test('D9: ✅ maps to the one done glyph', () => {
    expect(DONE_GLYPH).toBe('✓');
    expect(contractGlyph('✅')).toBe(DONE_GLYPH);
  });
  test('D9: no mod or omp renderer hardcodes the done mark outside theme.ts', () => {
    const files = [...sources(join(import.meta.dir, '..', 'mod'), /theme\.ts$|test_helpers|done-glyph\.test/), ...sources(import.meta.dir, /^$/)];
    const bad = files.filter((p) => /(['"`])✓\1/.test(readFileSync(p, 'utf8')));
    expect(bad.map((p) => p.replace(`${join(import.meta.dir, '..')}/`, ''))).toEqual([]);
  });
});
