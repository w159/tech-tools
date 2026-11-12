// Truecolor paint primitives: exact segments for padding, folding and chips.
// Pure functions, so every expectation is a literal or a one-line derivation.
import { describe, expect, test } from 'claude-code/testing';
import { chip, merge, padRow, seg } from './paint';
import { PALETTES } from './atlas-ui';

const M = PALETTES.mocha;

const text = (parts: readonly { t: string }[]): string => parts.map((p) => p.t).join('');

describe('seg and chip', () => {
  test('seg defaults to the panel background, no colour, not bold', () => {
    expect(seg('hi')).toEqual({ t: 'hi', color: undefined, bg: M.panel, bold: undefined });
  });
  test('seg takes colour, background and bold as given', () => {
    expect(seg('hi', '#112233', '#445566', true)).toEqual({ t: 'hi', color: '#112233', bg: '#445566', bold: true });
  });
  test('chip pads the text with one space each side, dark text, bold, on the given background', () => {
    expect(chip('run', '#abcdef')).toEqual({ t: ' run ', color: M.base, bg: '#abcdef', bold: true });
  });
});

describe('padRow', () => {
  test('pads with panel spaces up to exactly cols cells', () => {
    const row = padRow([seg('ab')], 5);
    expect(row).toEqual([seg('ab'), { t: '   ', bg: M.panel }]);
  });
  test('uses the given background for the padding', () => {
    expect(padRow([seg('a')], 3, '#010203')[1]).toEqual({ t: '  ', bg: '#010203' });
  });
  test('measures terminal cells, not code units: a wide glyph counts as two', () => {
    expect(text(padRow([seg('漢')], 4))).toBe('漢  ');
  });
  test('a row that already fills (or overflows) cols is returned untouched', () => {
    const exact = [seg('abc')];
    expect(padRow(exact, 3)).toBe(exact);
    const over = [seg('abcd')];
    expect(padRow(over, 3)).toBe(over);
  });
  test('measures across all the runs', () => {
    expect(text(padRow([seg('a'), seg('bc')], 6))).toBe('abc   ');
  });
});

describe('merge', () => {
  test('adjacent runs with the same colour, background and weight fold into one', () => {
    expect(merge([seg('a', '#111'), seg('b', '#111'), seg('c', '#111')])).toEqual([{ t: 'abc', color: '#111', bg: M.panel, bold: undefined }]);
  });
  test('a change of colour, background or bold breaks the run', () => {
    expect(merge([seg('a', '#111'), seg('b', '#222')]).map((s) => s.t)).toEqual(['a', 'b']);
    expect(merge([seg('a', '#111', '#1'), seg('b', '#111', '#2')]).map((s) => s.t)).toEqual(['a', 'b']);
    expect(merge([seg('a', '#111', M.panel, true), seg('b', '#111', M.panel, false)]).map((s) => s.t)).toEqual(['a', 'b']);
  });
  test('only adjacent runs fold: A B A stays three runs', () => {
    expect(merge([seg('a', '#1'), seg('b', '#2'), seg('c', '#1')]).map((s) => s.t)).toEqual(['a', 'b', 'c']);
  });
  test('does not mutate its input', () => {
    const input = [seg('a', '#1'), seg('b', '#1')];
    merge(input);
    expect(input.map((s) => s.t)).toEqual(['a', 'b']);
  });
  test('empty in, empty out', () => {
    expect(merge([])).toEqual([]);
  });
});
