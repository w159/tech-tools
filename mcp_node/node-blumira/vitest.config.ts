import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // node_modules is a symlink to node_modules.nosync.noindex; vitest default exclude only covers "node_modules".
    exclude: ['**/node_modules/**', '**/node_modules.nosync.noindex/**'],
  },
});
