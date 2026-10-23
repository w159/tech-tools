import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig } from "./api-client.js";

const KEYS = [
  "CW_MANAGE_COMPANY_ID",
  "CW_MANAGE_PUBLIC_KEY",
  "CW_MANAGE_PRIVATE_KEY",
  "CW_MANAGE_CLIENT_ID",
  "CW_MANAGE_BASE_URL",
  "CW_MANAGE_URL",
] as const;

const saved: Record<string, string | undefined> = {};

function setRequired(): void {
  process.env.CW_MANAGE_COMPANY_ID = "acme";
  process.env.CW_MANAGE_PUBLIC_KEY = "pub";
  process.env.CW_MANAGE_PRIVATE_KEY = "priv";
  process.env.CW_MANAGE_CLIENT_ID = "cid";
}

describe("getConfig", () => {
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns null when nothing is set", () => {
    expect(getConfig()).toBeNull();
  });

  it.each([
    "CW_MANAGE_COMPANY_ID",
    "CW_MANAGE_PUBLIC_KEY",
    "CW_MANAGE_PRIVATE_KEY",
    "CW_MANAGE_CLIENT_ID",
  ])("returns null when %s is missing", (missing) => {
    setRequired();
    delete process.env[missing];
    expect(getConfig()).toBeNull();
  });

  it("defaults the base URL to the North America cloud host", () => {
    setRequired();
    expect(getConfig()).toEqual({
      baseUrl: "https://api-na.myconnectwise.net",
      companyId: "acme",
      publicKey: "pub",
      privateKey: "priv",
      clientId: "cid",
    });
  });

  it("treats an unresolved ${user_config.x} placeholder in the base URL as unset", () => {
    setRequired();
    process.env.CW_MANAGE_BASE_URL = "${user_config.cw_manage_base_url}";
    expect(getConfig()?.baseUrl).toBe("https://api-na.myconnectwise.net");
  });

  it("accepts CW_MANAGE_BASE_URL, strips trailing slashes, and adds https:// when absent", () => {
    setRequired();
    process.env.CW_MANAGE_BASE_URL = "api-eu.myconnectwise.net//";
    expect(getConfig()?.baseUrl).toBe("https://api-eu.myconnectwise.net");
  });

  it("keeps an explicit http:// scheme for self-hosted instances", () => {
    setRequired();
    process.env.CW_MANAGE_BASE_URL = "http://cw.internal.test";
    expect(getConfig()?.baseUrl).toBe("http://cw.internal.test");
  });

  it("falls back to the legacy CW_MANAGE_URL alias, and the canonical name wins when both are set", () => {
    setRequired();
    process.env.CW_MANAGE_URL = "https://legacy.example.test";
    expect(getConfig()?.baseUrl).toBe("https://legacy.example.test");
    process.env.CW_MANAGE_BASE_URL = "https://canonical.example.test";
    expect(getConfig()?.baseUrl).toBe("https://canonical.example.test");
  });
});
