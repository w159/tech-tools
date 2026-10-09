import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';

export default defineConfig({
  // Mirror the tsup/tsconfig "@shared" alias so tests can import server.ts.
  resolve: { alias: { '@shared': fileURLToPath(new URL('../_shared', import.meta.url)) } },
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
