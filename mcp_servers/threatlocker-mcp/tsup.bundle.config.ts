// Builds the self-contained ESM bundle that ships inside the atlas plugin
// (plugins/atlas/mcp/threatlocker/server.mjs). Everything is inlined (noExternal)
// so the plugin runs with no node_modules next to it.
//   npx tsup --config tsup.bundle.config.ts
import { defineConfig } from 'tsup';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: { server: 'src/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  minify: true,
  dts: false,
  sourcemap: false,
  splitting: false,
  clean: false,
  banner: {
    js: "import { createRequire as __atlasCreateRequire } from 'module'; const require = __atlasCreateRequire(import.meta.url);",
  },
  noExternal: [/.*/],
  outDir: resolve(here, '../../plugins/atlas/mcp/threatlocker'),
  outExtension: () => ({ js: '.mjs' }),
  esbuildOptions(options) {
    options.alias = { ...(options.alias ?? {}), '@shared': resolve(here, '../_shared') };
  },
});
