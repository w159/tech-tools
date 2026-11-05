import { describe, expect, test } from 'claude-code/testing';
import { runsToSvg } from './review';

describe('runsToSvg', () => {
  const svg = runsToSvg([[{ text: '▀', fg: '#f00', bg: '#00f' }, { text: '█', fg: '#0f0' }], [{ text: ' A', fg: '#fff', bg: '#123' }]]);
  test('▀ draws a half-height fg rect, █ a full-height one', () => {
    expect(svg).toContain('<rect x="0" y="0" width="8" height="8" fill="#f00"/>');
    expect(svg).toContain('<rect x="8" y="0" width="8" height="16" fill="#0f0"/>');
  });
  test('chip text becomes <text>', () => expect(svg).toContain('<text'));
  test('honours cell size', () => expect(runsToSvg([[{ text: '█', fg: '#000' }]], { cellW: 4, cellH: 8 })).toContain('width="4" height="8"'));
});

describe('runsToSvg exact output', () => {
  const T = '#1b1f27'; // spriteTile
  const head = (w: number, h: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  const rect = (x: number, y: number, w: number, h: number, fill: string): string => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

  test('empty input is a 0x0 svg', () => {
    expect(runsToSvg([])).toBe(`${head(0, 0)}</svg>`);
    expect(runsToSvg([[]])).toBe(`${head(0, 16)}</svg>`);
  });
  test('▀ ▄ █ paint upper half, lower half, full cell over the bg rect', () => {
    expect(runsToSvg([[{ text: '▀', fg: '#f00', bg: '#00f' }]])).toBe(`${head(8, 16)}${rect(0, 0, 8, 16, '#00f')}${rect(0, 0, 8, 8, '#f00')}</svg>`);
    expect(runsToSvg([[{ text: '▄', fg: '#f00', bg: '#00f' }]])).toBe(`${head(8, 16)}${rect(0, 0, 8, 16, '#00f')}${rect(0, 8, 8, 8, '#f00')}</svg>`);
    expect(runsToSvg([[{ text: '█', fg: '#f00', bg: '#00f' }]])).toBe(`${head(8, 16)}${rect(0, 0, 8, 16, '#00f')}${rect(0, 0, 8, 16, '#f00')}</svg>`);
  });
  test('missing fg and bg fall back to the sprite tile colour', () => {
    expect(runsToSvg([[{ text: '▀' }]])).toBe(`${head(8, 16)}${rect(0, 0, 8, 16, T)}${rect(0, 0, 8, 8, T)}</svg>`);
    expect(runsToSvg([[{ text: '▄' }]])).toBe(`${head(8, 16)}${rect(0, 0, 8, 16, T)}${rect(0, 8, 8, 8, T)}</svg>`);
    expect(runsToSvg([[{ text: '█' }]])).toBe(`${head(8, 16)}${rect(0, 0, 8, 16, T)}${rect(0, 0, 8, 16, T)}</svg>`);
  });
  test('a space is only a bg rect', () => {
    expect(runsToSvg([[{ text: ' ', bg: '#123' }]])).toBe(`${head(8, 16)}${rect(0, 0, 8, 16, '#123')}</svg>`);
  });
  test('a letter is a bg rect plus positioned <text>; bold and default fill', () => {
    expect(runsToSvg([[], [{ text: ' A', fg: '#abc', bg: '#123', bold: true }, { text: 'b' }]])).toBe(
      `${head(24, 32)}${rect(0, 16, 8, 16, '#123')}${rect(8, 16, 8, 16, '#123')}`
      + '<text x="8" y="28.8" font-family="monospace" font-size="12.8" textLength="8" fill="#abc" font-weight="bold">A</text>'
      + rect(16, 16, 8, 16, T)
      + '<text x="16" y="28.8" font-family="monospace" font-size="12.8" textLength="8" fill="#fff">b</text></svg>',
    );
  });
  test('text is XML-escaped', () => {
    const svg = runsToSvg([[{ text: '<' }, { text: '&' }, { text: '>' }]]);
    expect(svg).toContain('>&lt;</text>');
    expect(svg).toContain('>&amp;</text>');
    expect(svg).toContain('>&gt;</text>');
  });
  test('multi-char runs advance one cell per code point; width is the widest row, height the row count', () => {
    const svg = runsToSvg([[{ text: '██', fg: '#111' }, { text: '▀', fg: '#222' }], [{ text: '😀', fg: '#333' }]], { cellW: 5, cellH: 10 });
    expect(svg.startsWith(head(15, 20))).toBe(true);
    expect(svg).toContain(rect(10, 0, 5, 5, '#222'));
    expect(svg).toContain(rect(5, 0, 5, 10, '#111'));
    expect(svg).toContain('<text x="0" y="18" font-family="monospace" font-size="8" textLength="5" fill="#333">😀</text>');
  });
  test('cellW and cellH apply independently', () => {
    expect(runsToSvg([[{ text: '▄', fg: '#f00', bg: '#00f' }]], { cellW: 3 })).toBe(`${head(3, 16)}${rect(0, 0, 3, 16, '#00f')}${rect(0, 8, 3, 8, '#f00')}</svg>`);
    expect(runsToSvg([[{ text: '▄', fg: '#f00', bg: '#00f' }]], { cellH: 4 })).toBe(`${head(8, 4)}${rect(0, 0, 8, 4, '#00f')}${rect(0, 2, 8, 2, '#f00')}</svg>`);
  });
});
