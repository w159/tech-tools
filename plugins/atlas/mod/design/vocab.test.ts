// vocab.ts (S1, round 2 D4): one gate-line formatter, so every surface says `● name 8 pass · 0 deny` the same way and counts denials, never a pass ratio.
import { describe, expect, test } from 'claude-code/testing';
import { gateCounts, gateLine, gatesTotal } from './vocab';

describe('gateLine', () => {
  test('all checks pass: green', () => {
    expect(gateLine('completion', 4, 4)).toEqual({ glyph: '●', text: '● completion 4 pass · 0 deny', count: '4 pass · 0 deny', tone: 'ok', pass: 4, total: 4, deny: 0, fired: true });
  });
  test('some fail: red', () => {
    const g = gateLine('tripwire', 1, 2);
    expect(g.text).toBe('● tripwire 1 pass · 1 deny');
    expect(g.tone).toBe('bad');
  });
  test('no checks: grey `not fired`', () => {
    const g = gateLine('header', 0, 0);
    expect(g.text).toBe('○ header not fired');
    expect(g.tone).toBe('sub');
    expect(g.fired).toBe(false);
  });
  test('ASCII swaps the dot', () => {
    expect(gateLine('routing', 8, 8, true).text).toBe('* routing 8 pass - 0 deny');
    expect(gateLine('header', 0, 0, true).text).toBe('o header not fired');
  });
  test('unreadable counts clamp to zero', () => {
    expect(gateLine('x', NaN, -1).text).toBe('○ x not fired');
  });
});

describe('gateCounts', () => {
  test('lines pass or deny; a failing check holds at least one denial; pending and empty groups never fired', () => {
    expect(gateCounts({ ok: true, lines: 3, pass: 3 })).toEqual({ pass: 3, total: 3 });
    expect(gateCounts({ ok: false, lines: 3, pass: 3 })).toEqual({ pass: 2, total: 3 });
    expect(gateCounts({ ok: true, pending: true, lines: 2, pass: 1 })).toEqual({ pass: 0, total: 0 });
    expect(gateCounts({ ok: true, lines: 0, pass: 0 })).toEqual({ pass: 0, total: 0 });
    expect(gateCounts({ ok: false, lines: 0 })).toEqual({ pass: 0, total: 1 });
    expect(gateCounts({ ok: true })).toEqual({ pass: 1, total: 1 });
  });
});

describe('gatesTotal', () => {
  test('sums the gates that fired; one that never fired is excluded', () => {
    const t = gatesTotal([{ pass: 1, total: 1 }, { pass: 2, total: 2 }, { pass: 8, total: 8 }, { pass: 0, total: 0 }]);
    expect(t).toEqual({ pass: 11, total: 11, deny: 0, fired: 3, notFired: 1, text: 'ok', tone: 'ok' });
  });
  test('a denial turns the total red', () => {
    expect(gatesTotal([{ pass: 1, total: 2 }, { pass: 3, total: 3 }])).toEqual({ pass: 4, total: 5, deny: 1, fired: 2, notFired: 0, text: '1 denied', tone: 'bad' });
  });
  test('no gates fired is grey', () => {
    expect(gatesTotal([])).toEqual({ pass: 0, total: 0, deny: 0, fired: 0, notFired: 0, text: 'ok', tone: 'sub' });
  });
});
