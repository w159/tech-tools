import { defineConfig } from 'tsup';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Plugin } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));

// mcp_servers/_shared/ is one level up from this server's root directory.
const sharedDir = resolve(__dirname, '../_shared');

/**
 * esbuild plugin that resolves ../../_shared/*.js imports in src/ (and
 * ../../../_shared/*.js from src/domains/) to the .ts source files in
 * mcp_servers/_shared/. tsup v8 has no top-level alias option, so we wire
 * this manually via esbuildPlugins.
 *
 * The filter matches any import containing "/_shared/" so it works regardless
 * of how many ../ prefixes callers use.
 */
const sharedPlugin: Plugin = {
  name: 'shared-modules',
  setup(build) {
    build.onResolve({ filter: /\/_shared\// }, (args) => {
      const match = args.path.match(/\/_shared\/(.+?)(?:\.js)?$/);
      if (!match) return;
      return { path: resolve(sharedDir, `${match[1]}.ts`) };
    });
  },
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
  outDir: 'dist',
  target: 'node18',
  esbuildPlugins: [sharedPlugin],
});
