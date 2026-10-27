import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { EFFECTS, parsePolicy, type Effect } from "../policy.js";
import type { OrgModel } from "./discover.js";

// Offline: org-model.json + answers.yaml -> policy.yaml (gateway policy format)
// and plan.json (the desired Entra state, applied by `provision`).
//
// Refs (Microsoft Learn):
//   identifier URI formats  https://learn.microsoft.com/en-us/entra/identity-platform/identifier-uri-restrictions
//   application resource    https://learn.microsoft.com/en-us/graph/api/resources/application?view=graph-rest-1.0
//   appRole resource        https://learn.microsoft.com/en-us/graph/api/resources/approle?view=graph-rest-1.0
//   Graph permission ids    https://learn.microsoft.com/en-us/graph/permissions-reference

export class AnswersError extends Error {
  constructor(readonly problems: string[]) {
    super(`answers.yaml is invalid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "AnswersError";
  }
}

export interface Grant {
  connectors: string[];
  effects: Effect[];
  deny_tools: string[];
}
export interface RoleAnswer {
  name: string;
  description: string;
  groups: string[];
  grants: Grant[];
}
export interface Answers {
  version: 1;
  tenantId: string;
  gatewayUrl: string;
  appName: string;
  refreshHours: number;
  roles: RoleAnswer[];
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// App role values may not contain spaces; keep them to a conservative alphabet.
const ROLE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function catalogConnectorIds(): string[] {
  const path = fileURLToPath(new URL("../../catalog/catalog.json", import.meta.url));
  const doc = JSON.parse(readFileSync(path, "utf8")) as { connectors: Array<{ id: string }> };
  return doc.connectors.map((c) => c.id);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function checkKeys(o: Obj, allowed: readonly string[], where: string, problems: string[]): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) problems.push(`${where}: unknown key "${k}" (allowed: ${allowed.join(", ")})`);
}

function stringList(v: unknown, where: string, problems: string[], opts: { nonEmpty: boolean }): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.length > 0)) {
    problems.push(`${where}: must be a list of non-empty strings`);
    return [];
  }
  if (opts.nonEmpty && v.length === 0) problems.push(`${where}: must not be empty`);
  return v as string[];
}

export function parseAnswers(text: string, org: OrgModel, connectorIds: readonly string[]): Answers {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new AnswersError([`not valid YAML: ${err instanceof Error ? err.message : String(err)}`]);
  }
  const problems: string[] = [];
  if (!isObj(doc)) throw new AnswersError(["document must be a mapping"]);
  checkKeys(doc, ["version", "tenantId", "gatewayUrl", "appName", "refreshHours", "roles"], "answers", problems);

  if (doc.version !== 1) problems.push(`version: must be 1, got ${JSON.stringify(doc.version)}`);

  const tenantId = typeof doc.tenantId === "string" ? doc.tenantId.toLowerCase() : "";
  if (!GUID_RE.test(tenantId)) problems.push("tenantId: must be a GUID");
  else if (tenantId !== org.tenantId.toLowerCase()) problems.push(`tenantId: ${tenantId} does not match the discovered tenant ${org.tenantId}`);

  let gatewayUrl = "";
  if (typeof doc.gatewayUrl !== "string") problems.push("gatewayUrl: required (https://<host>)");
  else {
    try {
      const u = new URL(doc.gatewayUrl);
      if (u.protocol !== "https:") problems.push("gatewayUrl: must be https");
      else if ((u.pathname !== "/" && u.pathname !== "") || u.search || u.hash || u.username) {
        problems.push("gatewayUrl: must be just https://<host> (no path, query or credentials)");
      } else gatewayUrl = u.origin;
    } catch {
      problems.push("gatewayUrl: not a valid URL");
    }
  }

  const appName = typeof doc.appName === "string" ? doc.appName.trim() : "";
  if (!appName || appName.length > 120) problems.push("appName: required, at most 120 characters");
  else if (slugify(appName) === "") problems.push("appName: must contain letters or digits");

  const refreshHours = doc.refreshHours;
  if (typeof refreshHours !== "number" || !Number.isInteger(refreshHours) || refreshHours < 1 || refreshHours > 2160) {
    problems.push("refreshHours: must be an integer from 1 to 2160");
  }

  const groupIds = new Set(org.groups.map((g) => g.id.toLowerCase()));
  const known = new Set(connectorIds);
  const roles: RoleAnswer[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(doc.roles) || doc.roles.length === 0) problems.push("roles: must be a non-empty list");
  else {
    doc.roles.forEach((raw, i) => {
      const at = `roles[${i}]`;
      if (!isObj(raw)) {
        problems.push(`${at}: must be a mapping`);
        return;
      }
      checkKeys(raw, ["name", "description", "groups", "grants"], at, problems);
      const name = typeof raw.name === "string" ? raw.name : "";
      if (!ROLE_NAME_RE.test(name)) problems.push(`${at}.name: must match ${ROLE_NAME_RE} (lowercase letters, digits, . _ -)`);
      else if (seen.has(name)) problems.push(`${at}.name: duplicate role "${name}"`);
      else seen.add(name);
      if (typeof raw.description !== "string" || !raw.description.trim()) problems.push(`${at}.description: required`);

      const groups = stringList(raw.groups, `${at}.groups`, problems, { nonEmpty: true });
      groups.forEach((g, j) => {
        if (!groupIds.has(g.toLowerCase())) problems.push(`${at}.groups[${j}]: unknown group id "${g}" (not in org-model.json)`);
      });

      const grants: Grant[] = [];
      if (!Array.isArray(raw.grants) || raw.grants.length === 0) problems.push(`${at}.grants: must be a non-empty list`);
      else {
        raw.grants.forEach((rg, k) => {
          const gat = `${at}.grants[${k}]`;
          if (!isObj(rg)) {
            problems.push(`${gat}: must be a mapping`);
            return;
          }
          checkKeys(rg, ["connectors", "effects", "deny_tools"], gat, problems);
          const connectors = stringList(rg.connectors, `${gat}.connectors`, problems, { nonEmpty: true });
          connectors.forEach((c, m) => {
            if (!known.has(c)) problems.push(`${gat}.connectors[${m}]: unknown connector "${c}" (catalog has: ${[...known].sort().join(", ")})`);
          });
          const effects = stringList(rg.effects, `${gat}.effects`, problems, { nonEmpty: true });
          effects.forEach((e, m) => {
            if (!EFFECTS.includes(e as Effect)) problems.push(`${gat}.effects[${m}]: unknown effect "${e}" (allowed: ${EFFECTS.join(", ")})`);
          });
          const deny = rg.deny_tools === undefined ? [] : stringList(rg.deny_tools, `${gat}.deny_tools`, problems, { nonEmpty: false });
          grants.push({ connectors, effects: effects as Effect[], deny_tools: deny });
        });
      }
      roles.push({ name, description: typeof raw.description === "string" ? raw.description.trim() : "", groups, grants });
    });
  }

  if (problems.length > 0) throw new AnswersError(problems);
  return { version: 1, tenantId, gatewayUrl, appName, refreshHours: refreshHours as number, roles };
}

// ---------------------------------------------------------------------------
// Desired Entra state
// ---------------------------------------------------------------------------

// UUID v5 (RFC 9562): SHA-1 over namespace + name. Stable across reruns.
const ROLE_NAMESPACE = "6f1f5f4e-8c1b-4c52-9a55-2f2c7d8a1b10";

export function uuidV5(name: string, namespace = ROLE_NAMESPACE): string {
  const ns = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const h = createHash("sha1").update(ns).update(name, "utf8").digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
// Delegated permission ids of Microsoft Graph, checked against the Graph permissions
// reference (Delegated column of the openid, profile, offline_access and User.Read entries):
// https://learn.microsoft.com/en-us/graph/permissions-reference
export const GRAPH_SCOPES: ReadonlyArray<{ value: string; id: string }> = [
  { value: "openid", id: "37f7f235-527c-4136-accd-4a02d197296e" },
  { value: "profile", id: "14dad69e-099b-42c9-810b-d002981feec1" },
  { value: "offline_access", id: "7427e0e9-2fba-42fe-b0c0-848c9e6a8182" },
  { value: "User.Read", id: "e1fe6dd8-ba31-4d61-89e7-88639da4683d" },
];

// Application permissions (app roles of the Microsoft Graph service principal) that
// the gateway's refresh-time membership check uses, checked against the Application
// column of https://learn.microsoft.com/en-us/graph/permissions-reference
// Granted by `provision` through POST /servicePrincipals/{graphSpId}/appRoleAssignedTo:
// https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-approleassignedto?view=graph-rest-1.0
export const GRAPH_APP_PERMISSIONS: ReadonlyArray<{ value: string; id: string }> = [
  { value: "Application.Read.All", id: "9a5d68dd-52b0-4cc2-bd40-abcf44ac3a30" },
  { value: "GroupMember.Read.All", id: "98830695-27a2-44f7-8c18-0c3ebc9698f6" },
  { value: "User.Read.All", id: "df021288-bdef-4463-88db-98f22de89214" },
];

export interface AppRoleDef {
  id: string;
  allowedMemberTypes: ["User"];
  displayName: string;
  description: string;
  value: string;
  isEnabled: true;
}

export interface Plan {
  version: 1;
  tenantId: string;
  gatewayUrl: string;
  // Optional: pin an existing app registration instead of matching by name + identifier URI.
  appId: string | null;
  application: {
    displayName: string;
    identifierUris: string[];
    signInAudience: "AzureADMyOrg";
    api: { requestedAccessTokenVersion: 2 };
    appRoles: AppRoleDef[];
    web: { redirectUris: string[] };
    requiredResourceAccess: Array<{ resourceAppId: string; resourceAccess: Array<{ id: string; type: "Scope" }> }>;
  };
  appRoleAssignments: Array<{ role: string; groupId: string }>;
  adminConsent: { consentType: "AllPrincipals"; resourceAppId: string; scope: string };
  // Application permissions granted to the gateway service principal (and optionally a
  // managed identity) so the refresh-time membership check can call Graph.
  graphAppPermissions: { resourceAppId: string; permissions: Array<{ value: string; id: string }> };
  gatewayEnv: Record<string, string>;
}

export function buildPlan(answers: Answers): Plan {
  const { tenantId } = answers;
  const appRoles: AppRoleDef[] = answers.roles.map((r) => ({
    id: uuidV5(`${tenantId}:${r.name}`),
    allowedMemberTypes: ["User"],
    displayName: r.name,
    description: r.description,
    value: r.name,
    isEnabled: true,
  }));
  const assignments = answers.roles
    .flatMap((r) => r.groups.map((g) => ({ role: r.name, groupId: g.toLowerCase() })))
    .sort((a, b) => (a.role === b.role ? a.groupId.localeCompare(b.groupId) : a.role.localeCompare(b.role)));
  const scope = GRAPH_SCOPES.map((s) => s.value).join(" ");
  return {
    version: 1,
    tenantId,
    gatewayUrl: answers.gatewayUrl,
    appId: null,
    application: {
      displayName: answers.appName,
      // api://<tenantId>/<string> is one of the documented secure identifier URI patterns.
      identifierUris: [`api://${tenantId}/${slugify(answers.appName)}`],
      signInAudience: "AzureADMyOrg",
      api: { requestedAccessTokenVersion: 2 },
      appRoles,
      web: { redirectUris: [`${answers.gatewayUrl}/interaction/callback`] },
      requiredResourceAccess: [
        { resourceAppId: GRAPH_APP_ID, resourceAccess: GRAPH_SCOPES.map((s) => ({ id: s.id, type: "Scope" as const })) },
      ],
    },
    appRoleAssignments: assignments,
    adminConsent: { consentType: "AllPrincipals", resourceAppId: GRAPH_APP_ID, scope },
    graphAppPermissions: { resourceAppId: GRAPH_APP_ID, permissions: GRAPH_APP_PERMISSIONS.map((x) => ({ ...x })) },
    gatewayEnv: {
      GATEWAY_MODE: "broker",
      PUBLIC_BASE_URL: answers.gatewayUrl,
      BROKER_UPSTREAM_KIND: "entra",
      BROKER_UPSTREAM_ISSUER: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      BROKER_REFRESH_TOKEN_TTL: String(answers.refreshHours * 3600),
      ENTRA_MEMBERSHIP_CHECK: "1",
    },
  };
}

// policy.yaml in the gateway's own format. The app role value is the gateway
// role name, so a signed-in user's "roles" claim selects the grants directly.
export function buildPolicyYaml(answers: Answers): string {
  const doc = {
    version: 1,
    subjects: answers.roles.map((r) => ({ role: r.name, when: { claim: "roles", equals: r.name } })),
    grants: answers.roles.flatMap((r) =>
      r.grants.map((g) => ({
        role: r.name,
        connectors: g.connectors,
        effects: g.effects,
        ...(g.deny_tools.length > 0 ? { deny_tools: g.deny_tools } : {}),
      })),
    ),
  };
  return `# Generated by mcp-gateway admin plan. Edit answers.yaml and re-run plan instead of editing this file.\n${stringifyYaml(doc, { lineWidth: 0 })}`;
}

export interface PlanResult {
  answers: Answers;
  plan: Plan;
  policyYaml: string;
}

export function makePlan(org: OrgModel, answersText: string, connectorIds: readonly string[] = catalogConnectorIds()): PlanResult {
  const answers = parseAnswers(answersText, org, connectorIds);
  const plan = buildPlan(answers);
  const policyYaml = buildPolicyYaml(answers);
  // The generated policy must load in the gateway itself.
  parsePolicy(policyYaml, connectorIds);
  return { answers, plan, policyYaml };
}

export function renderPlanSummary(answers: Answers, plan: Plan, org: OrgModel): string {
  const groupName = new Map(org.groups.map((g) => [g.id.toLowerCase(), g.displayName]));
  const a = plan.application;
  const lines = [
    `Plan for tenant ${plan.tenantId}`,
    `+ application "${a.displayName}"  identifierUri ${a.identifierUris[0]}  (access token v2)`,
    `+ redirect URI ${a.web.redirectUris[0]}`,
    `+ delegated permissions ${plan.adminConsent.scope} (tenant-wide admin consent)`,
  ];
  if (plan.graphAppPermissions.permissions.length > 0) {
    lines.push(`+ Graph application permissions ${plan.graphAppPermissions.permissions.map((x) => x.value).join(" ")} (granted to the gateway service principal, plus a managed identity with --managed-identity-principal-id)`);
  }
  for (const r of answers.roles) {
    const role = a.appRoles.find((x) => x.value === r.name)!;
    lines.push(`+ app role ${r.name}  id ${role.id}`);
    for (const g of r.groups) lines.push(`    + assign group ${groupName.get(g.toLowerCase()) ?? g} (${g.toLowerCase()})`);
    for (const g of r.grants) {
      lines.push(`    + grant ${g.connectors.join(",")}: ${g.effects.join(",")}${g.deny_tools.length ? `  deny ${g.deny_tools.join(",")}` : ""}`);
    }
  }
  lines.push("+ gateway env:", ...Object.entries(plan.gatewayEnv).map(([k, v]) => `    ${k}=${v}`));
  return lines.join("\n");
}

// plan.json is hand-reviewable and could be hand-edited; check its shape before
// provision acts on it.
export function parsePlan(text: string): Plan {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new AnswersError(["plan.json: not valid JSON"]);
  }
  const problems: string[] = [];
  const p = doc as Partial<Plan> | null;
  if (!p || typeof p !== "object" || p.version !== 1) problems.push("version must be 1");
  if (typeof p?.tenantId !== "string" || !GUID_RE.test(p.tenantId)) problems.push("tenantId must be a GUID");
  const a = p?.application;
  if (!a || typeof a.displayName !== "string" || !a.displayName) problems.push("application.displayName is required");
  if (!Array.isArray(a?.identifierUris) || a.identifierUris.length === 0) problems.push("application.identifierUris is required");
  if (!Array.isArray(a?.appRoles)) problems.push("application.appRoles must be a list");
  if (!Array.isArray(a?.web?.redirectUris)) problems.push("application.web.redirectUris must be a list");
  if (!Array.isArray(p?.appRoleAssignments)) problems.push("appRoleAssignments must be a list");
  if (typeof p?.adminConsent?.scope !== "string") problems.push("adminConsent.scope is required");
  const gp = p?.graphAppPermissions;
  if (gp !== undefined) {
    const okList =
      Array.isArray(gp?.permissions) &&
      gp.permissions.every((x) => typeof x?.value === "string" && x.value.length > 0 && typeof x?.id === "string" && GUID_RE.test(x.id));
    if (typeof gp?.resourceAppId !== "string" || !GUID_RE.test(gp.resourceAppId) || !okList) {
      problems.push("graphAppPermissions must be { resourceAppId: GUID, permissions: [{ value, id: GUID }] }");
    }
  }
  if (p?.appId !== null && p?.appId !== undefined && (typeof p.appId !== "string" || !GUID_RE.test(p.appId))) problems.push("appId must be null or a GUID");
  if (problems.length > 0) throw new AnswersError(problems.map((m) => `plan.json: ${m}`));
  // A plan written before graphAppPermissions existed grants no application permissions.
  return { ...(p as Plan), appId: p!.appId ?? null, graphAppPermissions: p!.graphAppPermissions ?? { resourceAppId: GRAPH_APP_ID, permissions: [] } };
}
