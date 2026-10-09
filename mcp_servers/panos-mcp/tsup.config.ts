import { defineConfig } from 'tsup';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Absolute path to the shared module directory, resolved at config-read time.
// tsup/esbuild alias: key must be a bare module name (no slashes), value is the
// directory to expand it to. "@shared" -> resolved absolute path, so imports
// like "@shared/response-shaper.js" resolve to ../_shared/response-shaper.js.
const sharedDir = resolve(__dirname, '../_shared');

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      '@shared': sharedDir,
    };
  },
});
