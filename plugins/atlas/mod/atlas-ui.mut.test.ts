// Mutation-kill tests for atlas-ui.ts (seed 1105 survivors): the top cube level of the xterm-256 mapping is 255,
// and a cut stops at the first character that does not fit (a wide one), never skipping on to a narrower later one.
import { describe, expect, test } from 'claude-code/testing';
import { clip, clipMiddle, hexTo256 } from './atlas-ui';

describe('hexTo256', () => {
  test('a near-white colour snaps to the cube level 255, not to the grey ramp', () => {
    // r 194 -> level 175, g 195 -> level 175, b 236 -> level 255 (19 away; 215 is 21 away): cube 16 + 36*3 + 6*3 + 5 = 147.
    // Against a top level of 256 the cube loses to the grey ramp (252).
    expect(hexTo256('#c2c3ec')).toBe(147);
  });
});

describe('clip stops at the first character that does not fit', () => {
  test('a wide character that overflows ends the kept prefix; a later narrow one is not pulled in', () => {
    expect(clip('abcd日cdefgh', 8)).toBe('abcd...');
  });
  test('the same holds for the head of a middle cut', () => {
    expect(clipMiddle('abcd日cdefgh', 8)).toBe('abc...gh');
  });
});
