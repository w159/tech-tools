// Edge pins for mod/atlas-ui.ts that the main atlas-ui tests leave open (surviving mutants of the 553a9bce run): the env read,
// the default spinner frame, the empty cut, the 3-cell middle-cut boundary, and the pad and column arithmetic.
import { describe, expect, test } from 'claude-code/testing';
import { atColumn, brandMark, clip, clipMiddle, countRuns, hostEnv, padEnd, runsCells, type Ui } from './atlas-ui';

const ui: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };

describe('hostEnv', () => {
  test('is the live process environment, not an empty object', () => {
    const key = 'ATLAS_UI_EDGE_PROBE';
    // The claude-code/testing kit has no `process` global; install a stand-in for the probe so the read is still exercised there.
    const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } };
    const hadProcess = g.process !== undefined;
    if (!hadProcess) g.process = { env: {} };
    g.process!.env[key] = 'on';
    try {
      expect(hostEnv()[key]).toBe('on');
    } finally {
      delete g.process!.env[key];
      if (!hadProcess) delete g.process;
    }
    expect(hostEnv()[key]).toBeUndefined();
  });
});

describe('countRuns', () => {
  test('without a spin frame the running glyph is the first frame, followed by a blank', () => {
    const runs = countRuns('running', 2, ui);
    expect(runs[0]!.t).toBe('⠋ ');
    expect(runs[1]).toEqual({ t: '2 running', tone: 'text' });
    expect(countRuns('running', 2, ui, 1)[0]!.t).toBe('⠙ ');
  });
});

describe('clip and clipMiddle', () => {
  test('a width of zero or less is the empty string, never undefined', () => {
    expect(clip('abc', 0)).toBe('');
    expect(clip('abc', -2)).toBe('');
    expect(clipMiddle('abc', 0)).toBe('');
    expect(clipMiddle('abc', -1)).toBe('');
  });
  test('clipMiddle: 3 cells or fewer is a plain cut, 4 is one letter and the dots', () => {
    expect(clipMiddle('abcdefgh', 3)).toBe('abc');
    expect(clipMiddle('abcdefgh', 4)).toBe('a...');
    expect(clipMiddle('abcdefgh', 5)).toBe('a...h');
    expect(clipMiddle('abcdefgh', 7)).toBe('ab...gh');
  });
});

describe('padEnd and atColumn', () => {
  test('padEnd fills to n cells and never pads past it (wide glyphs count two)', () => {
    expect(padEnd('ab', 5)).toBe('ab   ');
    expect(padEnd('abcdef', 3)).toBe('abcdef');
    expect(padEnd('漢', 4)).toBe('漢  ');
  });
  test('atColumn pads to the column, and two spaces separate when the cursor is already past it', () => {
    const runs = [{ t: 'abc', tone: 'text' as const }];
    const to = atColumn(runs, 10);
    expect(runsCells(to)).toBe(10);
    expect(to.at(-1)!.t).toBe(' '.repeat(7));
    expect(atColumn(runs, 4).at(-1)!.t).toBe('  ');
    expect(atColumn(runs, 5).at(-1)!.t).toBe('  ');
    expect(atColumn(runs, 6).at(-1)!.t).toBe('   ');
  });
});

describe('brandMark', () => {
  test('ASCII is a bold ATLAS; the glyph form is a plain diamond and a bold accent ATLAS', () => {
    expect(brandMark({ ascii: true })).toEqual([{ t: 'ATLAS', tone: 'text', bold: true }]);
    expect(brandMark({ ascii: false })).toEqual([{ t: '◆ ', tone: 'accent' }, { t: 'ATLAS', tone: 'accent', bold: true }]);
  });
});
