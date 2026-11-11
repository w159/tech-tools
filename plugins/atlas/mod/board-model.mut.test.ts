// Mutation-kill tests for board-model.ts (seed 1105 survivors): the `ran` and elapsed guards of toBoardRow, the compact label
// tone, and the compact state column's right-hand bound.
import { describe, expect, test } from 'claude-code/testing';
import type { Ui } from './atlas-ui';
import { blockedCount, boardBody, boardRow, toBoardRow, type BoardRow } from './board-model';

const ui: Ui = { theme: 'mocha', ascii: true, color: 'truecolor' };
const src = (over: Record<string, unknown>) => ({ content: 'ship it', status: 'completed', ...over }) as Parameters<typeof toBoardRow>[0];

describe('toBoardRow: the `ran` detail needs a done item, both stamps and an ordered pair', () => {
  test('done with both stamps reads ran', () => {
    expect(toBoardRow(src({ claimed_at: 100, completed_at: 190 })).detail).toBe('ran 01:30');
  });
  test('done with only a completion stamp has no ran time', () => {
    const row = toBoardRow(src({ completed_at: 190, evidence: '1. ok' }));
    expect(row.detail).toBe('ok');
  });
  test('done with only a claim stamp has no ran time', () => {
    expect(toBoardRow(src({ claimed_at: 100, evidence: '1. ok' })).detail).toBe('ok');
  });
  test('a claim at second 0 is no stamp: the pair is not ran', () => {
    expect(toBoardRow(src({ claimed_at: 0, completed_at: 5, evidence: 'ev' })).detail).toBe('ev');
    expect(toBoardRow(src({ claimed_at: 0, completed_at: 0, evidence: 'ev' })).detail).toBe('ev');
  });
  test('a completion before the claim is not ran', () => {
    expect(toBoardRow(src({ claimed_at: 200, completed_at: 100, evidence: 'ev' })).detail).toBe('ev');
  });
  test('an item that is not done never reads ran, whatever its stamps', () => {
    expect(toBoardRow(src({ status: 'in_progress', claimed_at: 100, completed_at: 190, evidence: 'ev' })).detail).toBe('ev');
    expect(toBoardRow(src({ status: 'pending', claimed_at: 100, completed_at: 190, evidence: 'ev' })).detail).toBe('ev');
  });
});

describe('toBoardRow: elapsed needs a running item, a claim, a clock and a clock past the claim', () => {
  const run = (over: Record<string, unknown>, now?: number) => toBoardRow(src({ status: 'in_progress', evidence: 'ev', ...over }), now);
  test('running with a claim and a later clock carries elapsed', () => {
    expect(run({ claimed_at: 100 }, 130).elapsed).toEqual({ secs: 30 });
    expect(run({ claimed_at: 100, estimate_s: 60 }, 130).elapsed).toEqual({ secs: 30, of: 60 });
  });
  test('no clock, a claim at second 0, or a clock before the claim carries none', () => {
    expect(run({ claimed_at: 100 }, undefined).elapsed).toBeUndefined();
    expect(run({ claimed_at: 0 }, 50).elapsed).toBeUndefined();
    expect(run({ claimed_at: 100 }, 99).elapsed).toBeUndefined();
    expect(run({}, 50).elapsed).toBeUndefined();
  });
  test('an item that is not running carries none even with a claim and a clock', () => {
    for (const status of ['pending', 'blocked', 'completed', 'failed']) expect(toBoardRow(src({ status, claimed_at: 100 }), 130).elapsed).toBeUndefined();
  });
});

describe('blockedCount', () => {
  test('counts the items whose state word is blocked: a blocked status or a waiting owner, never a done item', () => {
    const owners = new Map<string, 'waiting' | 'running'>([['w', 'waiting'], ['r', 'running']]);
    const items = [
      { status: 'blocked' }, { status: 'pending', owner: 'w' }, { status: 'pending', owner: 'r' },{ status: 'completed', owner: 'w' }, { status: 'in_progress', owner: 'w' },
    ];
    expect(blockedCount(items, owners)).toBe(3);
    expect(blockedCount([], owners)).toBe(0);
  });
});

describe('boardRow: the label tone', () => {
  const row = (state: BoardRow['state']): BoardRow => ({ label: 'wire the band', state, owner: '', detail: '' });
  const labelTone = (r: BoardRow, cols: number) => boardRow(r, false, { cols, ui }).find((x) => x.t.startsWith('wire'))!.tone;
  test('compact keeps a done label in text, narrow dims it', () => {
    expect(labelTone(row('done'), 80)).toBe('text');
    expect(labelTone(row('running'), 80)).toBe('text');
    expect(labelTone(row('done'), 50)).toBe('sub');
    expect(labelTone(row('running'), 50)).toBe('text');
  });
});

describe('boardBody: the compact state column stops one cell short of the room the longest state word needs', () => {
  test('at 60 columns with a long label the state word starts at column 52', () => {
    const rows: BoardRow[] = [{ label: 'x'.repeat(70), state: 'running', owner: '', detail: '' }];
    const line = boardBody(rows, { cols: 60, ui })[0]!.runs.map((x) => x.t).join('');
    expect(line.indexOf('running')).toBe(60 - 7 - 1);
  });
});

describe('boardRow: the narrow form spends every cell after its four-cell head on the label', () => {
  test('a long label fills exactly the width', () => {
    const row: BoardRow = { label: 'x'.repeat(80), state: 'running', owner: 'o', detail: '' };
    const w = boardRow(row, false, { cols: 30, ui }).map((x) => x.t).join('').length;
    expect(w).toBe(30);
  });
});
