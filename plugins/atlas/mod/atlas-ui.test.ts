// Unit tests for the ATLAS design primitives (atlas-ui.ts): tokens, env switches, contrast, the state vocabulary, capsule,
// ribbon, rail, the eighth-quantised gauge (property test), chip, sparkline, spinner and the eased gauge.
import { describe, expect, test } from 'claude-code/testing';
import { world } from '../contracts/band-world';
import {
  asciiMode, ATLAS_GLYPHS, capsule, CHIP_W, chip, chipCount, clip, colorMode, contrast, countRuns, easedFrames, easedValue, easeOutCubic,
  emittedPairs, gauge, gaugeEighths, gaugeParts, gaugeText, glyphTone, hexTo256, hostTo256, inkFor, stable256Indices, xtermHex, luminance, PALETTES, percent, rail, ribbon,
  runKind, runsCells, runsString, sgrColor, sparkline, spinFrameOf, spinnerFrame, spinnerGlyph, stateChip, stateGlyph, stateRun, STATE_ASCII,
  STATE_GLYPHS, STATE_TOKEN, themeName, toneHex, uiFromEnv, UI_STATES, type Ui,
} from './atlas-ui';

const near = (a: number, b: number): void => expect([a, Math.abs(a - b) < 1e-5]).toEqual([a, true]);
const mocha: Ui = { theme: 'mocha', ascii: false, color: 'truecolor' };
const latte: Ui = { theme: 'latte', ascii: false, color: 'truecolor' };
const ascii: Ui = { theme: 'mocha', ascii: true, color: 'truecolor' };

describe('tokens', () => {
  test('Mocha and Latte carry every token as #rrggbb, with the rev 4 values', () => {
    for (const theme of ['mocha', 'latte'] as const) {
      expect(Object.keys(PALETTES[theme]).sort()).toEqual(['accent', 'bad', 'base', 'block', 'info', 'ink', 'line', 'muted', 'ok', 'panel', 'queued_fill', 'run', 'sub', 'text', 'warn', 'white']);
      for (const hex of Object.values(PALETTES[theme])) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(PALETTES.mocha).toMatchObject({ panel: '#181825', text: '#cdd6f4', accent: '#cba6f7', line: '#7f849c' });
    expect(PALETTES.latte).toMatchObject({ panel: '#e6e9ef', text: '#4c4f69', accent: '#8839ef', queued_fill: '#bcc0cc' });
  });
  test('toneHex maps legacy dim to a readable colour in each theme', () => {
    expect(toneHex('dim', 'mocha')).toBe('#585b70');
    expect(toneHex('dim', 'latte')).toBe(PALETTES.latte.muted);
    expect(toneHex('accent', 'latte')).toBe('#8839ef');
  });
});

describe('environment', () => {
  test('theme: ATLAS_THEME wins, COLORFGBG background 7 or 15 reads light, default Mocha', () => {
    expect(themeName({})).toBe('mocha');
    expect(themeName({ ATLAS_THEME: 'latte' })).toBe('latte');
    expect(themeName({ ATLAS_THEME: 'light' })).toBe('latte');
    expect(themeName({ ATLAS_THEME: 'mocha', COLORFGBG: '0;15' })).toBe('mocha');
    expect(themeName({ COLORFGBG: '0;15' })).toBe('latte');
    expect(themeName({ COLORFGBG: '15;0' })).toBe('mocha');
    expect(themeName({ ATLAS_THEME: 'auto', COLORFGBG: '0;7' })).toBe('latte');
  });
  test('ASCII: ATLAS_ASCII=1 or a non-UTF-8 locale; 0 turns it off; an unset locale reads UTF-8', () => {
    expect(asciiMode({})).toBe(false);
    expect(asciiMode({ ATLAS_ASCII: '1' })).toBe(true);
    expect(asciiMode({ ATLAS_ASCII: '0', LANG: 'C' })).toBe(false);
    expect(asciiMode({ LANG: 'en_US.UTF-8' })).toBe(false);
    expect(asciiMode({ LANG: 'C.UTF-8' })).toBe(false);
    expect(asciiMode({ LANG: 'en_US.ISO-8859-1' })).toBe(true);
    expect(asciiMode({ LANG: 'POSIX' })).toBe(true);
    expect(asciiMode({ LC_ALL: 'C', LANG: 'en_US.UTF-8' })).toBe(true);
    expect(asciiMode({ LC_ALL: 'en_US.utf8', LANG: 'C' })).toBe(false);
  });
  test('colour: NO_COLOR (non-empty) turns it off, TERM=xterm-256color without COLORTERM is 256, else truecolor', () => {
    expect(colorMode({})).toBe('truecolor');
    expect(colorMode({ NO_COLOR: '1' })).toBe('none');
    expect(colorMode({ NO_COLOR: '' })).toBe('truecolor');
    expect(colorMode({ TERM: 'xterm-256color' })).toBe('256');
    expect(colorMode({ TERM: 'xterm-256color', COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(uiFromEnv({ ATLAS_THEME: 'latte', ATLAS_ASCII: '1', NO_COLOR: '1' })).toEqual({ theme: 'latte', ascii: true, color: 'none' });
  });
  test('256-colour indexes and SGR parameters', () => {
    expect(hexTo256('#000000')).toBe(16);
    expect(hexTo256('#ffffff')).toBe(231);
    expect(hexTo256('#808080')).toBeGreaterThanOrEqual(232); // grey ramp
    expect(sgrColor('#cba6f7', 38, 'truecolor')).toBe('38;2;203;166;247');
    expect(sgrColor('#cba6f7', 48, '256')).toMatch(/^48;5;\d+$/);
    expect(sgrColor('#cba6f7', 38, 'none')).toBe('');
  });
});

describe('contrast', () => {
  test('WCAG maths: black on white is 21:1, equal colours 1:1', () => {
    near(contrast('#000000', '#ffffff'), 21);
    near(contrast('#336699', '#336699'), 1);
    near(luminance('#ffffff'), 1);
  });
  test('every pair the primitives can emit meets its threshold, text 4.5:1 and glyphs 3:1, in both themes', () => {
    for (const theme of ['mocha', 'latte'] as const) {
      const pairs = emittedPairs(theme);
      expect(pairs.length).toBeGreaterThan(15);
      for (const p of pairs) expect([theme, p.what, p.ratio >= p.need]).toEqual([theme, p.what, true]);
      const min = (kind: 'text' | 'glyph') => Math.min(...pairs.filter((p) => p.kind === kind).map((p) => p.ratio));
      // The measured minimums of rev 4 (evidence/contrast-results.txt).
      expect(min('text')).toBeGreaterThanOrEqual(theme === 'mocha' ? 6.219 : 4.91);
      expect(min('glyph')).toBeGreaterThanOrEqual(theme === 'mocha' ? 4.75 : 3.078);
    }
  });
  test('rules: Latte run is under 4.5 as text and ok under 3 as a glyph, so the glyph falls back to text', () => {
    expect(contrast(PALETTES.latte.run, PALETTES.latte.panel)).toBeLessThan(4.5);
    expect(contrast(PALETTES.latte.ok, PALETTES.latte.panel)).toBeLessThan(3);
    expect(glyphTone('ok', 'latte')).toBe('text');
    expect(glyphTone('ok', 'mocha')).toBe('ok');
    expect(glyphTone('run', 'latte')).toBe('run');
  });
  test('chip ink is whichever of ink and white reads better on the fill', () => {
    for (const theme of ['mocha', 'latte'] as const) {
      for (const fill of ['accent', 'ok', 'run', 'warn', 'bad', 'info', 'queued_fill'] as const) {
        const p = PALETTES[theme];
        const ink = inkFor(fill, theme);
        const other = ink === 'ink' ? 'white' : 'ink';
        expect(contrast(p[ink], p[fill])).toBeGreaterThanOrEqual(contrast(p[other], p[fill]));
      }
    }
  });
  test('runKind: marks and rules are glyphs (3:1), words and digits are text (4.5:1)', () => {
    expect(runKind('██▌░░')).toBe('glyph');
    expect(runKind('  ──  ')).toBe('glyph');
    expect(runKind('◐')).toBe('glyph');
    expect(runKind('running')).toBe('text');
    expect(runKind('62%')).toBe('text');
    expect(runKind('·')).toBe('text');
  });
});

describe('state vocabulary', () => {
  test('six lowercase words, each one glyph, one ASCII mark and one token', () => {
    expect([...UI_STATES]).toEqual(['queued', 'running', 'done', 'failed', 'blocked', 'waiting']);
    expect(UI_STATES.map((s) => STATE_GLYPHS[s]).join('')).toBe('◇◐●■▣◉');
    expect(UI_STATES.map((s) => STATE_ASCII[s]).join('')).toBe('o|*x#?');
    expect(new Set(UI_STATES.map((s) => STATE_GLYPHS[s])).size).toBe(6); // failed is the solid square, blocked the boxed one (critique 17 A2): no two states share a mark
    expect(STATE_TOKEN).toEqual({ queued: 'muted', running: 'run', done: 'ok', failed: 'bad', blocked: 'block', waiting: 'info' });
    for (const s of UI_STATES) expect(s).toMatch(/^[a-z]+$/);
  });
  test('stateRun: token colour, text where under 3:1 or in ASCII; running takes the spinner frame', () => {
    expect(stateRun('failed', mocha)).toEqual({ t: '■', tone: 'bad' });
    expect(stateRun('done', latte)).toEqual({ t: '●', tone: 'text' });
    expect(stateRun('running', mocha, 1).t).toBe('◓');
    expect(stateRun('running', ascii, 1)).toEqual({ t: '/', tone: 'text' });
    expect(stateRun('blocked', ascii)).toEqual({ t: '#', tone: 'text' });
    expect(stateGlyph('queued', ascii)).toBe('o');
    expect(runsString(countRuns('failed', 1, mocha))).toBe('■ 1 failed');
  });
  test('chips are the state words in capitals, one fixed width', () => {
    for (const s of UI_STATES) {
      const c = stateChip(s, mocha);
      expect(c.t).toHaveLength(CHIP_W);
      expect(c.t.trim()).toBe(s.toUpperCase());
      expect(c).toMatchObject({ bold: true, chip: true });
    }
    expect(stateChip('queued', mocha).bg).toBe('queued_fill');
    expect(stateChip('done', mocha)).toMatchObject({ bg: 'ok', tone: 'ink' });
  });
});

describe('brand capsule, ribbon, rail', () => {
  test('capsule: ◖ ◆ ATLAS ◗ with the fill on the middle only; ASCII [ATLAS]', () => {
    const c = capsule(mocha);
    expect(runsString(c)).toBe('◖ ◆ ATLAS ◗');
    expect(c.map((x) => x.bg)).toEqual([undefined, 'accent', undefined]);
    expect(c.map((x) => x.tone)).toEqual(['accent', 'ink', 'accent']);
    expect(chipCount(c)).toBe(1);
    expect(runsString(capsule(ascii))).toBe('[ATLAS]');
    expect(chipCount(capsule(ascii))).toBe(0);
  });
  test('ribbon: exactly `cols` cells, the right label ends the row, ◆ appears once', () => {
    for (const cols of [40, 80, 120]) {
      const r = ribbon(cols, 'TODO', '3 of 7 done', mocha);
      expect(runsCells(r)).toBe(cols);
      expect(runsString(r)).toMatch(/^◖ ◆ ATLAS ◗ ▸ TODO ━+ 3 of 7 done +$/);
      expect([...runsString(r)].filter((c) => c === '◆')).toHaveLength(1);
    }
    expect(runsCells(ribbon(30, 'TODO', '', mocha))).toBe(30);
    const a = runsString(ribbon(40, 'TODO', '3/7', ascii));
    expect(a).toMatch(/^\[ATLAS\] > TODO -+ 3\/7 +$/);
    expect(a).toHaveLength(40);
  });
  test('rail: numbered phases, ● done, ▸ active, ◇ ahead; all done when active = length', () => {
    const phases = world.phases.map((p) => p.id as string);
    expect(runsString(rail(phases, 1, mocha))).toBe('● 1 plan  ──  ▸ 2 research  ──  ◇ 3 build  ──  ◇ 4 verify');
    expect(runsString(rail(phases, 4, mocha))).toBe('● 1 plan  ──  ● 2 research  ──  ● 3 build  ──  ● 4 verify');
    expect(runsString(rail(phases, 0, ascii))).toBe('> 1 plan  --  o 2 research  --  o 3 build  --  o 4 verify');
    const active = rail(phases, 1, mocha).filter((x) => x.bold);
    expect(active.map((x) => x.t)).toEqual(['▸ ', '2 research']);
    expect(rail(phases, 1, latte)[0]!.tone).toBe('text'); // Latte ● falls back to text
  });
});

describe('gauge', () => {
  test('golden gauges from the design (rev 3 section 6a)', () => {
    expect(gaugeText(16, 3 / 7)).toBe('██████▉░░░░░░░░░');
    expect(gaugeText(10, 3 / 7)).toBe('████▎░░░░░');
    expect(gaugeText(8, 0.62)).toBe('█████░░░');
    expect(gaugeText(12, 4 / 9)).toBe('█████▍░░░░░░');
    expect(gaugeText(8, 4 / 9)).toBe('███▌░░░░');
    expect(gaugeText(10, 42 / 300)).toBe('█▍░░░░░░░░');
  });
  test('property: widths 1-40 and values 0-1, filled cells within 1/8 of value*width, width exact', () => {
    // Violations are collected and asserted once: ~120k per-iteration expect() calls blew the kit's 5 s test timeout.
    const bad: string[] = [];
    for (let w = 1; w <= 40; w++) {
      for (let k = 0; k <= 1000; k++) {
        const v = k / 1000;
        const e = gaugeEighths(w, v);
        if (Math.abs(e / 8 - v * w) > 0.125) bad.push(`w=${w} v=${v} eighths=${e}`);
        const p = gaugeParts(w, v);
        if ([...p.full + p.partial + p.track].length !== w) bad.push(`w=${w} v=${v} width`);
        if (p.full.length * 8 + (p.partial ? '▏▎▍▌▋▊▉'.indexOf(p.partial) + 1 : 0) !== e) bad.push(`w=${w} v=${v} parts`);
      }
      for (const v of [3 / 7, 4 / 9, 42 / 300, 1 / 3, 2 / 3, 0.5]) if (Math.abs(gaugeEighths(w, v) / 8 - v * w) > 0.125) bad.push(`w=${w} v=${v} spot`);
    }
    expect(bad).toEqual([]);
  });
  test('clamps out-of-range and non-finite values; zero and full are exact', () => {
    expect(gaugeText(5, -3)).toBe('░░░░░');
    expect(gaugeText(5, 9)).toBe('█████');
    expect(gaugeText(5, Number.NaN)).toBe('░░░░░');
    expect(gaugeText(0, 0.5)).toBe('');
  });
  test('runs: fill in info (or a given token) over a line track; ASCII is = over .', () => {
    expect(gauge(10, 3 / 7, mocha)).toEqual([{ t: '████▎', tone: 'info' }, { t: '░░░░░', tone: 'line' }]);
    expect(gauge(4, 1, mocha, 'ok')).toEqual([{ t: '████', tone: 'ok' }]);
    expect(gauge(8, 0.5, ascii)).toEqual([{ t: '====', tone: 'text' }, { t: '....', tone: 'muted' }]);
    expect(percent(0.62)).toBe('62%');
  });
});

describe('chip', () => {
  test('fixed 11 cells whatever the word, ink on fill, bold', () => {
    for (const w of ['done', 'running', 'waiting', 'blocked', 'a', 'implementer']) expect(chip(w, 'run', mocha).t).toHaveLength(CHIP_W);
    expect(chip('done', 'ok', mocha).t).toBe(' DONE      ');
    expect(chip('failed', 'bad', mocha)).toMatchObject({ bg: 'bad', bold: true, chip: true });
  });
  test('ASCII chip has no fill and keeps the width', () => {
    const c = chip('done', 'ok', ascii);
    expect(c.t).toBe('[ DONE    ]');
    expect(c.t).toHaveLength(CHIP_W);
    expect(c.bg).toBeUndefined();
  });
  test('chipCount counts fills; clip and cells', () => {
    expect(chipCount([chip('a', 'ok', mocha), chip('b', 'ok', mocha)])).toBe(2);
    expect(clip('abcdefghij', 6)).toBe('abc...');
    expect(clip('abc', 6)).toBe('abc');
    expect(clip('abcdef', 2)).toBe('ab');
  });
});

describe('sparkline', () => {
  test('eight block levels scaled to the peak, five ASCII levels', () => {
    expect(sparkline([0, 90, 180], 180)).toBe('▁▅█');
    expect(sparkline([0, 45, 90, 135, 180], 180, true)).toBe("_.-~'");
    expect(sparkline([300, -5], 180)).toBe('█▁'); // clamped
    expect(sparkline([], 180)).toBe('');
  });
  test('the world spark series draws 60 cells with its peak at the top level', () => {
    const s = sparkline(world.spark.values, world.spark.peak);
    expect([...s]).toHaveLength(60);
    expect(s).toContain('█');
    expect(sparkline(world.spark.values, world.spark.peak, true)).toMatch(/^[_.\-~']{60}$/);
  });
});

describe('motion', () => {
  test('spinFrameOf: one clock and the agent id decide the frame, so every surface shows the same glyph for the same agent', () => {
    const ui = { theme: 'mocha', ascii: false, color: 'truecolor' } as const;
    const glyphOn = (now: number, id: string): string => stateRun('running', ui, spinFrameOf(now, id)).t;
    for (const id of ['alpha-explorer', 'implementer-band', 'a', '']) {
      for (const now of [0, 99, 4_321_000, 1_700_000_123_456]) {
        expect(glyphOn(now, id)).toBe(glyphOn(now + (99 - (now % 100)), id)); // same 100 ms bucket (two surfaces redrawing a few ms apart)
        expect(spinFrameOf(now + 100 - (now % 100), id)).toBe(spinFrameOf(now, id) + 1); // the next bucket is the next frame
      }
    }
    expect(spinFrameOf(1_000, 'alpha-explorer')).toBe(spinFrameOf(1_050, 'alpha-explorer'));
    expect(new Set(['a', 'b', 'c', 'd'].map((id) => spinFrameOf(0, id) % 4)).size).toBe(4); // ids spread over the four phases
    expect(spinFrameOf(1234, '')).toBe(Math.floor(1234 / 100));
  });
  test('hostTo256 is the host formula: the raw Mocha panel is navy 17 and the text tone 189 (seen live); stable palette colours agree with hexTo256', () => {
    expect([hostTo256('#181825'), hostTo256('#cdd6f4')]).toEqual([17, 189]);
    for (const i of stable256Indices()) expect([i, hexTo256(xtermHex(i)), hostTo256(xtermHex(i))]).toEqual([i, i, i]);
    expect(stable256Indices().length).toBeGreaterThan(60);
  });
  test('spinner: ◐◓◑◒ one frame per 100 ms, |/-\\ in ASCII, any integer frame', () => {
    expect([0, 1, 2, 3, 4].map((f) => spinnerGlyph(f))).toEqual(['◐', '◓', '◑', '◒', '◐']);
    expect([0, 1, 2, 3].map((f) => spinnerGlyph(f, true)).join('')).toBe('|/-\\');
    expect(spinnerGlyph(-1)).toBe('◒');
    expect(spinnerFrame(0)).toBe('◐');
    expect(spinnerFrame(99)).toBe('◐');
    expect(spinnerFrame(100)).toBe('◓');
    expect(spinnerFrame(350, true)).toBe('\\');
  });
  test('eased gauge: ease-out cubic over 160 ms, six frames, ends on the target', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    near(easeOutCubic(0.5), 0.875);
    near(easedValue(0.2, 0.6, 0), 0.2);
    near(easedValue(0.2, 0.6, 160), 0.6);
    near(easedValue(0.2, 0.6, 999), 0.6);
    const f = easedFrames(3 / 7, 4 / 7);
    expect(f).toHaveLength(6);
    near(f[5]!, 4 / 7);
    for (let i = 1; i < f.length; i++) expect(f[i]!).toBeGreaterThan(f[i - 1]!);
    near(f[0]!, 3 / 7 + (1 / 7) * (1 - (5 / 6) ** 3));
  });
});

describe('ASCII mode', () => {
  test('every primitive prints plain ASCII, no fills and no colour-only meaning', () => {
    const rows = [
      capsule(ascii), ribbon(60, 'BOARD', '7 items', ascii), rail(['plan', 'build'], 1, ascii), gauge(10, 0.4, ascii),
      [chip('done', 'ok', ascii)], ...UI_STATES.map((s) => [stateRun(s, ascii)]), countRuns('running', 2, ascii),
    ];
    for (const r of rows) expect(runsString(r)).toMatch(/^[\x20-\x7e]*$/);
    expect(sparkline(world.spark.values, 180, true)).toMatch(/^[\x20-\x7e]*$/);
    for (const f of [0, 1, 2, 3]) expect(spinnerGlyph(f, true)).toMatch(/^[\x20-\x7e]$/);
    expect(rows.every((r) => r.every((x) => x.bg === undefined))).toBe(true);
  });
  test('ATLAS_GLYPHS lists every non-ASCII character the Unicode primitives emit', () => {
    const rows = [
      capsule(mocha), ribbon(60, 'BOARD', '7 items', mocha), rail(['plan', 'build', 'ship'], 1, mocha), gauge(10, 0.43, mocha), gauge(9, 0.5, mocha),
      ...UI_STATES.map((s) => [stateRun(s, mocha)]), ...[0, 1, 2, 3].map((f) => [stateRun('running', mocha, f)]),
    ];
    const all = rows.map(runsString).join('') + sparkline(world.spark.values, 180) + '▉▊▋▌▍▎▏';
    for (const ch of new Set([...all])) if (ch.charCodeAt(0) > 0x7e) expect([ch, ATLAS_GLYPHS.includes(ch)]).toEqual([ch, true]);
  });
});

import { gridRow as gridRowStrike } from './atlas-ui';
test('live 6b7f637d: a struck name column strikes the name, never the padding spaces that follow it (critique 13)', () => {
  const runs = gridRowStrike({ cols: 40, ui: { ascii: false }, name: { t: 'T2 read', tone: 'sub', strike: true }, nameW: 12 });
  const struck = runs.filter((x) => x.strike);
  expect(struck.map((x) => x.t)).toEqual(['T2 read']);
  expect(runs.map((x) => x.t).join('')).toContain('T2 read     '); // the column still pads to its width
});
