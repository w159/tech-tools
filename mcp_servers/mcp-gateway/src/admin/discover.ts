import { GraphClient, GraphError } from "./graph.js";

// Read-only tenant discovery. Everything about users is aggregated to counts;
// no user name, email or id ever reaches the returned model.
//
// Refs (Microsoft Learn, v1.0):
//   GET /organization                          https://learn.microsoft.com/en-us/graph/api/organization-list?view=graph-rest-1.0
//   GET /users ($select, $top, paging)         https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0
//   GET /groups                                https://learn.microsoft.com/en-us/graph/api/group-list?view=graph-rest-1.0
//   GET /groups/{id}/transitiveMembers/$count  https://learn.microsoft.com/en-us/graph/api/group-list-transitivemembers?view=graph-rest-1.0
//   GET /directoryRoles, /{id}/members         https://learn.microsoft.com/en-us/graph/api/directoryrole-list?view=graph-rest-1.0
//                                              https://learn.microsoft.com/en-us/graph/api/directoryrole-list-members?view=graph-rest-1.0
//   GET /directory/administrativeUnits, members https://learn.microsoft.com/en-us/graph/api/directory-list-administrativeunits?view=graph-rest-1.0
//                                              https://learn.microsoft.com/en-us/graph/api/administrativeunit-list-members?view=graph-rest-1.0
//   ConsistencyLevel / $count                  https://learn.microsoft.com/en-us/graph/aad-advanced-queries

export type Counts = Record<string, number>;

export interface OrgModel {
  version: 1;
  tenantId: string;
  users: {
    total: number;
    byDepartment: Counts;
    byCompanyName: Counts;
    byDivision: Counts;
    byCostCenter: Counts;
    byJobTitle: Counts;
    byOfficeLocation: Counts;
  };
  groups: Array<{
    id: string;
    displayName: string;
    securityEnabled: boolean;
    mailEnabled: boolean;
    groupTypes: string[];
    hasMembershipRule: boolean;
    transitiveMemberCount: number;
  }>;
  directoryRoles: Array<{ displayName: string; memberCount: number }>;
  administrativeUnits: Array<{ id: string; displayName: string; memberCount: number }>;
  warnings: string[];
}

export const UNSET = "(unset)";

interface UserRow {
  department?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  officeLocation?: string | null;
  employeeOrgData?: { division?: string | null; costCenter?: string | null } | null;
}

function bump(counts: Counts, value: string | null | undefined): void {
  const key = value && value.trim() ? value.trim() : UNSET;
  counts[key] = (counts[key] ?? 0) + 1;
}

function sorted(counts: Counts): Counts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const EVENTUAL = { ConsistencyLevel: "eventual" };

// Optional sections need directory permissions an admin may not have granted;
// a 403 there becomes a warning instead of aborting discovery.
async function optional<T>(warnings: string[], what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GraphError && err.status === 403) {
      warnings.push(`${what}: access denied (403); section left empty`);
      return fallback;
    }
    throw err;
  }
}

export async function discover(client: GraphClient): Promise<OrgModel> {
  const orgs = await client.get<{ value: Array<{ id: string }> }>("/organization?$select=id");
  const tenantId = orgs.value[0]?.id;
  if (!tenantId) throw new GraphError("GET /organization returned no tenant");

  const users = await client.getAll<UserRow>(
    "/users?$select=department,companyName,jobTitle,officeLocation,employeeOrgData&$top=999",
  );
  const u: OrgModel["users"] = {
    total: users.length,
    byDepartment: {},
    byCompanyName: {},
    byDivision: {},
    byCostCenter: {},
    byJobTitle: {},
    byOfficeLocation: {},
  };
  for (const row of users) {
    bump(u.byDepartment, row.department);
    bump(u.byCompanyName, row.companyName);
    bump(u.byDivision, row.employeeOrgData?.division);
    bump(u.byCostCenter, row.employeeOrgData?.costCenter);
    bump(u.byJobTitle, row.jobTitle);
    bump(u.byOfficeLocation, row.officeLocation);
  }
  for (const k of ["byDepartment", "byCompanyName", "byDivision", "byCostCenter", "byJobTitle", "byOfficeLocation"] as const) {
    u[k] = sorted(u[k]);
  }

  const rawGroups = await client.getAll<{
    id: string;
    displayName: string;
    securityEnabled?: boolean;
    mailEnabled?: boolean;
    groupTypes?: string[];
    membershipRule?: string | null;
  }>("/groups?$select=id,displayName,securityEnabled,mailEnabled,groupTypes,membershipRule&$top=999");
  const groups: OrgModel["groups"] = [];
  for (const g of rawGroups) {
    const count = Number((await client.getText(`/groups/${encodeURIComponent(g.id)}/transitiveMembers/$count`, EVENTUAL)).trim());
    groups.push({
      id: g.id,
      displayName: g.displayName,
      securityEnabled: g.securityEnabled === true,
      mailEnabled: g.mailEnabled === true,
      groupTypes: [...(g.groupTypes ?? [])].sort(),
      hasMembershipRule: Boolean(g.membershipRule),
      transitiveMemberCount: Number.isFinite(count) ? count : 0,
    });
  }
  groups.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));

  const warnings: string[] = [];
  const directoryRoles = await optional(
    warnings,
    "directoryRoles",
    async () => {
      const roles = await client.getAll<{ id: string; displayName: string }>("/directoryRoles?$select=id,displayName");
      const out: OrgModel["directoryRoles"] = [];
      for (const r of roles) {
        const members = await client.getAll<{ id: string }>(`/directoryRoles/${encodeURIComponent(r.id)}/members?$select=id`);
        out.push({ displayName: r.displayName, memberCount: members.length });
      }
      return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    [] as OrgModel["directoryRoles"],
  );
  const administrativeUnits = await optional(
    warnings,
    "administrativeUnits",
    async () => {
      const aus = await client.getAll<{ id: string; displayName: string }>("/directory/administrativeUnits?$select=id,displayName");
      const out: OrgModel["administrativeUnits"] = [];
      for (const a of aus) {
        const members = await client.getAll<{ id: string }>(`/directory/administrativeUnits/${encodeURIComponent(a.id)}/members?$select=id`);
        out.push({ id: a.id, displayName: a.displayName, memberCount: members.length });
      }
      return out.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    },
    [] as OrgModel["administrativeUnits"],
  );

  return { version: 1, tenantId, users: u, groups, directoryRoles, administrativeUnits, warnings };
}

export function summarize(m: OrgModel): string {
  const top = (c: Counts): string =>
    Object.entries(c)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k, n]) => `${k} (${n})`)
      .join(", ") || "-";
  const lines = [
    `Tenant ${m.tenantId}`,
    `Users: ${m.users.total}`,
    `  departments: ${Object.keys(m.users.byDepartment).length}  top: ${top(m.users.byDepartment)}`,
    `  job titles: ${Object.keys(m.users.byJobTitle).length}  offices: ${Object.keys(m.users.byOfficeLocation).length}`,
    `Groups: ${m.groups.length} (${m.groups.filter((g) => g.securityEnabled).length} security, ${m.groups.filter((g) => g.hasMembershipRule).length} dynamic)`,
    ...m.groups.map((g) => `  ${g.id}  ${g.displayName}  members=${g.transitiveMemberCount}`),
    `Directory roles: ${m.directoryRoles.length}`,
    `Administrative units: ${m.administrativeUnits.length}`,
    ...m.warnings.map((w) => `WARNING ${w}`),
  ];
  return lines.join("\n");
}
