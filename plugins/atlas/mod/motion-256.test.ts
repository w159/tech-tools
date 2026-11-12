// State-change motion and surface colour on 256-colour terminals (tmux without COLORTERM): the ease is a staircase of palette colours that
// both downsamplers (Atlas's and the host's) map to the same distinct indices, the done pop never reuses another state's glyph, and the
// panel fill is the neutral grey of the host's tone family (the raw hex reached the terminal as navy 17).
import { describe, expect, test } from 'claude-code/testing';
import { contrast, emittedPairs, fitHex, hexTo256, hostTo256, luminance, PALETTES, runsString, STATE_ASCII, STATE_GLYPHS, STATE_TOKEN, surfaceHex, UI_STATES, xtermHex, type Run, type ThemeName, type Token, type Ui } from './atlas-ui';
import { animateRow, deltaE, easeSteps256, MAX_STEPS_256, MIN_STEPS_256, MIN_STEP_DE, MIN_STEP_DL, STRONG_STEP_DE, Motion, MOTION_MS, POP_ASCII, POP_UNICODE } from './motion';

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
          expect(steps.length).toBeLessThanOrEqual(MAX_STEPS_256);
          const target = fitHex(p[rest], theme);
          // C2: neighbours differ visibly (not 194, 193, 187): at least MIN_STEP_DE apart, the last step too from the resting tone.
          const seq = [...steps, target];
          for (let i = 1; i < seq.length; i++) expect([theme, state, rest, i, deltaE(seq[i - 1]!, seq[i]!) >= MIN_STEP_DE]).toEqual([theme, state, rest, i, true]);
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
    expect(eased).toBeGreaterThanOrEqual(27); // 30 before critique 16 A2 (blocked took the red tone, whose ladder eases fewer pairs); 40 before critique 12: pairs whose only mid-steps read as the body tone now keep their resting tone instead
    // Critique 12: no step is the body tone (189 on Mocha): a `returned` glyph and word at that step looked uncoloured beside the rows at rest.
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      for (const state of UI_STATES) for (const rest of RESTS) for (const c of easeSteps256(p[STATE_TOKEN[state]], p[rest], theme)) expect([theme, state, rest, deltaE(c, fitHex(p.text, theme)) >= MIN_STEP_DE]).toEqual([theme, state, rest, true]);
    }
    // The tones the surfaces actually fade a done row to keep a staircase on Mocha; a pair with no two palette colours MIN_STEP_DE and
    // MIN_STEP_DL apart keeps its resting tone and only the glyph pops (Mocha body text, most of Latte).
    for (const rest of ['sub', 'muted', 'ok'] as const) expect([rest, easeSteps256(PALETTES.mocha.ok, PALETTES.mocha[rest], 'mocha').length >= MIN_STEPS_256]).toEqual([rest, true]);
    expect(skipped.filter((k) => k.startsWith('mocha/') && !k.endsWith('/text')).length).toBeLessThanOrEqual(30);
    expect(easeSteps256(PALETTES.mocha[STATE_TOKEN.done], PALETTES.mocha.sub, 'mocha').length).toBeGreaterThanOrEqual(2);
  });

  test('a done row in 256 colours: the title and detail pass through at least 3 distinct indices, the same on both downsamplers, and settle on rest', () => {
    const ui: Ui = { theme: 'mocha', ascii: false, color: '256' };
    const m = new Motion(true);
    m.observe('todo', [{ key: 'todo:a', state: 'running' }], 0);
    m.observe('todo', [{ key: 'todo:a', state: 'done' }], 1000);
    const resting: Run[] = [{ t: '●', tone: 'ok' }, { t: ' ', tone: 'text' }, { t: 'wire the gate', tone: 'sub', strike: true }, { t: 'tests green', tone: 'muted' }];
    for (const word of ['wire the gate', 'tests green']) {
      const seen: string[] = [];
      let boldOff = false;
      for (let dt = 0; dt < MOTION_MS; dt += 50) {
        const run = animateRow(resting, 'todo:a', 'done', m.ctx(1000 + dt), ui, { pop: false, reveal: false }).find((r) => r.t === word)!;
        const fg = run.fg;
        expect(fg).toBeDefined(); // critique 16: every beat of the window is a step; the last one is the resting tone held bold (never a bold that arrives late)
        if (!run.bold) boldOff = true;
        expect(boldOff && run.bold === true).toBe(false); // bold only falls
        expect([fg, idx(fg!)]).toEqual([fg, hostTo256(fg!)]);
        if (seen.at(-1) !== fg) seen.push(fg!);
      }
      expect(new Set(seen.map(idx)).size).toBeGreaterThanOrEqual(MIN_STEPS_256);
      expect(seen.length).toBe(new Set(seen).size); // a staircase: no step comes back
    }
    expect(animateRow(resting, 'todo:a', 'done', m.ctx(1000 + MOTION_MS), ui)).toBe(resting);
  });

  test('a tone with no room for the staircase keeps its resting colour (Latte running: no two palette colours MIN_STEP_DE apart)', () => {
    const ui: Ui = { theme: 'latte', ascii: false, color: '256' };
    const m = new Motion(true);
    m.observe('todo', [{ key: 'todo:a', state: 'queued' }], 0);
    m.observe('todo', [{ key: 'todo:a', state: 'running' }], 1000);
    const text: Run[] = [{ t: '◐', tone: 'text' }, { t: ' wire', tone: 'text' }];
    const f = animateRow(text, 'todo:a', 'running', m.ctx(1100), ui);
    expect(f.some((r) => r.fg !== undefined)).toBe(false);
  });
  test('a done row in Latte 256 colours pops the dotted ring (its staircase, if the palette has room for one, keeps every step visible)', () => {
    const ui: Ui = { theme: 'latte', ascii: false, color: '256' };
    const st = easeSteps256(PALETTES.latte.ok, PALETTES.latte.text, 'latte');
    expect(st.length === 0 || st.length >= MIN_STEPS_256).toBe(true);
    const m = new Motion(true);
    m.observe('todo', [{ key: 'todo:a', state: 'running' }], 0);
    m.observe('todo', [{ key: 'todo:a', state: 'done' }], 1000);
    const f = animateRow([{ t: '●', tone: 'text' }, { t: ' wire', tone: 'text' }], 'todo:a', 'done', m.ctx(1000), ui);
    expect(runsString(f)[0]).toBe(POP_UNICODE[0]);
  });
});

describe('256-colour ease: every step is visible on the panel (critique 8)', () => {
  const L = (hex: string): number => { const lin = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); const y = 0.2126729 * lin[0]! + 0.7151522 * lin[1]! + 0.072175 * lin[2]!; return 116 * (y > 216 / 24389 ? Math.cbrt(y) : (24389 / 27 * y + 16) / 116) - 16; };
  test('the first step already differs from the body tone, and neighbours differ in colour and in lightness', () => {
    for (const theme of THEMES) {
      const p = PALETTES[theme];
      for (const state of UI_STATES) for (const rest of RESTS) {
        const steps = easeSteps256(p[STATE_TOKEN[state]], p[rest], theme);
        if (!steps.length) continue;
        expect([theme, state, rest, deltaE(fitHex(p.text, theme), steps[0]!) >= MIN_STEP_DE]).toEqual([theme, state, rest, true]); // frame 0 is not the colour the row wore
        for (let i = 1; i < steps.length; i++) expect([theme, state, rest, i, deltaE(steps[i]!, steps[i - 1]!) >= STRONG_STEP_DE || Math.abs(L(steps[i]!) - L(steps[i - 1]!)) >= MIN_STEP_DL - 1e-9]).toEqual([theme, state, rest, i, true]);
      }
    }
  });
  test('the done glyph and title ramps are the ones the critique asked for: no 194/193 pastel pair, no 193 to 187 hue-only step', () => {
    const ramp = (rest: 'ok' | 'sub'): number[] => easeSteps256(PALETTES.mocha.ok, PALETTES.mocha[rest], 'mocha').map(idx);
    expect(ramp('ok')).toEqual([194, 151]); // the glyph: pale green, then mid green, then its resting 114 (the brief's exact ok index; white is within a step of the body tone 252)
    for (const rest of ['ok', 'sub'] as const) { const r = ramp(rest); expect(r.includes(194) && r.includes(193)).toBe(false); expect(r.includes(193) && r.includes(187)).toBe(false); }
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
