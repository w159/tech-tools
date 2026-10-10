/**
 * grid.ts tests — expectations derived from the real render semantics:
 * frame rows pair into ▀/▄ half-block runs (top pixel -> `color`, bottom ->
 * `backgroundColor`); adjacent runs merge only on identical glyph + colour +
 * background; `maxRuns` folds neighbour pairs keeping the LEFT run's colours;
 * `frameToCells` has no bg option and omits transparent pixels; `frameToSvg`
 * emits one <rect> per horizontal colour run; `validateSpriteSet` demands the
 * three fixed pixel dims (portrait 16x16, field 8x12, mini 4x4).
 */
import { describe, expect, test } from 'claude-code/testing';
import type { Frame, SpriteSet, SpriteSize, SpriteState } from '../contract';
import {
  SIZES,
  STATES,
  frameToCells,
  frameToRuns,
  frameToSvg,
  tint,
  validateSpriteSet,
} from './grid';

const P = { X: '#112233', Y: '#445566', Z: '#778899' };

const rowsOf = (h: number, w: number, paint: (x: number, y: number) => string): Frame =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => paint(x, y)).join(''));

const framePair = (size: SpriteSize): Frame[] => {
  const [w, h] = SIZES[size];
  return [
    rowsOf(h, w, (x, y) => (x === y ? 'X' : (x + y) % 3 === 0 ? 'Y' : '.')),
    rowsOf(h, w, (x, y) => (x === y ? 'X' : (x + y) % 3 === 1 ? 'Z' : '.')),
  ];
};

const byState = (size: SpriteSize): Record<SpriteState, Frame[]> =>
  Object.fromEntries(STATES.map((s) => [s, framePair(size)] as const)) as Record<
    SpriteState,
    Frame[]
  >;

const SET: SpriteSet = {
  persona: 'test',
  palette: P,
  portrait: byState('portrait'),
  field: byState('field'),
  mini: byState('mini'),
};

describe('frameToRuns', () => {
  test('empty frame has no rows', () => {
    expect(frameToRuns([], P)).toEqual([]);
  });

  test('pairs rows into ▀ runs: top pixel as color, bottom as backgroundColor', () => {
    // x0: top X lit, bottom transparent -> plain ▀ with color only (cannot merge
    // with x1, whose backgroundColor differs from undefined).
    expect(frameToRuns(['XX', '.Y'], P)).toEqual([
      [
        { text: '▀', color: '#112233' },
        { text: '▀', color: '#112233', backgroundColor: '#445566' },
      ],
    ]);
  });

  test('bottom-only pixel is ▄ with its colour', () => {
    expect(frameToRuns(['..', 'XY'], P)).toEqual([
      [
        { text: '▄', color: '#112233' },
        { text: '▄', color: '#445566' },
      ],
    ]);
  });

  test('merges neighbours with identical glyph, colour and background', () => {
    expect(frameToRuns(['XX', 'XX'], P)).toEqual([
      [{ text: '▀▀', color: '#112233', backgroundColor: '#112233' }],
    ]);
  });

  test('both transparent is a plain space (space runs merge)', () => {
    expect(frameToRuns(['..', '..'], P)).toEqual([[{ text: '  ' }]]);
  });

  test('bg paints fully transparent cells', () => {
    expect(frameToRuns(['..', '..'], P, { bg: '#0c1215' })).toEqual([
      [{ text: '  ', backgroundColor: '#0c1215' }],
    ]);
  });

  test('maxRuns folds neighbour pairs, keeping the left run colours', () => {
    expect(frameToRuns(['XYZ', '...'], P, { maxRuns: 1 })).toEqual([
      [{ text: '▀▀▀', color: '#112233' }],
    ]);
  });
});

describe('frameToCells', () => {
  test('emits one {x,y,fg} per lit pixel, transparent pixels absent', () => {
    expect(frameToCells(['XX', '.Y'], P)).toEqual([
      { x: 0, y: 0, fg: '#112233' },
      { x: 1, y: 0, fg: '#112233' },
      { x: 1, y: 1, fg: '#445566' },
    ]);
  });

  test('skips transparent pixels entirely (no bg fill in the real API)', () => {
    expect(frameToCells(['..', 'X.'], P)).toEqual([{ x: 0, y: 1, fg: '#112233' }]);
  });
});

describe('frameToSvg', () => {
  test('one <rect> per horizontal colour run, scaled', () => {
    // 'XX' is one run (2px wide), '.Y' one pixel -> 2 rects, not 4 pixels.
    expect(frameToSvg(['XX', '.Y'], P, 2)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" viewBox="0 0 4 4">' +
        '<rect x="0" y="0" width="4" height="2" fill="#112233"/>' +
        '<rect x="2" y="2" width="2" height="2" fill="#445566"/>' +
        '</svg>',
    );
  });

  test('same-colour runs separated by transparent pixels stay distinct', () => {
    const svg = frameToSvg(['XXYX'], P);
    expect((svg.match(/<rect /g) ?? []).length).toBe(3);
    expect(svg).toContain('width="4" height="1" viewBox="0 0 4 1"');
  });
});

describe('tint', () => {
  test('replaces the accent-stripe key "a", leaves other keys intact', () => {
    const pal = { X: '#112233', a: '#ff00ff', Y: '#445566' };
    expect(tint(pal, '#2fbd9f')).toEqual({ X: '#112233', a: '#2fbd9f', Y: '#445566' });
  });

  test('does not mutate the input and adds "a" when missing', () => {
    const pal: Record<string, string> = { X: '#112233' };
    const out = tint(pal, '#2fbd9f');
    expect(pal.a).toBeUndefined();
    expect(out.a).toBe('#2fbd9f');
    expect(out.X).toBe('#112233');
  });
});

describe('validateSpriteSet', () => {
  test('accepts a complete set with no problems', () => {
    expect(validateSpriteSet(SET)).toEqual([]);
  });

  test('rejects frames with wrong rows and row width per size', () => {
    const bad: SpriteSet = { ...SET, portrait: { ...SET.portrait, idle: [['XXXX'], ['....']] } };
    const problems = validateSpriteSet(bad);
    expect(problems.some((p) => /portrait/.test(p))).toBe(true);
    expect(problems.some((p) => /expected 16/.test(p))).toBe(true);
  });

  test('requires >=2 frames per state', () => {
    const bad: SpriteSet = { ...SET, mini: { ...SET.mini, working: framePair('mini').slice(0, 1) } };
    expect(validateSpriteSet(bad).some((p) => /working/.test(p))).toBe(true);
  });

  test('rejects chars not in the palette (except ".")', () => {
    const bad: SpriteSet = {
      ...SET,
      mini: {
        ...SET.mini,
        idle: [rowsOf(4, 4, (x) => (x === 0 ? 'Q' : 'X')), rowsOf(4, 4, () => '.')],
      },
    };
    expect(validateSpriteSet(bad).some((p) => /palette/.test(p))).toBe(true);
  });
});
