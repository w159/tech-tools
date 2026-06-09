import { defineConfig } from 'tsup';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Absolute path to the shared module directory, resolved at config-read time.
// "@shared" -> ../_shared so imports like "@shared/response-shaper.js" resolve correctly.
const sharedDir = resolve(__dirname, '../_shared');

export default defineConfig({
  entry: { index: 'src/index.ts', http: 'src/http.ts' },
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      '@shared': sharedDir,
    };
  },
});
