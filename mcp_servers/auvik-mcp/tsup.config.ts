import { defineConfig } from 'tsup';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the shared module directory at config-read time.
// tsup/esbuild alias: "@shared" maps to mcp_servers/_shared so imports like
// "@shared/response-shaper.js" resolve to ../../_shared/response-shaper.ts.
const sharedDir = resolve(__dirname, '../_shared');

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  esbuildOptions(options) {
    options.alias = {
      ...(options.alias ?? {}),
      '@shared': sharedDir,
    };
  },
});