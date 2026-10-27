import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeGraph, FAKE_MANAGED_IDENTITY_SP_ID } from "../test-fixtures/fake-graph.js";
import { allFileText, cli, fixturePath, tempDir } from "../test-fixtures/admin-helpers.js";

const TOKEN = "SECRET-TOKEN-must-never-appear-0004";
let fake: FakeGraph;
let dir: string;
let cleanup: () => void;
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  fake = new FakeGraph({ token: TOKEN, pageSize: 3 });
  await fake.start();
  ({ dir, cleanup } = tempDir());
  env = { GRAPH_TOKEN: TOKEN, GRAPH_BASE_URL: fake.baseUrl };
  copyFileSync(fixturePath("answers.yaml"), join(dir, "answers.yaml"));
});
afterAll(async () => {
  await fake.stop();
  cleanup();
});
beforeEach(() => fake.clearRequests());

const p = (name: string): string => join(dir, name);

describe("admin CLI end to end against the fake Graph", () => {
  const outputs: string[] = [];

  it("discover -> plan -> provision (dry run) -> provision --apply -> provision --apply", async () => {
    const d = await cli(["discover", "--out", p("org-model.json")], env);
    const pl = await cli(["plan", "--org", p("org-model.json"), "--answers", p("answers.yaml"), "--out", p("plan.json"), "--policy", p("policy.yaml")], env);
    expect([d.code, pl.code]).toEqual([0, 0]);
    expect(pl.stdout).toContain('+ application "Contoso MCP Gateway"');
    expect(pl.stdout).toContain("+ app role it-ops");
    expect(pl.stdout).toContain("+ Graph application permissions Application.Read.All GroupMember.Read.All User.Read.All");
    expect(readFileSync(p("policy.yaml"), "utf8")).toContain("equals: it-ops");

    fake.clearRequests();
    const dry = await cli(["provision", "--plan", p("plan.json")], env);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain("DRY RUN");
    expect(dry.stdout).toMatch(/^POST \/applications {2}create application "Contoso MCP Gateway"/m);
    expect(dry.stdout).toContain("Would apply 8 write(s).");
    for (const perm of ["Application.Read.All", "GroupMember.Read.All", "User.Read.All"]) {
      expect(dry.stdout).toContain(`grant Graph application permission ${perm} to the gateway service principal`);
    }
    expect(fake.nonGet()).toEqual([]);

    const apply = await cli(["provision", "--plan", p("plan.json"), "--apply"], env);
    expect(apply.code).toBe(0);
    expect(apply.stdout).toContain("Applied 8 write(s).");
    expect(apply.stdout).toContain("Client secret was NOT created");
    expect(apply.stdout).toMatch(/az keyvault secret set --vault-name <vault>/);
    expect(fake.nonGet()).toHaveLength(8);

    fake.clearRequests();
    const again = await cli(["provision", "--plan", p("plan.json"), "--apply"], env);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("nothing to do");
    expect(fake.nonGet()).toEqual([]);
    outputs.push(d.stdout, d.stderr, pl.stdout, pl.stderr, dry.stdout, dry.stderr, apply.stdout, apply.stderr, again.stdout, again.stderr);
  });

  it("--managed-identity-principal-id grants the Graph permissions to that identity too", async () => {
    fake.addManagedIdentity();
    const args = ["provision", "--plan", p("plan.json"), "--managed-identity-principal-id", FAKE_MANAGED_IDENTITY_SP_ID];
    const dry = await cli(args, env);
    expect(dry.code).toBe(0);
    expect(dry.stdout.match(/to the managed identity/g)).toHaveLength(3);
    expect(dry.stdout).toContain("Would apply 3 write(s).");
    expect(fake.nonGet()).toEqual([]);
    expect((await cli([...args, "--apply"], env)).stdout).toContain("Applied 3 write(s).");
    expect((await cli([...args, "--apply"], env)).stdout).toContain("nothing to do");
  });

  it("GRAPH_TOKEN never appears in stdout, stderr or any written file", async () => {
    const failing = await cli(["discover", "--out", p("never.json")], { GRAPH_TOKEN: "SECRET-TOKEN-wrong-0005", GRAPH_BASE_URL: fake.baseUrl });
    expect(failing.code).toBe(1);
    expect(failing.stderr).toContain("HTTP 401");
    outputs.push(failing.stdout, failing.stderr);
    for (const text of outputs) {
      expect(text).not.toContain("SECRET-TOKEN");
    }
    expect(allFileText(dir)).not.toContain("SECRET-TOKEN");
    expect(JSON.stringify(fake.requests.map((r) => r.path))).not.toContain("SECRET-TOKEN");
  });

  it("reports bad answers on stderr, exits 1 and writes nothing", async () => {
    const bad = readFileSync(p("answers.yaml"), "utf8").replace("[ninjaone, connectwise]", "[ninjaone, nosuchvendor]");
    writeFileSync(p("bad.yaml"), bad);
    const r = await cli(["plan", "--org", p("org-model.json"), "--answers", p("bad.yaml"), "--out", p("bad-plan.json"), "--policy", p("bad-policy.yaml")], env);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unknown connector "nosuchvendor"');
    expect(existsSync(p("bad-plan.json"))).toBe(false);
    expect(existsSync(p("bad-policy.yaml"))).toBe(false);
  });

  it("exits 2 with usage on a bad command line", async () => {
    for (const args of [[], ["nope"], ["discover"], ["plan", "--org", "x"], ["provision", "--plan", p("plan.json"), "--force"], ["provision", "--plan", p("plan.json"), "--managed-identity-principal-id"], ["provision", "--plan", p("plan.json"), "--managed-identity-principal-id", "not-a-guid"]]) {
      const r = await cli(args, env);
      expect(r.code).toBe(2);
    }
    expect((await cli([], env)).stdout).toContain("Usage:");
  });
});

describe("token from the Azure CLI", () => {
  const stub = mkdtempSync(join(tmpdir(), "stub-az-cli-"));
  afterAll(() => rmSync(stub, { recursive: true, force: true }));
  it("is used when GRAPH_TOKEN is unset, and not printed", async () => {
    writeFileSync(join(stub, "az"), `#!/bin/sh\necho ${TOKEN}\n`);
    chmodSync(join(stub, "az"), 0o755);
    const old = process.env.PATH;
    process.env.PATH = `${stub}:${old}`;
    try {
      const r = await cli(["discover", "--out", p("from-az.json")], { GRAPH_BASE_URL: fake.baseUrl });
      expect(r.code).toBe(0);
      expect(r.stdout + r.stderr).not.toContain("SECRET-TOKEN");
      expect(readFileSync(p("from-az.json"), "utf8")).not.toContain("SECRET-TOKEN");
    } finally {
      process.env.PATH = old;
    }
  });
});

describe("built CLI (dist/admin/cli.js)", () => {
  const dist = fileURLToPath(new URL("../../dist/admin/cli.js", import.meta.url));
  it.skipIf(!existsSync(dist))("runs plan offline from the fixtures", () => {
    const r = spawnSync(
      process.execPath,
      [dist, "plan", "--org", fixturePath("org-model.json"), "--answers", fixturePath("answers.yaml"), "--out", p("built-plan.json"), "--policy", p("built-policy.yaml")],
      { encoding: "utf8", env: { PATH: process.env.PATH } },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Wrote");
    expect(JSON.parse(readFileSync(p("built-plan.json"), "utf8")).application.displayName).toBe("Contoso MCP Gateway");
  });
});
