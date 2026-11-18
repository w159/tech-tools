// Sidebar text helpers: the age label and the raw-agent-id scrubber.
import { describe, expect, test } from 'claude-code/testing';
import { ageStr, scrub } from './chrome';

describe('ageStr', () => {
  test('under 45 seconds reads "now" (the boundary itself reads seconds)', () => {
    expect(ageStr(0)).toBe('now');
    expect(ageStr(44_999)).toBe('now');
    expect(ageStr(45_000)).toBe('45s');
  });
  test('seconds up to the first minute', () => {
    expect(ageStr(46_000)).toBe('46s');
    expect(ageStr(59_999)).toBe('59s');
  });
  test('minutes carry the leftover seconds, unpadded', () => {
    expect(ageStr(60_000)).toBe('1m0s');
    expect(ageStr(252_000)).toBe('4m12s');
    expect(ageStr(3_599_000)).toBe('59m59s');
  });
  test('hours pad the minutes to two digits and drop seconds', () => {
    expect(ageStr(3_600_000)).toBe('1h00m');
    expect(ageStr(3_720_000)).toBe('1h02m');
    expect(ageStr(3_600_000 * 25 + 59_000)).toBe('25h00m');
    expect(ageStr(3_600_000 * 2 + 600_000)).toBe('2h10m');
  });
});

describe('scrub', () => {
  test('cuts a bare 17-hex agent id to six characters', () => {
    expect(scrub('agent 0123456789abcdef0 done')).toBe('agent 012345 done');
  });
  test('scrubs every id in the text', () => {
    expect(scrub('0123456789abcdef0 and fedcba98765432100')).toBe('012345 and fedcba');
  });
  test('ids of any other length, or inside longer words, are left alone', () => {
    expect(scrub('0123456789abcdef')).toBe('0123456789abcdef');
    expect(scrub('0123456789abcdef01')).toBe('0123456789abcdef01');
    expect(scrub('x0123456789abcdef0')).toBe('x0123456789abcdef0');
  });
  test('uppercase hex is not an agent id', () => {
    expect(scrub('0123456789ABCDEF0')).toBe('0123456789ABCDEF0');
  });
  test('text without ids is returned as is', () => {
    expect(scrub('')).toBe('');
    expect(scrub('plain words')).toBe('plain words');
  });
});
