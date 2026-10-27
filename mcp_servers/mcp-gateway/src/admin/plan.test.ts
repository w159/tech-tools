import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { parsePolicy } from "../policy.js";
import { fixturePath } from "../test-fixtures/admin-helpers.js";
import { AnswersError, buildPlan, catalogConnectorIds, makePlan, parsePlan, uuidV5 } from "./plan.js";
import type { OrgModel } from "./discover.js";

const org = JSON.parse(readFileSync(fixturePath("org-model.json"), "utf8")) as OrgModel;
const answers = readFileSync(fixturePath("answers.yaml"), "utf8");
const connectors = catalogConnectorIds();

function problemsFor(mutate: (doc: Record<string, any>) => void): string {
  const doc = parseYaml(answers) as Record<string, any>;
  mutate(doc);
  try {
    makePlan(org, JSON.stringify(doc), connectors);
  } catch (err) {
    expect(err).toBeInstanceOf(AnswersError);
    return (err as AnswersError).message;
  }
  throw new Error("expected makePlan to throw");
}

describe("plan: policy.yaml", () => {
  it("is accepted by the gateway's parsePolicy against the real catalog", () => {
    const { policyYaml } = makePlan(org, answers, connectors);
    const policy = parsePolicy(policyYaml, connectors);
    expect(policy.subjects).toEqual([
      { role: "it-ops", when: { claim: "roles", equals: "it-ops" } },
      { role: "helpdesk", when: { claim: "roles", equals: "helpdesk" } },
    ]);
    expect(policy.grants).toEqual([
      { role: "it-ops", connectors: ["ninjaone", "connectwise"], effects: ["read", "write"], deny_tools: ["ninjaone_get_secret"] },
      { role: "helpdesk", connectors: ["connectwise"], effects: ["read"] },
    ]);
  });
});

describe("plan: plan.json", () => {
  it("describes the Entra application the gateway needs", () => {
    const { plan } = makePlan(org, answers, connectors);
    const a = plan.application;
    expect(a.displayName).toBe("Contoso MCP Gateway");
    expect(a.identifierUris).toEqual(["api://11111111-2222-4333-8444-555555555555/contoso-mcp-gateway"]);
    expect(a.api.requestedAccessTokenVersion).toBe(2);
    expect(a.web.redirectUris).toEqual(["https://mcp.contoso.example/interaction/callback"]);
    expect(a.appRoles.map((r) => [r.value, r.allowedMemberTypes, r.isEnabled])).toEqual([
      ["it-ops", ["User"], true],
      ["helpdesk", ["User"], true],
    ]);
    expect(a.requiredResourceAccess[0]!.resourceAppId).toBe("00000003-0000-0000-c000-000000000000");
    expect(a.requiredResourceAccess[0]!.resourceAccess).toHaveLength(4);
    expect(plan.adminConsent).toMatchObject({ consentType: "AllPrincipals", scope: "openid profile offline_access User.Read" });
    expect(plan.graphAppPermissions).toEqual({
      resourceAppId: "00000003-0000-0000-c000-000000000000",
      permissions: [
        { value: "Application.Read.All", id: "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30" },
        { value: "GroupMember.Read.All", id: "98830695-27a2-44f7-8c18-0c3ebc9698f6" },
        { value: "User.Read.All", id: "df021288-bdef-4463-88db-98f22de89214" },
      ],
    });
    expect(plan.appRoleAssignments).toEqual([
      { role: "helpdesk", groupId: "aaaaaaaa-0000-4000-8000-000000000002" },
      { role: "it-ops", groupId: "aaaaaaaa-0000-4000-8000-000000000001" },
    ]);
    expect(plan.gatewayEnv).toMatchObject({
      BROKER_UPSTREAM_KIND: "entra",
      BROKER_UPSTREAM_ISSUER: "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0",
      BROKER_REFRESH_TOKEN_TTL: "28800",
      ENTRA_MEMBERSHIP_CHECK: "1",
    });
  });

  it("is byte-identical on rerun", () => {
    const one = makePlan(org, answers, connectors);
    const two = makePlan(org, answers, connectors);
    expect(JSON.stringify(two.plan, null, 2)).toBe(JSON.stringify(one.plan, null, 2));
    expect(two.policyYaml).toBe(one.policyYaml);
  });

  it("derives role ids from tenant and role name (UUID v5)", () => {
    expect(uuidV5("python.org", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
    const ids = buildPlan(makePlan(org, answers, connectors).answers).application.appRoles.map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe(uuidV5("11111111-2222-4333-8444-555555555555:it-ops"));
    expect(uuidV5("other-tenant:it-ops")).not.toBe(ids[0]);
  });

  it("round-trips through parsePlan", () => {
    const { plan } = makePlan(org, answers, connectors);
    expect(parsePlan(JSON.stringify(plan))).toEqual(plan);
    expect(() => parsePlan("{}")).toThrow(/plan\.json: version must be 1/);
  });
});

describe("plan: strict validation of answers.yaml", () => {
  it("rejects a group id that is not in the org model", () => {
    const msg = problemsFor((d) => (d.roles[0].groups = ["aaaaaaaa-0000-4000-8000-0000000000ff"]));
    expect(msg).toContain('roles[0].groups[0]: unknown group id "aaaaaaaa-0000-4000-8000-0000000000ff"');
  });

  it("rejects a connector that is not in the catalog", () => {
    const msg = problemsFor((d) => (d.roles[0].grants[0].connectors = ["ninjaone", "nosuchvendor"]));
    expect(msg).toContain('roles[0].grants[0].connectors[1]: unknown connector "nosuchvendor"');
  });

  it("rejects an effect outside read, write, destructive", () => {
    const msg = problemsFor((d) => (d.roles[1].grants[0].effects = ["read", "admin"]));
    expect(msg).toContain('roles[1].grants[0].effects[1]: unknown effect "admin"');
  });

  it("rejects unknown keys at every level", () => {
    expect(problemsFor((d) => (d.surprise = 1))).toContain('answers: unknown key "surprise"');
    expect(problemsFor((d) => (d.roles[0].owner = "me"))).toContain('roles[0]: unknown key "owner"');
    expect(problemsFor((d) => (d.roles[0].grants[0].tools = []))).toContain('roles[0].grants[0]: unknown key "tools"');
  });

  it("reports every problem at once", () => {
    const msg = problemsFor((d) => {
      d.refreshHours = 0;
      d.gatewayUrl = "http://mcp.contoso.example/path";
      d.roles[0].name = "Bad Name";
    });
    expect(msg).toContain("refreshHours");
    expect(msg).toContain("gatewayUrl: must be https");
    expect(msg).toContain("roles[0].name");
  });

  it("rejects a tenant id that differs from the discovered tenant, and duplicate roles", () => {
    expect(problemsFor((d) => (d.tenantId = "99999999-2222-4333-8444-555555555555"))).toContain("does not match the discovered tenant");
    expect(problemsFor((d) => (d.roles[1].name = "it-ops"))).toContain('duplicate role "it-ops"');
  });
});
