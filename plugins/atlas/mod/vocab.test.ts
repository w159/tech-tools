// vocab.ts (S1): one gate-line formatter, so every surface says `● name n/m` the same way and counts the same checks.
import { describe, expect, test } from 'claude-code/testing';
import { gateLine, gatesTotal } from './vocab';

describe('gateLine', () => {
  test('all checks pass: green', () => {
    expect(gateLine('completion', 4, 4)).toEqual({ glyph: '●', text: '● completion 4/4', tone: 'ok', pass: 4, total: 4 });
  });
  test('some fail: red', () => {
    const g = gateLine('tripwire', 1, 2);
    expect(g.text).toBe('● tripwire 1/2');
    expect(g.tone).toBe('bad');
  });
  test('no checks: grey neutral, shown as 0/0', () => {
    const g = gateLine('header', 0, 0);
    expect(g.text).toBe('● header 0/0');
    expect(g.tone).toBe('sub');
  });
  test('ASCII swaps the dot', () => {
    expect(gateLine('routing', 8, 8, true).text).toBe('* routing 8/8');
  });
  test('unreadable counts clamp to zero', () => {
    expect(gateLine('x', NaN, -1).text).toBe('● x 0/0');
  });
});

describe('gatesTotal', () => {
  test('sums n/m so every surface reports the same count', () => {
    const t = gatesTotal([{ pass: 1, total: 1 }, { pass: 2, total: 2 }, { pass: 8, total: 8 }, { pass: 0, total: 0 }]);
    expect(t).toEqual({ pass: 11, total: 11, text: '11/11', tone: 'ok' });
  });
  test('a failing gate turns the total red', () => {
    expect(gatesTotal([{ pass: 1, total: 2 }, { pass: 3, total: 3 }])).toEqual({ pass: 4, total: 5, text: '4/5', tone: 'bad' });
  });
  test('no gates at all is 0/0 grey', () => {
    expect(gatesTotal([])).toEqual({ pass: 0, total: 0, text: '0/0', tone: 'sub' });
  });
});
