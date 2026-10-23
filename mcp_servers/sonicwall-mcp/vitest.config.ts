import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules', 'dist', '**/*.test.ts'],
    },
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../_shared'),
      // Run against the library source so the unit tests need no prior build of node-sonicwall.
      'node-sonicwall': resolve(__dirname, '../../mcp_node/node-sonicwall/src/index.ts'),
    },
  },
});
