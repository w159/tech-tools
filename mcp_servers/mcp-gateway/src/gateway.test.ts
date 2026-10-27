import { describe, expect, it } from "vitest";
import { AuditLogger, AUDIT_SCHEMA, type AuditEvent } from "./audit.js";
import { BackendPool } from "./backends.js";
import { Gateway } from "./gateway.js";
import type { Identity } from "./auth.js";
import { compatPolicy, mergePolicies, parsePolicy } from "./policy.js";
import { spec, stubBackend, tool, type StubBackend } from "./test-fixtures/helpers.js";

const POLICY_YAML = `
version: 1
subjects:
  - role: auditor
    when: { claim: roles, equals: "Gateway.Auditor" }
  - role: ops
    when: { claim: roles, equals: "Gateway.Ops" }
grants:
  - role: auditor
    connectors: [gateway]
    effects: [read]
  - role: ops
    connectors: [alpha]
    effects: [read, write, destructive]
    deny_tools: ["alpha_commit*"]
`;

const ALPHA = [tool("alpha_list", "read"), tool("alpha_set", "write"), tool("alpha_drop", "destructive"), tool("alpha_commit_all", "write")];
const BETA = [tool("beta_list", "read"), tool("beta_set", "write")];

function identity(roles: string[], sub = "u1"): Identity {
  return { userKey: `https://idp.example.com|${sub}`, sub, email: `${sub}@example.com`, idp: "test", clientId: "cli-1", roles };
}

interface Setup {
  gateway: Gateway;
  lines: string[];
  events: () => AuditEvent[];
  backends: Map<string, StubBackend[]>;
}

async function setup(opts: { stateful?: boolean; resultText?: string } = {}): Promise<Setup> {
  const specs = [spec("alpha"), spec("beta", opts.stateful === true)];
  const backends = new Map<string, StubBackend[]>();
  const pool = new BackendPool(
    specs,
    (s) => {
      const b = stubBackend(s, s.id === "alpha" ? ALPHA : BETA, opts.resultText ?? "RESULT-SECRET-TEXT");
      backends.set(s.id, [...(backends.get(s.id) ?? []), b]);
      return b;
    },
    { idleMs: 1000, maxPerUserChildren: 10 },
  );
  const policy = mergePolicies(
    parsePolicy(POLICY_YAML, ["alpha", "beta"]),
    compatPolicy([{ id: "alpha", compatRole: "Alpha" }, { id: "beta", compatRole: "Beta" }]),
  );
  const lines: string[] = [];
  const audit = new AuditLogger({ hmacKey: "test-key", sink: (l) => lines.push(l) });
  const gateway = new Gateway(pool, policy, audit);
  await gateway.init();
  return { gateway, lines, events: () => lines.map((l) => JSON.parse(l) as AuditEvent), backends };
}

const names = (tools: Array<{ name: string }>): string[] => tools.map((t) => t.name);
const text = (r: Record<string, unknown>): string => (r.content as Array<{ text: string }>)[0]!.text;

describe("grants limit visibility and calls (acceptance 3)", () => {
  it("hides connector B tools and denies a direct B call with no_grant", async () => {
    const s = await setup();
    const who = identity(["ops"]);
    expect(names(await s.gateway.listTools(who, "req-00000001"))).toEqual(["alpha_list", "alpha_set", "alpha_drop"]);

    const r = await s.gateway.callTool(who, "beta_list", {}, "req-00000002");
    expect(r.isError).toBe(true);
    expect(text(r)).toBe("Access denied: beta_list (no_grant)");
    const line = s.events().find((e) => e.event === "tool_call");
    expect(line).toMatchObject({ decision: "deny", reason: "no_grant", connector: "beta", tool: "beta_list", request_id: "req-00000002" });
    expect(s.backends.get("beta")?.[0]?.calls ?? []).toHaveLength(0);
  });

  it("unknown tools return Unknown tool and audit unknown_tool", async () => {
    const s = await setup();
    const r = await s.gateway.callTool(identity(["ops"]), "nope", {}, "req-00000003");
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Unknown tool");
    expect(s.events()[0]).toMatchObject({ decision: "deny", reason: "unknown_tool" });
  });
});

describe("effect classes (acceptance 4)", () => {
  it("a read-only grant hides and denies write and destructive tools", async () => {
    const s = await setup();
    const reader = identity(["compat:alpha:read"]);
    expect(names(await s.gateway.listTools(reader, "req-00000004"))).toEqual(["alpha_list"]);

    const w = await s.gateway.callTool(reader, "alpha_set", {}, "req-00000005");
    expect(text(w)).toBe("Access denied: alpha_set (effect_not_granted:write)");
    const d = await s.gateway.callTool(reader, "alpha_drop", {}, "req-00000006");
    expect(text(d)).toBe("Access denied: alpha_drop (effect_not_granted:destructive)");
  });

  it("deny_tools beats a broad grant, in listing and in calls", async () => {
    const s = await setup();
    const ops = identity(["ops"]);
    expect(names(await s.gateway.listTools(ops, "req-00000007"))).not.toContain("alpha_commit_all");
    const r = await s.gateway.callTool(ops, "alpha_commit_all", {}, "req-00000008");
    expect(text(r)).toBe("Access denied: alpha_commit_all (deny_tools:ops:alpha_commit*)");
  });
});

describe("allowed calls and audit (acceptance 5)", () => {
  it("proxies the call and writes a schema-conformant line without arguments or results", async () => {
    const s = await setup();
    const ops = identity(["ops"]);
    const r = await s.gateway.callTool(ops, "alpha_list", { a: 1, b: "ARG-SECRET-VALUE" }, "req-00000009");
    expect(text(r)).toBe("RESULT-SECRET-TEXT");
    expect(s.backends.get("alpha")?.[0]?.calls).toEqual([{ name: "alpha_list", args: { a: 1, b: "ARG-SECRET-VALUE" } }]);

    const raw = s.lines.find((l) => l.includes('"tool_call"'))!;
    const e = JSON.parse(raw) as AuditEvent;
    expect(e).toMatchObject({
      schema: AUDIT_SCHEMA,
      request_id: "req-00000009",
      event: "tool_call",
      actor: { sub: "u1", email: "u1@example.com", idp: "test" },
      client_id: "cli-1",
      roles: ["ops"],
      connector: "alpha",
      tool: "alpha_list",
      effect: "read",
      decision: "allow",
      reason: "grant:ops",
      outcome: "ok",
    });
    expect(typeof e.duration_ms).toBe("number");
    expect(e.args_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(raw).not.toContain("ARG-SECRET-VALUE");
    expect(raw).not.toContain("RESULT-SECRET-TEXT");
  });

  it("args_hmac is equal for reordered keys and differs for different values", async () => {
    const s = await setup();
    const ops = identity(["ops"]);
    await s.gateway.callTool(ops, "alpha_list", { a: 1, b: 2 }, "req-00000010");
    await s.gateway.callTool(ops, "alpha_list", { b: 2, a: 1 }, "req-00000011");
    await s.gateway.callTool(ops, "alpha_list", { a: 1, b: 3 }, "req-00000012");
    const [x, y, z] = s.events().map((e) => e.args_hmac);
    expect(x).toBe(y);
    expect(x).not.toBe(z);
  });

  it("records tool_error and backend_error outcomes", async () => {
    const s = await setup();
    const ops = identity(["ops"]);
    const stub = s.backends.get("alpha")![0]!;
    stub.callTool = async () => ({ isError: true, content: [{ type: "text", text: "x" }] });
    await s.gateway.callTool(ops, "alpha_list", {}, "req-00000013");
    stub.callTool = async () => {
      throw new Error("child died");
    };
    await expect(s.gateway.callTool(ops, "alpha_list", {}, "req-00000014")).rejects.toThrow("child died");
    expect(s.events().map((e) => e.outcome)).toEqual(["tool_error", "backend_error"]);
  });

  it("emits tools_listed with tool_count", async () => {
    const s = await setup();
    await s.gateway.listTools(identity(["ops"]), "req-00000015");
    expect(s.events()[0]).toMatchObject({ event: "tools_listed", tool_count: 3, roles: ["ops"] });
  });
});

describe("gateway tools", () => {
  it("are visible and callable only with a gateway grant", async () => {
    const s = await setup();
    expect(names(await s.gateway.listTools(identity(["ops"]), "req-00000016"))).not.toContain("gateway_access_report");
    const denied = await s.gateway.callTool(identity(["ops"]), "gateway_audit_search", {}, "req-00000017");
    expect(text(denied)).toContain("no_grant");

    const auditor = identity(["auditor"], "aud");
    expect(names(await s.gateway.listTools(auditor, "req-00000018"))).toEqual(["gateway_access_report", "gateway_audit_search"]);
  });

  it("access report returns the matrix and audit search filters recent events", async () => {
    const s = await setup();
    await s.gateway.callTool(identity(["ops"]), "beta_list", {}, "req-00000019");
    const auditor = identity(["auditor"], "aud");

    const report = JSON.parse(text(await s.gateway.callTool(auditor, "gateway_access_report", {}, "req-00000020")));
    const ops = report.find((r: { role: string; connector: string }) => r.role === "ops" && r.connector === "alpha");
    expect(ops.allowed).toEqual(["alpha_list", "alpha_set", "alpha_drop"]);
    expect(ops.denied).toEqual([{ tool: "alpha_commit_all", reason: "deny_tools:ops:alpha_commit*" }]);

    const found = JSON.parse(text(await s.gateway.callTool(auditor, "gateway_audit_search", { decision: "deny", connector: "beta" }, "req-00000021")));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ tool: "beta_list", reason: "no_grant" });

    const bad = await s.gateway.callTool(auditor, "gateway_audit_search", { limit: 500 }, "req-00000022");
    expect(bad.isError).toBe(true);
  });

  it("auditorTools:false removes them", async () => {
    const pool = new BackendPool([spec("alpha")], (s) => stubBackend(s, ALPHA), { idleMs: 1, maxPerUserChildren: 1 });
    const policy = parsePolicy(POLICY_YAML, ["alpha"]);
    const g = new Gateway(pool, policy, new AuditLogger({ sink: () => undefined }), { auditorTools: false });
    await g.init();
    expect(names(await g.listTools(identity(["auditor"]), "req-00000023"))).toEqual([]);
  });
});

describe("init", () => {
  it("throws naming both connectors on duplicate tool names", async () => {
    const pool = new BackendPool(
      [spec("alpha"), spec("beta")],
      (s) => stubBackend(s, [tool("shared_tool", "read")]),
      { idleMs: 1, maxPerUserChildren: 1 },
    );
    const g = new Gateway(pool, parsePolicy(POLICY_YAML, ["alpha", "beta"]), new AuditLogger({ sink: () => undefined }));
    await expect(g.init()).rejects.toThrow(/shared_tool.*alpha.*beta/);
  });

  it("skips a connector that fails to list", async () => {
    const pool = new BackendPool(
      [spec("alpha"), spec("beta")],
      (s) => {
        const b = stubBackend(s, ALPHA);
        if (s.id === "beta") b.listTools = async () => Promise.reject(new Error("spawn failed"));
        return b;
      },
      { idleMs: 1, maxPerUserChildren: 1 },
    );
    const g = new Gateway(pool, parsePolicy(POLICY_YAML, ["alpha", "beta"]), new AuditLogger({ sink: () => undefined }));
    await g.init();
    expect([...g.catalogSnapshot().keys()]).toEqual(["alpha", "gateway"]);
  });

  it("lists a stateful connector through a throwaway child that is closed", async () => {
    const s = await setup({ stateful: true });
    const probes = s.backends.get("beta")!;
    expect(probes).toHaveLength(1);
    expect(probes[0]?.closed).toBe(true);
  });
});

describe("stateful connectors through the gateway (acceptance 8)", () => {
  it("serves each user from their own child", async () => {
    const s = await setup({ stateful: true });
    const u1 = identity(["compat:beta:write"], "u1");
    const u2 = identity(["compat:beta:write"], "u2");
    await s.gateway.listTools(u1, "req-00000024");
    await s.gateway.listTools(u2, "req-00000025");
    await s.gateway.callTool(u1, "beta_set", {}, "req-00000026");
    await s.gateway.callTool(u1, "beta_set", {}, "req-00000027");
    await s.gateway.callTool(u2, "beta_set", {}, "req-00000028");
    const [probe, c1, c2] = s.backends.get("beta")!;
    expect(s.backends.get("beta")).toHaveLength(3);
    expect(probe?.calls).toHaveLength(0);
    expect(c1?.calls).toHaveLength(2);
    expect(c2?.calls).toHaveLength(1);
  });
});
