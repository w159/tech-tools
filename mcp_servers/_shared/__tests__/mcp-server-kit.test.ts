/**
 * Run with: node --experimental-strip-types --test __tests__/mcp-server-kit.test.ts
 * zod comes from a connector's node_modules (_shared has none).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "../../threatlocker-mcp/node_modules/zod/index.js";
import { toZodShape } from "../zod-shape.ts";
import {
  createToolRegistrar, registerNavigationTools, registerDomainTools,
  navigateDomain, statusResult, runAuthCheck, formatAuthFailure,
  makeNavigate, credentialStatusResult, registerCredentialGatedTools,
  type KitContext, type ToolRun,
} from "../mcp-server-kit.ts";
import { cleanEnv } from "../clean-env.ts";

// The kit keeps DomainHandler private; tests derive it from the API they exercise.
type DomainHandler = Parameters<typeof registerDomainTools>[2] extends (d: never) => Promise<infer H> ? H : never;

type Tool = Parameters<KitContext["annotate"]>[0][number];
type Registered = { name: string; config: any; cb: (a: unknown, e: unknown) => Promise<any> };

const tool = (name: string): Tool =>
  ({ name, description: `desc ${name}`, inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }) as Tool;

function makeContext() {
  const registered: Registered[] = [];
  const server = { registerTool: (name: string, config: unknown, cb: Registered["cb"]) => registered.push({ name, config, cb } as Registered) };
  const annotate: KitContext["annotate"] = (tools, vendor) =>
    tools.map((t) => ({ annotations: { title: `${vendor} ${t.name}`, readOnlyHint: true } }));
  const ctx = { server, z, toZodShape, annotate, vendorTitle: "Acme" } as unknown as KitContext;
  return { registered, register: createToolRegistrar(ctx) };
}

const ok = { content: [{ type: "text" as const, text: "ok" }] };

describe("createToolRegistrar", () => {
  it("registers title, annotations, description and a validating zod shape", async () => {
    const { registered, register } = makeContext();
    let seen: unknown;
    register(tool("acme_get"), async (args) => { seen = args; return ok; });
    const [r] = registered;
    assert.equal(r.name, "acme_get");
    assert.equal(r.config.title, "Acme acme_get");
    assert.deepEqual(r.config.annotations, { title: "Acme acme_get", readOnlyHint: true });
    assert.equal(r.config.description, "desc acme_get");
    assert.equal(z.object(r.config.inputSchema).safeParse({}).success, false);
    assert.deepEqual(await r.cb({ id: "1" }, undefined), ok);
    assert.deepEqual(seen, { id: "1" });
  });
});

describe("registerNavigationTools", () => {
  it("routes the navigate tool to navigate and everything else to status", async () => {
    const { registered, register } = makeContext();
    registerNavigationTools(register, [tool("acme_navigate"), tool("acme_status")], "acme_navigate",
      async (d) => ({ content: [{ type: "text", text: `nav ${d}` }] }),
      async () => ({ content: [{ type: "text", text: "status" }] }));
    assert.equal((await registered[0].cb({ domain: "x" }, undefined)).content[0].text, "nav x");
    assert.equal((await registered[1].cb({}, undefined)).content[0].text, "status");
  });
});

describe("registerDomainTools", () => {
  const handler = (throws: boolean): DomainHandler => ({
    getTools: () => [tool("acme_a")],
    handleCall: async (name, args, extra) => {
      if (throws) throw new Error("boom");
      return { content: [{ type: "text", text: JSON.stringify({ name, args, extra }) }] };
    },
  });

  it("forwards name, args and extra to the handler", async () => {
    const { registered, register } = makeContext();
    await registerDomainTools(register, ["d"] as const, async () => handler(false), () => assert.fail("no error expected"));
    const res = await registered[0].cb({ id: "1" }, "X");
    assert.deepEqual(JSON.parse(res.content[0].text), { name: "acme_a", args: { id: "1" }, extra: "X" });
  });

  it("turns an escaped throw into the onError result", async () => {
    const { registered, register } = makeContext();
    await registerDomainTools(register, ["d"] as const, async () => handler(true),
      (name, err) => ({ content: [{ type: "text", text: `${name}: ${(err as Error).message}` }], isError: true }));
    const res = await registered[0].cb({ id: "1" }, undefined);
    assert.deepEqual(res, { content: [{ type: "text", text: "acme_a: boom" }], isError: true });
  });
});

describe("navigateDomain", () => {
  const base = {
    domains: ["one", "two"] as const,
    getHandler: async () => ({ getTools: () => [tool("acme_a")], handleCall: async () => ok }) as DomainHandler,
    heading: (d: string) => `Domain: ${d}`,
    footer: "\n\nYou can call any of these tools directly.",
  };

  it("rejects an unknown domain with the valid list", async () => {
    const res = await navigateDomain({ ...base, domain: "zzz" });
    assert.deepEqual(res, { content: [{ type: "text", text: "Invalid domain: zzz. Valid: one, two" }], isError: true });
  });

  it("lists the domain's tools between heading and footer", async () => {
    const res = await navigateDomain({ ...base, domain: "one" });
    assert.equal(res.content[0].type === "text" && res.content[0].text,
      "Domain: one\n\nAvailable tools:\n- acme_a: desc acme_a\n\nYou can call any of these tools directly.");
    assert.equal("isError" in res, false);
  });
});

describe("auth check helpers", () => {
  it("reports OK with elapsed ms", async () => {
    assert.match(await runAuthCheck(async () => 1, "10s"), /^OK \(HTTP 200, \d+ ms\)$/);
  });

  it("reports a failure with the HTTP status and a capped message", async () => {
    const err = Object.assign(new Error("x".repeat(300)), { httpStatus: 401 });
    const out = await runAuthCheck(async () => { throw err; }, "10s");
    assert.equal(out, `FAILED HTTP 401: ${"x".repeat(200)}`);
  });

  it("times out with the caller's wording", async () => {
    const out = await runAuthCheck(() => new Promise(() => {}), "10s", 20);
    assert.equal(out, "FAILED: timed out after 10s");
  });

  it("formats a non-Error throw and flips isError only on FAILED", () => {
    assert.equal(formatAuthFailure("nope"), "FAILED: nope");
    assert.equal(statusResult("t", "FAILED: x").isError, true);
    assert.equal(statusResult("t", "OK (HTTP 200, 1 ms)").isError, false);
    assert.equal(statusResult("t", "SKIPPED (no key)").isError, false);
  });
});

// Keeps the ToolRun type import exercised by the compiler, not the runtime.
const _typecheck: ToolRun = async () => ok;
void _typecheck;

describe("makeNavigate", () => {
  const getHandler = async () => ({ getTools: () => [tool("acme_a")], handleCall: async () => ok }) as DomainHandler;

  it("uses the default heading and footer", async () => {
    const res = await makeNavigate(["one"] as const, getHandler)("one");
    assert.equal(res.content[0].type === "text" && res.content[0].text,
      "Domain: one\n\nAvailable tools:\n- acme_a: desc acme_a\n\nYou can call any of these tools directly.");
  });

  it("accepts a custom heading and still rejects unknown domains", async () => {
    const nav = makeNavigate(["one"] as const, getHandler, (d) => `About ${d}`);
    assert.match((await nav("one")).content[0].type === "text" ? (await nav("one")).content[0].text : "", /^About one\n/);
    assert.equal((await nav("zzz")).isError, true);
  });
});

describe("credentialStatusResult", () => {
  const report = { vendor: "Acme", credStatus: "Configured", authCheck: "OK (HTTP 200, 5 ms)", domains: ["a", "b"], footer: "Use acme_navigate." };

  it("renders the status block with the default domains label", () => {
    assert.deepEqual(credentialStatusResult(report), {
      content: [{ type: "text", text: "Acme MCP Server Status\n\nCredentials: Configured\nAuth check: OK (HTTP 200, 5 ms)\nDomains: a, b\n\nUse acme_navigate." }],
      isError: false,
    });
  });

  it("honors a custom domains label and flips isError on FAILED", () => {
    const res = credentialStatusResult({ ...report, authCheck: "FAILED HTTP 401: no", domainsLabel: "Available domains" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].type === "text" ? res.content[0].text : "", /\nAvailable domains: a, b\n/);
  });
});

describe("registerCredentialGatedTools", () => {
  const navTools = [tool("acme_navigate"), tool("acme_status")];
  const run = async (hasCredentials: boolean) => {
    const { registered, register } = makeContext();
    await registerCredentialGatedTools({
      register, navigationTools: navTools, navigateName: "acme_navigate",
      navigate: async () => ok, status: async () => ok, hasCredentials: () => hasCredentials,
      domains: ["d"] as const, getHandler: async () => ({ getTools: () => [tool("acme_a")], handleCall: async () => ok }) as DomainHandler,
      onError: () => ok,
    });
    return registered.map((r) => r.name);
  };

  it("lists only status and navigate without credentials", async () => {
    assert.deepEqual(await run(false), ["acme_navigate", "acme_status"]);
  });

  it("adds domain tools once credentials resolve", async () => {
    assert.deepEqual(await run(true), ["acme_navigate", "acme_status", "acme_a"]);
  });
});

describe("cleanEnv", () => {
  it("trims real values", () => assert.equal(cleanEnv("  v  "), "v"));
  it("blanks undefined, empty and whitespace", () => {
    assert.equal(cleanEnv(undefined), "");
    assert.equal(cleanEnv("   "), "");
  });
  it("blanks an unresolved host placeholder", () => assert.equal(cleanEnv(" ${user_config.x} "), ""));
});
