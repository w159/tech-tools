import { defineConfig } from 'tsup';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// plain tsc does not rewrite the "@shared" path alias, so dist/ is built by
// tsup (same alias as tsup.bundle.config.ts); tsc stays the typecheck step.
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}), '@shared': resolve(here, '../_shared') };
  },
});
