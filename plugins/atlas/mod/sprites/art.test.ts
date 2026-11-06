// The hand-drawn pixel art tables: shape contract only (the rendered gallery is covered in api.test.ts).
import { describe, expect, test } from 'claude-code/testing';
import { ART } from './art';
import { CREATURES } from './palette';

const LEGEND = new Set('kfmhagywbsdctroen'.split(''));
const SIZES = { m: 12, l: 16 } as const;

describe('ART tables', () => {
  test('every drawn persona is a known creature', () => {
    expect(Object.keys(ART).sort()).toEqual(['completeness-critic', 'explorer', 'implementer', 'lead', 'planner', 'runner', 'verifier']);
    for (const k of Object.keys(ART)) expect(CREATURES[k]).toBeDefined();
  });
  for (const [persona, art] of Object.entries(ART)) {
    for (const size of ['m', 'l'] as const) {
      const n = SIZES[size];
      test(`${persona}/${size} is a ${n}x${n} grid of legend characters`, () => {
        const rows = art[size];
        expect(rows).toHaveLength(n);
        for (const r of rows) {
          expect(r).toHaveLength(n);
          for (const ch of r) expect(ch === '.' || LEGEND.has(ch)).toBe(true);
        }
      });
      test(`${persona}/${size} has an outlined, filled body`, () => {
        const flat = art[size].join('');
        expect([...flat].filter((c) => c === 'k').length).toBeGreaterThan(n);
        expect(art[size].some((r) => r.includes('f') || r.includes('h') || r.includes('w'))).toBe(true);
      });
    }
    test(`${persona}: the large drawing is not the medium one scaled by padding alone`, () => {
      expect(art.l.join('')).not.toBe(art.m.join(''));
      expect(art.l.length).toBeGreaterThan(art.m.length);
    });
  }
});
