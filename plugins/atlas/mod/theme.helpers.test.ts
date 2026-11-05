// Behavior tests for the theme helpers the base theme.test.ts leaves unexercised.
import { describe, expect, test } from 'claude-code/testing';
import {
  barParts, blink, chartRoom, contractGlyph, dim, fitText, formatDuration, glyph, isRawId, lerp, meterColor, MOCHA, mix,
  phaseColor, phaseHue, rangeWidth, spin, spriteTile, STATE_GLYPH, stateColor, textWidth,
} from './theme';

test('phaseColor and stateColor cover every key with the BRAND token', () => {
  const phases = { research: '#62b8e6', theory: '#b5a3fa', test: '#f2aa40', validate: '#7fe0cb', implement: '#2fbd9f', verify: '#52c872', done: '#2fbd9f', blocked: '#ff7570' } as const;
  for (const [p, c] of Object.entries(phases)) expect([p, phaseColor(p as keyof typeof phases)]).toEqual([p, c]);
  const states = { spawning: '#b5a3fa', running: '#2fbd9f', idle: '#93a4ac', input: '#f2aa40', stuck: '#ff7570', parked: '#9fb0b8', finished: '#52c872', failed: '#ff7570', dead: '#9fb0b8' } as const;
  for (const [s, c] of Object.entries(states)) expect([s, stateColor(s as keyof typeof states)]).toEqual([s, c]);
});

test('STATE_GLYPH and glyph tables', () => {
  expect(STATE_GLYPH).toEqual({ spawning: '▸', running: '▶', idle: '○', input: '◇', stuck: '■', parked: '·', finished: '●', failed: '■', dead: '·' });
  expect(glyph).toEqual({ brand: '◆', diamond: '◆', hollow: '◇', rail: '━', dash: '┄', play: '▶', tri: '▸', disc: '●', ring: '○', square: '■', fill: '▰', empty: '▱', star: '✦', starDim: '✧', spark: '˚', dot: '·', bar: '│' });
});

test('meterColor boundaries are inclusive at 60 and 85', () => {
  expect(meterColor(59.9)).toBe('#52c872');
  expect(meterColor(60)).toBe('#f2aa40');
  expect(meterColor(84.9)).toBe('#f2aa40');
  expect(meterColor(85)).toBe('#ff7570');
});

test('lerp extrapolates unclamped using (b - a)', () => {
  expect(lerp(10, 20, 2)).toBe(30);
  expect(lerp(10, 0, 0.5)).toBe(5);
  expect(lerp(0, 10, -1)).toBe(-10);
});

test('dim: per-channel rounding, clamping and malformed input', () => {
  expect(dim('#ff8000', 0.5)).toBe('#804000');
  expect(dim('#0a141e', 2)).toBe('#0a141e');
  expect(dim('#ffffff', -1)).toBe('#000000');
  expect(dim('#102030', 0.25)).toBe('#04080c');
  expect(dim('#abc', 0.5)).toBe('#abc');
  expect(dim('xabcdef', 0.5)).toBe('xabcdef');
  expect(dim('#zzzzzz', 0.5)).toBe('#zzzzzz');
  expect(dim('#000001', 1)).toBe('#000001');
  expect(dim('#0000ff', 0.5)).toBe('#000080');
});

test('mix blends channel-wise and clamps t', () => {
  expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  expect(mix('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  expect(mix('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  expect(mix('#ff0000', '#0000ff', 7)).toBe('#0000ff');
  expect(mix('#ff0000', '#0000ff', -7)).toBe('#ff0000');
  expect(mix('#102030', '#102030', 0.3)).toBe('#102030');
  expect(mix('#0a0a0a', '#141414', 0.5)).toBe('#0f0f0f');
  expect(mix('#ffffff', '#000000', 0.25)).toBe('#bfbfbf');
  expect(mix('#00ff00', '#ff0000', 1)).toBe('#ff0000');
  expect(mix('nope', '#ffffff', 1)).toBe('#ffffff');
});

test('MOCHA palette and phaseHue', () => {
  expect(MOCHA).toEqual({
    panel: '#11111b', panel2: '#181825', base: '#1e1e2e', text: '#cdd6f4', muted: '#6c7086', dim: '#45475a',
    violet: '#cba6f7', teal: '#94e2d5', sky: '#89dceb', blue: '#89b4fa', green: '#a6e3a1', peach: '#fab387',
    red: '#f38ba8', yellow: '#f9e2af', pink: '#f5c2e7', grey: '#585b70', grey2: '#313244', white: '#ffffff',
  });
  expect(['research', 'theory', 'test', 'validate', 'implement', 'verify', 'done', 'blocked'].map(phaseHue)).toEqual([
    MOCHA.blue, MOCHA.violet, MOCHA.yellow, MOCHA.sky, MOCHA.peach, MOCHA.green, MOCHA.teal, MOCHA.red,
  ]);
  expect(phaseHue('nonsense')).toBe(MOCHA.violet);
});

test('chartRoom roles and spriteTile', () => {
  expect(chartRoom).toEqual({ muted: 'subtle', faint: 'inactive', focus: 'claude', live: 'suggestion', ok: 'success', fail: 'error', warn: 'warning', border: 'promptBorder' });
  expect(spriteTile).toBe('#1b1f27');
});

test('barParts: widths, rounding and out-of-range input', () => {
  expect(barParts(50, 5)).toEqual(['▰▰▰', '▱▱']);
  expect(barParts(0, 0)).toEqual(['', '']);
  expect(barParts(100, 3)).toEqual(['▰▰▰', '']);
  expect(barParts(33, 3)).toEqual(['▰', '▱▱']);
  expect(barParts(250, 2)).toEqual(['▰▰', '']);
  expect(barParts(-10, 2)).toEqual(['', '▱▱']);
});

describe('blink', () => {
  const realNow = Date.now;
  const at = (ms: number, period?: number): 0 | 1 => {
    Date.now = () => ms;
    try { return blink(period); } finally { Date.now = realNow; }
  };
  test('toggles every period using the wall clock', () => {
    expect(at(0)).toBe(0);
    expect(at(499)).toBe(0);
    expect(at(500)).toBe(1);
    expect(at(999)).toBe(1);
    expect(at(1000)).toBe(0);
    expect(at(1000, 1000)).toBe(1);
    expect(at(1000, 250)).toBe(0);
    expect(at(250, 250)).toBe(1);
  });
});

test('spin: default braille frames, per-phase tables, wrap, negative, fractional', () => {
  const braille = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  expect(braille.map((_, i) => spin(i))).toEqual(braille);
  expect(spin(10)).toBe('⠋');
  expect(spin(-1)).toBe('⠙');
  expect(spin(2.9)).toBe('⠹');
  expect(spin(1, 'unknown-phase')).toBe('⠙');
  expect(spin(1, '')).toBe('⠙');
  const tables: Record<string, string[]> = {
    research: ['◜', '◠', '◝', '◞', '◡', '◟'],
    theory: ['✶', '✷', '✸', '✹', '✺', '✻'],
    test: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠'],
    implement: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟'],
    verify: ['◐', '◓', '◑', '◒', '◔', '◕'],
  };
  for (const [p, frames] of Object.entries(tables)) {
    expect(frames.map((_, i) => spin(i, p))).toEqual(frames);
    expect(spin(6, p)).toBe(frames[0]!);
    expect(spin(7, p)).toBe(frames[1]!);
  }
  expect(spin(0, 'done')).toBe('⠋');
});

test('rangeWidth: zero wins over wide, wide is 2, else 1; spans are inclusive', () => {
  const zero = [[0, 5], [10, 20]] as const;
  const wide = [[15, 30], [100, 110]] as const;
  const got = [0, 5, 6, 10, 18, 20, 21, 30, 31, 99, 100, 110, 111].map((cp) => rangeWidth(cp, zero, wide));
  expect(got).toEqual([0, 0, 1, 0, 0, 0, 2, 2, 1, 1, 2, 2, 1]);
  expect(rangeWidth(50, [], [])).toBe(1);
});

test('textWidth honours every zero-width and wide span edge', () => {
  const w = (cp: number): number => textWidth(String.fromCodePoint(cp));
  const cases: Array<[number, number]> = [
    [0, 0], [0x1f, 0], [0x20, 1], [0x7e, 1], [0x7f, 0], [0x9f, 0], [0xa0, 1], [0x2ff, 1], [0x300, 0], [0x36f, 0], [0x370, 1],
    [0x200a, 1], [0x200b, 0], [0x200f, 0], [0x2010, 1], [0xfe0e, 1], [0xfe0f, 0], [0xfe10, 1],
    [0x10ff, 1], [0x1100, 2], [0x115f, 2], [0x1160, 1], [0x2aff, 1], [0x2b00, 2], [0x2bff, 2], [0x2c00, 1],
    [0x2e7f, 1], [0x2e80, 2], [0xa4cf, 2], [0xa4d0, 1], [0xabff, 1], [0xac00, 2], [0xd7a3, 2], [0xd7a4, 1],
    [0xf8ff, 1], [0xf900, 2], [0xfaff, 2], [0xfb00, 1], [0xfe2f, 1], [0xfe30, 2], [0xfe6f, 2], [0xfe70, 1],
    [0xfeff, 1], [0xff00, 2], [0xff60, 2], [0xff61, 1], [0xffdf, 1], [0xffe0, 2], [0xffe6, 2], [0xffe7, 1],
    [0x1f2ff, 1], [0x1f300, 2], [0x1faff, 2], [0x1fb00, 1], [0x1ffff, 1], [0x20000, 2], [0x3fffd, 2], [0x3fffe, 1],
  ];
  for (const [cp, width] of cases) expect([cp.toString(16), w(cp)]).toEqual([cp.toString(16), width]);
  expect(textWidth('')).toBe(0);
  expect(textWidth('abc')).toBe(3);
  expect(textWidth('a\tb')).toBe(2);
  expect(textWidth('é')).toBe(1);
  expect(textWidth('漢字')).toBe(4);
  expect(textWidth('◆◇')).toBe(2);
});

test('fitText: fits, cuts on cell boundaries with an ellipsis, handles wide chars and tiny limits', () => {
  expect(fitText('hello', 5)).toBe('hello');
  expect(fitText('hello', 4)).toBe('hel…');
  expect(fitText('hello', 1)).toBe('…');
  expect(fitText('hello', 0)).toBe('');
  expect(fitText('hello', -3)).toBe('');
  expect(fitText('', 3)).toBe('');
  expect(fitText('漢字漢字', 5)).toBe('漢字…');
  expect(fitText('漢字漢字', 4)).toBe('漢…');
  expect(fitText('漢字', 4)).toBe('漢字');
  expect(fitText('a漢b', 3)).toBe('a…');
  expect(fitText('ab😀cd', 4)).toBe('ab…');
  expect(fitText('abcdef', 2)).toBe('a…');
});

test('isRawId accepts host agent hex ids only', () => {
  const yes = ['aa42eb', 'a529730494759bac3', 'AA42EB', '123456', 'aaaaa1', '1'.repeat(32), 'a' + '1'.repeat(32)];
  const no = ['abcdef', 'a12', '12345', '1'.repeat(33), 'a' + '1'.repeat(33), 'explorer-1', 'xaa42eb', 'aa42eb ', ' aa42eb', ''];
  expect(yes.filter((s) => !isRawId(s))).toEqual([]);
  expect(no.filter((s) => isRawId(s))).toEqual([]);
});

test('contractGlyph maps each emoji; other single-cell passes; anything else becomes a dot', () => {
  const m: Record<string, string> = { '🔍': '◎', '💡': '◇', '🧪': '⚗', '📋': '☰', '🔧': '⚒', '✅': '✓', '🏁': '⚑', '⛔': '■' };
  for (const [k, v] of Object.entries(m)) expect(contractGlyph(k)).toBe(v);
  expect(contractGlyph('x')).toBe('x');
  expect(contractGlyph('')).toBe('·');
  expect(contractGlyph('ab')).toBe('·');
  expect(contractGlyph('漢')).toBe('·');
});

test('formatDuration: seconds, zero-padded minutes, hours, rounding and clamping', () => {
  const cases: Array<[number, string]> = [
    [0, '0s'], [-5000, '0s'], [12_000, '12s'], [499, '0s'], [500, '1s'], [59_400, '59s'], [59_500, '1m00s'],
    [60_000, '1m00s'], [65_000, '1m05s'], [252_000, '4m12s'], [3_599_000, '59m59s'], [3_600_000, '1h0m'],
    [3_720_000, '1h2m'], [7_325_000, '2h2m'],
  ];
  for (const [ms, want] of cases) expect([ms, formatDuration(ms)]).toEqual([ms, want]);
});
