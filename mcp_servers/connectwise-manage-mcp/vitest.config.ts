import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // node_modules.nosync.noindex is a vendored dependency copy (macOS sync
    // workaround); vitest's default exclude only covers "node_modules".
    exclude: ['**/node_modules/**', '**/node_modules.nosync.noindex/**'],
  },
});