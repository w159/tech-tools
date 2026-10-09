import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mirror tsup's alias so tests that transitively import the shared response
// quality modules ("@shared/...") resolve them the same way the build does.
const sharedDir = resolve(__dirname, '../_shared');

export default defineConfig({
  test: {
    globals: true,
    // node_modules is a symlink to node_modules.nosync.noindex; vitest's
    // default exclude only covers the "node_modules" name.
    exclude: ['**/node_modules/**', '**/node_modules.nosync.noindex/**'],
  },
  resolve: {
    alias: {
      '@shared': sharedDir,
    },
  },
});
