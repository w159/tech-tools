import { describe, it, expect, vi } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { annotate, classifyTool } from "../annotate-tool.js";

// classifyTool() used to `return "read"` for any name its pattern tables did
// not match. readOnlyHint is the flag an MCP client reads to decide it may run
// a tool without asking, so an unanticipated mutating tool shipped as "safe to
// auto-run" while its own description said DESTRUCTIVE. These specs pin the two
// halves of the fix: the description marker wins, and an unrecognised name
// fails closed.
const tool = (name: string, description: string, annotations?: Tool["annotations"]): Tool => ({
  name,
  description,
  inputSchema: { type: "object" as const, properties: {} },
  ...(annotations ? { annotations } : {}),
});

describe("annotate", () => {
  it("follows a DESTRUCTIVE: description marker even for a read-looking name", () => {
    // knowbe4_users_list matches READ_PATTERNS; the marker must still win.
    const [t] = annotate([tool("knowbe4_users_list", "DESTRUCTIVE: tears the thing down.")]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(t.annotations?.destructiveHint).toBe(true);
  });

  it("follows a VISIBLE-TO-OTHERS: marker the same way", () => {
    const [t] = annotate([tool("knowbe4_users_get", "VISIBLE-TO-OTHERS: posts something other users see.")]);
    expect(t.annotations?.readOnlyHint).toBe(false);
  });

  it("does not annotate an unrecognised tool name read-only", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate([tool("knowbe4_frobnicate_user", "Does something the tables never saw.")]);
    expect(classifyTool("knowbe4_frobnicate_user")).toBeUndefined();
    expect(t.annotations?.readOnlyHint).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("knowbe4_frobnicate_user"));
    warn.mockRestore();
  });

  it("overrides a hand-written read-only annotation that contradicts the marker", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const [t] = annotate([
      tool("knowbe4_users_get", "DESTRUCTIVE: reboots the appliance.", { readOnlyHint: true }),
    ]);
    expect(t.annotations?.readOnlyHint).toBe(false);
    warn.mockRestore();
  });

  it("still classifies the genuine reads as read-only", () => {
    // These match no pattern table and are declared in CLASS_OVERRIDES; without
  // that they would fail closed to mutating. knowbe4_router only appears when
  // LAZY_LOADING=true, so a default tools/list probe never sees it.
    for (const name of [
      "knowbe4_groups_members",
      "knowbe4_phishing_campaign_tests",
      "knowbe4_phishing_security_test_recipients",
      "knowbe4_phishing_security_test_recipient",
      "knowbe4_reporting_risk_overview",
      "knowbe4_router",
    ]) {
      expect(classifyTool(name)).toBe("read");
    }
  });
});
