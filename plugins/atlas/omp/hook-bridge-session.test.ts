// Hook-bridge behavior added for the session-end/run-state work: PostToolUse
// tool_response and transcript_path, connector-name re-splitting, omp task batches
// as Claude Task dispatches, the run-state sink contract (allowed-only, no
// double-writes), and the tripwire/native-policy overlap guard.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { runCaptureSync } from "./proc";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	CONNECTOR_SERVERS,
	MCP_SERVERS,
	type BridgeDeps,
	type BridgedHook,
	type HookRunner,
	type ToolEventInfo,
	claudeMcpName,
	loadConnectorServers,
	claudeNamesForCall,
	splitMcpDevice,
	claudeTaskInput,
	claudeTaskInputs,
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

// ---- contracts/mcp-servers.json is the connector list's source ----

test("CONNECTOR_SERVERS equals the contract's connectorWatch, in order", () => {
	const contract = JSON.parse(readFileSync(MCP_SERVERS, "utf8")) as { connectorWatch: string[] };
	expect([...CONNECTOR_SERVERS]).toEqual(contract.connectorWatch);
});

test("loadConnectorServers follows a modified contract and fails open on a missing, malformed or empty one", () => {
	const write = (name: string, body: string) => {
		const p = join(dir, name);
		writeFileSync(p, body);
		return p;
	};
	const fallback = ["fallback_server"];
	expect(loadConnectorServers(write("ok.json", JSON.stringify({ connectorWatch: ["a_b", "c"] })), fallback)).toEqual(["a_b", "c"]);
	expect(loadConnectorServers(join(dir, "missing.json"), fallback)).toBe(fallback);
	expect(loadConnectorServers(write("bad.json", "{not json"), fallback)).toBe(fallback);
	expect(loadConnectorServers(write("list.json", "[]"), fallback)).toBe(fallback);
	expect(loadConnectorServers(write("empty.json", JSON.stringify({ connectorWatch: [] })), fallback)).toBe(fallback);
	expect(loadConnectorServers(write("mixed.json", JSON.stringify({ connectorWatch: ["a", 3] })), fallback)).toBe(fallback);
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

test("dispatch_tripwire runs for every matched tool, including the natively policed ones, so its inline-op threshold can fire", async () => {
	const h = harness([hook("PreToolUse", "dispatch_tripwire.py", "Edit|Write|Read|Grep|Glob|Bash|Task")]);
	for (const tool of ["read", "grep", "glob", "bash"]) await h.handlers.tool_call({ toolName: tool, input: {} }, h.ctx());
	await h.handlers.tool_call({ toolName: "edit", input: { path: "src/a.ts" } }, h.ctx());
	expect(h.payloads.map(p => p.payload.tool_name)).toEqual(["Read", "Grep", "Glob", "Bash", "Edit"]);
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

/**
 * Runs `body` with a fixture project root and an isolated environment for the REAL dispatch_tripwire.py:
 *  - the root lives under the repo's gitignored `.scratch/`, never under the user's home: a checked-in test must not
 *    write into the home directory of whoever runs it, and it must still be OUTSIDE the system temp roots, which the
 *    tripwire exempts from its "never edit target code inline" rule;
 *  - HOME is pinned to an empty directory, because the tripwire reads `~/.claude.json` and `~/.claude/settings.json`
 *    to decide whether lean-ctx is configured, so the answer depends on the machine running the test. Measured on
 *    the author's machine, whose `~/.claude.json` declares a top-level lean-ctx server: `_lean_ctx_server_key` returned
 *    'lean-ctx' for a project with no .mcp.json under the real HOME and None under an empty HOME. To reproduce, pass
 *    `_lean_ctx_server_key` a `pathlib.Path`: it does `root / ".mcp.json"`, so a `str` raises, the fail-open `except`
 *    swallows it, and the call returns None under ANY home, which looks like "HOME does not matter". On a machine
 *    without such a config both are None, so the pin changes nothing there; it exists so the "lean-ctx not
 *    configured" case means the same thing on every machine.
 * Process env is restored afterwards, including variables that were originally unset.
 */
async function withSandbox<T>(body: (root: string) => Promise<T>): Promise<T> {
	const scratch = join(import.meta.dir, "..", "..", "..", ".scratch");
	mkdirSync(scratch, { recursive: true });
	const root = mkdtempSync(join(scratch, "bridge-real-"));
	const emptyHome = mkdtempSync(join(dir, "home-"));
	const names = ["ATLAS_DB", "ATLAS_HOOKSTATE_DIR", "ATLAS_HARNESS", "HOME"] as const;
	const keep: Record<string, string | undefined> = Object.fromEntries(names.map(n => [n, process.env[n]]));
	try {
		mkdirSync(join(root, "docs"));
		mkdirSync(join(root, "src"));
		writeFileSync(join(root, "docs", "CHANGELOG.md"), "x\n");
		writeFileSync(join(root, "src", "a.py"), "print(0)\n");
		process.env.ATLAS_DB = join(dir, "atlas.db");
		process.env.ATLAS_HOOKSTATE_DIR = join(dir, "hookstate");
		process.env.ATLAS_HARNESS = "omp";
		process.env.HOME = emptyHome;
		return await body(root);
	} finally {
		for (const n of names) {
			if (keep[n] === undefined) delete process.env[n];
			else process.env[n] = keep[n];
		}
		rmSync(root, { recursive: true, force: true });
	}
}

// dispatch_tripwire's inline-op threshold deny lives in PreToolUse and counts mutating bash and edits; read-only
// investigation (read/grep/glob, exploration or read-only-git bash) is neither counted nor blocked. The bridge used to
// skip the tripwire's PreToolUse for the inline tools (index.ts polices them natively), which silently removed the
// deny tier in omp: 12 inline bash calls on an armed run were never denied although the DB counted all 12.
/**
 * Drives the REAL dispatch_tripwire.py through the REAL bridge on an armed run: inline read/bash/grep calls with no
 * dispatch must hit the inline-op threshold, and a dispatch must reset it. `leanCtx` configures a lean-ctx MCP server in
 * the fixture's .mcp.json; with lean-ctx reachable, the tripwire's native-tool policy DENIES native Grep/Glob and
 * exploration-only Bash and returns from main() before the count is ever evaluated, so a fixture without it cannot
 * tell whether the threshold tier is still reachable in the setup this repo actually uses.
 */
async function thresholdScenario(leanCtx: boolean) {
	return withSandbox(async root => {
		if (leanCtx) writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { "lean-ctx": { command: "lean-ctx", args: [] } } }));
		const runstate = join(import.meta.dir, "..", "scripts", "omp_runstate.py");
		const sh = (...argv: string[]) => Bun.spawnSync(["python3", runstate, ...argv, "--session-id", "thr-sess", "--cwd", root], { env: process.env });
		sh("begin");
		sh("arm", "--agent-type", "atlas:implementer");

		const handlers: Record<string, Handler[]> = {};
		registerHookBridge({ on: (ev: string, fn: Handler) => void (handlers[ev] ??= []).push(fn) } as unknown as ExtensionAPI);
		const ctx: Ctx = { cwd: root, agent: { kind: "main" }, sessionManager: { getSessionId: () => "thr-sess" } };
		const call = async (toolName: string, input: Record<string, unknown>) => {
			let text = "";
			for (const h of handlers.tool_call ?? []) {
				const r = await h({ toolCallId: `c${Math.random()}`, toolName, input }, ctx);
				if (r?.block) return { blocked: true, text: String(r.reason) };
				if (typeof r?.additionalContext === "string") text += r.additionalContext;
			}
			for (const h of handlers.tool_result ?? []) await h({ toolCallId: "r", toolName, input, content: [{ type: "text", text: "ok" }], isError: false, details: {} }, ctx);
			return { blocked: false, text };
		};
		// A mutating bash counts toward the threshold and is never denied by the native policy even with lean-ctx configured,
		// so any deny is the threshold. Interleaved reads must neither count nor be blocked, even past the threshold.
		const inline = (i: number) => call("bash", { command: `touch src/f${i}.txt` });
		const reads: { blocked: boolean; text: string }[] = [];

		const verdicts: { blocked: boolean; text: string }[] = [];
		for (let i = 1; i <= 12; i++) {
			verdicts.push(await inline(i));
			reads.push(await call("read", { path: "src/a.py" }));
		}
		const firstDeny = verdicts.findIndex(v => v.blocked);

		const TOOLS = "TOOLS: first load them with ToolSearch, then use serena and lean-ctx for code navigation.\n";
		const SPEC = "GOAL: g\nDELIVERABLE: d\nSUCCESS CRITERIA: s\nOUT OF SCOPE: o\nSTOP CONDITIONS: c\nREPORT: r\n";
		const dispatch = await call("task", { tasks: [{ name: "W", agent: "implementer", task: TOOLS + SPEC }] });
		const afterReset = await inline(1);
		// native Grep with lean-ctx configured: the tripwire's own native-policy deny must NOT reach the model (index.ts owns that text)
		const grep = await call("grep", { pattern: "x" });
		return { verdicts, reads, firstDeny, dispatch, afterReset, grep };
	});
}

for (const leanCtx of [false, true]) {
	test(`REAL tripwire through the bridge (lean-ctx ${leanCtx ? "configured" : "not configured"}): the inline-op threshold denies and a dispatch resets it`, async () => {
		const r = await thresholdScenario(leanCtx);
		expect(r.firstDeny).toBeGreaterThanOrEqual(0);
		expect(r.verdicts[r.firstDeny].text).toMatch(/inline ops since your last dispatch/);
		expect(r.verdicts.slice(0, r.firstDeny).every(v => !v.blocked)).toBe(true);
		expect(r.reads.every(v => !v.blocked)).toBe(true); // reads past the threshold are never blocked
		expect(r.dispatch.blocked).toBe(false);
		expect(r.afterReset.blocked).toBe(false);
		expect(r.grep.text + (r.grep.blocked ? r.grep.text : "")).not.toMatch(/native Grep is disabled/);
	});
}

// The tests above inject fake hook runners, so none of them would notice the REAL dispatch_tripwire.py
// disagreeing with the payload the bridge builds. This drives the real hook through the real bridge.
// The project root must NOT be under the OS temp dir: the tripwire exempts temp paths from its
// "never edit target code inline" rule, which made an earlier hand check wrongly report that rule dead on omp.
test("REAL dispatch_tripwire through the bridge: spec-less, bundled and production-edit calls are denied; well-formed and docs calls pass", async () => {
	await withSandbox(async root => {
		const runstate = join(import.meta.dir, "..", "scripts", "omp_runstate.py");
		const sh = (...argv: string[]) => Bun.spawnSync(["python3", runstate, ...argv, "--session-id", "real-sess", "--cwd", root], { env: process.env });
		sh("begin");
		sh("arm", "--agent-type", "atlas:implementer");

		const handlers: Record<string, Handler[]> = {};
		registerHookBridge({ on: (ev: string, fn: Handler) => void (handlers[ev] ??= []).push(fn) } as unknown as ExtensionAPI);
		const ctx: Ctx = { cwd: root, agent: { kind: "main" }, sessionManager: { getSessionId: () => "real-sess" } };
		const fire = async (toolName: string, input: Record<string, unknown>) => {
			for (const h of handlers.tool_call ?? []) {
				const r = await h({ toolCallId: `c${Math.random()}`, toolName, input }, ctx);
				if (r?.block) return r;
			}
			return undefined;
		};
		const TOOLS = "TOOLS: first load them with ToolSearch, then use serena and lean-ctx for code navigation.\n";
		const SPEC = "GOAL: fix add\nDELIVERABLE: patched src/calc.py\nSUCCESS CRITERIA: pytest passes\nOUT OF SCOPE: docs\nSTOP CONDITIONS: tests green\nREPORT: structured result\n";
		const task = (prompt: string) => ({ tasks: [{ name: "W", agent: "implementer", task: prompt }] });

		expect(await fire("task", task(TOOLS + SPEC))).toBeUndefined();
		expect(String((await fire("task", task(`${TOOLS}just fix it`)))?.reason)).toContain("unbounded: missing GOAL:");
		expect(String((await fire("task", task(`${TOOLS}${SPEC}GOAL: and also rewrite billing\n`)))?.reason)).toContain("2 GOAL: blocks");
		expect(String((await fire("edit", { path: "src/a.py", input: "x" }))?.reason)).toContain("never edit target code inline");
		expect(await fire("edit", { path: "docs/CHANGELOG.md", input: "x" })).toBeUndefined();
	});
});

// omp has no ToolSearch: its tools are xd:// devices. The Claude tripwire asks every atlas dispatch for a `ToolSearch`
// load step, so a faithful omp lead could never satisfy it and was pushed into writing Claude-only wording (and into
// activating serena). The bridge sets ATLAS_TOOLKIT_LOAD=omp so only that half of the requirement is waived.
test("REAL dispatch_tripwire through the bridge: an omp-shaped TOOLS block passes, a dispatch naming no navigation tool is still denied", async () => {
	await withSandbox(async root => {
		const runstate = join(import.meta.dir, "..", "scripts", "omp_runstate.py");
		const sh = (...argv: string[]) => Bun.spawnSync(["python3", runstate, ...argv, "--session-id", "omp-tools", "--cwd", root], { env: process.env });
		sh("begin");
		sh("arm", "--agent-type", "atlas:implementer");
		const handlers: Record<string, Handler[]> = {};
		registerHookBridge({ on: (ev: string, fn: Handler) => void (handlers[ev] ??= []).push(fn) } as unknown as ExtensionAPI);
		const ctx: Ctx = { cwd: root, agent: { kind: "main" }, sessionManager: { getSessionId: () => "omp-tools" } };
		const fire = async (input: Record<string, unknown>) => {
			for (const h of handlers.tool_call ?? []) {
				const r = await h({ toolCallId: `c${Math.random()}`, toolName: "task", input }, ctx);
				if (r?.block) return r;
			}
			return undefined;
		};
		const SPEC = "GOAL: fix add\nDELIVERABLE: patched src/calc.py\nSUCCESS CRITERIA: pytest passes\nOUT OF SCOPE: docs\nSTOP CONDITIONS: tests green\nREPORT: structured result\n";
		const OMP_TOOLS = "TOOLS: use lean-ctx via its xd:// devices (xd://mcp__lean_ctx_ctx_search); do not activate serena.\n";
		const task = (prompt: string) => ({ tasks: [{ name: "W", agent: "implementer", task: prompt }] });
		expect(await fire(task(OMP_TOOLS + SPEC))).toBeUndefined();
		expect(String((await fire(task(`read the files you need\n${SPEC}`)))?.reason)).toContain("missing the code-nav TOOLS block");
	});
});

// A `write` to an `xd://` URI is an MCP DEVICE CALL in omp, not a file edit. The bridge classified it by tool name only
// (`Write`), so the REAL tripwire denied the claude-mem recall that atlas's own recall gate demands, and every lean-ctx
// device call, as "never edit target code inline" (measured: the denial text named xd://mcp__claude_mem_mcp_search_search).
test("claudeNamesForCall: a write to an xd:// device is the MCP tool, a write to a file stays Write", () => {
	expect(claudeNamesForCall("write", { path: "xd://mcp__lean_ctx_ctx_search", content: "{}" })).toEqual(["mcp__lean_ctx__ctx_search"]);
	expect(claudeNamesForCall("write", { path: "xd://mcp__claude_mem_mcp_search_search", content: "{}" })).toEqual(["mcp__claude_mem__mcp_search_search"]);
	expect(claudeNamesForCall("write", { path: "xd://mcp__atlas_falcon_falcon_status", content: "{}" })).toEqual(["mcp__atlas_falcon__status"]); // doubled token: omp drops the redundant `falcon_`
	expect(claudeNamesForCall("write", { path: "src/a.py", content: "x" })).toEqual(["Write"]);
	expect(claudeNamesForCall("write", { path: "local://notes.md", content: "x" })).toEqual(["Write"]); // not an MCP device
	expect(claudeNamesForCall("edit", { path: "xd://mcp__lean_ctx_ctx_read" })).toEqual(["Edit"]); // only `write` invokes devices
	expect(claudeNamesForCall("write", undefined)).toEqual(["Write"]);
	expect(claudeNamesForCall("write", { path: 7 })).toEqual(["Write"]);
});

test("splitMcpDevice agrees with scripts/omp_transcript.py _split_mcp_xd on every device, so live hooks and the converted transcript name a tool the same way", () => {
	const devices = [
		"xd://mcp__lean_ctx_ctx_search", "xd://mcp__lean_ctx_ctx_shell", "xd://mcp__claude_mem_mcp_search_search",
		"xd://mcp__context_mode_context_mode_ctx_execute", "xd://mcp__atlas_falcon_falcon_get_host_details", "xd://mcp__azure_azure_acr",
		"xd://mcp__serena_find_symbol", "xd://mcp__microsoft_docs_microsoft_docs_search", "xd://mcp__plaid_search_documentation",
		"xd://mcp__unknownserver_thing", "xd://mcp__x", "xd://mcp__a_a", "xd://not_a_device", "xd://mcp__",
	];
	const script = "import json,sys; sys.path.insert(0, sys.argv[1]); import omp_transcript as o; print(json.dumps([o._split_mcp_xd(d) for d in json.loads(sys.argv[2])]))";
	// proc.ts transport: piped child stdio comes back empty under `bun test` on some hosts (see omp/README).
	const out = runCaptureSync(["python3", "-c", script, join(import.meta.dir, "..", "scripts"), JSON.stringify(devices)], { cwd: join(import.meta.dir, "..", "scripts") });
	if (out.code !== 0) throw new Error(`python split failed (exit ${out.code})`);
	const python: (string | null)[] = JSON.parse(out.stdout);
	expect(devices.map(d => splitMcpDevice(d) ?? null)).toEqual(python);
});

test("REAL dispatch_tripwire through the bridge: device writes are never 'inline edits of target code'", async () => {
	await withSandbox(async root => {
		const runstate = join(import.meta.dir, "..", "scripts", "omp_runstate.py");
		const sh = (...argv: string[]) => Bun.spawnSync(["python3", runstate, ...argv, "--session-id", "dev-w", "--cwd", root], { env: process.env });
		sh("begin");
		sh("arm", "--agent-type", "atlas:implementer");
		const handlers: Record<string, Handler[]> = {};
		registerHookBridge({ on: (ev: string, fn: Handler) => void (handlers[ev] ??= []).push(fn) } as unknown as ExtensionAPI);
		const ctx: Ctx = { cwd: root, agent: { kind: "main" }, sessionManager: { getSessionId: () => "dev-w" } };
		const fire = async (toolName: string, input: Record<string, unknown>) => {
			for (const h of handlers.tool_call ?? []) {
				const r = await h({ toolCallId: `c${Math.random()}`, toolName, input }, ctx);
				if (r?.block) return r;
			}
			return undefined;
		};
		expect(await fire("write", { path: "xd://mcp__claude_mem_mcp_search_search", content: '{"query":"x"}' })).toBeUndefined();
		expect(await fire("write", { path: "xd://mcp__lean_ctx_ctx_search", content: '{"pattern":"x"}' })).toBeUndefined();
		expect(String((await fire("write", { path: "src/a.py", content: "x" }))?.reason)).toContain("never edit target code inline"); // a real file edit is still denied
	});
});

// omp's `task` tool takes a batch-level `context` (shared `# Goal`/contract) plus per-item `task`, and gives every child
// BOTH. The bridge built the tripwire's `prompt` from `task` alone, so a well-formed omp dispatch whose spec and TOOLS
// line live in `context` (as omp's own prompt instructs) was denied as unbounded / missing TOOLS (measured: 2-3 denied
// dispatches per run, each costing a lead turn at ~100k context).
test("claudeTaskInputs folds the batch context into every item's prompt, once, before the task", () => {
	const out = claudeTaskInputs({ context: "# Goal\nshared", tasks: [{ agent: "implementer", name: "A", task: "do A" }, { agent: "verifier", name: "B", task: "do B" }] });
	expect(out.map(i => i.prompt)).toEqual(["# Goal\nshared\n\ndo A", "# Goal\nshared\n\ndo B"]);
	expect(out.map(i => i.subagent_type)).toEqual(["atlas:implementer", "atlas:verifier"]);
	expect(claudeTaskInputs({ agent: "implementer", task: "solo" })[0].prompt).toBe("solo"); // single form: no context to fold
	expect(claudeTaskInputs({ context: "  ", tasks: [{ task: "t" }] })[0].prompt).toBe("t"); // blank context adds nothing
	expect(claudeTaskInputs({ context: 7, tasks: [{ task: "t" }] })[0].prompt).toBe("t"); // hostile context ignored
	expect(claudeTaskInputs(undefined)).toEqual([]);
	expect(claudeTaskInputs({ context: "c", tasks: [{ task: 5 }] })[0].prompt).toBe("c"); // a non-string task contributes nothing
});

test("REAL dispatch_tripwire through the bridge: spec and TOOLS carried by the batch context bound every item; a second GOAL in one task is still bundling", async () => {
	await withSandbox(async root => {
		const runstate = join(import.meta.dir, "..", "scripts", "omp_runstate.py");
		const sh = (...argv: string[]) => Bun.spawnSync(["python3", runstate, ...argv, "--session-id", "ctx-sess", "--cwd", root], { env: process.env });
		sh("begin");
		sh("arm", "--agent-type", "atlas:implementer");
		const handlers: Record<string, Handler[]> = {};
		registerHookBridge({ on: (ev: string, fn: Handler) => void (handlers[ev] ??= []).push(fn) } as unknown as ExtensionAPI);
		const ctx: Ctx = { cwd: root, agent: { kind: "main" }, sessionManager: { getSessionId: () => "ctx-sess" } };
		const fire = async (input: Record<string, unknown>) => {
			for (const h of handlers.tool_call ?? []) {
				const r = await h({ toolCallId: `c${Math.random()}`, toolName: "task", input }, ctx);
				if (r?.block) return r;
			}
			return undefined;
		};
		const SHARED = "TOOLS: use lean-ctx via xd://mcp__lean_ctx_ctx_search; do not activate serena.\nGOAL: implement the slice named below\nDELIVERABLE: the file\nSUCCESS CRITERIA: its tests pass\nOUT OF SCOPE: other files\nSTOP CONDITIONS: tests green\nREPORT: structured result\n";
		const items = [{ name: "A", agent: "implementer", task: "# Target\nsrc/a.py" }, { name: "B", agent: "implementer", task: "# Target\nsrc/b.py" }];
		expect(await fire({ context: SHARED.replace("GOAL: implement the slice named below\n", "").concat("GOAL: g\n"), tasks: items })).toBeUndefined(); // spec only in context: bounded
		expect(String((await fire({ tasks: items }))?.reason)).toContain("missing the code-nav TOOLS block"); // same items, no context: still denied
		expect(String((await fire({ context: SHARED, tasks: [{ name: "C", agent: "implementer", task: "GOAL: and also rewrite billing\n# Target\nsrc/c.py" }] }))?.reason)).toContain("2 GOAL: blocks");
	});
});
