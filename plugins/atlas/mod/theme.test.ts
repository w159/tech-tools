// Self-check for the band's theme helpers (run: claude plugin test <dir>).
import { expect, test } from 'claude-code/testing';
import { bar, blink, dim, glyph, lerp, phaseColor, stateColor } from './theme';

test('bar clamps and rounds', () => {
  expect(bar(0, 10)).toBe('▱▱▱▱▱▱▱▱▱▱');
  expect(bar(41, 10)).toBe('▰▰▰▰▱▱▱▱▱▱');
  expect(bar(100, 10)).toBe('▰▰▰▰▰▰▰▰▰▰');
  expect(bar(150, 10)).toBe('▰▰▰▰▰▰▰▰▰▰');
  expect(bar(-5, 3)).toBe('▱▱▱');
});

test('lerp interpolates', () => {
  expect(lerp(0, 10, 0.5)).toBe(5);
  expect(lerp(2, 4, 0)).toBe(2);
  expect(lerp(2, 4, 1)).toBe(4);
});

test('dim scales hex and passes non-hex through', () => {
  expect(dim('#ffffff', 0.5)).toBe('#808080');
  expect(dim('#2fbd9f', 1)).toBe('#2fbd9f');
  expect(dim('green', 0.5)).toBe('green');
  expect(dim('#2fbd9f', 0)).toBe('#000000');
});

test('phase and state colours resolve from BRAND', () => {
  expect(phaseColor('implement')).toBe('#2fbd9f');
  expect(phaseColor('blocked')).toBe('#ff7570');
  expect(stateColor('running')).toBe('#2fbd9f');
  expect(stateColor('failed')).toBe('#ff7570');
});

test('glyph constants and blink domain', () => {
  expect(glyph.hex).toBe('⬢');
  expect(glyph.diamond).toBe('◆');
  expect(glyph.hollow).toBe('◇');
  expect([0, 1]).toContain(blink(500));
});
