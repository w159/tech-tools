import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      // Mirror the tsconfig "@shared" path so tests can import server.ts.
      "@shared": fileURLToPath(new URL("../_shared", import.meta.url)),
      // Run against the library source so the unit tests need no prior build of node-paylocity.
      "node-paylocity": fileURLToPath(
        new URL("../../mcp_node/node-paylocity/src/index.ts", import.meta.url),
      ),
    },
  },
});
