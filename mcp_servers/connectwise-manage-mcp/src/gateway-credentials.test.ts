import { describe, it, expect, beforeEach } from "vitest";
import { configStorage, getConfig } from "./api-client.js";

const KEYS = [
  "CW_MANAGE_COMPANY_ID",
  "CW_MANAGE_PUBLIC_KEY",
  "CW_MANAGE_PRIVATE_KEY",
  "CW_MANAGE_CLIENT_ID",
  "CW_MANAGE_BASE_URL",
  "CW_MANAGE_URL",
] as const;

const configFor = (id: string) => ({
  baseUrl: "https://cw.example.test",
  companyId: id,
  publicKey: `pub-${id}`,
  privateKey: `priv-${id}`,
  clientId: `cid-${id}`,
});

describe("gateway per-request credentials", () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("request B without headers does not see request A credentials", async () => {
    await configStorage.run(configFor("a"), async () => {
      await Promise.resolve();
      expect(getConfig()?.privateKey).toBe("priv-a");
    });
    // Request B: no ALS context, no env
    expect(getConfig()).toBeNull();
    expect(process.env.CW_MANAGE_PRIVATE_KEY).toBeUndefined();
  });

  it("concurrent requests keep their own credentials", async () => {
    const read = (id: string) =>
      configStorage.run(configFor(id), async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getConfig()?.companyId;
      });
    expect(await Promise.all([read("a"), read("b")])).toEqual(["a", "b"]);
  });
});
