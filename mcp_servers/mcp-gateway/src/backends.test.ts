import { describe, expect, it } from "vitest";
import { BACKEND_CATALOG, childEnv } from "./backends.js";

describe("backends childEnv", () => {
  it("includes the vendor's own prefix and excludes another vendor's secrets", () => {
    const ninjaone = BACKEND_CATALOG.find((s) => s.id === "ninjaone")!;
    const env = childEnv(ninjaone, {
      NINJAONE_CLIENT_SECRET: "secret-value",
      CW_MANAGE_PRIVATE_KEY: "other-vendor-secret",
      PATH: "/usr/bin",
    });

    expect(env.NINJAONE_CLIENT_SECRET).toBe("secret-value");
    expect(env.CW_MANAGE_PRIVATE_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.MCP_TRANSPORT).toBe("stdio");
  });
});
