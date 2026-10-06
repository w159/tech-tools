/**
 * ninjaone_status without credentials.
 *
 * AGENTS.md section 4: every server exposes a <vendor>_status tool that RUNS
 * WITHOUT CREDENTIALS and REPORTS CONFIGURATION STATE. It used to return the
 * MISSING_CREDENTIALS error envelope (isError: true) instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { describeUnconfigured } from "../status.js";

/** Joined text blocks of a tool result (content is a union that includes images). */
const textOf = (result: ReturnType<typeof describeUnconfigured>): string =>
  result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");

const NINJA_ENV = [
  "NINJAONE_CLIENT_ID",
  "NINJAONE_CLIENT_SECRET",
  "NINJAONE_REGION",
  "NINJAONE_AUTH_MODE",
  "NINJAONE_BASE_URL",
] as const;

const DOMAINS = ["devices", "organizations", "alerts", "tickets", "queries", "automation", "directory"];

describe("describeUnconfigured (ninjaone_status without credentials)", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of NINJA_ENV) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of NINJA_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    vi.restoreAllMocks();
  });

  it("is a report, not an error", () => {
    const result = describeUnconfigured(DOMAINS);
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).not.toContain("MISSING_CREDENTIALS");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("names the missing variables and says what is optional", () => {
    const text = textOf(describeUnconfigured(DOMAINS));
    expect(text).toMatch(/^NinjaOne MCP Server Status/);
    expect(text).toMatch(/NINJAONE_CLIENT_ID[^\n]*MISSING/i);
    expect(text).toMatch(/NINJAONE_CLIENT_SECRET[^\n]*MISSING/i);
    expect(text).toContain("NINJAONE_REGION");
    expect(text).toContain("NINJAONE_AUTH_MODE");
  });

  it("skips the live auth check and lists the domains", () => {
    const text = textOf(describeUnconfigured(DOMAINS));
    expect(text).toContain("Auth check: SKIPPED (no credentials)");
    expect(text).toContain(`Available domains: ${DOMAINS.join(", ")}`);
  });

  it("reports the default base URL the server really uses, not an empty one", () => {
    const text = textOf(describeUnconfigured(DOMAINS));
    expect(text).toMatch(/Base URL: https:\/\/app\.ninjarmm\.com/);
    expect(text).toMatch(/vendor default/);
  });

  it("reports a set variable as set and never prints its value", () => {
    process.env.NINJAONE_CLIENT_ID = "client-id-secret-value";
    const text = textOf(describeUnconfigured(DOMAINS));
    expect(text).toMatch(/NINJAONE_CLIENT_ID[^\n]*\bset\b/);
    expect(text).toMatch(/NINJAONE_CLIENT_SECRET[^\n]*MISSING/i);
    expect(text).not.toContain("client-id-secret-value");
  });

  it("treats an unresolved ${user_config.*} placeholder as missing", () => {
    process.env.NINJAONE_CLIENT_ID = "${user_config.ninjaone_client_id}";
    const text = textOf(describeUnconfigured(DOMAINS));
    expect(text).toMatch(/NINJAONE_CLIENT_ID[^\n]*MISSING/i);
  });

  it("explains that only status, navigate and the sign-in tools are listed until configured", () => {
    const text = textOf(describeUnconfigured(DOMAINS));
    expect(text).toMatch(/ninjaone_navigate/);
    expect(text).toMatch(/restart/i);
  });
});
