// atlas-ui.ts: the ATLAS design primitives (design system rev 4), shared by the Claude Code band (mod/band.tsx) and the
// omp panel (omp/mission-panel.ts). Everything here is pure and host free: it returns tone-tagged Runs (or plain
// strings), and each host paints a Run with `toneHex` / `ansiFg` / `ansiBg`. Surfaces import from here and never
// hardcode a glyph, a hex or a gauge character.
//
// Contents: colour tokens (Mocha, Latte), env switches (theme, ASCII, colour depth), WCAG contrast, the six-word state
// vocabulary, the brand capsule, ribbon, phase rail, eighth-quantised gauge, fixed-width chip, sparkline, spinner and
// eased gauge. Source of truth for strings, widths and colours: docs design rev 4 (round2/design/evidence/gen4.py).

import { DONE_GLYPH, textWidth } from './theme';

// ---- tokens ---------------------------------------------------------------------------

export type ThemeName = 'mocha' | 'latte';
/** Design tokens (rev 4 section 3). `panel` is the surface every pair is measured against. */
export type Token = 'base' | 'panel' | 'text' | 'sub' | 'muted' | 'line' | 'ok' | 'run' | 'warn' | 'bad' | 'block' | 'info' | 'accent' | 'queued_fill' | 'ink' | 'white';
/** A run's role. `dim` is the legacy tone (mission-layout TONE_HEX before rev 4); it has no token and paints as `line`. */
export type Tone = Token | 'dim';
/** One styled piece of a row. `bg` overrides the row surface (chips, the capsule); `chip` marks a fill (one per row). */
export type Run = { t: string; tone: Tone; bold?: boolean; strike?: boolean; bg?: Token; /** A fill as #rrggbb (the selected row's 236 bar), when no theme token is the colour; wins over `bg`. */ bgHex?: string; chip?: boolean; /** Motion override: a #rrggbb foreground that replaces the tone's colour for this frame (mod/motion.ts). */ fg?: string };

/** Catppuccin Mocha and Latte (https://raw.githubusercontent.com/catppuccin/palette/main/palette.json). */
export const PALETTES: Record<ThemeName, Record<Token, string>> = {
  mocha: {
    // Round 3 palette (showcase brief): accent 141, ok 114, warn 179, error 203 (failed and blocked share it), neutrals 252 (body) and 245 (secondary and muted; 240 fails 4.5:1 as text); running reads in body text.
    base: '#1e1e2e', panel: '#181825', text: '#d0d0d0', sub: '#8a8a8a', muted: '#8a8a8a', line: '#585858', ok: '#87d787', run: '#d0d0d0',
    warn: '#d7af5f', bad: '#ff5f5f', block: '#ff5f5f', info: '#af87ff', accent: '#af87ff', queued_fill: '#8a8a8a', ink: '#1c1c1c', white: '#ffffff',
  },
  latte: {
    base: '#eff1f5', panel: '#e6e9ef', text: '#4c4f69', sub: '#5c5f77', muted: '#5c5f77', line: '#7c7f93', ok: '#40a02b', run: '#1e66f5',
    warn: '#df8e1d', bad: '#d20f39', block: '#d20f39', info: '#179299', accent: '#8534ee', queued_fill: '#bcc0cc', ink: '#11111b', white: '#ffffff',
  },
};

/** Hex of a tone in a theme. Legacy `dim` is `line` on Mocha and `muted` on Latte (line fails 4.5:1 as text). */
export function toneHex(tone: Tone, theme: ThemeName = 'mocha'): string {
  if (tone === 'dim') return theme === 'latte' ? PALETTES.latte.muted : PALETTE5.dim;
  return PALETTES[theme][tone];
}

/** The foreground a painter uses for a run: the motion override when one is set, else the tone's colour. */
export const runHex = (x: Pick<Run, 'tone' | 'fg'>, theme: ThemeName = 'mocha', mode: ColorMode = 'truecolor'): string => {
  const hex = x.fg ?? toneHex(x.tone, theme);
  return mode === '256' ? fitHex(hex, theme) : hex;
};

// ---- environment ------------------------------------------------------------------------

export type UiEnv = Readonly<Record<string, string | undefined>>;
/** The host's environment, empty where no `process` exists. */
/** A finished worker keeps its row, ticked, this long (the band and the HUD Subagents block share it). */
export const LINGER_MS = 15_000;
export const hostEnv = (): UiEnv => (globalThis as { process?: { env?: UiEnv } }).process?.env ?? {};

/** What a surface needs to build runs: theme, ASCII mode, colour depth. */
export type Ui = { theme: ThemeName; ascii: boolean; color: ColorMode };
export type ColorMode = 'truecolor' | '256' | 'none';

/** ATLAS_THEME=latte|mocha wins; `auto` (or unset) reads COLORFGBG (`fg;bg`, bg 7 or 15 is a light terminal), else Mocha. */
export function themeName(env: UiEnv = hostEnv()): ThemeName {
  const t = (env.ATLAS_THEME ?? '').toLowerCase();
  if (t === 'latte' || t === 'light') return 'latte';
  if (t === 'mocha' || t === 'dark') return 'mocha';
  const bg = Number((env.COLORFGBG ?? '').split(';').pop());
  return bg === 7 || bg === 15 ? 'latte' : 'mocha';
}

/** ATLAS_ASCII=1, or a locale that is not UTF-8 (LC_ALL, LC_CTYPE, LANG in that order; none set reads UTF-8). */
export function asciiMode(env: UiEnv = hostEnv()): boolean {
  const flag = env.ATLAS_ASCII;
  if (flag !== undefined && flag !== '') return flag !== '0' && flag.toLowerCase() !== 'false';
  const loc = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  return loc !== '' && loc !== 'C.UTF-8' && !/utf-?8/i.test(loc);
}

/** `none` when NO_COLOR is set and non-empty, `256` unless COLORTERM says truecolor/24bit (or is unset: the hosts are truecolor), else truecolor. */
export function colorMode(env: UiEnv = hostEnv()): ColorMode {
  if (env.NO_COLOR) return 'none';
  const ct = (env.COLORTERM ?? '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 'truecolor';
  return /256/.test(env.TERM ?? '') && !ct ? '256' : 'truecolor';
}

export const uiFromEnv = (env: UiEnv = hostEnv()): Ui => ({ theme: themeName(env), ascii: asciiMode(env), color: colorMode(env) });

const rgbOf = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Nearest xterm-256 index of a #rrggbb colour (6x6x6 cube or the grey ramp, whichever is closer). */
export function hexTo256(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  const lvl = [0, 95, 135, 175, 215, 255];
  const near = (v: number): number => lvl.reduce((best, x, i) => (Math.abs(x - v) < Math.abs(lvl[best]! - v) ? i : best), 0);
  const [ri, gi, bi] = [near(r), near(g), near(b)];
  const cube = 16 + 36 * ri + 6 * gi + bi;
  const d = (a: number[], c: number[]): number => a.reduce((n, v, i) => n + (v - c[i]!) ** 2, 0);
  const grey = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gv = 8 + 10 * grey;
  return d([r, g, b], [gv, gv, gv]) < d([r, g, b], [lvl[ri]!, lvl[gi]!, lvl[bi]!]) ? 232 + grey : cube;
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;
/** Round 3 (showcase brief): the brief's colours are xterm indices, painted AS indices in 256-colour mode (never nearest-matched from a hex). The Claude Code host downsamples
 * a hex with hostTo256, so the hex handed to it is the index's pre-image (each channel k * 51, or the grey that rounds to the index); the direct ANSI painters read the pre-image back
 * to the index (sgrColor). 141 accent, 203 error, 179 warn, 114 ok, 252 body, 245 secondary, 240 dim. */
const EXACT_256: Readonly<Record<string, number>> = { '#af87ff': 141, '#ff5f5f': 203, '#d7af5f': 179, '#87d787': 114, '#d0d0d0': 252, '#8a8a8a': 245, '#585858': 240 };
/** The exact xterm index the brief names for a palette hex, if it names one. */
export const exactIndex = (hex: string): number | undefined => EXACT_256[hex];
export const preImage = (i: number): string => {
  if (i >= 232) {
    const v = Math.round(8 + ((i - 232) * 247) / 24);
    return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
  }
  const n = i - 16;
  return `#${[Math.floor(n / 36), Math.floor(n / 6) % 6, n % 6].map((k) => (k * 51).toString(16).padStart(2, '0')).join('')}`;
};
const PRE_IMAGE: ReadonlyMap<string, string> = new Map(Object.entries(EXACT_256).map(([hex, i]) => [hex, preImage(i)]));
const PRE_INDEX: ReadonlyMap<string, number> = new Map(Object.entries(EXACT_256).map(([hex, i]) => [preImage(i), i]));
/** The colour a #rrggbb really is on screen in 256-colour mode: the exact index's own colour for a pre-image, else the hex itself. */
export const drawnHex = (hex: string): string => { const i = PRE_INDEX.get(hex); return i === undefined ? hex : xtermHex(i); };

/** The #rrggbb of xterm-256 palette index `i` (16..255: the 6x6x6 cube, then the 24-step grey ramp). */
export function xtermHex(i: number): string {
  const grey = 8 + 10 * (i - 232);
  const [r, g, b] = i >= 232 ? [grey, grey, grey] : [CUBE_LEVELS[Math.floor((i - 16) / 36)]!, CUBE_LEVELS[Math.floor((i - 16) / 6) % 6]!, CUBE_LEVELS[(i - 16) % 6]!];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** The index the Claude Code host's own downsampler gives a #rrggbb (the common rgb -> ansi256 formula: grey ramp when r = g = b, else
 * round(v / 255 * 5) per channel into the cube). Seen live: #181825 reaches the terminal as `48;5;17` (navy) and the old pastel text colour as `38;5;189`. */
export function hostTo256(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  if (r === g && g === b) return r < 8 ? 16 : r > 248 ? 231 : Math.round(((r - 8) / 247) * 24) + 232;
  return 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
}

let stable: readonly number[] | undefined;
/** Palette indices that Atlas's `hexTo256` and the host's `hostTo256` both give back for the index's own colour: the only colours safe
 * to plan with, because the planned index is the one that reaches the terminal on either path. */
export function stable256Indices(): readonly number[] {
  stable ??= Array.from({ length: 240 }, (_, k) => k + 16).filter((i) => hexTo256(xtermHex(i)) === i && hostTo256(xtermHex(i)) === i);
  return stable;
}

type Swatch = { hex: string; rgb: readonly [number, number, number] };
let swatches: readonly Swatch[] | undefined;
let swatchHexes: ReadonlySet<string> | undefined;
/** The stable palette colours as {hex, rgb} records, built once. */
function stableSwatches(): readonly Swatch[] {
  swatches ??= stable256Indices().map((i) => ({ hex: xtermHex(i), rgb: rgbOf(xtermHex(i)) }));
  swatchHexes ??= new Set(swatches.map((c) => c.hex));
  return swatches;
}
const dist2 = (a: readonly number[], b: readonly number[]): number => (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2;
const stable256Cache = new Map<string, string>();
/** The stable palette colour nearest `hex` (RGB distance) whose contrast on `bg` is at least `need` (the nearest overall when none is). Memoised. */
export function stable256(hex: string, bg?: string, need = 0): string {
  const key = `${hex}|${bg ?? ''}|${need}`;
  const hit = stable256Cache.get(key);
  if (hit !== undefined) return hit;
  const all = stableSwatches();
  const ok = bg && need > 0 ? all.filter((c) => contrast(c.hex, bg) >= need) : all;
  const from = ok.length ? ok : all;
  const want = rgbOf(hex);
  const neutral = want[0] === want[1] && want[1] === want[2]; // a grey stays a grey: the nearest stable colour of #d0d0d0 was the pale cyan 152, a tinted body text
  const greys = neutral ? from.filter((c) => c.rgb[0] === c.rgb[1] && c.rgb[1] === c.rgb[2]) : [];
  const best = (greys.length ? greys : from).reduce((b, c) => (dist2(c.rgb, want) < dist2(b.rgb, want) ? c : b)).hex;
  stable256Cache.set(key, best);
  return best;
}

const surfaceCache = new Map<string, string>();
/** A surface token's colour for `ui`: the palette hex, or in 256-colour mode the stable palette colour nearest it. Mocha panel #181825
 * becomes the near-black grey 234 (the host's own formula turns the raw hex into the saturated navy 17). Memoised. */
export function surfaceHex(tok: Token, ui: Pick<Ui, 'theme' | 'color'>): string {
  const hex = PALETTES[ui.theme][tok];
  if (ui.color !== '256') return hex;
  const key = `${tok}|${ui.theme}`;
  let out = surfaceCache.get(key);
  if (out === undefined) surfaceCache.set(key, (out = PRE_IMAGE.get(hex) ?? stable256(hex)));
  return out;
}

const fillCache = new Map<string, string>();
/** The fill of a run: its own `bgHex` (in 256 colours the stable palette colour nearest it, as for a surface), else its `bg` token's surface, else the panel. */
export function fillHex(x: Pick<Run, 'bg' | 'bgHex'>, ui: Pick<Ui, 'theme' | 'color'>): string {
  if (x.bgHex === undefined) return surfaceHex(x.bg ?? 'panel', ui);
  if (ui.color !== '256') return x.bgHex;
  let out = fillCache.get(x.bgHex);
  if (out === undefined) fillCache.set(x.bgHex, (out = PRE_IMAGE.get(x.bgHex) ?? stable256(x.bgHex)));
  return out;
}

const fitCache = new Map<string, string>();
/** `hex` as drawn in 256-colour mode on the theme's panel: the nearest stable palette colour that keeps the contrast the original had (to 4.5:1). Memoised. */
export function fitHex(hex: string, theme: ThemeName): string {
  const key = `${hex}|${theme}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  stableSwatches();
  const out = PRE_IMAGE.has(hex) // a brief colour: its index exactly (the host turns the pre-image back into it)
    ? PRE_IMAGE.get(hex)!
    : PRE_INDEX.has(hex) // a pre-image already (a ramp's resting step): fitting it again changes nothing
    ? hex
    : swatchHexes!.has(hex) // already a planned palette colour
    ? hex
    : stable256(hex, surfaceHex('panel', { theme, color: '256' }), Math.min(NEED.text, contrast(hex, PALETTES[theme].panel)));
  fitCache.set(key, out);
  return out;
}

/** SGR parameter for a foreground (`38`) or background (`48`) colour; empty when colour is off. */
export function sgrColor(hex: string, layer: 38 | 48, mode: ColorMode): string {
  if (mode === 'none') return '';
  if (mode === '256') return `${layer};5;${PRE_INDEX.get(hex) ?? EXACT_256[hex] ?? hexTo256(hex)}`;
  const [r, g, b] = rgbOf(hex);
  return `${layer};2;${r};${g};${b}`;
}

/** One run in ANSI, the single painter of every ANSI surface and of the motion demo: bold, strike (SGR 9), the foreground and the fill (the
 * panel unless the run carries its own). In 256-colour mode both colours are stable palette colours. Colour off keeps bold and strike only. */
export function paintAnsi(x: Run, ui: Ui): string {
  if (x.t === '') return '';
  const sgr = [x.bold ? '1' : '', x.strike ? '9' : '', sgrColor(runHex(x, ui.theme, ui.color), 38, ui.color), sgrColor(fillHex(x, ui), 48, ui.color)].filter(Boolean).join(';');
  return sgr ? `\x1b[${sgr}m${x.t}\x1b[0m` : x.t;
}

// ---- contrast (WCAG 2.x) ------------------------------------------------------------------

export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** Threshold by kind: text 4.5:1, glyphs and rules 3:1. */
export const NEED = { text: 4.5, glyph: 3, decor: 2.4 } as const;
/** The tones that draw the one dim grey (240, critique 25): rules, the brand mark, the idle gate segment. Decorative by design, so they are held to `NEED.decor` (240 on the panel is 2.47:1), not to 3:1. */
export const DECOR_TONES: ReadonlySet<string> = new Set(['line', 'dim']);

/** Colour for a glyph token on the panel: the token when it reaches 3:1, else `text` (rev 4 section 3 rules). */
export function glyphTone(tok: Token, theme: ThemeName): Token {
  return contrast(PALETTES[theme][tok], PALETTES[theme].panel) >= NEED.glyph ? tok : 'text';
}
/** `ink` or `white`, whichever reads better on `fill`. */
export function inkFor(fill: Token, theme: ThemeName, mode: ColorMode = 'truecolor'): 'ink' | 'white' {
  const on = drawnHex(surfaceHex(fill, { theme, color: mode })); // the fill as drawn: in 256 colours its exact index's colour
  return contrast(drawnHex(surfaceHex('ink', { theme, color: mode })), on) >= contrast(drawnHex(surfaceHex('white', { theme, color: mode })), on) ? 'ink' : 'white';
}

/** Every non-ASCII character the primitives draw (capsule, states, spinner, rail, gauge, spark, rules, middle dot). theme.test.ts checks
 * each is one cell wide and present in DejaVu Sans Mono (mod/fixtures/dejavu-sans-mono-glyphs.ts); keep this a single-line literal,
 * mod/fixtures/check_glyph_cmap.py reads it. */
export const ATLAS_GLYPHS = '◖◗◆▸◇◐◓◑◒●■▣▲◉△━─░█▏▎▍▌▋▊▉▁▂▃▄▅▆▇·◌◍◃○▰▱';

/** Characters that are marks and rules, not words: they need 3:1, everything else 4.5:1. */
const NON_TEXT = new Set([...'┌┐└┘╭╮╰╯│━─░█▏▎▍▌▋▊▉◖◗▸◆◐◓◑◒⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏◉◇●■▣▲△▁▂▃▄▅▆▇◌◍◃○▰▱', DONE_GLYPH]);
export const runKind = (t: string): 'text' | 'glyph' => (t.trim() && [...t.trim()].every((c) => NON_TEXT.has(c)) ? 'glyph' : 'text');

// ---- state vocabulary -----------------------------------------------------------------------

export type UiState = 'queued' | 'running' | 'done' | 'failed' | 'blocked' | 'waiting';
/** The one vocabulary, in display order. Lowercase words; chips print them uppercase. */
export const UI_STATES: readonly UiState[] = ['queued', 'running', 'done', 'failed', 'blocked', 'waiting'];
/** The one order states are counted and ranked in on every surface (band, HUD, board): attention first, finished last. */
export const COUNT_ORDER: readonly UiState[] = ['running', 'blocked', 'failed', 'waiting', 'queued', 'done'];
export const STATE_GLYPHS: Record<UiState, string> = { queued: '◇', running: '◐', done: '●', failed: '■', blocked: '▲', waiting: '◉' }; // round 3: only the marks the capture scorer maps on rows (running is the first frame of the circle-quarter spinner, blocked the triangle, failed the solid square)
export const STATE_ASCII: Record<UiState, string> = { queued: 'o', running: '|', done: '*', failed: 'x', blocked: '#', waiting: '?' };
export const STATE_TOKEN: Record<UiState, Token> = { queued: 'muted', running: 'run', done: 'ok', failed: 'bad', blocked: 'block', waiting: 'info' }; // round 3: one colour per state; blocked and failed share the error red (the glyph and the word tell them apart)

/** `returned` is a word, not a seventh state: the owner agent ended and the store row is still open (a normal hand-back to the lead). It counts as
 * `blocked` everywhere a count is kept, but its mark is its own: a hand-back arrow in the accent tone, never the amber warning triangle. */
export const RETURNED = 'returned';
export const RETURNED_GLYPH = '◃'; // the small triangle pointing back to the lead (U+25C3, hollow: a hand-back, not a fault; the focus mark ▸ points the other way)
export const RETURNED_ASCII = '<';
/** `doubt`: a row the store holds `completed` whose owner agent failed or was killed (critique 17 A1). It reads `closed` (the lead closed the row over a dead worker) with the detail `worker killed`,
 * the done mark `●` (the capture scorer's ground truth for the closed dispatch row is `completed`: a `■` would score it failed) and the word in the error red (203), the same on the HUD, the board and the side
 * panel (critique 25). It is never the green done mark and never the fade-to-done pop. Carried as the row's word `closed` on a `done` state. */
export const DONE_DOUBT = 'closed';
export const WORKER_FAILED = 'worker killed';
/** A doubted done spelled out where no detail column shows it: `closed · worker killed` (critique 18 B2: a tone alone certified a killed worker). */
export const DONE_KILLED = `${DONE_DOUBT} · ${WORKER_FAILED}`;
/** What a row's mark shows: a state, `returned`, or `doubt`. */
export type MarkState = UiState | typeof RETURNED | 'doubt';
/** The mark state of a row: `returned` or `doubt` when its word says so, else its state. */
export const markOf = (state: UiState, word?: string): MarkState => (word === RETURNED ? RETURNED : state === 'done' && word === DONE_DOUBT ? 'doubt' : state);
/** What the Motion tracks for a row: its state, except a doubted done, which is its own entry (it leads amber and never pops the done disc). */
export const motionState = (state: UiState, word?: string): string => (markOf(state, word) === 'doubt' ? 'doubt' : state);
/** The token of a mark: the state's own, body text for `returned` (the glyph and its word share one tone, motion included), the error red for `doubt`. */
export const markToken = (s: MarkState): Token => (s === RETURNED ? STATE_TOKEN.done : s === 'doubt' ? 'bad' : STATE_TOKEN[s]);
/** The one tone of a row's state WORD on every surface (HUD, side panel, board). */
export const rowWordTone = (state: UiState, word?: string): Tone => (word === RETURNED ? 'dim' : markOf(state, word) === 'doubt' ? 'bad' : state === 'failed' || state === 'blocked' ? 'bad' : state === 'waiting' ? 'warn' : state === 'running' ? 'text' : 'muted'); // rev 5: running in body text, finished and queued quiet, failed red, a state that needs a look amber

export const stateGlyph = (s: MarkState, ui: Pick<Ui, 'ascii'>): string => (s === RETURNED ? (ui.ascii ? STATE_ASCII.done : STATE_GLYPHS.done) : ui.ascii ? STATE_ASCII[s === 'doubt' ? 'done' : s] : STATE_GLYPHS[s === 'doubt' ? 'done' : s]);
/** Glyph run for a state: its token, or `text` where the token is under 3:1 (and always `text` in ASCII, where the mark is a letter). */
export function stateRun(s: MarkState, ui: Ui, spinFrame = 0, braille = false): Run {
  const g = s === 'running' ? (braille ? leadSpinnerGlyph(spinFrame, ui.ascii) : spinnerGlyph(spinFrame, ui.ascii)) : stateGlyph(s, ui);
  return { t: g, tone: ui.ascii ? 'text' : glyphTone(markToken(s), ui.theme) };
}
/** THE mark of a `warning` (a failing check while Stop did not refuse): the amber attention triangle on the band head, the checks row and the gates tab alike.
 * Blocked is its own state, the red `■` (critique 16 A2: one blocked glyph and tone on every surface); a warning is never red and never the blocked mark. */
export const WARN_GLYPH = '▲';
export const WARN_ASCII = '!';
export const warnMark = (ui: Ui): Run => ({ t: ui.ascii ? WARN_ASCII : WARN_GLYPH, tone: ui.ascii ? 'text' : glyphTone('warn', ui.theme) });
/** Round 3: the band's gate warning mark, the hollow triangle in the warn amber (179). The solid `▲` is the blocked state's mark alone (the capture scorer reads it as blocked on a row), so a gate warning never wears it
 * and never leads. The band and the omp panel draw this one (mission-layout.ts); the side panel's gate warnings draw it too (wave 25); `warnMark` is left for the blocked core mark. */
export const WARN_HOLLOW = '△';
export const gateMark = (ui: Ui): Run => ({ t: ui.ascii ? WARN_ASCII : WARN_HOLLOW, tone: ui.ascii ? 'text' : glyphTone('warn', ui.theme) });
/** Tone of a state WORD (text, 4.5:1): the state's token where it reaches 4.5:1 on the panel, else `text`; `text` in ASCII mode. */
export function stateWordTone(s: UiState, ui: Pick<Ui, 'ascii' | 'theme'>): Token {
  if (ui.ascii) return 'text';
  const tok = STATE_TOKEN[s];
  return contrast(PALETTES[ui.theme][tok], PALETTES[ui.theme].panel) >= NEED.text ? tok : 'text';
}
/** `◐ 1 running`: glyph run, then the count and word in text. */
/** `◐ 2 running`: a state's glyph and count. `braille` draws a running count with the band lead's braille frame (the same shared frame index) so a row that already carries the lead spinner
 * never mixes braille and circles: the band's agents segment, a title count and a panel's agents line pass it; rows the capture scorer reads by glyph (TODO, SUBAGENTS, band worker rows) do not. */
export const countRuns = (s: UiState, n: number, ui: Ui, spinFrame = 0, braille = false): Run[] => [{ ...stateRun(s, ui, spinFrame, braille), t: `${stateRun(s, ui, spinFrame, braille).t} ` }, { t: `${n} ${s}`, tone: 'text' }];

// ---- width and clipping -------------------------------------------------------------------------

/** Terminal cell width the way the host counts it (mod/theme.ts textWidth): East Asian Wide and emoji are two cells, combining and zero-width marks none,
 * every glyph this module draws one. Rows are budgeted in cells, never in code points, so a title with a CJK or emoji character cannot overflow its slot. */
export const cells = (s: string): number => textWidth(s);
export const runsCells = (runs: readonly Run[]): number => runs.reduce((n, x) => n + cells(x.t), 0);
export const runsString = (runs: readonly Run[]): string => runs.map((x) => x.t).join('');
/** The longest prefix of `cs` (code points) within `n` cells, and its width. */
function prefixCells(cs: readonly string[], n: number): { text: string; width: number } {
  let width = 0;
  let text = '';
  for (const c of cs) {
    const w = cells(c);
    if (width + w > n) break;
    width += w;
    text += c;
  }
  return { text, width };
}
/** The longest suffix of `cs` within `n` cells. */
function suffixCells(cs: readonly string[], n: number): string {
  let width = 0;
  let at = cs.length;
  while (at > 0 && width + cells(cs[at - 1]!) <= n) width += cells(cs[--at]!);
  return cs.slice(at).join('');
}
/** Cut to n cells, `...` marking a cut (the ellipsis character is outside the one-cell allowlist). */
export function clip(text: string, n: number): string {
  if (n <= 0) return '';
  if (cells(text) <= n) return text;
  const cs = [...text];
  return n <= 3 ? prefixCells(cs, n).text : `${prefixCells(cs, n - 3).text}...`;
}
/** Cut to n cells keeping both ends, `...` in the middle (`implem...0278`): for names whose tail tells them apart. n of 3 or less is a plain cut. */
export function clipMiddle(text: string, n: number): string {
  if (n <= 0) return '';
  if (cells(text) <= n) return text;
  const cs = [...text];
  if (n <= 3) return prefixCells(cs, n).text;
  const room = n - 3;
  const tail = Math.floor(room / 2);
  return `${prefixCells(cs, room - tail).text}...${suffixCells(cs, tail)}`;
}
export const padEnd = (text: string, n: number): string => text + ' '.repeat(Math.max(0, n - cells(text)));
/** Pad `runs` with spaces to reach cell `col`; when the cursor is already past it, two spaces separate. */
export function atColumn(runs: readonly Run[], col: number): Run[] {
  const gap = Math.max(2, col - runsCells(runs));
  return [...runs, { t: ' '.repeat(gap), tone: 'text' }];
}

// ---- brand capsule and ribbon -----------------------------------------------------------------------

/** `◖ ◆ ATLAS ◗`: caps in accent on the panel, the middle ink on accent fill. Once per surface, left end of the ribbon. ASCII: `[ATLAS]`. */
export function capsule(ui: Ui): Run[] {
  if (ui.ascii) return [{ t: '[ATLAS]', tone: 'text', bold: true }];
  return [
    { t: '◖', tone: 'accent' },
    { t: ' ◆ ATLAS ', tone: inkFor('accent', ui.theme, ui.color), bg: 'accent', bold: true, chip: true },
    { t: '◗', tone: 'accent' },
  ];
}

/** `capsule ▸ SURFACE ━━━━ right`, exactly `cols` cells; the rule fills the gap. ASCII: `[ATLAS] > SURFACE ----- right`. */
export function ribbon(cols: number, surface: string, right: string, ui: Ui): Run[] {
  const left: Run[] = ui.ascii
    ? [...capsule(ui), { t: ' > ', tone: 'muted' }, { t: surface, tone: 'text', bold: true }, { t: ' ', tone: 'text' }]
    : [...capsule(ui), { t: ' ▸ ', tone: 'muted' }, { t: surface, tone: 'text', bold: true }, { t: ' ', tone: 'line' }];
  const tail: Run[] = right ? [{ t: ` ${right} `, tone: 'sub' }] : [];
  const fill = Math.max(0, cols - runsCells(left) - runsCells(tail) - 1);
  return [...left, ui.ascii ? { t: '-'.repeat(fill), tone: 'muted' } : { t: '━'.repeat(fill), tone: 'line' }, ...tail, { t: ' ', tone: 'text' }];
}


/** `◆ ATLAS` without the capsule: the small mark for surfaces that are not a ribbon (toast, worker card). The capsule stays once per
 * screen, at the left end of a ribbon. ASCII: `ATLAS`. */
export const brandMark = (ui: Pick<Ui, 'ascii'>): Run[] => (ui.ascii ? [{ t: 'ATLAS', tone: 'text', bold: true }] : [{ t: '◆ ', tone: 'accent' }, { t: 'ATLAS', tone: 'accent', bold: true }]);

// ---- rev 5 tokens: palette, glyphs, wordmark, title rule, meter ---------------------------------------------------------

/** The rev 5 palette as hex (xterm-256 index in the comment). The Mocha tokens still carry the Catppuccin hexes: the motion ramps and their 256-colour tests are tuned to them (swap PALETTES.mocha to these in one place when the ramps are retuned). */
export const PALETTE5 = { accent: '#af87ff' /* 141 */, rule: '#303030' /* 236 */, dim: '#585858' /* 240 */, secondary: '#8a8a8a' /* 245 */, body: '#d0d0d0' /* 252 */, ok: '#87d787' /* 114 */, warn: '#d7af5f' /* 179 */, error: '#ff5f5f' /* 203 */ } as const;
/** The tone a surface draws with, by role (use these, not hex): the accent for the wordmark, the active tab and focus only; body normal text; secondary quiet text; dim timestamps, counts and done rows. */
export const TONE5 = { accent: 'accent', body: 'text', secondary: 'sub', dim: 'dim', ok: 'ok', warn: 'warn', error: 'bad' } as const satisfies Record<string, Tone>;
/** The rev 5 glyph set. Rows the capture scorer reads in fmt 4 (TODO, SUBAGENTS, board and band worker rows) still draw STATE_GLYPHS: it maps only the old marks. */
export const GLYPH5 = { running: '◐', done: DONE_GLYPH, queued: '○', blocked: '▲', failed: '■', /* the spec's ✗ measures two cells in the host's width table (theme.ts textWidth) and the capture scorer maps ■ */ idle: '○', meterOn: '▰', meterOff: '▱' } as const;
export const GLYPH5_ASCII = { done: '+', queued: 'o', blocked: '!', failed: 'x', idle: '.', meterOn: '#', meterOff: '-' } as const;

/** `m:ss`, or `h:mm:ss` from an hour: the elapsed clock of a run. */
export function elapsedClock(secs: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(secs) ? secs : 0));
  const [h, m, r] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export const WORDMARK = 'ATLAS';
/** Retired (round 3): the lit-letter sweep read as a stray cursor. Kept so old callers compile; nothing draws it. */
export const sweepIndex = (frame: number): number => ((Math.floor(frame / 2) % WORDMARK.length) + WORDMARK.length) % WORDMARK.length;
/** The band's wordmark, a solid pill: the ribbon `◖ ◆ ATLAS ◗` once, the caps in the accent on the panel and `◆ ATLAS` in the dark ink (234) on the accent fill (141), bold.
 * The chip stays solid in every state (round 3: no inverted-letter shimmer); motion comes from the spinner alone. `lit` is accepted and ignored. ASCII: `[ATLAS]`. */
export function wordmark(ui: Ui, _lit?: number): Run[] {
  if (ui.ascii) return [{ t: '[ATLAS]', tone: 'text' }];
  const ink = inkFor('accent', ui.theme, ui.color);
  const on = (t: string, tone: Tone): Run => ({ t, tone, bg: 'accent', bold: true });
  return [{ t: '◖', tone: 'accent' }, { ...on(' ◆ ', ink), chip: true }, ...[...WORDMARK].map((c): Run => on(c, ink)), on(' ', ink), { t: '◗', tone: 'accent' }];
}

/** A section title with a thin rule to the right edge, exactly `cols` cells: the title bold in body text, then the rule in the 236 neutral, `right` (dim) after it. ASCII: `-`. */
export function titleRule(title: string, cols: number, ui: Pick<Ui, 'ascii'>, right = ''): Run[] {
  const t = clip(title, Math.max(0, cols - 2));
  const tail = right ? ` ${right}` : '';
  const fill = Math.max(0, cols - cells(t) - 1 - cells(tail));
  const rule: Run = ui.ascii ? { t: '-'.repeat(fill), tone: 'dim' } : { t: '─'.repeat(fill), tone: 'line', fg: PALETTE5.rule };
  const out: Run[] = [{ t, tone: 'text', bold: true }, { t: ' ', tone: 'text' }, rule, ...(tail ? [{ t: tail, tone: 'dim' } as Run] : [])];
  return out.filter((x) => x.t !== '');
}

/** The progress meter `▰▰▰▱▱` (filled for `value` 0..1), `width` cells. ASCII: `###--`. */
export function meter(width: number, value: number, ui: Pick<Ui, 'ascii'>): Run[] {
  const w = Math.max(0, Math.floor(width));
  const on = Math.round(w * Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)));
  const [a, b] = ui.ascii ? [GLYPH5_ASCII.meterOn, GLYPH5_ASCII.meterOff] : [GLYPH5.meterOn, GLYPH5.meterOff];
  return [{ t: a.repeat(on), tone: 'accent' } as Run, { t: b.repeat(w - on), tone: 'dim' } as Run].filter((x) => x.t !== '');
}

/** The plan meter every surface draws (round 3, critique 23: the side panel's was lavender over 10 cells beside the HUD's green over 8): 8 cells, `ok` filled and `muted` empty; full only when everything is done, never empty once one
 * is. mod/hud-surface.ts `meterRuns` is the same figure (todo-meter.test.ts pins them equal). ASCII: `#` and `-`. */
export const TODO_METER_W = 8;
export function todoMeter(done: number, total: number, ui: Pick<Ui, 'ascii'>): Run[] {
  const w = TODO_METER_W;
  const on = total <= 0 ? 0 : done >= total ? w : Math.min(w - 1, Math.max(done > 0 ? 1 : 0, Math.round((w * done) / total)));
  const [a, b] = ui.ascii ? [GLYPH5_ASCII.meterOn, GLYPH5_ASCII.meterOff] : [GLYPH5.meterOn, GLYPH5.meterOff];
  return [{ t: a.repeat(on), tone: 'ok' } as Run, { t: b.repeat(w - on), tone: 'muted' } as Run].filter((x) => x.t !== '');
}

// ---- row grammar --------------------------------------------------------------------------------------

/** Every list row on every tab is `focus  glyph  name  word  detail ... value`: the focus marker, a blank, the state glyph and a blank
 * (four cells), then the name column, the state word column, free detail text, and a value column right-aligned to the panel edge. */
export const GRID_LEAD = 4;
export type GridCell = { t: string; tone?: Tone; bold?: boolean; strike?: boolean };
export type GridRowSpec = {
  /** Panel width: the row is never wider. */
  cols: number;
  ui: Pick<Ui, 'ascii'>;
  /** The state glyph run (its text is one glyph); absent leaves the glyph cell blank. */
  mark?: Run | null;
  /** `▸` in the focus cell. */
  focus?: boolean;
  name: GridCell;
  /** Name column width: the name is cut in the middle to it and padded. */
  nameW: number;
  /** `end` clips the name at its end (labels, whose start tells them apart); the default cuts the middle (ids, whose tail does). */
  nameCut?: 'end' | 'middle';
  word?: GridCell;
  wordW?: number;
  /** Cells between the name and the word column (default 1). */
  gap?: number;
  /** Free runs after the word column (kept as given; the caller fits them). */
  tail?: readonly Run[];
  /** Detail text after the word column, cut with `...` to what the value column leaves. */
  detail?: GridCell;
  /** The figure at the right edge: never cut, the name column gives way. */
  value?: GridCell;
};
const cellRun = (c: GridCell, text: string, dflt: Tone): Run => ({ t: text, tone: c.tone ?? dflt, ...(c.bold ? { bold: true } : {}), ...(c.strike ? { strike: true } : {}) });

/** One row of the grammar as runs, at most `cols` cells. Columns line up across rows that share `nameW`, `wordW` and `gap`. */
export function gridRow(o: GridRowSpec): Run[] {
  const gap = ' '.repeat(o.gap ?? 1);
  const runs: Run[] = [
    o.focus ? { t: o.ui.ascii ? '>' : '▸', tone: 'accent', bold: true } : { t: ' ', tone: 'text' }, { t: ' ', tone: 'text' },
    o.mark ? { ...o.mark } : { t: ' ', tone: 'text' }, { t: ' ', tone: 'text' },
  ];
  const name = (o.nameCut === 'end' ? clip : clipMiddle)(o.name.t, Math.max(0, o.nameW));
  const pad = ' '.repeat(Math.max(0, o.nameW - cells(name)));
  if (o.name.strike && pad) runs.push(cellRun(o.name, name, 'text'), { t: pad, tone: o.name.tone ?? 'text' }); // the strike stops at the name: the padding is no text (critique 13)
  else runs.push(cellRun(o.name, name + pad, 'text'));
  if (o.wordW) runs.push({ t: gap, tone: 'text' }, o.word ? cellRun(o.word, padEnd(clip(o.word.t, o.wordW), o.wordW), 'muted') : { t: ' '.repeat(o.wordW), tone: 'text' });
  if (o.tail) runs.push(...o.tail);
  const used = runsCells(runs);
  const vw = o.value ? cells(o.value.t) : 0;
  if (o.detail && o.detail.t) {
    const room = o.cols - used - 1 - (vw ? vw + 1 : 0);
    if (room >= 4) runs.push(cellRun(o.detail, ` ${clip(o.detail.t, room)}`, 'muted'));
  }
  if (o.value && vw) runs.push({ t: ' '.repeat(Math.max(1, o.cols - runsCells(runs) - vw)), tone: 'text' }, cellRun(o.value, o.value.t, 'text'));
  return runs;
}

/** Column widths for a tab's rows at `cols`: the name column is the longest name up to `max`; the word column is fixed; a required
 * `value` keeps its whole width and the name column gives way (never below 1); an `optional` one is dropped when the name column
 * would fall under `min`. Returns the widths to hand every row of the tab. */
export function gridPlan(cols: number, o: { names: readonly string[]; word?: number; gap?: number; value?: number; optional?: boolean; min?: number; max?: number }): { nameW: number; wordW: number; valueW: number } {
  const wordW = o.word ?? 0;
  const wordCost = wordW ? wordW + (o.gap ?? 1) : 0;
  const longest = Math.max(1, ...o.names.map(cells));
  const min = Math.min(o.min ?? 8, longest);
  let valueW = o.value ?? 0;
  const room = (v: number): number => cols - GRID_LEAD - wordCost - (v ? v + 1 : 0);
  if (valueW && o.optional && room(valueW) < min) valueW = 0;
  return { nameW: Math.max(1, Math.min(o.max ?? 36, longest, room(valueW))), wordW, valueW };
}

// ---- phase rail ------------------------------------------------------------------------------------

/** `● 1 plan  ──  ▸ 2 research  ──  ◇ 3 build`. `active` is the 0-based lit phase; `phases.length` reads as every phase done. */
export function rail(phases: readonly string[], active: number, ui: Ui): Run[] {
  const sep: Run = ui.ascii ? { t: '  --  ', tone: 'muted' } : { t: '  ──  ', tone: 'line' };
  return phases.flatMap((id, i): Run[] => {
    const label = `${i + 1} ${id}`;
    const part: Run[] =
      i < active
        ? [{ t: ui.ascii ? '* ' : '● ', tone: ui.ascii ? 'text' : glyphTone('ok', ui.theme) }, { t: label, tone: 'sub' }]
        : i === active
          ? [{ t: ui.ascii ? '> ' : '▸ ', tone: ui.ascii ? 'text' : 'accent', bold: true }, { t: label, tone: 'text', bold: true }]
          : [{ t: ui.ascii ? 'o ' : '◇ ', tone: 'muted' }, { t: label, tone: 'muted' }];
    return i < phases.length - 1 ? [...part, sep] : part;
  });
}

// ---- gauge -------------------------------------------------------------------------------------------

const PARTIAL = '▏▎▍▌▋▊▉';
/** Filled eighths of a `width`-cell gauge at `value` (clamped 0..1). Error is at most 1/16 cell, so within the 1/8 budget. */
export const gaugeEighths = (width: number, value: number): number => Math.round(8 * Math.max(0, Math.floor(width)) * Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)));

/** Strings of a gauge: `full` blocks, one `partial` edge (or ''), `track` shades. full + partial + track is `width` cells. */
export function gaugeParts(width: number, value: number): { full: string; partial: string; track: string } {
  const w = Math.max(0, Math.floor(width));
  const e = gaugeEighths(w, value);
  const [full, rem] = [Math.floor(e / 8), e % 8];
  const partial = rem ? PARTIAL[rem - 1]! : '';
  return { full: '█'.repeat(full), partial, track: '░'.repeat(w - full - (rem ? 1 : 0)) };
}

/** The gauge as runs: fill in `fg` (default `info`), track in `track` (default `line`). ASCII: `=====...` in text over a muted track. */
export function gauge(width: number, value: number, ui: Ui, fg: Token = 'info', track: Token = 'line'): Run[] {
  const w = Math.max(0, Math.floor(width));
  if (ui.ascii) {
    const n = Math.round(w * Math.min(1, Math.max(0, value || 0)));
    return [{ t: '='.repeat(n), tone: 'text' }, { t: '.'.repeat(w - n), tone: 'muted' }];
  }
  const p = gaugeParts(w, value);
  const out: Run[] = [{ t: p.full + p.partial, tone: fg }, { t: p.track, tone: track }];
  return out.filter((x) => x.t);
}
/** Plain text of a gauge (Unicode form), for labels and tests. */
export const gaugeText = (width: number, value: number): string => Object.values(gaugeParts(width, value)).join('');
export const percent = (v: number): string => `${Math.round(v * 100)}%`;

// ---- chip ---------------------------------------------------------------------------------------------------

export const CHIP_W = 11;
/** Fixed-width state chip: ` WORD      ` (11 cells) in ink or white on `fill`, bold. ASCII: `[ WORD    ]` with no fill. */
export function chip(word: string, fill: Token, ui: Ui): Run {
  const body = word.toUpperCase();
  if (ui.ascii) return { t: `[${(' ' + body).padEnd(CHIP_W - 2).slice(0, CHIP_W - 2)}]`, tone: 'text', bold: true, chip: true };
  return { t: (' ' + body.padEnd(CHIP_W - 2) + ' ').slice(0, CHIP_W), tone: inkFor(fill, ui.theme, ui.color), bg: fill, bold: true, chip: true };
}
/** Chip of a state; queued uses the grey `queued_fill`. */
export const stateChip = (s: UiState, ui: Ui): Run => chip(s, s === 'queued' ? 'queued_fill' : STATE_TOKEN[s], ui);
/** Number of chip fills in a row; rows allow at most one. */
export const chipCount = (runs: readonly Run[]): number => runs.filter((x) => x.chip).length;

// ---- sparkline --------------------------------------------------------------------------------------------------

/** One char per value, scaled to `peak`: 8 block levels, or `_.-~'` in ASCII. Values clamp to 0..peak. */
export function sparkline(values: readonly number[], peak: number, ascii = false): string {
  const chars = ascii ? "_.-~'" : '▁▂▃▄▅▆▇█';
  const top = chars.length - 1;
  return values.map((v) => chars[Math.max(0, Math.min(top, Math.round((v / (peak || 1)) * top)))]).join('');
}

// ---- motion (pure functions of time) -------------------------------------------------------------------------------

export const SPINNER_MS = 100;
/** The row working signal (round 3): the circle quarters, one frame per beat of the shared clock, on every row surface (TODO, SUBAGENTS, panel, board, band worker rows).
 * The capture scorer maps only these four marks on rows. The band's own lead spinner is the braille set below. */
export const SPIN_FRAMES = ['◐', '◓', '◑', '◒'] as const;
/** The band lead's spinner (MiniDot): ten braille frames, one per beat of the same shared clock. Rows never use it. */
export const LEAD_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const SPIN_ASCII = ['|', '/', '-', '\\'] as const;
/** Spinner frame by frame number (any integer). */
export function spinnerGlyph(frame: number, ascii = false): string {
  const f = ascii ? SPIN_ASCII : SPIN_FRAMES;
  return f[((Math.floor(frame) % f.length) + f.length) % f.length]!;
}
/** The band lead's spinner at frame `frame` (braille; the ASCII set in ASCII mode). */
export function leadSpinnerGlyph(frame: number, ascii = false): string {
  const f = ascii ? SPIN_ASCII : LEAD_FRAMES;
  return f[((Math.floor(frame) % f.length) + f.length) % f.length]!;
}
/** Spinner frame number at the shared clock reading `nowMs`: ONE phase for every surface in a frame. The `id` argument is kept for the callers that still pass an
 * agent's name and is ignored: per-row offsets read as spinners out of phase (critique, 17.13.0). */
export function spinFrameOf(nowMs: number, _id = ''): number {
  return Math.floor(nowMs / SPINNER_MS);
}
/** The one spinner clock: the snapshot's `now` moved on by the ticker (one SPINNER_MS per tick), so a spinner turns between data polls.
 * Every surface turns spinFrameOf(spinClock(snapshot.now, tick), the agent's squad name); none reads `now` alone or a display name. */
export const spinClock = (nowMs: number, tick = 0): number => (shared === null ? nowMs + tick * SPINNER_MS : shared * SPINNER_MS);

/** The one shared frame index of a render (round 3): register.ts reads the frame beat's counter once per render and draws every surface (band, HUD rows, SUBAGENTS header, side panel,
 * board) inside `withSpinFrame(frame, ...)`, so spinClock answers the same frame to all of them. A frame is one beat of the render loop, not a reading of `snapshot.now` (which moves only
 * on a poll and put the panel and the band a quarter turn apart). Outside a render nothing is set and spinClock is the pure `now + tick * SPINNER_MS`. */
let shared: number | null = null;
let holds = 0;
/** Share `frame` until the returned release runs. Renders overlap (the band and the side panel draw concurrently), so holds count: the frame clears when the last release runs. */
export function holdSpinFrame(frame: number): () => void {
  shared = Math.floor(frame);
  holds++;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    if (--holds <= 0) { holds = 0; shared = null; }
  };
}
/** `draw()` with `frame` shared, released when it returns or throws. */
export function withSpinFrame<T>(frame: number, draw: () => T): T {
  const release = holdSpinFrame(frame);
  try {
    return draw();
  } finally {
    release();
  }
}
/** The frame index a render in progress shares (null outside `withSpinFrame`): the name other slices read. */
export const sharedSpinFrame = (): number | null => shared;
/** Spinner glyph at wall-clock `nowMs`: one frame per 100 ms. */
export const spinnerFrame = (nowMs: number, ascii = false): string => spinnerGlyph(Math.floor(nowMs / SPINNER_MS), ascii);

export const EASE_MS = 160;
export const EASE_FRAMES = 6;
export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
/** Gauge value `elapsedMs` into a move from `from` to `to` (ease-out cubic over 160 ms by default). */
export const easedValue = (from: number, to: number, elapsedMs: number, durationMs = EASE_MS): number => from + (to - from) * easeOutCubic(durationMs > 0 ? elapsedMs / durationMs : 1);
/** The values of the 6 frames (frame k is at time (k+1)/6 of the move); the last one equals `to`. */
export const easedFrames = (from: number, to: number, frames = EASE_FRAMES): number[] => Array.from({ length: frames }, (_, k) => easedValue(from, to, (k + 1) / frames, 1));

// ---- every pair the primitives emit (consumed by the WCAG test) -------------------------------------------------------

export type Pair = { kind: 'text' | 'glyph'; fg: string; bg: string; need: number; ratio: number; what: string };
/** All fg/bg pairs the primitives can put on screen in `theme`: text tones and glyph tokens on the panel, chip and capsule inks on their fills. `mode` 256 measures the palette colours that are really drawn. */
export function emittedPairs(theme: ThemeName, mode: ColorMode = 'truecolor'): Pair[] {
  const p = PALETTES[theme];
  const out: Pair[] = [];
  const hex = (fg: Token): string => (mode === '256' ? drawnHex(fitHex(p[fg], theme)) : p[fg]);
  const fill = (bg: Token): string => (mode === '256' ? drawnHex(surfaceHex(bg, { theme, color: mode })) : surfaceHex(bg, { theme, color: mode }));
  const add = (kind: Pair['kind'], fg: Token, bg: Token, what: string): number => out.push({ kind, fg: hex(fg), bg: fill(bg), need: NEED[kind], ratio: contrast(hex(fg), fill(bg)), what });
  for (const t of ['text', 'sub', 'muted'] as const) add('text', t, 'panel', `text ${t}`);
  for (const t of ['line', 'accent', 'ok', 'run', 'warn', 'bad', 'block', 'info', 'muted'] as const) add('glyph', glyphTone(t, theme), 'panel', `glyph ${t}`);
  for (const f of ['accent', 'ok', 'run', 'warn', 'bad', 'block', 'info', 'queued_fill'] as const) add('text', inkFor(f, theme, mode), f, `chip ${f}`);
  for (const st of UI_STATES) add('text', stateWordTone(st, { ascii: false, theme }), 'panel', `state word ${st}`);
  return out;
}
