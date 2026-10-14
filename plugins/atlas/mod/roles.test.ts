// roles.ts: every role has a character, frames move with the tick and differ per state, widths never change.
import { describe, expect, test } from 'claude-code/testing';
import { charFrame, MOUTHS, ROLE_EYES, roleKey, type CharState } from './roles';
import { textWidth } from './theme';

const STATES = Object.keys(MOUTHS) as CharState[];
const PERSONAS = [
  'explorer', 'implementer', 'verifier', 'runner', 'planner', 'completeness-critic', 'docs-curator', 'docs-auditor',
  'ui-runtime-tester', 'db-prober', 'rls-privilege-audit', 'schema-inventory', 'naming-glossary-audit', 'armada-sales', 'unknown',
];

describe('role characters', () => {
  test('every persona maps to a character, unknown ones to generic', () => {
    for (const p of PERSONAS) expect(roleKey(p) in ROLE_EYES).toBe(true);
    expect(roleKey('atlas:implementer')).toBe('implementer');
    expect(roleKey('armada-sales')).toBe('generic');
    expect(roleKey(undefined)).toBe('generic');
  });
  test('each role key has its own eyes', () => {
    const eyes = Object.values(ROLE_EYES).map((e) => e.join(''));
    expect(new Set(eyes).size).toBe(eyes.length);
  });
  test('running and thinking cycle with the tick, and keep moving when sampled every 8 ticks', () => {
    for (const s of ['running', 'thinking'] as const) {
      const n = MOUTHS[s].length;
      const frames = Array.from({ length: n }, (_, t) => charFrame('explorer', s, t));
      expect(new Set(frames).size).toBe(n);
      expect(charFrame('explorer', s, n)).toBe(frames[0]);
      expect(new Set([0, 8, 16, 24].map((t) => charFrame('explorer', s, t))).size).toBeGreaterThan(1);
    }
  });
  test('done, failed and blocked hold one frame', () => {
    for (const s of ['done', 'failed', 'blocked'] as const) expect(new Set([0, 1, 2, 3].map((t) => charFrame('verifier', s, t))).size).toBe(1);
  });
  test('states look different from each other', () => {
    const one = STATES.map((s) => charFrame('implementer', s, 0));
    expect(new Set(one).size).toBe(STATES.length);
  });
  test('every frame of every role and state is exactly three cells', () => {
    for (const p of PERSONAS) for (const s of STATES) for (let t = 0; t < 8; t++) expect([p, s, textWidth(charFrame(p, s, t))]).toEqual([p, s, 3]);
  });
});
