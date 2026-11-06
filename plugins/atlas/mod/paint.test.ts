// Truecolor paint primitives: exact segments for padding, folding, the title-bar gradient, eighth-block bars,
// sparklines and nick colours. Pure functions, so every expectation is a literal or a one-line derivation.
import { describe, expect, test } from 'claude-code/testing';
import { chip, eighthBar, gradientBar, merge, nickColor, padRow, seg, sparkline } from './paint';
import { MOCHA as M, mix } from './theme';

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

describe('gradientBar', () => {
  const A = '#000000';
  const B = '#ffffff';
  const cellsOf = (parts: { t: string; bg?: string }[]) => parts.flatMap((p) => [...p.t].map(() => p.bg));
  test('lays the title after one space and puts right flush against the edge', () => {
    expect(text(gradientBar('Title', 'ok', 14, A, B))).toBe(' Title      ok');
  });
  test('right text is dropped when fewer than two spaces would separate it', () => {
    expect(text(gradientBar('abcd', 'xyz', 9, A, B))).toBe(' abcd    ');
    expect(text(gradientBar('abcd', 'xyz', 10, A, B))).toBe(' abcd  xyz');
    expect(text(gradientBar('abcd', 'xyz', 11, A, B))).toBe(' abcd   xyz');
  });
  test('the bar is never wider than cols; an over-long title is cut', () => {
    expect(text(gradientBar('abcdefghij', '', 6, A, B))).toBe(' abcde');
  });
  test('every cell is bold dark text on a left-to-right ramp, stepping every three cells', () => {
    const bar = gradientBar('x', '', 10, A, B);
    const bgs = cellsOf(bar);
    expect(bgs).toHaveLength(10);
    const at = (i: number) => mix(A, B, (Math.floor(i / 3) * 3) / 9);
    expect(bgs).toEqual(Array.from({ length: 10 }, (_, i) => at(i)));
    expect(bgs[0]).toBe(A);
    expect(bgs[2]).toBe(bgs[0]);
    expect(bgs[3]).not.toBe(bgs[2]);
    expect(bar.every((p) => p.color === M.base && p.bold === true)).toBe(true);
  });
  test('a custom foreground replaces the dark default', () => {
    expect(gradientBar('x', '', 4, A, B, '#123456').every((p) => p.color === '#123456')).toBe(true);
  });
  test('runs with the same gradient step fold, so the node count stays small', () => {
    expect(gradientBar('x', '', 9, A, B)).toHaveLength(3);
  });
  test('a one-cell bar does not divide by zero', () => {
    const bar = gradientBar('', '', 1, A, B);
    expect(bar).toHaveLength(1);
    expect(bar[0]!.bg).toBe(A);
  });
});

describe('eighthBar', () => {
  const full = (parts: { t: string }[]) => text(parts);
  test('whole cells are full blocks, the remainder an eighth block, the rest blank', () => {
    expect(full(eighthBar(0.3, 5, M.teal, M.blue))).toBe('█▌   ');
    expect(full(eighthBar(0.5, 4, M.teal, M.blue))).toBe('██  ');
    expect(full(eighthBar(1, 4, M.teal, M.blue))).toBe('████');
    expect(full(eighthBar(0, 4, M.teal, M.blue))).toBe('    ');
  });
  test('each eighth maps to its own block', () => {
    const blocks = ' ▏▎▍▌▋▊▉█';
    for (let k = 0; k < 8; k++) expect(full(eighthBar((k + 0.0001) / 8, 1, M.teal, M.blue))).toBe(blocks[k]!);
  });
  test('the fraction is clamped to 0..1', () => {
    expect(full(eighthBar(-3, 3, M.teal, M.blue))).toBe('   ');
    expect(full(eighthBar(7, 3, M.teal, M.blue))).toBe('███');
  });
  test('width is always honoured, zero included', () => {
    expect([...full(eighthBar(0.4, 12, M.teal, M.blue))]).toHaveLength(12);
    expect(eighthBar(0.4, 0, M.teal, M.blue)).toEqual([]);
  });
  test('blank cells are dim, filled cells follow the a-to-b ramp, all on the secondary panel', () => {
    const bar = eighthBar(0.5, 4, '#000000', '#ffffff');
    expect(bar.every((p) => p.bg === M.panel2)).toBe(true);
    expect(bar).toEqual([
      { t: '██', color: mix('#000000', '#ffffff', 0), bg: M.panel2 },
      { t: '  ', color: M.dim, bg: M.panel2 },
    ]);
  });
  test('the ramp reaches the far end colour on a long bar', () => {
    const bar = eighthBar(1, 10, '#000000', '#ffffff');
    expect(bar[0]!.color).toBe(mix('#000000', '#ffffff', 0));
    expect(bar.at(-1)!.color).toBe(mix('#000000', '#ffffff', 9 / 9));
  });
});

describe('sparkline', () => {
  test('zero is a dim floor; 1..4 climb two steps each; more than 4 caps at a full block', () => {
    const c = '#ff0000';
    const col = (n: number) => sparkline([n], c)[0]!;
    expect(col(0)).toEqual(seg('▁', M.dim));
    expect(col(1)).toEqual(seg('▂', c));
    expect(col(2)).toEqual(seg('▄', c));
    expect(col(3)).toEqual(seg('▆', c));
    expect(col(4)).toEqual(seg('█', c));
    expect(col(9)).toEqual(seg('█', c));
  });
  test('same-coloured buckets fold into one run; the floor stays separate', () => {
    expect(sparkline([1, 1, 0, 0, 2], '#abc').map((s) => [s.t, s.color])).toEqual([['▂▂', '#abc'], ['▁▁', M.dim], ['▄', '#abc']]);
  });
  test('no buckets, no runs', () => {
    expect(sparkline([], '#abc')).toEqual([]);
  });
});

describe('nickColor', () => {
  test('is the code-point sum modulo the eight-hue palette', () => {
    const hues = [M.pink, M.peach, M.yellow, M.green, M.teal, M.sky, M.blue, M.violet];
    expect(nickColor('')).toBe(M.pink);
    expect(nickColor('a')).toBe(hues[97 % 8]!);
    expect(nickColor('ab')).toBe(hues[(97 + 98) % 8]!);
    expect(nickColor('b')).toBe(hues[98 % 8]!);
  });
  test('is stable, order-insensitive and counts astral code points once', () => {
    expect(nickColor('ab')).toBe(nickColor('ba'));
    expect(nickColor('ab')).toBe(nickColor('ab'));
    expect(nickColor('😁')).toBe([M.pink, M.peach, M.yellow, M.green, M.teal, M.sky, M.blue, M.violet][0x1f601 % 8]!);
  });
});
