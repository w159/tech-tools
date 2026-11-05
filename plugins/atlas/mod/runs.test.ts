// fitRuns and rowOf over a fake element table: cell budget, ellipsis on the overflowing run, and the row Box.
import { describe, expect, test } from 'claude-code/testing';
import type { ClientElements } from 'claude-code';
import { fitRuns, rowOf } from './runs';
import { textWidth } from './theme';

type Node = { kind: string; props: Record<string, any> };
const mk = (kind: string) => (props: Record<string, any>): Node => ({ kind, props });
const els = { Box: mk('Box'), Text: mk('Text') } as unknown as ClientElements;
const texts = (rs: unknown): string[] => (rs as Node[]).map((n) => String(n.props.children));

describe('fitRuns', () => {
  test('runs that fit are laid out whole, in order', () => {
    expect(texts(fitRuns(els, [{ t: 'ab' }, { t: 'cd' }, { t: 'e' }], 10))).toEqual(['ab', 'cd', 'e']);
  });
  test('the run that overflows is cut with an ellipsis and later runs are dropped', () => {
    expect(texts(fitRuns(els, [{ t: 'abc' }, { t: 'defgh' }, { t: 'ij' }], 6))).toEqual(['abc', 'de…']);
  });
  test('a run that fills the budget exactly stops the row', () => {
    const out = texts(fitRuns(els, [{ t: 'abc' }, { t: 'def' }, { t: 'ghi' }], 6));
    expect(out).toEqual(['abc', 'def']);
  });
  test('an empty run costs nothing and does not stop the row', () => {
    expect(texts(fitRuns(els, [{ t: 'ab' }, { t: '' }, { t: 'cd' }], 4))).toEqual(['ab', '', 'cd']);
  });
  test('a zero or negative budget still gets one cell', () => {
    expect(texts(fitRuns(els, [{ t: 'abc' }, { t: 'd' }], 0))).toEqual(['…']);
    expect(texts(fitRuns(els, [{ t: 'abc' }], -5))).toEqual(['…']);
    expect(texts(fitRuns(els, [{ t: 'a' }, { t: 'b' }], 1))).toEqual(['a']);
  });
  test('the total width never exceeds the budget', () => {
    for (let cols = 1; cols < 12; cols++) {
      const out = texts(fitRuns(els, [{ t: 'héllo ' }, { t: '日本語' }, { t: 'tail end' }], cols));
      expect(out.reduce((n, t) => n + textWidth(t), 0)).toBeLessThanOrEqual(cols);
    }
  });
  test('style flags are passed to the Text', () => {
    const [n] = fitRuns(els, [{ t: 'x', color: 'c', bg: 'b', bold: true, inverse: true, strike: true }], 5) as unknown as Node[];
    expect(n!.props).toEqual({ color: 'c', backgroundColor: 'b', bold: true, inverse: true, strikethrough: true, children: 'x' });
  });
});

describe('rowOf', () => {
  test('a row Box that keeps its height and holds the fitted runs', () => {
    const r = rowOf(els, [{ t: 'ab' }, { t: 'cdefg' }], 5) as unknown as Node;
    expect(r.kind).toBe('Box');
    expect(r.props.flexDirection).toBe('row');
    expect(r.props.flexShrink).toBe(0);
    expect(texts(r.props.children)).toEqual(['ab', 'cd…']);
  });
});
