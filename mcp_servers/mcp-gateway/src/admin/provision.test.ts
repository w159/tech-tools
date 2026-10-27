import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { FAKE_GRAPH_APP_ROLES, FAKE_GRAPH_SP_ID, FAKE_TENANT_ID, FakeGraph, GROUP_HELPDESK, GROUP_IT_OPS } from "../test-fixtures/fake-graph.js";
import { fixturePath } from "../test-fixtures/admin-helpers.js";
import { GraphClient } from "./graph.js";
import { catalogConnectorIds, makePlan, type Plan } from "./plan.js";
import { provision, ProvisionError, type ProvisionOptions } from "./provision.js";
import type { OrgModel } from "./discover.js";

const TOKEN = "provision-token-0003";
const org = JSON.parse(readFileSync(fixturePath("org-model.json"), "utf8")) as OrgModel;
const answersText = readFileSync(fixturePath("answers.yaml"), "utf8");

function planFrom(mutate?: (doc: Record<string, any>) => void): Plan {
  const doc = parseYaml(answersText) as Record<string, any>;
  mutate?.(doc);
  return makePlan(org, JSON.stringify(doc), catalogConnectorIds()).plan;
}

let fake: FakeGraph;
beforeEach(async () => {
  fake = new FakeGraph({ token: TOKEN, pageSize: 2 });
  await fake.start();
});
afterEach(async () => fake.stop());

const run = (plan: Plan, opts: Partial<ProvisionOptions> & { apply: boolean }, readOnly = !opts.apply) =>
  provision(new GraphClient({ baseUrl: fake.baseUrl, token: TOKEN, readOnly, sleep: async () => undefined }), plan, { prune: false, ...opts });

const writes = (): string[] => fake.nonGet().map((r) => `${r.method} ${r.path.replace(/[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g, "<id>")}`);

describe("provision dry run", () => {
  it("sends only GETs and lists the writes it would make", async () => {
    const r = await run(planFrom(), { apply: false });
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(fake.requests.every((q) => q.method === "GET")).toBe(true);
    expect(r.steps.map((s) => `${s.method} ${s.path.replace(/\{[^}]+\}|[0-9a-f]{8}-0000-4000-8000-[0-9a-f]{12}/g, "{x}")}`)).toEqual([
      "POST /applications",
      "POST /servicePrincipals",
      "POST /servicePrincipals/{x}/appRoleAssignedTo",
      "POST /servicePrincipals/{x}/appRoleAssignedTo",
      "POST /oauth2PermissionGrants",
      "POST /servicePrincipals/{x}/appRoleAssignedTo",
      "POST /servicePrincipals/{x}/appRoleAssignedTo",
      "POST /servicePrincipals/{x}/appRoleAssignedTo",
    ]);
    expect(r.steps.slice(-3).map((x) => x.description)).toEqual([
      `grant Graph application permission Application.Read.All (${FAKE_GRAPH_APP_ROLES[0]!.id}) to the gateway service principal`,
      `grant Graph application permission GroupMember.Read.All (${FAKE_GRAPH_APP_ROLES[1]!.id}) to the gateway service principal`,
      `grant Graph application permission User.Read.All (${FAKE_GRAPH_APP_ROLES[2]!.id}) to the gateway service principal`,
    ]);
    expect(fake.applications).toHaveLength(0);
    expect(fake.servicePrincipals).toHaveLength(1);
  });
});

describe("provision --apply", () => {
  it("on an empty tenant sends the expected writes in order", async () => {
    const plan = planFrom();
    const r = await run(plan, { apply: true });
    expect(writes()).toEqual([
      "POST /v1.0/applications",
      "POST /v1.0/servicePrincipals",
      "POST /v1.0/servicePrincipals/<id>/appRoleAssignedTo",
      "POST /v1.0/servicePrincipals/<id>/appRoleAssignedTo",
      "POST /v1.0/oauth2PermissionGrants",
      "POST /v1.0/servicePrincipals/<id>/appRoleAssignedTo",
      "POST /v1.0/servicePrincipals/<id>/appRoleAssignedTo",
      "POST /v1.0/servicePrincipals/<id>/appRoleAssignedTo",
    ]);
    const app = fake.applications[0]!;
    expect(app.displayName).toBe("Contoso MCP Gateway");
    expect(app.identifierUris).toEqual(plan.application.identifierUris);
    expect(app.api).toMatchObject({ requestedAccessTokenVersion: 2 });
    expect(app.web.redirectUris).toEqual(plan.application.web.redirectUris);
    expect(app.appRoles.map((x) => x.value)).toEqual(["it-ops", "helpdesk"]);
    const sp = fake.servicePrincipals.find((s) => s.appId === app.appId)!;
    expect(fake.assignments.filter((a) => a.resourceId === sp.id).map((a) => [a.principalId, a.resourceId])).toEqual([
      [GROUP_HELPDESK, sp.id],
      [GROUP_IT_OPS, sp.id],
    ]);
    // the three Graph application permissions, by id, to the gateway service principal
    expect(fake.assignments.filter((a) => a.resourceId === FAKE_GRAPH_SP_ID).map((a) => [a.principalId, a.principalType, a.appRoleId])).toEqual(
      FAKE_GRAPH_APP_ROLES.slice(0, 3).map((x) => [sp.id, "ServicePrincipal", x.id]),
    );
    expect(fake.grants).toEqual([
      expect.objectContaining({ clientId: sp.id, consentType: "AllPrincipals", scope: "openid profile offline_access User.Read" }),
    ]);
    expect(r.appId).toBe(app.appId);
    expect(r.servicePrincipalId).toBe(sp.id);
  });

  it("a second apply against the same state makes zero writes", async () => {
    const plan = planFrom();
    await run(plan, { apply: true });
    fake.clearRequests();
    const r = await run(plan, { apply: true });
    expect(fake.nonGet()).toEqual([]);
    expect(r.steps).toEqual([]);
  });

  it("repairs drift with only the missing writes", async () => {
    const plan = planFrom();
    await run(plan, { apply: true });
    fake.assignments.splice(0, 1);
    fake.applications[0]!.web.redirectUris = [];
    fake.grants[0]!.scope = "openid";
    fake.clearRequests();
    await run(plan, { apply: true });
    expect(writes()).toEqual([
      "PATCH /v1.0/applications/<id>",
      "POST /v1.0/servicePrincipals/<id>/appRoleAssignedTo",
      "PATCH /v1.0/oauth2PermissionGrants/<id>",
    ]);
    expect(fake.applications[0]!.web.redirectUris).toEqual(plan.application.web.redirectUris);
    expect(fake.grants[0]!.scope).toBe("openid profile offline_access User.Read");
  });

  it("keeps a role that left the answers, and its assignments, unless --prune", async () => {
    await run(planFrom(), { apply: true });
    const smaller = planFrom((d) => d.roles.splice(1, 1));
    fake.clearRequests();
    const r = await run(smaller, { apply: true });
    expect(fake.nonGet()).toEqual([]);
    expect(fake.applications[0]!.appRoles.map((x) => x.value)).toEqual(["it-ops", "helpdesk"]);
    expect(fake.assignments.filter((a) => a.principalType === "Group")).toHaveLength(2);
    expect(r.notes.join("\n")).toContain('app role "helpdesk"');
    expect(r.notes.join("\n")).toContain("use --prune");
  });

  it("--prune removes the assignments, disables the role, then removes it", async () => {
    await run(planFrom(), { apply: true });
    const smaller = planFrom((d) => d.roles.splice(1, 1));
    fake.clearRequests();
    await run(smaller, { apply: true, prune: true });
    expect(writes()).toEqual([
      "DELETE /v1.0/servicePrincipals/<id>/appRoleAssignedTo/<id>",
      "PATCH /v1.0/applications/<id>",
      "PATCH /v1.0/applications/<id>",
    ]);
    const disable = fake.nonGet()[1]!.body as { appRoles: Array<{ value: string; isEnabled: boolean }> };
    expect(disable.appRoles.find((x) => x.value === "helpdesk")!.isEnabled).toBe(false);
    expect(fake.applications[0]!.appRoles.map((x) => x.value)).toEqual(["it-ops"]);
    expect(fake.assignments.filter((a) => a.principalType === "Group").map((a) => a.principalId)).toEqual([GROUP_IT_OPS]);
    fake.clearRequests();
    await run(smaller, { apply: true, prune: true });
    expect(fake.nonGet()).toEqual([]);
  });

  it("grants a missing Graph permission only, and never removes one", async () => {
    const plan = planFrom();
    await run(plan, { apply: true });
    const idx = fake.assignments.findIndex((a) => a.resourceId === FAKE_GRAPH_SP_ID && a.appRoleId === FAKE_GRAPH_APP_ROLES[1]!.id);
    fake.assignments.splice(idx, 1);
    fake.clearRequests();
    await run(plan, { apply: true, prune: true });
    expect(fake.nonGet().map((r) => (r.body as { appRoleId: string }).appRoleId)).toEqual([FAKE_GRAPH_APP_ROLES[1]!.id]);
  });

  it("with a managed identity grants the three to it only, once", async () => {
    const plan = planFrom();
    const mi = fake.addManagedIdentity();
    const dry = await run(plan, { apply: false, managedIdentityPrincipalId: mi });
    expect(dry.steps.filter((s) => s.description.endsWith("to the managed identity"))).toHaveLength(3);
    expect(dry.steps.filter((s) => s.description.endsWith("to the gateway service principal"))).toHaveLength(0);
    expect(fake.nonGet()).toEqual([]);
    await run(plan, { apply: true, managedIdentityPrincipalId: mi });
    expect(fake.assignments.filter((a) => a.principalId === mi).map((a) => a.appRoleId)).toEqual(FAKE_GRAPH_APP_ROLES.slice(0, 3).map((x) => x.id));
    // The gateway's own service principal holds no tenant-wide Graph permission.
    const sp = fake.servicePrincipals.find((s) => s.appId === fake.applications[0]!.appId)!;
    expect(fake.assignments.filter((a) => a.principalId === sp.id && a.resourceId === FAKE_GRAPH_SP_ID)).toEqual([]);
    fake.clearRequests();
    const again = await run(plan, { apply: true, managedIdentityPrincipalId: mi });
    expect(again.steps).toEqual([]);
    expect(fake.nonGet()).toEqual([]);
  });

  it("a plan without graphAppPermissions grants none", async () => {
    const plan = planFrom();
    plan.graphAppPermissions.permissions = [];
    await run(plan, { apply: true });
    expect(fake.assignments.filter((a) => a.resourceId === FAKE_GRAPH_SP_ID)).toEqual([]);
  });

  it("refuses a plan whose Graph permission id is not the known id for its value, before any request", async () => {
    const plan = planFrom();
    // Names a read-only permission, carries the id of a different (real) Graph role.
    plan.graphAppPermissions.permissions[0] = { value: "Application.Read.All", id: "1bfefb4e-e0b5-418b-a88f-73c46d2cc8e9" };
    await expect(run(plan, { apply: true })).rejects.toThrow(/Application\.Read\.All \(1bfefb4e-.*not a permission this tool grants/);
    expect(fake.requests).toEqual([]);
  });

  it("refuses an unknown consentType or a non-GUID resourceAppId, before any request", async () => {
    const bad = planFrom();
    bad.adminConsent.consentType = "Principal" as never;
    await expect(run(bad, { apply: false })).rejects.toThrow(/consentType must be one of: AllPrincipals/);
    const inject = planFrom();
    inject.adminConsent.resourceAppId = "x' or appId ne '";
    await expect(run(inject, { apply: false })).rejects.toThrow(/adminConsent\.resourceAppId must be a GUID/);
    expect(fake.requests).toEqual([]);
  });

  it("stops at the first failure and says where", async () => {
    fake.failNext("POST", /\/servicePrincipals$/, 500);
    const err = await run(planFrom(), { apply: true }).catch((e: unknown) => e as ProvisionError);
    expect(err).toBeInstanceOf(ProvisionError);
    expect(err.message).toMatch(/stopped at POST \/servicePrincipals \(create service principal/);
    expect(err.message).toContain("1 earlier write(s) were applied");
    expect(writes()).toEqual(["POST /v1.0/applications", "POST /v1.0/servicePrincipals"]);
  });

  it("refuses to apply a plan to a different tenant", async () => {
    const plan = { ...planFrom(), tenantId: "99999999-2222-4333-8444-555555555555" };
    await expect(run(plan, { apply: true })).rejects.toThrow(new RegExp(`token is for tenant ${FAKE_TENANT_ID}`));
    expect(fake.nonGet()).toEqual([]);
  });

  it("updates an existing application in place when a role description changes", async () => {
    await run(planFrom(), { apply: true });
    const changed = planFrom((d) => (d.roles[0].description = "New wording"));
    fake.clearRequests();
    await run(changed, { apply: true });
    expect(writes()).toEqual(["PATCH /v1.0/applications/<id>"]);
    expect(fake.applications[0]!.appRoles.find((x) => x.value === "it-ops")!.description).toBe("New wording");
  });
});
