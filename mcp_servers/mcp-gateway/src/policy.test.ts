import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { canUseTool, hasAnyVendorRole, isReadOnly } from "./policy.js";

function tool(name: string, opts: { readOnly?: boolean; noAnnotations?: boolean } = {}): Tool {
  return {
    name,
    inputSchema: { type: "object" },
    annotations: opts.noAnnotations ? undefined : { readOnlyHint: opts.readOnly === true },
  };
}

describe("policy", () => {
  it("Read role sees a readOnly tool", () => {
    expect(canUseTool(["Vanta.Read"], "Vanta", tool("vanta_list", { readOnly: true }))).toBe(true);
  });

  it("Read role is denied a mutating tool", () => {
    expect(canUseTool(["Vanta.Read"], "Vanta", tool("vanta_update", { readOnly: false }))).toBe(false);
  });

  it("Write role sees both readOnly and mutating tools", () => {
    expect(canUseTool(["Vanta.Write"], "Vanta", tool("vanta_list", { readOnly: true }))).toBe(true);
    expect(canUseTool(["Vanta.Write"], "Vanta", tool("vanta_update", { readOnly: false }))).toBe(true);
  });

  it("missing annotations fail closed to needing Write", () => {
    const t = tool("vanta_mystery", { noAnnotations: true });
    expect(isReadOnly(t)).toBe(false);
    expect(canUseTool(["Vanta.Read"], "Vanta", t)).toBe(false);
    expect(canUseTool(["Vanta.Write"], "Vanta", t)).toBe(true);
  });

  it("another vendor's roles grant nothing", () => {
    expect(canUseTool(["Auvik.Write"], "Vanta", tool("vanta_list", { readOnly: true }))).toBe(false);
    expect(hasAnyVendorRole(["Auvik.Write"], "Vanta")).toBe(false);
  });

  it("hasAnyVendorRole is true for either Read or Write", () => {
    expect(hasAnyVendorRole(["Vanta.Read"], "Vanta")).toBe(true);
    expect(hasAnyVendorRole(["Vanta.Write"], "Vanta")).toBe(true);
    expect(hasAnyVendorRole([], "Vanta")).toBe(false);
  });
});
