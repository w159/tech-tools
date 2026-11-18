// Test support: finds mod sources by basename so a test that reads a source as text does not hard-code the folder the file lives in.
// Lives in fixtures/ because the host-load scan and the hex scan skip that folder; no mod source imports it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Absolute path of `plugins/atlas/mod` (this file is `mod/fixtures/source-tree.ts`). */
export const MOD_ROOT = join(import.meta.dir, '..');

/** Absolute path of `plugins/atlas`. */
export const pluginRoot = (): string => join(MOD_ROOT, '..');

/** Every file under `mod/` as a path relative to it, depth first, `node_modules` skipped. */
export function modFiles(dir = ''): string[] {
  return readdirSync(join(MOD_ROOT, dir)).flatMap((n) => {
    if (n === 'node_modules') return [];
    const rel = dir ? `${dir}/${n}` : n;
    return statSync(join(MOD_ROOT, rel)).isDirectory() ? modFiles(rel) : [rel];
  });
}

/** Non-test `.ts`/`.tsx` sources under `mod/` (relative paths); `.d.ts` files only when asked for. */
export function modSources(opts: { dts?: boolean } = {}): string[] {
  return modFiles().filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && (opts.dts === true || !/\.d\.ts$/.test(f)));
}

/** The one file under `mod/` with this basename, as a path relative to `mod/`. Throws when there is none or more than one. */
export function modPath(basename: string): string {
  const hits = modFiles().filter((f) => f === basename || f.endsWith(`/${basename}`));
  if (hits.length !== 1) throw new Error(`expected exactly one mod file named ${basename}, found ${hits.length}: ${hits.join(', ')}`);
  return hits[0]!;
}

/** Text of the one file under `mod/` with this basename. */
export const readMod = (basename: string): string => readFileSync(join(MOD_ROOT, modPath(basename)), 'utf8');

/** The host entry as text: `register.ts` and, once the entry is split, the `host/` modules that hold its code, in a fixed order. */
export function readHostEntry(): string {
  const parts = ['register.ts', ...['atoms', 'agents', 'poll', 'core-tick', 'handlers', 'frame', 'hooks'].map((n) => `host/${n}.ts`)];
  const read = (p: string): string => {
    try {
      return readFileSync(join(MOD_ROOT, p), 'utf8');
    } catch {
      return '';
    }
  };
  return parts.map(read).filter((t) => t !== '').join('\n');
}
