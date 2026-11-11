// State-change motion and surface colour on 256-colour terminals (tmux without COLORTERM): the ease is a staircase of palette colours that
// both downsamplers (Atlas's and the host's) map to the same distinct indices, the done pop never reuses another state's glyph, and the
// panel fill is the neutral grey of the host's tone family (the raw hex reached the terminal as navy 17).
import { describe, expect, test } from 'claude-code/testing';
import { contrast, emittedPairs, fitHex, hexTo256, hostTo256, luminance, PALETTES, runsString, STATE_ASCII, STATE_GLYPHS, STATE_TOKEN, surfaceHex, UI_STATES, xtermHex, type Run, type ThemeName, type Token, type Ui } from './atlas-ui';
import { animateRow, easeSteps256, MIN_STEPS_256, Motion, MOTION_MS, POP_ASCII, POP_UNICODE } from './motion';

const RESTS: readonly Token[] = ['text', 'sub', 'muted', 'line', 'ok', 'run', 'warn', 'bad', 'info', 'accent'];
const THEMES: readonly ThemeName[] = ['mocha', 'latte'];
const idx = (hex: string): number => hexTo256(hex);

describe('256-colour ease', () => {
  test('every state tone against every resting tone: at least 3 distinct palette steps, lightness monotone toward rest, or no ease at all', () => {
    let eased = 0;
    const skipped: string[] = [];
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      const bg = surfaceHex('panel', { theme, color: '256' });
      for (const state of UI_STATES) {
        for (const rest of RESTS) {
          const steps = easeSteps256(p[STATE_TOKEN[state]], p[rest], theme);
          if (steps.length === 0) { skipped.push(`${theme}/${state}/${rest}`); continue; }
          eased++;
          expect(steps.length).toBeGreaterThanOrEqual(MIN_STEPS_256);
          const target = fitHex(p[rest], theme);
          const dir = Math.sign(luminance(target) - luminance(steps[0]!));
          expect(dir).not.toBe(0);
          const chain = [...steps, target];
          for (let i = 1; i < chain.length; i++) expect(Math.sign(luminance(chain[i]!) - luminance(chain[i - 1]!))).toBe(dir); // monotone toward rest
          expect(new Set(chain.map(idx)).size).toBe(chain.length); // distinct palette indices
          for (const c of steps) {
            expect([c, idx(c)]).toEqual([c, hostTo256(c)]); // Atlas and the host land on the same index
            expect(contrast(c, bg)).toBeGreaterThanOrEqual(Math.min(4.5, contrast(p[rest], p.panel)) - 1e-9);
          }
        }
      }
    }
    expect(eased).toBeGreaterThanOrEqual(110);
    expect(skipped.every((k) => k.startsWith('mocha/') && k.endsWith('/text'))).toBe(true); // only the near-white body text has no room above it
  });

  test('a done row in 256 colours: the title and detail pass through at least 3 distinct indices, the same on both downsamplers, and settle on rest', () => {
    const ui: Ui = { theme: 'mocha', ascii: false, color: '256' };
    const m = new Motion(true);
    m.observe('todo', [{ key: 'todo:a', state: 'running' }], 0);
    m.observe('todo', [{ key: 'todo:a', state: 'done' }], 1000);
    const resting: Run[] = [{ t: '●', tone: 'ok' }, { t: ' ', tone: 'text' }, { t: 'wire the gate', tone: 'sub', strike: true }, { t: 'tests green', tone: 'muted' }];
    for (const word of ['wire the gate', 'tests green']) {
      const seen: string[] = [];
      for (let dt = 0; dt < MOTION_MS; dt += 50) {
        const fg = animateRow(resting, 'todo:a', 'done', m.ctx(1000 + dt), ui, { pop: false, reveal: false }).find((r) => r.t === word)!.fg;
        expect(fg).toBeDefined();
        expect([fg, idx(fg!)]).toEqual([fg, hostTo256(fg!)]);
        if (seen.at(-1) !== fg) seen.push(fg!);
      }
      expect(new Set(seen.map(idx)).size).toBeGreaterThanOrEqual(MIN_STEPS_256);
      expect(seen.length).toBe(new Set(seen).size); // a staircase: no step comes back
    }
    expect(animateRow(resting, 'todo:a', 'done', m.ctx(1000 + MOTION_MS), ui)).toBe(resting);
  });

  test('a tone with no room for the staircase keeps its resting colour and only the glyph pops', () => {
    const ui: Ui = { theme: 'mocha', ascii: false, color: '256' };
    const m = new Motion(true);
    m.observe('todo', [{ key: 'todo:a', state: 'running' }], 0);
    m.observe('todo', [{ key: 'todo:a', state: 'done' }], 1000);
    const text: Run[] = [{ t: '●', tone: 'text' }, { t: ' wire', tone: 'text' }];
    const f = animateRow(text, 'todo:a', 'done', m.ctx(1100), ui);
    expect(f.some((r) => r.fg !== undefined)).toBe(false);
    expect(runsString(f)[0]).toBe(POP_UNICODE[0]);
  });
});

describe('done pop glyphs', () => {
  test('C2: the pop glyph is never the middle dot, the host\'s own separator, in Unicode or ASCII', () => {
    for (const g of [...POP_UNICODE, ...POP_ASCII]) expect([g, ['·', '.', '-'].includes(g)]).toEqual([g, false]);
  });
  const other = (own: string, table: Record<string, string>): string[] => Object.entries(table).filter(([s]) => s !== own).map(([, g]) => g);
  test('no pop frame reuses a glyph that means another state, the spinner, the focus mark or the capsule', () => {
    const owned = [...other('done', STATE_GLYPHS), ...other('done', STATE_ASCII), '◐', '◓', '◑', '◒', '|', '/', '-', '\\', '▸', '>', '◆', '◖', '◗'];
    for (const g of [...POP_UNICODE, ...POP_ASCII]) expect([g, owned.includes(g)]).toEqual([g, false]);
  });
  test('across the whole window the glyph cell is the dot or the disc only', () => {
    for (const ascii of [false, true]) {
      const ui: Ui = { theme: 'mocha', ascii, color: 'truecolor' };
      const disc = ascii ? STATE_ASCII.done : STATE_GLYPHS.done;
      const m = new Motion(true);
      m.observe('todo', [{ key: 'todo:a', state: 'running' }], 0);
      m.observe('todo', [{ key: 'todo:a', state: 'done' }], 1000);
      for (let dt = 0; dt <= MOTION_MS; dt += 25) {
        const g = runsString(animateRow([{ t: disc, tone: 'ok' }, { t: ' wire the gate', tone: 'sub' }], 'todo:a', 'done', m.ctx(1000 + dt), ui)).slice(0, 1);
        expect([dt, [...POP_UNICODE, ...POP_ASCII, disc].includes(g)]).toEqual([dt, true]);
      }
    }
  });
});

describe('host-matched surface in 256 colours', () => {
  test('the Mocha panel is the neutral near-black grey both downsamplers agree on, not the navy 17 the raw hex becomes on the host', () => {
    expect(hostTo256(PALETTES.mocha.panel)).toBe(17); // the evidence: what the host made of the raw hex
    const fill = surfaceHex('panel', { theme: 'mocha', color: '256' });
    expect([hexTo256(fill), hostTo256(fill)]).toEqual([234, 234]);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
    expect([r === g, g === b]).toEqual([true, true]);
  });
  test('Latte stays light; truecolor keeps the palette hex', () => {
    expect(luminance(surfaceHex('panel', { theme: 'latte', color: '256' }))).toBeGreaterThan(0.5);
    expect(surfaceHex('panel', { theme: 'mocha', color: 'truecolor' })).toBe(PALETTES.mocha.panel);
    expect(xtermHex(234)).toBe('#1c1c1c');
  });
  test('every text and glyph pair the primitives emit keeps its WCAG ratio in 256 colours, in both themes', () => {
    for (const theme of THEMES) for (const x of emittedPairs(theme, '256')) expect([theme, x.what, x.ratio >= x.need]).toEqual([theme, x.what, true]);
  });
});
