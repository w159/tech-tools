import { defineConfig } from 'tsup';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the shared module directory at config-read time.
// "@shared" -> mcp_servers/_shared/ so imports like "@shared/response-shaper.js"
// resolve correctly during the tsup/esbuild bundling pass.
const sharedDir = resolve(__dirname, '../_shared');

export default defineConfig({
  entry: ['src/index.ts', 'src/http.ts'],
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