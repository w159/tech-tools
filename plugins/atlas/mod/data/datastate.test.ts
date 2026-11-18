import { describe, expect, test } from 'claude-code/testing';
import { diffSnapshots } from '../notify';
import { factsLine } from '../discipline';
import { ageShort, dataCell, dataStateOf, dataWord } from './datastate';

describe('empty, error and stale: the three states of a figure', () => {
  test('empty: no value and no failure', () => {
    const s = dataStateOf({ has: false });
    expect(s).toEqual({ kind: 'empty' });
    expect(dataWord(s)).toBe('no data yet');
    expect([dataCell(s), dataCell(s, true)]).toEqual(['—', '-']);
  });
  test('error: the read failed, even when an old value is held', () => {
    const s = dataStateOf({ has: true, failed: true, ageSecs: 1, refreshSecs: 10 });
    expect(s).toEqual({ kind: 'error' });
    expect(dataWord(s)).toBe('read failed');
    expect(dataCell(s)).toBe('err');
  });
  test('stale: older than its refresh interval, with its age', () => {
    const s = dataStateOf({ has: true, ageSecs: 125, refreshSecs: 60 });
    expect(s).toEqual({ kind: 'stale', ageSecs: 125 });
    expect(dataWord(s)).toBe('stale 2m');
    expect(dataCell(s)).toBe('~2m');
    expect(dataStateOf({ has: true, ageSecs: 60, refreshSecs: 60 })).toEqual({ kind: 'ok' }); // at the interval is still fresh
  });
  test('ok prints nothing; ages read s, m, h', () => {
    expect(dataWord({ kind: 'ok' })).toBe('');
    expect(dataCell({ kind: 'ok' })).toBe('');
    expect([ageShort(45), ageShort(180), ageShort(7300)]).toEqual(['45s', '3m', '2h']);
  });
});

describe('the sites that used to print `unknown`', () => {
  const snap = { root: '/repo', phase: 'implement', todos: [] } as never;
  test('discipline facts: an empty branch and a failed read are different words', () => {
    expect(factsLine(snap, '')).toContain('branch no data yet');
    expect(factsLine(snap, null)).toContain('branch read failed');
    expect(factsLine(snap, 'main')).toContain('branch main');
    expect(factsLine(snap, '')).not.toContain('unknown');
  });
  test('notify: a note with no owner names no data, never `unknown`', () => {
    const base = { squad: [], todos: [], notes: [], phase: 'implement' } as never as Record<string, unknown>;
    const next = { ...base, notes: [{ seq: 1, to: 'human', text: 'hi' }] } as never;
    const ev = diffSnapshots(base as never, next);
    expect(ev).toEqual([{ type: 'note', sender: 'no data yet', preview: 'hi' }]);
  });
});
