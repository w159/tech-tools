// Painting in 256-colour mode must stay cheap: runHex/surfaceHex/paintAnsi run once per run per frame, so the palette lookups are memoised.
// Outputs must equal the original uncached algorithm (copied below as the reference) byte for byte.
import { describe, expect, test } from 'claude-code/testing';
import { contrast, exactIndex, fitHex, hexTo256, hostTo256, NEED, PALETTES, paintAnsi, preImage, runHex, stable256, surfaceHex, xtermHex, type ThemeName, type Token } from './atlas-ui';

const BOUND_MS = 100;

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const dist2 = (a: string, b: string): number => rgb(a).reduce((n, v, i) => n + (v - rgb(b)[i]!) ** 2, 0);
const stableRef = (): number[] => Array.from({ length: 240 }, (_, k) => k + 16).filter((i) => hexTo256(xtermHex(i)) === i && hostTo256(xtermHex(i)) === i);
const stable256Ref = (hex: string, bg?: string, need = 0): string => {
  const all = stableRef().map(xtermHex);
  const ok = bg && need > 0 ? all.filter((c) => contrast(c, bg) >= need) : all;
  const from = ok.length ? ok : all;
  const [r, g, b] = rgb(hex);
  const grey = (c: string): boolean => new Set(rgb(c)).size === 1;
  const greys = r === g && g === b ? from.filter(grey) : []; // a neutral stays a neutral (the body text #d0d0d0 is not pulled to a tinted index)
  return (greys.length ? greys : from).reduce((best, c) => (dist2(c, hex) < dist2(best, hex) ? c : best));
};
// Round 3: the brief's own colours are painted as their exact xterm index (handed to the host as the index's pre-image); every other colour is the original nearest-stable algorithm.
const exactRef = (hex: string): string | undefined => { const i = exactIndex(hex); return i === undefined ? undefined : preImage(i); };
const surfaceRef = (tok: Token, theme: ThemeName): string => exactRef(PALETTES[theme][tok]) ?? stable256Ref(PALETTES[theme][tok]);
const fitRef = (hex: string, theme: ThemeName): string => {
  const exact = exactRef(hex);
  if (exact) return exact;
  if (stableRef().some((i) => xtermHex(i) === hex)) return hex;
  return stable256Ref(hex, surfaceRef('panel', theme), Math.min(NEED.text, contrast(hex, PALETTES[theme].panel)));
};

const themes: ThemeName[] = ['mocha', 'latte'];
const tokens = Object.keys(PALETTES.mocha) as Token[];
const offPalette = ['#123456', '#fedcba', '#ff00ff', '#010101', '#f0f0f0', '#abcdef', '#7a3b9c'];

describe('256-colour palette lookups', () => {
  test('cached results equal the uncached reference', () => {
    for (const theme of themes) {
      for (const tok of tokens) {
        expect(surfaceHex(tok, { theme, color: '256' })).toBe(surfaceRef(tok, theme));
        expect(fitHex(PALETTES[theme][tok], theme)).toBe(fitRef(PALETTES[theme][tok], theme));
        expect(stable256(PALETTES[theme][tok])).toBe(stable256Ref(PALETTES[theme][tok]));
      }
      for (const hex of offPalette) {
        expect(fitHex(hex, theme)).toBe(fitRef(hex, theme));
        expect(stable256(hex, PALETTES[theme].panel, 4.5)).toBe(stable256Ref(hex, PALETTES[theme].panel, 4.5));
        expect(stable256(hex, PALETTES[theme].panel, 4.5)).toBe(stable256Ref(hex, PALETTES[theme].panel, 4.5)); // a cache hit repeats
      }
      expect(stable256('#123456', PALETTES[theme].panel, 0)).toBe(stable256Ref('#123456', PALETTES[theme].panel, 0));
    }
  });

  test('a frame-sized workload finishes within the bound', () => {
    const t0 = performance.now();
    let sink = 0;
    for (let n = 0; n < 4000; n++) {
      const theme = themes[n % 2]!;
      const ui = { theme, ascii: false, color: '256' as const };
      const tone = tokens[n % tokens.length]!;
      sink += paintAnsi({ t: 'x', tone: tone as never }, ui).length;
      sink += paintAnsi({ t: 'x', tone: 'text', fg: offPalette[n % offPalette.length], bg: tone }, ui).length;
      sink += runHex({ tone: tone as never }, theme, '256').length + surfaceHex(tone, ui).length;
    }
    const ms = performance.now() - t0;
    expect({ ms: Math.round(ms), sink }.ms).toBeLessThan(BOUND_MS); // before the cache: ~6000 ms
  });
});
