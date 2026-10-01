import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import extension, { register } from "./index";

type Context = { cwd: string; agent: { kind: "main" | "sub" } };
type Result = { block?: boolean; reason?: string; additionalContext?: string; decision?: string } | undefined;
type Handler = (event: { toolName?: string; input: Record<string, unknown> }, ctx: Context) => Result;
let root: string;
let oldGate: string | undefined;
let oldHard: string | undefined;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "atlas-omp-"));
	mkdirSync(join(root, "project", "docs"), { recursive: true });
	oldGate = process.env.ATLAS_GATE;
	oldHard = process.env.ATLAS_TRIPWIRE_HARD;
	delete process.env.ATLAS_GATE;
	delete process.env.ATLAS_TRIPWIRE_HARD;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (oldGate === undefined) delete process.env.ATLAS_GATE; else process.env.ATLAS_GATE = oldGate;
	if (oldHard === undefined) delete process.env.ATLAS_TRIPWIRE_HARD; else process.env.ATLAS_TRIPWIRE_HARD = oldHard;
});
function harness(available: () => boolean = () => true) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, handler: Handler) => { handlers[name] = handler; } };
	// Capture the two host-typed callbacks; the fake only supplies fields they consume.
	const pi = api as unknown as Pick<ExtensionAPI, "on">;
	register(pi, { leanCtxAvailable: available });
	const ctx: Context = { cwd: join(root, "project"), agent: { kind: "main" } };
	return {
		ctx, handlers, pi,
		call: (toolName: string, input: Record<string, unknown> = {}) => handlers.tool_call({ toolName, input }, ctx),
		stop: () => handlers.session_stop({ input: {} }, ctx),
	};
}
test("grep and glob deny with exact reachable replacements", () => {
	const h = harness();
	expect(h.call("grep")).toMatchObject({ block: true, reason: expect.stringContaining("xd://mcp__lean_ctx_ctx_search") });
	expect(h.call("glob")).toMatchObject({ block: true, reason: expect.stringContaining("xd://mcp__lean_ctx_ctx_glob") });
});
test("no lean-ctx allows native search", () => {
	const h = harness(() => false);
	expect(h.call("grep")).toBeUndefined();
	expect(h.call("glob")).toBeUndefined();
});
test("outside docs scope all checks are silent", () => {
	const h = harness(); h.ctx.cwd = root;
	expect(h.call("grep")).toBeUndefined();
	expect(h.call("read")).toBeUndefined();
	h.call("write", { path: "src/main.ts" });
	expect(h.stop()).toBeUndefined();
});
test("ancestor docs scope covers nested project cwd", () => {
	const h = harness(); h.ctx.cwd = join(root, "project", "src", "nested");
	expect(h.call("grep")?.block).toBe(true);
});
test("read and bash nudge once independently even without lean-ctx", () => {
	const h = harness(() => false);
	expect(h.call("read")?.additionalContext).toContain("ctx_read");
	expect(h.call("read")).toBeUndefined();
	expect(h.call("bash")?.additionalContext).toContain("context-mode ctx_execute");
	expect(h.call("bash")).toBeUndefined();
});
test("hard kill switch allows search but preserves nudges", () => {
	process.env.ATLAS_TRIPWIRE_HARD = "off";
	const h = harness();
	expect(h.call("grep")).toBeUndefined();
	expect(h.call("glob")).toBeUndefined();
	expect(h.call("read")?.additionalContext).toContain("ctx_read");
});
test("native deny applies in subagents but delegation never blocks them", () => {
	const h = harness(); h.ctx.agent.kind = "sub";
	expect(h.call("grep")?.block).toBe(true);
	h.call("write", { path: "src/main.ts" });
	expect(h.stop()).toBeUndefined();
});
test("non-docs writes trigger exactly one real stop refusal", () => {
	const h = harness(); h.call("write", { path: "src/main.ts" });
	expect(h.stop()).toMatchObject({ decision: "block", reason: expect.stringContaining("dispatch the code change via the task tool") });
	expect(h.stop()).toBeUndefined();
});
test("multi-file edit derived paths trigger delegation", () => {
	const h = harness(); h.call("edit", { paths: ["docs/wiki.txt", "src/main.ts"] });
	expect(h.stop()?.decision).toBe("block");
});
test("any main task dispatch satisfies delegation", () => {
	const h = harness(); h.call("write", { path: "src/main.ts" }); h.call("task");
	expect(h.stop()).toBeUndefined();
});
test("docs, atlas artifacts, Markdown and internal devices do not trigger", () => {
	const h = harness();
	for (const path of ["docs/wiki.txt", ".atlas/findings.json", "README.md", "xd://mcp__lean_ctx_ctx_search", "local://x.ts", "docs/../.atlas/x.json"]) h.call("write", { path });
	expect(h.stop()).toBeUndefined();
});
test("normalized escape from docs is code", () => {
	const h = harness(); h.call("edit", { path: "docs/../src/main.ts" });
	expect(h.stop()?.decision).toBe("block");
});
test("delegation gate kill switch allows completion", () => {
	process.env.ATLAS_GATE = "off";
	const h = harness(); h.call("write", { path: "src/main.ts" });
	expect(h.stop()).toBeUndefined();
});
test("internal availability failures fail open", () => {
	const h = harness(() => { throw new Error("discovery unavailable"); });
	expect(h.call("grep")).toBeUndefined();
});
test("internal event and context failures fail open", () => {
	const h = harness();
	const badCtx: Context = { get cwd(): string { throw new Error("context unavailable"); }, agent: { kind: "main" } };
	expect(h.handlers.tool_call({ toolName: "grep", input: {} }, badCtx)).toBeUndefined();
	expect(h.handlers.session_stop({ input: {} }, badCtx)).toBeUndefined();
});
test("factory-bound sessions have independent nudge and stop state", () => {
	const a = harness(), b = harness();
	a.call("read"); expect(b.call("read")?.additionalContext).toContain("ctx_read");
	a.call("write", { path: "src/main.ts" }); expect(a.stop()?.decision).toBe("block");
	expect(b.stop()).toBeUndefined();
});
test("switching sessions resets nudges and delegation counters", () => {
	const h = harness(); h.call("read"); h.call("task");
	h.handlers.session_switch({ input: {} }, h.ctx);
	expect(h.call("read")?.additionalContext).toContain("ctx_read");
	h.call("write", { path: "src/main.ts" });
	expect(h.stop()?.decision).toBe("block");
});
test("runtime factory recognizes configured lean-ctx MCP without binary", () => {
	const h = harness();
	const originalPath = process.env.PATH;
	try {
		process.env.PATH = "";
		const api = { ...h.pi, getAllTools: () => [{ name: "mcp__lean_ctx_ctx_search", mcpServerName: "lean-ctx" }] };
		// Fake captures only callbacks; provenance fields match the host's public contract.
		extension(api as unknown as ExtensionAPI);
		expect(h.call("grep")?.block).toBe(true);
	} finally {
		if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
	}
});
