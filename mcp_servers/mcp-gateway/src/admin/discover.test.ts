import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FAKE_TENANT_ID, FakeGraph } from "../test-fixtures/fake-graph.js";
import { cli, fixturePath, tempDir } from "../test-fixtures/admin-helpers.js";
import { discover, summarize } from "./discover.js";
import { GraphClient } from "./graph.js";

const TOKEN = "discover-token-0002";
let fake: FakeGraph;

beforeAll(async () => {
  fake = new FakeGraph({ token: TOKEN, pageSize: 3 });
  await fake.start();
});
afterAll(async () => fake.stop());
beforeEach(() => {
  fake.clearRequests();
  fake.clearThrottles();
});

const client = (): GraphClient => new GraphClient({ baseUrl: fake.baseUrl, token: TOKEN, readOnly: true, sleep: async () => undefined });

describe("discover", () => {
  it("pages through nextLink for users", async () => {
    const m = await discover(client());
    expect(m.users.total).toBe(8);
    const userPages = fake.requests.filter((r) => r.path.startsWith("/v1.0/users"));
    expect(userPages).toHaveLength(3);
    expect(userPages[0]!.path).toContain("$select=department,companyName,jobTitle,officeLocation,employeeOrgData");
  });

  it("retries a 429 and still produces the model", async () => {
    fake.throttle("/v1.0/groups", 1, "0");
    const m = await discover(client());
    expect(m.groups).toHaveLength(3);
    expect(fake.requests.filter((r) => r.path.startsWith("/v1.0/groups?"))).toHaveLength(2);
  });

  it("uses only GET requests", async () => {
    await discover(client());
    expect(fake.requests.length).toBeGreaterThan(5);
    expect(fake.requests.every((r) => r.method === "GET")).toBe(true);
    expect(fake.requests.every((r) => r.authorized)).toBe(true);
  });

  it("summarizes users, groups, roles and administrative units as counts", async () => {
    const m = await discover(client());
    expect(m.tenantId).toBe(FAKE_TENANT_ID);
    expect(m.users.byDepartment).toEqual({ Finance: 2, IT: 3, Operations: 1, Support: 2 });
    expect(m.users.byDivision).toEqual({ "(unset)": 1, Corporate: 7 });
    expect(m.users.byCostCenter).toEqual({ "(unset)": 1, "CC-100": 3, "CC-200": 4 });
    const itOps = m.groups.find((g) => g.displayName === "IT Operations")!;
    expect(itOps).toMatchObject({ securityEnabled: true, mailEnabled: false, hasMembershipRule: false, transitiveMemberCount: 3 });
    expect(m.groups.find((g) => g.displayName === "All Staff")).toMatchObject({ hasMembershipRule: true, groupTypes: ["DynamicMembership"] });
    expect(m.directoryRoles).toEqual([
      { displayName: "Global Administrator", memberCount: 1 },
      { displayName: "Helpdesk Administrator", memberCount: 2 },
    ]);
    expect(m.administrativeUnits).toEqual([{ id: "dddddddd-0000-4000-8000-000000000001", displayName: "Corporate Users", memberCount: 2 }]);
    expect(summarize(m)).toContain("Users: 8");
  });

  it("turns a 403 on an optional section into a warning", async () => {
    fake.forbid("/v1.0/directoryRoles");
    const m = await discover(client());
    expect(m.directoryRoles).toEqual([]);
    expect(m.warnings).toEqual(["directoryRoles: access denied (403); section left empty"]);
    fake.clearForbidden();
  });
});

describe("discover CLI", () => {
  it("writes counts only: no user principal names, names or ids in the file", async () => {
    const { dir, cleanup } = tempDir();
    try {
      const out = join(dir, "org-model.json");
      const r = await cli(["discover", "--out", out], { GRAPH_TOKEN: TOKEN, GRAPH_BASE_URL: fake.baseUrl });
      expect(r.code).toBe(0);
      const text = readFileSync(out, "utf8");
      expect(text).not.toMatch(/contoso\.example/);
      expect(text).not.toMatch(/Fixture Person/);
      expect(text).not.toMatch(/private/);
      for (const u of fake.users) expect(text).not.toContain(u.id);
      expect(JSON.parse(text).users.total).toBe(8);
      expect(r.stdout).toContain(`Tenant ${FAKE_TENANT_ID}`);
      expect(r.stdout).not.toMatch(/contoso\.example/);
      expect(fake.nonGet()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("matches the committed fixture org-model.json", async () => {
    const { dir, cleanup } = tempDir();
    try {
      const out = join(dir, "org-model.json");
      await cli(["discover", "--out", out], { GRAPH_TOKEN: TOKEN, GRAPH_BASE_URL: fake.baseUrl });
      expect(readFileSync(out, "utf8")).toBe(readFileSync(fixturePath("org-model.json"), "utf8"));
    } finally {
      cleanup();
    }
  });
});
