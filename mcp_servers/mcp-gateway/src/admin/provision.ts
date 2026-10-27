import { GraphClient, GraphError, odataString } from "./graph.js";
import { planGrantProblems, type AppRoleDef, type Plan } from "./plan.js";

// Reads current Entra state with GETs, computes the minimal writes to reach the
// plan, and (with apply) performs them in order, stopping at the first failure.
// Nothing is deleted unless prune is set.
//
// Refs (Microsoft Learn, v1.0):
//   create application          https://learn.microsoft.com/en-us/graph/api/application-post-applications?view=graph-rest-1.0
//   update application (PATCH)  https://learn.microsoft.com/en-us/graph/api/application-update?view=graph-rest-1.0
//   create servicePrincipal     https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-serviceprincipals?view=graph-rest-1.0
//   appRoleAssignedTo (GET/POST/DELETE)
//                               https://learn.microsoft.com/en-us/graph/api/serviceprincipal-post-approleassignedto?view=graph-rest-1.0
//                               https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-approleassignedto?view=graph-rest-1.0
//                               https://learn.microsoft.com/en-us/graph/api/serviceprincipal-delete-approleassignedto?view=graph-rest-1.0
//   appRoleAssignments (list on a principal)
//                               https://learn.microsoft.com/en-us/graph/api/serviceprincipal-list-approleassignments?view=graph-rest-1.0
//   application permissions     https://learn.microsoft.com/en-us/graph/permissions-reference
//   oAuth2PermissionGrant       https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-post?view=graph-rest-1.0
//                               https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-list?view=graph-rest-1.0
//                               https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-update?view=graph-rest-1.0

export class ProvisionError extends Error {
  constructor(
    message: string,
    readonly completed: Step[],
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

export interface Step {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  description: string;
}

export interface ProvisionOptions {
  apply: boolean;
  prune: boolean;
  // Object id of a managed identity's service principal. When set it receives the
  // Graph application permissions INSTEAD of the gateway's own service principal.
  managedIdentityPrincipalId?: string;
  onStep?: (step: Step) => void;
}

export interface ProvisionResult {
  steps: Step[];
  notes: string[];
  appId?: string;
  servicePrincipalId?: string;
}

interface LiveRole {
  id: string;
  allowedMemberTypes?: string[];
  displayName?: string;
  description?: string;
  value?: string;
  isEnabled?: boolean;
  origin?: string;
}

interface LiveApp {
  id: string;
  appId: string;
  displayName: string;
  identifierUris?: string[];
  api?: Record<string, unknown> & { requestedAccessTokenVersion?: number | null };
  appRoles?: LiveRole[];
  web?: Record<string, unknown> & { redirectUris?: string[] };
  requiredResourceAccess?: Array<{ resourceAppId: string; resourceAccess: Array<{ id: string; type: string }> }>;
}

interface Assignment {
  id: string;
  appRoleId: string;
  principalId: string;
  principalType?: string;
}

const SP_PLACEHOLDER = "{servicePrincipal.id}";

function sameSet(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
}

function roleDiffers(live: LiveRole, want: AppRoleDef): boolean {
  return (
    live.displayName !== want.displayName ||
    live.description !== want.description ||
    live.value !== want.value ||
    live.isEnabled !== true ||
    !sameSet(live.allowedMemberTypes, want.allowedMemberTypes)
  );
}

export async function provision(client: GraphClient, plan: Plan, opts: ProvisionOptions): Promise<ProvisionResult> {
  const steps: Step[] = [];
  const notes: string[] = [];
  const want = plan.application;

  async function write<T>(step: Step, run: () => Promise<T>, dryValue: T): Promise<T> {
    steps.push(step);
    opts.onStep?.(step);
    if (!opts.apply) return dryValue;
    try {
      return await run();
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      throw new ProvisionError(
        `stopped at ${step.method} ${step.path} (${step.description}): ${why}. ${steps.length - 1} earlier write(s) were applied; fix the cause and re-run, it resumes where it stopped.`,
        steps.slice(0, -1),
      );
    }
  }

  // Before any request: a hand-edited plan must not widen what gets granted.
  const unsafe = planGrantProblems(plan);
  if (unsafe.length > 0) throw new ProvisionError(`plan is not safe to apply: ${unsafe.join("; ")}`, []);

  // A plan is for one tenant; refuse to apply it to whichever tenant the token happens to be for.
  const orgs = await client.get<{ value: Array<{ id: string }> }>("/organization?$select=id");
  const tenant = orgs.value[0]?.id;
  if (!tenant || tenant.toLowerCase() !== plan.tenantId.toLowerCase()) {
    throw new ProvisionError(`the Graph token is for tenant ${tenant ?? "(unknown)"} but the plan is for ${plan.tenantId}`, []);
  }

  // ---- application -------------------------------------------------------
  const filter = plan.appId
    ? `appId eq '${odataString(plan.appId)}'`
    : `displayName eq '${odataString(want.displayName)}'`;
  const candidates = (await client.getAll<LiveApp>(`/applications?$filter=${encodeURIComponent(filter)}`)).filter(
    (a) => plan.appId || want.identifierUris.every((u) => (a.identifierUris ?? []).includes(u)),
  );
  if (candidates.length > 1) {
    throw new ProvisionError(
      `${candidates.length} applications match "${want.displayName}" with ${want.identifierUris[0]}; pin the right one by setting appId in plan.json`,
      [],
    );
  }
  let app = candidates[0];
  let appId = app?.appId;
  // role value -> id as it exists (or will exist) in the tenant
  const roleIds = new Map<string, string>();
  const removedRoleIds = new Set<string>();

  if (!app) {
    const body = {
      displayName: want.displayName,
      identifierUris: want.identifierUris,
      signInAudience: want.signInAudience,
      api: want.api,
      appRoles: want.appRoles,
      web: want.web,
      requiredResourceAccess: want.requiredResourceAccess,
    };
    const created = await write<LiveApp | undefined>(
      {
        method: "POST",
        path: "/applications",
        body,
        description: `create application "${want.displayName}" (${want.identifierUris[0]}, ${want.appRoles.length} app role(s))`,
      },
      () => client.send<LiveApp>("POST", "/applications", body),
      undefined,
    );
    if (created) appId = created.appId;
    for (const r of want.appRoles) roleIds.set(r.value, r.id);
  } else {
    const patch: Record<string, unknown> = {};
    const what: string[] = [];

    const missingUris = want.identifierUris.filter((u) => !(app!.identifierUris ?? []).includes(u));
    if (missingUris.length > 0) {
      patch.identifierUris = [...(app.identifierUris ?? []), ...missingUris];
      what.push("identifierUris");
    }
    if (app.api?.requestedAccessTokenVersion !== 2) {
      patch.api = { ...(app.api ?? {}), requestedAccessTokenVersion: 2 };
      what.push("access token version 2");
    }
    const missingRedirects = want.web.redirectUris.filter((u) => !(app!.web?.redirectUris ?? []).includes(u));
    if (missingRedirects.length > 0) {
      patch.web = { ...(app.web ?? {}), redirectUris: [...(app.web?.redirectUris ?? []), ...missingRedirects] };
      what.push("redirect URIs");
    }
    const rra = [...(app.requiredResourceAccess ?? []).map((e) => ({ ...e, resourceAccess: [...e.resourceAccess] }))];
    let rraChanged = false;
    for (const w of want.requiredResourceAccess) {
      let entry = rra.find((e) => e.resourceAppId === w.resourceAppId);
      if (!entry) {
        entry = { resourceAppId: w.resourceAppId, resourceAccess: [] };
        rra.push(entry);
      }
      for (const a of w.resourceAccess) {
        if (!entry.resourceAccess.some((x) => x.id === a.id && x.type === a.type)) {
          entry.resourceAccess.push({ ...a });
          rraChanged = true;
        }
      }
    }
    if (rraChanged) {
      patch.requiredResourceAccess = rra;
      what.push("required permissions");
    }

    // appRoles: PATCH replaces the whole collection, so every live role not in
    // the plan is carried through unchanged (it is only dropped with prune).
    const liveRoles = app.appRoles ?? [];
    const merged: LiveRole[] = [];
    let rolesChanged = false;
    const planned = new Set<string>();
    for (const live of liveRoles) {
      const match = want.appRoles.find((w) => w.id === live.id) ?? want.appRoles.find((w) => w.value === live.value);
      if (match) {
        planned.add(match.value);
        roleIds.set(match.value, live.id);
        if (roleDiffers(live, match)) {
          merged.push({ ...live, displayName: match.displayName, description: match.description, value: match.value, isEnabled: true, allowedMemberTypes: match.allowedMemberTypes });
          rolesChanged = true;
        } else merged.push(live);
      } else if (opts.prune) {
        removedRoleIds.add(live.id);
        notes.push(`prune: app role "${live.value}" (${live.id}) is not in the plan and will be removed`);
        merged.push(live); // removed in the later disable/remove steps, after its assignments are gone
      } else {
        notes.push(`kept: app role "${live.value}" (${live.id}) is in the tenant but not in the plan (use --prune to remove)`);
        merged.push(live);
      }
    }
    for (const w of want.appRoles) {
      if (!planned.has(w.value)) {
        merged.push({ ...w });
        roleIds.set(w.value, w.id);
        rolesChanged = true;
      }
    }
    if (rolesChanged) {
      patch.appRoles = merged;
      what.push("app roles");
    }

    if (Object.keys(patch).length > 0) {
      await write(
        { method: "PATCH", path: `/applications/${app.id}`, body: patch, description: `update application: ${what.join(", ")}` },
        () => client.send("PATCH", `/applications/${app!.id}`, patch),
        undefined,
      );
    }
  }

  // ---- service principal -------------------------------------------------
  let spId = SP_PLACEHOLDER;
  let spExists = false;
  if (appId) {
    const sps = await client.getAll<{ id: string }>(`/servicePrincipals?$filter=${encodeURIComponent(`appId eq '${odataString(appId)}'`)}&$select=id`);
    if (sps[0]) {
      spId = sps[0].id;
      spExists = true;
    }
  }
  if (!spExists) {
    const created = await write<{ id: string } | undefined>(
      { method: "POST", path: "/servicePrincipals", body: { appId: appId ?? "{application.appId}" }, description: "create service principal for the application" },
      () => client.send<{ id: string }>("POST", "/servicePrincipals", { appId }),
      undefined,
    );
    if (created) {
      spId = created.id;
      spExists = true;
    }
  }

  // ---- app role assignments ---------------------------------------------
  const live: Assignment[] = spExists ? await client.getAll<Assignment>(`/servicePrincipals/${spId}/appRoleAssignedTo`) : [];
  const key = (principalId: string, roleId: string): string => `${principalId.toLowerCase()}|${roleId.toLowerCase()}`;
  const have = new Set(live.map((a) => key(a.principalId, a.appRoleId)));
  const desired = new Set<string>();
  for (const a of plan.appRoleAssignments) {
    const roleId = roleIds.get(a.role) ?? want.appRoles.find((r) => r.value === a.role)?.id;
    if (!roleId) throw new ProvisionError(`assignment names role "${a.role}" which is not an app role in the plan`, steps);
    desired.add(key(a.groupId, roleId));
    if (have.has(key(a.groupId, roleId))) continue;
    const body = { principalId: a.groupId, resourceId: spId, appRoleId: roleId };
    await write(
      { method: "POST", path: `/servicePrincipals/${spId}/appRoleAssignedTo`, body, description: `assign group ${a.groupId} to role "${a.role}"` },
      () => client.send("POST", `/servicePrincipals/${spId}/appRoleAssignedTo`, body),
      undefined,
    );
  }
  const plannedRoleIds = new Set([...roleIds.values()].map((v) => v.toLowerCase()));
  const stale = live.filter(
    (a) =>
      removedRoleIds.has(a.appRoleId) ||
      (a.principalType === "Group" && plannedRoleIds.has(a.appRoleId.toLowerCase()) && !desired.has(key(a.principalId, a.appRoleId))),
  );
  if (stale.length > 0 && !opts.prune) {
    notes.push(`kept: ${stale.length} assignment(s) not in the plan (use --prune to remove)`);
  } else {
    for (const a of stale) {
      await write(
        { method: "DELETE", path: `/servicePrincipals/${spId}/appRoleAssignedTo/${a.id}`, description: `remove assignment of ${a.principalType ?? "principal"} ${a.principalId} (not in the plan)` },
        () => client.send("DELETE", `/servicePrincipals/${spId}/appRoleAssignedTo/${a.id}`),
        undefined,
      );
    }
  }

  // ---- prune: retire app roles that left the plan ------------------------
  // Entra requires a role to be disabled before it can be removed.
  if (opts.prune && app && removedRoleIds.size > 0) {
    const current = (app.appRoles ?? []).map((r) => ({ ...r }));
    const afterAdd = want.appRoles.filter((w) => !current.some((c) => c.id === w.id || c.value === w.value)).map((w) => ({ ...w }));
    const all = [...current.map((r) => (removedRoleIds.has(r.id) ? { ...r, isEnabled: false } : r)), ...afterAdd];
    const disableBody = { appRoles: all.map((r) => ({ ...r })) };
    await write(
      { method: "PATCH", path: `/applications/${app.id}`, body: disableBody, description: `disable ${removedRoleIds.size} app role(s) before removal` },
      () => client.send("PATCH", `/applications/${app!.id}`, disableBody),
      undefined,
    );
    const removeBody = { appRoles: all.filter((r) => !removedRoleIds.has(r.id)) };
    await write(
      { method: "PATCH", path: `/applications/${app.id}`, body: removeBody, description: `remove ${removedRoleIds.size} app role(s) not in the plan` },
      () => client.send("PATCH", `/applications/${app!.id}`, removeBody),
      undefined,
    );
  }

  // ---- tenant-wide delegated consent ------------------------------------
  const resourceSps = await client.getAll<{ id: string }>(
    `/servicePrincipals?$filter=${encodeURIComponent(`appId eq '${odataString(plan.adminConsent.resourceAppId)}'`)}&$select=id`,
  );
  const resourceSp = resourceSps[0];
  if (!resourceSp) throw new GraphError(`resource service principal ${plan.adminConsent.resourceAppId} (Microsoft Graph) not found in the tenant`);
  const wantScopes = plan.adminConsent.scope.split(/\s+/).filter(Boolean);
  const grants =
    spExists
      ? (await client.getAll<{ id: string; clientId: string; resourceId: string; consentType: string; scope?: string }>(
          `/oauth2PermissionGrants?$filter=${encodeURIComponent(`clientId eq '${spId}'`)}`,
        )).filter((g) => g.resourceId === resourceSp.id && g.consentType === "AllPrincipals")
      : [];
  const grant = grants[0];
  if (!grant) {
    const body = { clientId: spId, consentType: plan.adminConsent.consentType, resourceId: resourceSp.id, scope: wantScopes.join(" ") };
    await write(
      { method: "POST", path: "/oauth2PermissionGrants", body, description: `grant tenant-wide consent: ${wantScopes.join(" ")}` },
      () => client.send("POST", "/oauth2PermissionGrants", body),
      undefined,
    );
  } else {
    const haveScopes = (grant.scope ?? "").split(/\s+/).filter(Boolean);
    const missing = wantScopes.filter((s) => !haveScopes.includes(s));
    if (missing.length > 0) {
      const body = { scope: [...haveScopes, ...missing].join(" ") };
      await write(
        { method: "PATCH", path: `/oauth2PermissionGrants/${grant.id}`, body, description: `extend tenant-wide consent with: ${missing.join(" ")}` },
        () => client.send("PATCH", `/oauth2PermissionGrants/${grant.id}`, body),
        undefined,
      );
    }
  }

  // ---- Graph application permissions -------------------------------------
  // The membership check calls Graph as the app (client credentials) or as a managed
  // identity, so the permissions are app role assignments of the Graph service
  // principal. With a managed identity the permissions go only to it: the
  // gateway's own service principal (which holds the client secret) stays free
  // of tenant-wide read access. Existing assignments are read from the target,
  // which keeps the read small; nothing is ever removed.
  const appPerms = plan.graphAppPermissions.permissions;
  if (appPerms.length > 0) {
    const mi = opts.managedIdentityPrincipalId;
    const targets: Array<{ id: string; label: string; known: boolean }> = mi
      ? [{ id: mi, label: "managed identity", known: true }]
      : [{ id: spId, label: "gateway service principal", known: spExists }];
    for (const t of targets) {
      const held = t.known ? await client.getAll<Assignment & { resourceId: string }>(`/servicePrincipals/${t.id}/appRoleAssignments`) : [];
      const heldKeys = new Set(held.filter((a) => a.resourceId === resourceSp.id).map((a) => a.appRoleId.toLowerCase()));
      for (const perm of appPerms) {
        if (heldKeys.has(perm.id.toLowerCase())) continue;
        const body = { principalId: t.id, resourceId: resourceSp.id, appRoleId: perm.id };
        await write(
          { method: "POST", path: `/servicePrincipals/${resourceSp.id}/appRoleAssignedTo`, body, description: `grant Graph application permission ${perm.value} (${perm.id}) to the ${t.label}` },
          () => client.send("POST", `/servicePrincipals/${resourceSp.id}/appRoleAssignedTo`, body),
          undefined,
        );
      }
    }
  }

  return { steps, notes, appId, servicePrincipalId: spExists ? spId : undefined };
}

export function followUp(plan: Plan, appId: string | undefined, spId?: string): string[] {
  const id = appId ?? "<appId>";
  return [
    `Application (client) id: ${id}`,
    "Client secret was NOT created. Create it straight into Key Vault (the value never prints):",
    `  az keyvault secret set --vault-name <vault> --name broker-upstream-client-secret --value "$(az ad app credential reset --id ${id} --append --display-name mcp-gateway --years 1 --query password -o tsv)"`,
    "Membership check credentials: the managed identity when IDENTITY_ENDPOINT and IDENTITY_HEADER are set (Container Apps sets them), otherwise the application's client secret. With --managed-identity-principal-id <id> the Graph application permissions go to that identity only, so run the gateway with the managed identity; without the flag they go to the application's service principal.",
    `Gateway env: BROKER_UPSTREAM_CLIENT_ID=${id}, BROKER_UPSTREAM_CLIENT_SECRET from Key Vault, ENTRA_SP_OBJECT_ID=${spId ?? "<service principal object id>"}, plus:`,
    ...Object.entries(plan.gatewayEnv).map(([k, v]) => `  ${k}=${v}`),
  ];
}
