import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Backend, BackendPool, childEnv, loadCatalog, parseCatalog, type BackendSpec } from "./backends.js";
import { decide, parsePolicy } from "./policy.js";
import { spec, stubBackend } from "./test-fixtures/helpers.js";

const gatewayDir = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const catalog = loadCatalog(`${gatewayDir}catalog/catalog.json`, "/app/mcp");

describe("backends childEnv", () => {
  it("includes the vendor's own prefix and excludes another vendor's secrets", () => {
    const ninjaone = catalog.find((s) => s.id === "ninjaone")!;
    const env = childEnv(ninjaone, {
      NINJAONE_CLIENT_SECRET: "secret-value",
      CW_MANAGE_PRIVATE_KEY: "other-vendor-secret",
      PATH: "/usr/bin",
    });

    expect(env.NINJAONE_CLIENT_SECRET).toBe("secret-value");
    expect(env.CW_MANAGE_PRIVATE_KEY).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.MCP_TRANSPORT).toBe("stdio");
  });
});

describe("catalog", () => {
  it("scripts/gen-catalog.mjs --check passes", () => {
    const out = execFileSync(process.execPath, [`${gatewayDir}scripts/gen-catalog.mjs`, "--check"], { encoding: "utf8" });
    expect(out).toContain("current");
  });

  it("parseCatalog expands ${BACKENDS_ROOT}", () => {
    const text = JSON.stringify({
      version: 1,
      connectors: [{ id: "a", command: "node", args: ["${BACKENDS_ROOT}/a/server.mjs"], envPrefixes: ["A_"], stateful: false }],
    });
    const [a] = parseCatalog(text, "/srv/mcp");
    expect(a?.args).toEqual(["/srv/mcp/a/server.mjs"]);
    expect(a?.command).toBe(process.execPath);
  });

  it("parseCatalog rejects duplicate ids", () => {
    const c = { id: "a", command: "node", args: [], envPrefixes: [] };
    expect(() => parseCatalog(JSON.stringify({ version: 1, connectors: [c, c] }), "/x")).toThrow(/duplicate connector id "a"/);
  });

  it("the shipped catalog marks blumira stateful and has unique ids", () => {
    expect(catalog.find((s) => s.id === "blumira")?.stateful).toBe(true);
    expect(new Set(catalog.map((s) => s.id)).size).toBe(catalog.length);
  });
});

describe("BackendPool (acceptance 8)", () => {
  let now = 1_000;
  const clock = (): number => now;
  const stateful = spec("blumira", true);
  const shared = spec("vanta");

  function makePool(max = 50) {
    const made: Array<{ spec: BackendSpec; backend: ReturnType<typeof stubBackend> }> = [];
    const pool = new BackendPool(
      [stateful, shared],
      (s) => {
        const backend = stubBackend(s, []);
        made.push({ spec: s, backend });
        return backend;
      },
      { idleMs: 10_000, maxPerUserChildren: max, now: clock },
    );
    return { pool, made };
  }

  afterEach(() => {
    now = 1_000;
  });

  it("gives two users two instances of a stateful connector", () => {
    const { pool, made } = makePool();
    const a = pool.get("blumira", "u1");
    const b = pool.get("blumira", "u2");
    expect(a).not.toBe(b);
    expect(made.filter((m) => m.spec.id === "blumira")).toHaveLength(2);
  });

  it("gives the same user the same instance", () => {
    const { pool, made } = makePool();
    expect(pool.get("blumira", "u1")).toBe(pool.get("blumira", "u1"));
    expect(made).toHaveLength(1);
  });

  it("shares one instance of a stateless connector across users", () => {
    const { pool, made } = makePool();
    expect(pool.get("vanta", "u1")).toBe(pool.get("vanta", "u2"));
    expect(made).toHaveLength(1);
  });

  it("reapIdle closes children idle past the timeout and keeps fresh ones", async () => {
    const { pool, made } = makePool();
    pool.get("blumira", "old");
    now += 9_000;
    pool.get("blumira", "fresh");
    now += 2_000;
    expect(await pool.reapIdle()).toBe(1);
    expect(made[0]?.backend.closed).toBe(true);
    expect(made[1]?.backend.closed).toBe(false);
    expect(pool.perUserCount()).toBe(1);
  });

  it("evicts the least recently used child at the cap", () => {
    const { pool, made } = makePool(2);
    pool.get("blumira", "u1");
    now += 1;
    pool.get("blumira", "u2");
    now += 1;
    pool.get("blumira", "u1"); // u1 is now newer than u2
    now += 1;
    pool.get("blumira", "u3");
    expect(pool.perUserCount()).toBe(2);
    expect(made[1]?.backend.closed).toBe(true); // u2 evicted
    expect(made[0]?.backend.closed).toBe(false);
  });

  it("transient children are outside the per-user bookkeeping", () => {
    const { pool } = makePool();
    pool.transient("blumira");
    expect(pool.perUserCount()).toBe(0);
  });

  it("closeAll closes shared and per-user children", async () => {
    const { pool, made } = makePool();
    pool.get("blumira", "u1");
    pool.get("vanta", "u1");
    await pool.closeAll();
    expect(made.every((m) => m.backend.closed)).toBe(true);
  });
});

describe("real stdio backends", () => {
  const fixtureSpec: BackendSpec = {
    ...spec("fixture"),
    command: process.execPath,
    args: [fileURLToPath(new URL("./test-fixtures/fixture-server.mjs", import.meta.url))],
  };

  it("lists and calls the fixture server through a real Backend, and effects classify", async () => {
    const backend = new Backend(fixtureSpec);
    try {
      const tools = await backend.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["fx_delete", "fx_read", "fx_write"]);

      const policy = parsePolicy(
        "version: 1\nsubjects:\n  - role: r\n    when: { claim: roles, equals: R }\ngrants:\n  - role: r\n    connectors: [fixture]\n    effects: [read]\n",
        ["fixture"],
      );
      const verdicts = Object.fromEntries(tools.map((t) => [t.name, decide(policy, ["r"], "fixture", t).reason]));
      expect(verdicts).toEqual({
        fx_read: "grant:r",
        fx_write: "effect_not_granted:write",
        fx_delete: "effect_not_granted:destructive",
      });

      const result = (await backend.callTool("fx_read", { q: "hello" })) as { content: Array<{ text: string }> };
      expect(result.content[0]?.text).toContain("fx_read ok");
    } finally {
      await backend.close();
    }
  }, 30_000);

  it("lists the real vanta bundle without credentials", async () => {
    const backend = new Backend({
      ...spec("vanta"),
      command: process.execPath,
      args: [`${repoRoot}plugins/armada/mcp/vanta/server.mjs`],
      envPrefixes: ["VANTA_"],
    });
    try {
      const tools = await backend.listTools();
      expect(tools.length).toBeGreaterThan(0);
      expect(tools.map((t) => t.name)).toContain("vanta_status");
    } finally {
      await backend.close();
    }
  }, 30_000);
});
