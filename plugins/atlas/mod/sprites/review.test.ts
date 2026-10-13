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
