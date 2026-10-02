// Hook-bridge behavior added for the session-end/run-state work: PostToolUse
// tool_response and transcript_path, connector-name re-splitting, omp task batches
// as Claude Task dispatches, the run-state sink contract (allowed-only, no
// double-writes), and the tripwire/native-policy overlap guard.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	CONNECTOR_SERVERS,
	type BridgeDeps,
	type BridgedHook,
	type HookRunner,
	type ToolEventInfo,
	claudeMcpName,
	claudeTaskInput,
	loadBridgedHooks,
	loadBridgedHooksFor,
	registerHookBridge,
	taskItems,
	toolResponseText,
} from "./hook-bridge";

type Ctx = { cwd: string; agent: { kind: "main" | "sub" }; sessionManager: { getSessionId(): string } };
type Handler = (event: Record<string, unknown>, ctx: Ctx) => Promise<Record<string, unknown> | undefined>;

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-bridge2-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const hook = (event: BridgedHook["event"], script: string, matcher?: string): BridgedHook => ({
	event,
	matcher: matcher ? new RegExp(`^(?:${matcher})$`) : undefined,
	command: `python3 "/x/${script}"`,
	timeoutMs: 60_000,
});
const scriptOf = (command: string) => /([\w.-]+\.py)/.exec(command)?.[1] ?? "";
const deny = (reason: string) => JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });

function harness(hooks: BridgedHook[], stdout: Record<string, string | ((payload: Record<string, unknown>) => string)> = {}, deps: Partial<BridgeDeps> = {}) {
	const payloads: { script: string; payload: Record<string, unknown> }[] = [];
	const handlers: Record<string, Handler> = {};
	const run: HookRunner = async (command, payload) => {
		const script = scriptOf(command);
		payloads.push({ script, payload });
		const out = stdout[script];
		return typeof out === "function" ? out(payload) : (out ?? "");
	};
	registerHookBridge({ on: (name: string, fn: Handler) => void (handlers[name] = fn) } as unknown as Pick<ExtensionAPI, "on">, { hooks, run, env: {}, ...deps });
	const ctx = (kind: "main" | "sub" = "main"): Ctx => ({ cwd: dir, agent: { kind }, sessionManager: { getSessionId: () => "s-1" } });
	return { handlers, payloads, ctx };
}

// ---- PostToolUse payload ----

test("PostToolUse carries the stringified result as tool_response, plus transcript_path and is_error", async () => {
	const h = harness([hook("PostToolUse", "docs_drift_watch.py", "Edit")], {}, { transcriptPath: () => "/t/x.jsonl" });
	await h.handlers.tool_result({ toolName: "edit", input: { path: "a.ts" }, content: [{ type: "text", text: "ok" }], isError: false }, h.ctx());
	await h.handlers.tool_result({ toolName: "edit", input: { path: "a.ts" }, content: "plain text", isError: false }, h.ctx());
	await h.handlers.tool_result({ toolName: "edit", input: { path: "a.ts" }, isError: false }, h.ctx());
	expect(h.payloads.map(p => p.payload.tool_response)).toEqual(['[{"type":"text","text":"ok"}]', "plain text", ""]);
	expect(h.payloads[0].payload).toMatchObject({ transcript_path: "/t/x.jsonl", is_error: false, hook_event_name: "PostToolUse", tool_name: "Edit" });
});

test("an errored result runs no PostToolUse hook, as before", async () => {
	const h = harness([hook("PostToolUse", "docs_drift_watch.py")]);
	expect(await h.handlers.tool_result({ toolName: "edit", input: {}, content: "boom", isError: true }, h.ctx())).toBeUndefined();
	expect(h.payloads).toEqual([]);
});

test("toolResponseText never throws on hostile content", () => {
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	expect(toolResponseText(cyclic)).toBe("");
	expect(toolResponseText(undefined)).toBe("");
	expect(toolResponseText(null)).toBe("");
	expect(toolResponseText(42)).toBe("42");
});

// ---- connector name re-splitting ----

test("omp-minted connector names are re-split so the hooks.json matcher and the python hook both work", async () => {
	const matcher = "mcp__plugin_atlas_.*|mcp__falcon-mcp__.*|mcp__cipp.*|mcp__connectwise.*|mcp__plaid__.*|mcp__gcloud__.*";
	const h = harness([hook("PostToolUse", "connector_credential_watch.py", matcher)]);
	await h.handlers.tool_result({ toolName: "mcp__falcon-mcp_falcon_search_hosts", input: {}, content: "HTTP 401 Unauthorized", isError: false }, h.ctx());
	await h.handlers.tool_result({ toolName: "mcp__plugin_atlas_cw_search_tickets", input: {}, content: "x", isError: false }, h.ctx());
	await h.handlers.tool_result({ toolName: "mcp__cipp_users_get", input: {}, content: "x", isError: false }, h.ctx());
	await h.handlers.tool_result({ toolName: "mcp__lean_ctx_ctx_read", input: {}, content: "x", isError: false }, h.ctx()); // not a connector
	expect(h.payloads.map(p => p.payload.tool_name)).toEqual(["mcp__falcon-mcp__falcon_search_hosts", "mcp__plugin_atlas__cw_search_tickets", "mcp__cipp__users_get"]);
	expect(h.payloads[0].payload.tool_response).toBe("HTTP 401 Unauthorized");
});

test("claudeMcpName splits on the longest known server, accepts the xd:// form, and leaves the rest alone", () => {
	expect(claudeMcpName("mcp__falcon-mcp_falcon_get_host_details")).toBe("mcp__falcon-mcp__falcon_get_host_details");
	expect(claudeMcpName("xd://mcp__plaid_get_sandbox_access_token")).toBe("mcp__plaid__get_sandbox_access_token");
	expect(claudeMcpName("mcp__gcloud_list")).toBe("mcp__gcloud__list");
	expect(claudeMcpName("mcp__ciphertext_tool")).toBe("mcp__ciphertext_tool"); // `cipp_` is not a prefix of `ciphertext_`
	expect(claudeMcpName("mcp__cipp_")).toBe("mcp__cipp_"); // an empty tool is not a split
	expect(claudeMcpName("mcp__serena_find_symbol")).toBe("mcp__serena_find_symbol");
	expect(claudeMcpName("bash")).toBe("bash");
	expect([...CONNECTOR_SERVERS].sort()).toEqual(["cipp", "connectwise", "falcon-mcp", "gcloud", "plaid", "plugin_atlas"]);
});

// ---- task batches as Claude Task dispatches ----

test("an omp task batch is checked once per item, as a Claude atlas:<agent> Task", async () => {
	const h = harness([hook("PreToolUse", "dispatch_tripwire.py", "Task|Agent")]);
	await h.handlers.tool_call(
		{ toolName: "task", input: { tasks: [{ agent: "implementer", name: "A", task: "GOAL: x", isolated: true }, { agent: "task", task: "generic" }] } },
		h.ctx(),
	);
	expect(h.payloads.length).toBe(2);
	expect(h.payloads[0].payload).toMatchObject({ tool_name: "Task", tool_input: { subagent_type: "atlas:implementer", prompt: "GOAL: x", description: "A", isolation: "worktree" } });
	expect(h.payloads[1].payload.tool_input).toMatchObject({ subagent_type: "task", prompt: "generic" }); // non-atlas agents stay unprefixed
});

test("one denied item blocks the whole batch and stops checking the rest", async () => {
	let n = 0;
	const h = harness([hook("PreToolUse", "dispatch_tripwire.py", "Task")], { "dispatch_tripwire.py": () => (++n === 2 ? deny("second item is unbounded") : "") });
	const result = await h.handlers.tool_call({ toolName: "task", input: { tasks: [{ agent: "implementer" }, { agent: "explorer" }, { agent: "verifier" }] } }, h.ctx());
	expect(result).toEqual({ block: true, reason: "second item is unbounded" });
	expect(h.payloads.length).toBe(2); // the third item was never checked
});

test("taskItems and claudeTaskInput handle single, batch and malformed shapes", () => {
	expect(taskItems({ agent: "explorer", task: "x" })).toEqual([{ agent: "explorer", task: "x" }]);
	expect(taskItems({ tasks: [{ agent: "a" }, null, 3, ["x"], { agent: "b" }] })).toEqual([{ agent: "a" }, { agent: "b" }]);
	expect(taskItems({ tasks: [] })).toEqual([]);
	expect(taskItems(undefined)).toEqual([]);
	expect(claudeTaskInput({ task: 7 })).toMatchObject({ prompt: "", subagent_type: "" });
	expect(claudeTaskInput({ agent: " explorer ", name: "  ", isolated: false })).toEqual({ agent: " explorer ", name: "  ", isolated: false, subagent_type: "atlas:explorer", prompt: "" });
});

// ---- tripwire / native-policy overlap ----

test("dispatch_tripwire is skipped for tools index.ts already polices natively, and runs for Edit/Task", async () => {
	const h = harness([hook("PreToolUse", "dispatch_tripwire.py", "Edit|Write|Read|Grep|Glob|Bash|Task")]);
	for (const tool of ["read", "grep", "glob", "bash"]) await h.handlers.tool_call({ toolName: tool, input: {} }, h.ctx());
	expect(h.payloads).toEqual([]);
	await h.handlers.tool_call({ toolName: "edit", input: { path: "src/a.ts" } }, h.ctx());
	await h.handlers.tool_call({ toolName: "write", input: { path: "src/b.ts" } }, h.ctx());
	expect(h.payloads.map(p => p.payload.tool_name)).toEqual(["Edit", "Write"]);
	// PostToolUse logging is NOT skipped for the policed tools: that is the inline-op counter.
	const post = harness([hook("PostToolUse", "dispatch_tripwire.py", "Read|Bash")]);
	await post.handlers.tool_result({ toolName: "read", input: {}, content: "x", isError: false }, post.ctx());
	expect(post.payloads.length).toBe(1);
});

// ---- run-state sink contract ----

test("the allowed-sink fires after hooks allow, reports tripwireRan, and never fires on a deny", async () => {
	const seen: ToolEventInfo[] = [];
	const hooks = [hook("PreToolUse", "dispatch_tripwire.py", "Task")];
	const allowed = harness(hooks, {}, { onToolAllowed: info => void seen.push(info) });
	await allowed.handlers.tool_call({ toolName: "task", input: { agent: "implementer" } }, allowed.ctx());
	expect(seen).toEqual([{ toolName: "task", input: { agent: "implementer" }, cwd: dir, sessionId: "s-1", tripwireRan: true, isError: false }]);
	const denied = harness(hooks, { "dispatch_tripwire.py": deny("no") }, { onToolAllowed: info => void seen.push(info) });
	const before = seen.length;
	expect(await denied.handlers.tool_call({ toolName: "task", input: { agent: "implementer" } }, denied.ctx())).toMatchObject({ block: true });
	expect(seen.length).toBe(before); // a denied dispatch never ran, so it must not be armed or logged
	const bare = harness([], {}, { onToolAllowed: info => void seen.push(info) });
	await bare.handlers.tool_call({ toolName: "edit", input: { path: "a.ts" } }, bare.ctx());
	expect(seen.at(-1)).toMatchObject({ toolName: "edit", tripwireRan: false }); // no tripwire hook: the sink is the fallback
});

test("the result-sink fires for successful results only", async () => {
	const seen: string[] = [];
	const h = harness([], {}, { onToolResult: info => void seen.push(info.toolName) });
	await h.handlers.tool_result({ toolName: "edit", input: {}, content: "ok", isError: false }, h.ctx());
	await h.handlers.tool_result({ toolName: "write", input: {}, content: "boom", isError: true }, h.ctx());
	expect(seen).toEqual(["edit"]);
});

test("a throwing sink never breaks the tool call", async () => {
	const h = harness([hook("PreToolUse", "dispatch_tripwire.py", "Edit")], {}, {
		onToolAllowed: () => {
			throw new Error("sink exploded");
		},
		onToolResult: () => {
			throw new Error("sink exploded");
		},
	});
	expect(await h.handlers.tool_call({ toolName: "edit", input: { path: "a.ts" } }, h.ctx())).toBeUndefined();
	expect(await h.handlers.tool_result({ toolName: "edit", input: {}, content: "ok", isError: false }, h.ctx())).toBeUndefined();
});

test("a throwing or rejecting transcript provider degrades to an empty path and the deny still applies", async () => {
	for (const provider of [
		() => {
			throw new Error("no transcript");
		},
		() => Promise.reject(new Error("no transcript")),
	]) {
		const h = harness([hook("PreToolUse", "dispatch_tripwire.py", "Edit")], { "dispatch_tripwire.py": deny("production edit") }, { transcriptPath: provider });
		expect(await h.handlers.tool_call({ toolName: "edit", input: { path: "src/a.ts" } }, h.ctx())).toEqual({ block: true, reason: "production edit" });
		expect(h.payloads[0].payload.transcript_path).toBe("");
	}
});

test("transcript_path reaches PreToolUse hooks; main sessions without a provider send an empty path", async () => {
	const withPath = harness([hook("PreToolUse", "dispatch_tripwire.py", "Edit")], {}, { transcriptPath: ctx => (ctx.agent?.kind === "sub" ? "/c/subagents/agent-1.jsonl" : "") });
	await withPath.handlers.tool_call({ toolName: "edit", input: {} }, withPath.ctx("sub"));
	await withPath.handlers.tool_call({ toolName: "edit", input: {} }, withPath.ctx("main"));
	expect(withPath.payloads.map(p => p.payload.transcript_path)).toEqual(["/c/subagents/agent-1.jsonl", ""]);
	const none = harness([hook("PreToolUse", "dispatch_tripwire.py", "Edit")]);
	await none.handlers.tool_call({ toolName: "edit", input: {} }, none.ctx());
	expect(none.payloads[0].payload.transcript_path).toBe("");
});

// ---- the loaders keep their event families apart ----

test("loadBridgedHooks stays turn-only; the session-end family loads through its own list", () => {
	const turn = loadBridgedHooks();
	expect(turn.length).toBeGreaterThan(0);
	expect(turn.every(h => ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"].includes(h.event))).toBe(true);
	const scripts = (hooks: BridgedHook[]) => hooks.map(h => scriptOf(h.command));
	const stop = loadBridgedHooksFor(["Stop"], "bridgedSessionEnd");
	expect(scripts(stop)).toEqual(["completion_gate.py", "ingest_session.py", "chronicle_facet.py", "memory_capture.py", "nudge.py"]);
	for (const event of ["SessionEnd", "SubagentStop", "PreCompact"] as const) expect(scripts(loadBridgedHooksFor([event], "bridgedSessionEnd"))).toEqual(["ingest_session.py"]);
	expect(scripts(turn)).toContain("dispatch_tripwire.py");
	expect(scripts(turn)).toContain("connector_credential_watch.py");
	expect(scripts(turn)).not.toContain("completion_gate.py");
	const noKey = join(dir, "c.json");
	writeFileSync(noKey, JSON.stringify({ bridged: ["session_boot.py"] }));
	expect(loadBridgedHooksFor(["Stop"], "bridgedSessionEnd", undefined, noKey)).toEqual([]); // a contract without the list bridges nothing
});

// The tests above inject fake hook runners, so none of them would notice the REAL dispatch_tripwire.py
// disagreeing with the payload the bridge builds. This drives the real hook through the real bridge.
// The project root must NOT be under the OS temp dir: the tripwire exempts temp paths from its
// "never edit target code inline" rule, which made an earlier hand check wrongly report that rule dead on omp.
test("REAL dispatch_tripwire through the bridge: spec-less, bundled and production-edit calls are denied; well-formed and docs calls pass", async () => {
	const root = mkdtempSync(join(homedir(), ".atlas-bridge-real-"));
	const db = join(dir, "atlas.db");
	const keep = { db: process.env.ATLAS_DB, state: process.env.ATLAS_HOOKSTATE_DIR, harness: process.env.ATLAS_HARNESS };
	try {
		mkdirSync(join(root, "docs"));
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "docs", "CHANGELOG.md"), "x\n");
		writeFileSync(join(root, "src", "app.py"), "print(0)\n");
		process.env.ATLAS_DB = db;
		process.env.ATLAS_HOOKSTATE_DIR = join(dir, "hookstate");
		process.env.ATLAS_HARNESS = "omp";
		const runstate = join(import.meta.dir, "..", "scripts", "omp_runstate.py");
		const sh = (...argv: string[]) => Bun.spawnSync(["python3", runstate, ...argv, "--session-id", "real-sess", "--cwd", root], { env: process.env });
		sh("begin");
		sh("arm", "--agent-type", "atlas:implementer");

		const handlers: Record<string, Handler[]> = {};
		const pi = { on: (ev: string, fn: Handler) => void (handlers[ev] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">;
		registerHookBridge(pi as ExtensionAPI);
		const ctx: Ctx = { cwd: root, agent: { kind: "main" }, sessionManager: { getSessionId: () => "real-sess" } };
		const fire = async (toolName: string, input: Record<string, unknown>) => {
			for (const h of handlers.tool_call ?? []) {
				const r = await h({ toolCallId: `c${Math.random()}`, toolName, input }, ctx);
				if (r?.block) return r;
			}
			return undefined;
		};
		const TOOLS = "TOOLS: first load them with ToolSearch, then use serena and lean-ctx for code navigation.\n";
		const SPEC = "GOAL: fix add\nDELIVERABLE: patched src/calc.py\nSUCCESS CRITERIA: pytest passes\nOUT OF SCOPE: docs\nSTOP CONDITIONS: tests green\n";
		const task = (prompt: string) => ({ tasks: [{ name: "W", agent: "implementer", task: prompt }] });

		expect(await fire("task", task(TOOLS + SPEC))).toBeUndefined();
		expect(String((await fire("task", task(`${TOOLS}just fix it`)))?.reason)).toContain("unbounded: missing GOAL:");
		expect(String((await fire("task", task(`${TOOLS}${SPEC}GOAL: and also rewrite billing\n`)))?.reason)).toContain("2 GOAL: blocks");
		expect(String((await fire("edit", { path: "src/app.py", input: "x" }))?.reason)).toContain("never edit target code inline");
		expect(await fire("edit", { path: "docs/CHANGELOG.md", input: "x" })).toBeUndefined();
	} finally {
		process.env.ATLAS_DB = keep.db;
		process.env.ATLAS_HOOKSTATE_DIR = keep.state;
		process.env.ATLAS_HARNESS = keep.harness;
		if (keep.db === undefined) delete process.env.ATLAS_DB;
		if (keep.state === undefined) delete process.env.ATLAS_HOOKSTATE_DIR;
		if (keep.harness === undefined) delete process.env.ATLAS_HARNESS;
		rmSync(root, { recursive: true, force: true });
	}
});
