import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  // Mirror the tsup/tsconfig "@shared" alias so tests can import the domain handlers.
  resolve: { alias: { '@shared': fileURLToPath(new URL('../_shared', import.meta.url)) } },
  test: {
    globals: true,
    environment: 'node',
    // node_modules.nosync.noindex is a vendored dependency copy (macOS sync
    // workaround); vitest's default exclude only covers "node_modules".
    exclude: ['**/node_modules/**', '**/node_modules.nosync.noindex/**'],
  },
});