// Critique 25: one restrained palette. Accent 141, ok 114, warn 179, error 203 and the neutrals 236 / 240 / 245 / 252; no second set of pastels in any non-test file that draws an Atlas surface.
// Fades come only from the motion ramp (computed, never a literal), so a literal hex in a source file must be one of the tokens below.
import { describe, expect, test } from 'claude-code/testing';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PALETTE5, PALETTES } from './atlas-ui';
import { leadTone } from './transcript/leadheader';

const ROOT = resolve(import.meta.dir, '..'); // plugins/atlas
const hexes = (o: Record<string, string>): string[] => Object.values(o).map((h) => h.toLowerCase());

/** Every colour a source file may spell: the Mocha and Latte tokens, the five-role palette, and white (the chip ink). */
const ALLOWED = new Set<string>([...hexes(PALETTES.mocha), ...hexes(PALETTES.latte), ...hexes(PALETTE5), '#ffffff']);

/** Files that spell colours for something other than an Atlas surface, each with its reason. */
const EXEMPT: Record<string, string> = {
  'mod/contract.ts': 'BRAND: the legacy persona/identity palette the contract exports; read by data/personas.ts only, drawn on no surface',
  'mod/data/personas.ts': 'persona identity colours of the roster data, never painted by the band, HUD, board, panel or cards',
};
const EXEMPT_DIRS = ['mod/sprites/']; // the pixel-art sprite sheets are art assets with their own palettes
const SPRITE_TILE = '#1b1f27'; // mod/theme.ts spriteTile: the dark tile behind a sprite, not a surface colour

const files = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return files(rel);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) && !/golden-(fixture|cases)\.ts$/.test(n) && !/\.d\.ts$/.test(n) ? [rel] : [];
  });

const surfaceFiles = [...files('mod'), ...files('omp')].filter((f) => !(f in EXEMPT) && !EXEMPT_DIRS.some((d) => f.startsWith(d)));

describe('critique 25: one palette', () => {
  test('the five-role palette is the 256-colour set the brief names', () => {
    expect(PALETTE5).toMatchObject({ accent: '#af87ff', ok: '#87d787', warn: '#d7af5f', error: '#ff5f5f', rule: '#303030', dim: '#585858', secondary: '#8a8a8a', body: '#d0d0d0' });
  });
  test('the scan finds the surface files (a moved folder cannot turn this test into a no-op)', () => {
    expect(surfaceFiles.length).toBeGreaterThan(40);
    for (const f of ['mod/atlas-ui.ts', 'mod/mission-layout.ts', 'mod/panel-layout.ts', 'mod/board-model.ts', 'mod/transcript/cards.tsx', 'mod/restyle.tsx', 'omp/panel-paint.ts', 'omp/mission-panel.ts']) expect(surfaceFiles).toContain(f);
  });
  test('no non-test mod or omp file spells a colour outside the palette', () => {
    const stray: string[] = [];
    for (const f of surfaceFiles) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        const hex = m[0].toLowerCase();
        if (ALLOWED.has(hex)) continue;
        if (f === 'mod/theme.ts' && hex === SPRITE_TILE) continue;
        stray.push(`${f}: ${hex}`);
      }
    }
    expect(stray).toEqual([]);
  });
  test('no non-test file paints a raw 24-bit colour sequence or an rgb() literal', () => {
    const raw: string[] = [];
    for (const f of surfaceFiles) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      if (/\\x1b\[(?:38|48);2;\d+;\d+;\d+m|rgb\(\s*\d+/.test(src)) raw.push(f);
    }
    expect(raw).toEqual([]);
  });
  test('the lead-line bar takes four values: accent for an active phase, ok for done, error for blocked (quiet and note bars use the secondary grey)', () => {
    const tones = new Set((['research', 'plan', 'build', 'verify', 'done', 'blocked'] as const).map((p) => leadTone(p as never)));
    expect([...tones].sort()).toEqual(['accent', 'bad', 'ok']);
    expect(leadTone('done' as never)).toBe('ok');
    expect(leadTone('blocked' as never)).toBe('bad');
    expect(leadTone('build' as never)).toBe('accent');
  });
  test('the retired off-palette greys and pastels are gone from the Mocha tokens', () => {
    const mocha = new Set(hexes(PALETTES.mocha));
    for (const gone of ['#7f849c', '#585b70', '#94e2d5', '#a6e3a1', '#f38ba8', '#cba6f7', '#2fbd9f', '#cdd6f4']) expect(mocha.has(gone)).toBe(false);
  });
});
