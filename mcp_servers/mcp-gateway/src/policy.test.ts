import { describe, expect, it } from "vitest";
import {
  accessMatrix,
  compatPolicy,
  decide,
  effectOf,
  hasAnyGrant,
  mergePolicies,
  parsePolicy,
  resolveRoles,
  type Policy,
} from "./policy.js";
import { tool } from "./test-fixtures/helpers.js";

const compat = compatPolicy([{ id: "vanta", compatRole: "Vanta" }, { id: "auvik", compatRole: "Auvik" }]);

// Roles as the verifier derives them from a legacy Entra roles claim.
const rolesFor = (...entraRoles: string[]): string[] => resolveRoles(compat, { roles: entraRoles });

const allows = (entraRoles: string[], connector: string, t: ReturnType<typeof tool>): boolean =>
  decide(compat, rolesFor(...entraRoles), connector, t).allow;

describe("policy (ported behaviors, compat profile)", () => {
  it("Read role sees a readOnly tool", () => {
    expect(allows(["Vanta.Read"], "vanta", tool("vanta_list", "read"))).toBe(true);
  });

  it("Read role is denied a mutating tool", () => {
    expect(allows(["Vanta.Read"], "vanta", tool("vanta_update", "destructive"))).toBe(false);
    expect(allows(["Vanta.Read"], "vanta", tool("vanta_update", "write"))).toBe(false);
  });

  it("Write role sees both readOnly and mutating tools", () => {
    expect(allows(["Vanta.Write"], "vanta", tool("vanta_list", "read"))).toBe(true);
    expect(allows(["Vanta.Write"], "vanta", tool("vanta_update", "destructive"))).toBe(true);
  });

  it("missing annotations fail closed to needing Write", () => {
    const t = tool("vanta_mystery", "none");
    expect(effectOf(t)).toBe("destructive");
    expect(allows(["Vanta.Read"], "vanta", t)).toBe(false);
    expect(allows(["Vanta.Write"], "vanta", t)).toBe(true);
  });

  it("another vendor's roles grant nothing", () => {
    expect(allows(["Auvik.Write"], "vanta", tool("vanta_list", "read"))).toBe(false);
    expect(hasAnyGrant(compat, rolesFor("Auvik.Write"), "vanta")).toBe(false);
  });

  it("hasAnyGrant is true for either Read or Write", () => {
    expect(hasAnyGrant(compat, rolesFor("Vanta.Read"), "vanta")).toBe(true);
    expect(hasAnyGrant(compat, rolesFor("Vanta.Write"), "vanta")).toBe(true);
    expect(hasAnyGrant(compat, [], "vanta")).toBe(false);
  });
});

describe("effectOf", () => {
  it.each([
    ["read", "read"],
    ["write", "write"],
    ["destructive", "destructive"],
    ["none", "destructive"],
  ] as const)("%s annotations -> %s", (kind, effect) => {
    expect(effectOf(tool("t", kind))).toBe(effect);
  });

  it("a mutating tool that omits destructiveHint is destructive (MCP default)", () => {
    const t = { name: "t", inputSchema: { type: "object" as const }, annotations: { readOnlyHint: false } };
    expect(effectOf(t)).toBe("destructive");
  });
});

const VALID = `
version: 1
subjects:
  - role: helpdesk
    when: { claim: roles, equals: "Gateway.Helpdesk" }
grants:
  - role: helpdesk
    connectors: [vanta]
    effects: [read, write]
    deny_tools: ["vanta_purge*"]
`;

describe("parsePolicy", () => {
  const known = ["vanta", "auvik"];

  it("accepts a valid document", () => {
    const p = parsePolicy(VALID, known);
    expect(p.grants[0]).toMatchObject({ role: "helpdesk", connectors: ["vanta"], effects: ["read", "write"] });
  });

  it("rejects unknown top-level keys", () => {
    expect(() => parsePolicy(`${VALID}\nextra: 1\n`, known)).toThrow(/unknown top-level key "extra"/);
  });

  it("rejects an unknown connector", () => {
    expect(() => parsePolicy(VALID.replace("[vanta]", "[nope]"), known)).toThrow(/unknown connector "nope"/);
  });

  it("rejects an unknown effect", () => {
    expect(() => parsePolicy(VALID.replace("[read, write]", "[read, admin]"), known)).toThrow(/unknown effect "admin"/);
  });

  it("rejects a grant whose role has no subjects rule", () => {
    expect(() => parsePolicy(VALID.replace("- role: helpdesk\n    connectors", "- role: ghost\n    connectors"), known)).toThrow(
      /no subjects rule/,
    );
  });

  it("allows the gateway connector and the * wildcard", () => {
    const p = parsePolicy(VALID.replace("[vanta]", "[gateway, \"*\"]"), known);
    expect(p.grants[0]?.connectors).toEqual(["gateway", "*"]);
  });
});

describe("decide", () => {
  const policy = parsePolicy(VALID, ["vanta"]);
  const roles = ["helpdesk"];

  it("denies with no_grant when no grant covers the connector", () => {
    expect(decide(policy, roles, "auvik", tool("auvik_x", "read"))).toMatchObject({ allow: false, reason: "no_grant" });
  });

  it("denies an effect the grant does not include", () => {
    expect(decide(policy, roles, "vanta", tool("vanta_del", "destructive"))).toMatchObject({
      allow: false,
      reason: "effect_not_granted:destructive",
    });
  });

  it("deny_tools beats a broad grant", () => {
    expect(decide(policy, roles, "vanta", tool("vanta_purge_all", "read"))).toMatchObject({
      allow: false,
      reason: "deny_tools:helpdesk:vanta_purge*",
    });
  });

  it("allows with the granting role as the reason", () => {
    expect(decide(policy, roles, "vanta", tool("vanta_list", "write"))).toMatchObject({ allow: true, reason: "grant:helpdesk" });
  });
});

describe("compat profile and merge", () => {
  it("maps <Vendor>.Read and <Vendor>.Write app roles", () => {
    expect(rolesFor("Vanta.Read", "Auvik.Write", "Other.Read")).toEqual(["compat:auvik:write", "compat:vanta:read"]);
  });

  it("mergePolicies concatenates subjects and grants", () => {
    const own: Policy = parsePolicy(VALID, ["vanta"]);
    const merged = mergePolicies(own, compat);
    expect(merged.subjects.length).toBe(own.subjects.length + compat.subjects.length);
    expect(merged.grants.length).toBe(own.grants.length + compat.grants.length);
  });

  it("accessMatrix lists allowed and denied tools per role and connector", () => {
    const rows = accessMatrix(compat, new Map([["vanta", [tool("vanta_list", "read"), tool("vanta_del", "destructive")]]]));
    const read = rows.find((r) => r.role === "compat:vanta:read");
    expect(read?.allowed).toEqual(["vanta_list"]);
    expect(read?.denied).toEqual([{ tool: "vanta_del", reason: "effect_not_granted:destructive" }]);
  });
});
