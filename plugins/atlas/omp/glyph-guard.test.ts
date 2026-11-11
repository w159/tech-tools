// Guard (design system rev 4, R5): no source hardcodes a check mark, a bullet or an ellipsis; state marks come from the
// glyph map in mod/atlas-ui.ts (an omp test: it reads the source tree, which the mod test host cannot) (stateGlyph / UI_STATES) so ASCII and NO_COLOR modes can swap them. The surfaces this
// redesign owns must be at zero. Every other file may only shrink its count: DEBT is the ratchet (lower it, never raise it).
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const BAD = /[✓•…]/g; // check mark, bullet, ellipsis

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'node_modules' || n === 'fx' ? [] : walk(p)) : [p];
  });
const isSource = (f: string): boolean =>
  /\.(ts|tsx)$/.test(f) && !/\.(test|golden-cases|golden-fixture)\.|-golden\.|fixture|test-shim|test_helpers|\.d\.ts$/.test(f);

/** Source with block and line comments removed: prose may say a check mark, code may not draw one. */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const hits = (f: string): number => (code(readFileSync(f, 'utf8')).match(BAD) ?? []).length;

/** Files that own the rev 4 surfaces: zero hardcoded marks. */
const OWNED = [
  'mod/panel-layout.ts', 'mod/core-row.ts', 'mod/notify.ts',
  'mod/pane/sidebar.tsx', 'mod/pane/sidebar-model.ts', 'mod/pane/sidebar-paint.tsx', 'mod/pane/sidebar-route.tsx', 'mod/pane/sidebar-team.tsx',
  'mod/pane/sidebar-channel.tsx', 'mod/pane/sidebar-gates.tsx', 'mod/pane/sidebar-core.tsx', 'mod/pane/sidebar-types.ts',
  'mod/transcript/cards.tsx', 'omp/panel-view.ts',
];

/** Known debt in files this work does not own: the count of non-comment marks today. Tighten when a file is cleaned. */
const DEBT: Record<string, number> = {
  'mod/theme.ts': 2, // DONE_GLYPH and fitText's ellipsis: omp/done-glyph.test.ts pins DONE_GLYPH to the check mark
  'mod/roles.ts': 2,
  'mod/data/channels.ts': 1,
  'mod/data/todos.ts': 1,
  'mod/data/orchestration.ts': 5,
  'mod/sprites/api.ts': 1,
  'omp/channel-view.ts': 2,
  'omp/panel-paint.ts': 1,
  'omp/usage-statusline.ts': 2,
};

describe('glyph guard', () => {
  const files = [...walk(join(ROOT, 'mod')), ...walk(join(ROOT, 'omp'))].filter(isSource);
  test('the scan sees the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });
  test('the rev 4 surfaces hardcode no check mark, bullet or ellipsis', () => {
    for (const f of OWNED) {
      const p = join(ROOT, f);
      let n = 0;
      try { n = hits(p); } catch { continue; }
      expect([f, n]).toEqual([f, 0]);
    }
  });
  test('no other file grows its count (the ratchet)', () => {
    for (const f of files) {
      const rel = relative(ROOT, f);
      if (OWNED.includes(rel)) continue;
      const n = hits(f);
      expect([rel, n <= (DEBT[rel] ?? 0)]).toEqual([rel, true]);
    }
  });
  test('the debt list names only files that still have the marks', () => {
    for (const [rel, n] of Object.entries(DEBT)) {
      let cur = 0;
      try { cur = hits(join(ROOT, rel)); } catch { /* removed file */ }
      expect([rel, cur >= n]).toEqual([rel, true]);
    }
  });
});
