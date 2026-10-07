// Handler logic runs against a recording runner (command -> canned stdout): it
// stays fast and records per-hook timeout data. The REAL runner (node
// child_process) is exercised directly against real hooks/ scripts in the tests
// below, proving captured-child stdout with EVERY `bun test` path form, since
// bun's own spawn stdio was unreliable under relative-path test filters.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	HOOKS_JSON,
	BRIDGE_CONTRACT,
	HANDLER_BUDGET_MS,
	SESSION_MARKER,
	TOOL_CALL_BUDGET_MS,
	claudeNamesFor,
	claudeNamesForCall,
	loadBridgedHooks,
	matcherNames,
	parseHookOutput,
	registerHookBridge,
	runHook,
	type BridgeDeps,
	type HookRunner,
} from "./hook-bridge";

type Ctx = { cwd: string; agent: { kind: "main" | "sub" }; sessionManager: { getSessionId(): string } };
type Result = { block?: boolean; reason?: string; additionalContext?: string; systemPrompt?: string[] } | undefined;
type Handler = (event: Record<string, unknown>, ctx: Ctx) => Promise<Result> | Result;

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-bridge-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Fake hook registry: script name -> stdout; every call's payload is recorded. */
const outputs: Record<string, string> = {};
const calls: Record<string, Array<Record<string, unknown>>> = {};
const times: Record<string, number[]> = {};
function hookScript(name: string, output: unknown): string {
	outputs[name] = typeof output === "string" ? output : JSON.stringify(output);
	calls[name] = [];
	times[name] = [];
	return join(dir, name);
}
const logOf = (name: string) => calls[name] ?? [];
const recordingRunner: HookRunner = async (command, payload, timeoutMs) => {
	const name = /([\w.-]+\.py)/.exec(command)?.[1] ?? "";
	if (!(name in outputs)) throw new Error(`unexpected hook ${command}`);
	calls[name].push(payload);
	times[name].push(timeoutMs);
	if (outputs[name] === "CRASH") throw new Error("hook crashed");
	return outputs[name];
};

function writeConfig(hooks: Record<string, unknown>, bridged: string[]) {
	writeFileSync(join(dir, "hooks.json"), JSON.stringify({ hooks }));
	writeFileSync(join(dir, "bridge.json"), JSON.stringify({ bridged, notBridged: {} }));
	return loadBridgedHooks(join(dir, "hooks.json"), join(dir, "bridge.json"));
}

function harness(hooks: ReturnType<typeof loadBridgedHooks>, env: Record<string, string | undefined> = {}, run: HookRunner = recordingRunner, extra: Partial<BridgeDeps> = {}) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerHookBridge(api as unknown as Pick<ExtensionAPI, "on">, { hooks, run, env, ...extra });
	const ctx = (kind: "main" | "sub" = "main"): Ctx => ({ cwd: dir, agent: { kind }, sessionManager: { getSessionId: () => "s-1" } });
	return { handlers, ctx };
}

const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
const context = (event: string, text: string) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

test("only contract-bridged scripts load; matchers and timeouts come from hooks.json", () => {
	const ok = hookScript("ok_hook.py", {});
	const skip = hookScript("skip_hook.py", {});
	const hooks = writeConfig(
		{
			PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `python3 "${ok}"`, timeout: 7 }, { type: "command", command: `python3 "${skip}"` }] }],
			Stop: [{ hooks: [{ type: "command", command: `python3 "${ok}"` }] }],
		},
		["ok_hook.py"],
	);
	expect(hooks.length).toBe(1);
	expect(hooks[0].event).toBe("PreToolUse");
	expect(hooks[0].timeoutMs).toBe(7000);
	expect(hooks[0].matcher?.test("Bash")).toBe(true);
	expect(hooks[0].matcher?.test("BashOutput")).toBe(false);
});

test("PreToolUse deny blocks the omp call; payload is Claude-shaped", async () => {
	const script = hookScript("gate.py", deny("no commits below the floor"));
	const { handlers, ctx } = harness(writeConfig({ PreToolUse: [{ matcher: "Bash", hooks: [{ command: `python3 "${script}"` }] }] }, ["gate.py"]));
	const result = await handlers.tool_call({ toolName: "bash", input: { command: "git commit -m x" } }, ctx("sub"));
	expect(result).toEqual({ block: true, reason: "no commits below the floor" });
	const [payload] = logOf("gate.py");
	expect(payload).toMatchObject({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git commit -m x" }, session_id: "s-1", cwd: dir });
	// matcher excludes other tools
	expect(await handlers.tool_call({ toolName: "read", input: { path: "a.ts" } }, ctx())).toBeUndefined();
	expect(logOf("gate.py").length).toBe(1);
});

test("PreToolUse forwards the parent's live model as session_model, only when the context has one", async () => {
	const script = hookScript("model_gate.py", {});
	const { handlers, ctx } = harness(writeConfig({ PreToolUse: [{ matcher: "Task", hooks: [{ command: `python3 "${script}"` }] }] }, ["model_gate.py"]));
	const dispatch = { toolName: "task", input: { agent: "implementer", task: "do it", name: "Impl" } };
	await handlers.tool_call(dispatch, ctx());
	expect(logOf("model_gate.py")[0]).not.toHaveProperty("session_model"); // no model on the context: nothing invented
	for (const [provider, id] of [["anthropic", "claude-opus-5-5"], ["ollama", "glm-5.3-flash:cloud"]]) {
		await handlers.tool_call(dispatch, { ...ctx(), model: { provider, id } } as Ctx);
		expect(logOf("model_gate.py").at(-1)).toMatchObject({ session_model: `${provider}/${id}`, tool_name: "Task" });
	}
	await handlers.tool_call(dispatch, { ...ctx(), model: { provider: "anthropic" } } as Ctx); // incomplete model: dropped
	expect(logOf("model_gate.py").at(-1)).not.toHaveProperty("session_model");
});

test("PostToolUse context returns as additionalContext with an absolute file_path", async () => {
	const script = hookScript("drift.py", context("PostToolUse", "docs drift: update docs/"));
	const { handlers, ctx } = harness(writeConfig({ PostToolUse: [{ matcher: "Edit|Write", hooks: [{ command: `python3 "${script}"` }] }] }, ["drift.py"]));
	const result = await handlers.tool_result({ toolName: "edit", input: { path: "src/app.ts" }, isError: false }, ctx());
	expect(result).toEqual({ additionalContext: "docs drift: update docs/" });
	expect(logOf("drift.py")[0].tool_input.file_path).toBe(join(dir, "src/app.ts"));
	expect(await handlers.tool_result({ toolName: "edit", input: { path: "x" }, isError: true }, ctx())).toBeUndefined();
});

test("SessionStart runs once; its context and per-prompt context reach the main system prompt", async () => {
	const boot = hookScript("boot.py", context("SessionStart", "Atlas: orchestrator posture"));
	const opt = hookScript("opt.py", context("UserPromptSubmit", "optimized brief"));
	const { handlers, ctx } = harness(
		writeConfig(
			{ SessionStart: [{ hooks: [{ command: `python3 "${boot}"` }] }], UserPromptSubmit: [{ hooks: [{ command: `python3 "${opt}"` }] }] },
			["boot.py", "opt.py"],
		),
	);
	const first = await handlers.before_agent_start({ prompt: "fix the bug", systemPrompt: ["base"] }, ctx());
	expect(first?.systemPrompt).toEqual(["base", `${SESSION_MARKER}\nAtlas: orchestrator posture`, "optimized brief"]);
	await handlers.before_agent_start({ prompt: "next", systemPrompt: ["base"] }, ctx());
	expect(logOf("boot.py").length).toBe(1);
	expect(logOf("opt.py").map(p => p.prompt)).toEqual(["fix the bug", "next"]);
	expect(await handlers.before_agent_start({ prompt: "x", systemPrompt: ["base"] }, ctx("sub"))).toBeUndefined();
});

test("failures, garbage output and the kill switch all allow", async () => {
	const crash = hookScript("crash.py", "CRASH");
	const garbage = hookScript("garbage.py", "not json at all");
	const hooks = writeConfig({ PreToolUse: [{ matcher: "Bash", hooks: [{ command: `python3 "${crash}"` }, { command: `python3 "${garbage}"` }] }] }, ["crash.py", "garbage.py"]);
	const { handlers, ctx } = harness(hooks);
	expect(await handlers.tool_call({ toolName: "bash", input: { command: "ls" } }, ctx())).toBeUndefined();
	const gate = hookScript("gate2.py", deny("x"));
	const killed = harness(writeConfig({ PreToolUse: [{ matcher: "Bash", hooks: [{ command: `python3 "${gate}"` }] }] }, ["gate2.py"]), { ATLAS_HOOK_BRIDGE: "off" });
	expect(await killed.handlers.tool_call({ toolName: "bash", input: { command: "ls" } }, killed.ctx())).toBeUndefined();
	expect(logOf("gate2.py").length).toBe(0);
	expect(loadBridgedHooks(join(dir, "absent.json"), join(dir, "absent2.json"))).toEqual([]);
});

test("parseHookOutput and tool-name translation", () => {
	expect(parseHookOutput("")).toEqual({});
	expect(parseHookOutput(JSON.stringify({ decision: "block", reason: "STOP: delegate" }))).toEqual({ context: "STOP: delegate" });
	expect(claudeNamesFor("task").sort()).toEqual(["Agent", "Task"]);
	expect(claudeNamesFor("bash")).toEqual(["Bash"]);
	expect(claudeNamesFor("mcp__x_y")).toEqual(["mcp__x_y"]);
});

test("the real contract bridges only hooks that exist in hooks.json", () => {
	const real = loadBridgedHooks();
	const scripts = new Set(real.map(h => /([\w.-]+\.py)/.exec(h.command)?.[1]));
	const contract = JSON.parse(readFileSync(join(import.meta.dir, "..", "contracts", "hook-bridge.json"), "utf8"));
	for (const s of contract.bridged) expect(scripts.has(s)).toBe(true);
	for (const s of Object.keys(contract.notBridged)) expect(scripts.has(s)).toBe(false);
});

// ---- Real runner against real hooks/ scripts (no fake runner) ----

function realCommand(event: string, script: string): string {
	const hook = loadBridgedHooks().find(h => h.event === event && h.command.includes(script));
	if (!hook) throw new Error(`${script} is not bridged for ${event}`);
	return hook.command;
}

test("real runHook runs a real python hook and captures its stdout", async () => {
	const stdout = await runHook(
		realCommand("PreToolUse", "bash_advisor.py"),
		{ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /" } },
		15_000,
	);
	// The bun-stdio failure mode: the child runs but stdout comes back empty.
	expect(stdout.trim().length).toBeGreaterThan(0);
	expect(stdout).toContain("hookSpecificOutput");
});

test("runHook kills a hung hook at its timeout and stays fail-open", async () => {
	const started = Date.now();
	const out = await runHook('python3 -c "import time; time.sleep(30)"', { hook_event_name: "PreToolUse" }, 700);
	expect(Date.now() - started).toBeLessThan(5_000);
	expect(out).toBe("");
});

// An atlas_mux worker is a leaf. prompt_optimizer.py arms a session as an orchestrator from prompt text alone, and a
// worker's task prompt ("implement X, add tests") reads as engineering work, so without this the tripwire then denied
// every edit the worker was spawned to make (seen live: money.py stayed a stub). The bridge must hand hooks the existing
// ATLAS_ENGINE_ARM=off kill switch for a worker, and must not for a lead.
test("runHook sets ATLAS_ENGINE_ARM=off for an atlas_mux worker and leaves a lead alone", async () => {
	const probe = `python3 -c "import os,sys; sys.stdout.write(os.environ.get('ATLAS_ENGINE_ARM','<unset>'))"`;
	const saved = { worker: process.env.ATLAS_WORKER_NAME, arm: process.env.ATLAS_ENGINE_ARM };
	try {
		delete process.env.ATLAS_ENGINE_ARM;
		delete process.env.ATLAS_WORKER_NAME;
		expect(await runHook(probe, { hook_event_name: "UserPromptSubmit" }, 15_000)).toBe("<unset>");
		process.env.ATLAS_WORKER_NAME = "money";
		expect(await runHook(probe, { hook_event_name: "UserPromptSubmit" }, 15_000)).toBe("off");
		process.env.ATLAS_WORKER_NAME = "   "; // blank is not a worker
		expect(await runHook(probe, { hook_event_name: "UserPromptSubmit" }, 15_000)).toBe("<unset>");
	} finally {
		if (saved.worker === undefined) delete process.env.ATLAS_WORKER_NAME;
		else process.env.ATLAS_WORKER_NAME = saved.worker;
		if (saved.arm === undefined) delete process.env.ATLAS_ENGINE_ARM;
		else process.env.ATLAS_ENGINE_ARM = saved.arm;
	}
});

test("every script hooks.json references is listed in the bridge contract", () => {
	const scripts = new Set<string>();
	const walk = (node: unknown): void => {
		if (typeof node === "string") {
			const script = /([\w.-]+\.py)/.exec(node)?.[1];
			if (script) scripts.add(script);
		} else if (Array.isArray(node)) node.forEach(walk);
		else if (node && typeof node === "object") Object.values(node).forEach(walk);
	};
	walk((JSON.parse(readFileSync(HOOKS_JSON, "utf8")) as { hooks: unknown }).hooks);
	const contract = JSON.parse(readFileSync(BRIDGE_CONTRACT, "utf8")) as { bridged: string[]; bridgedSessionEnd: string[]; notBridged: Record<string, string> };
	const listed = new Set([...contract.bridged, ...contract.bridgedSessionEnd, ...Object.keys(contract.notBridged)]);
	expect(scripts.size).toBeGreaterThan(10);
	expect([...scripts].filter(s => !listed.has(s))).toEqual([]);
});

test("real bash_advisor stdout translates to advisory context, never a deny", async () => {
	const command = realCommand("PreToolUse", "bash_advisor.py");
	const bad = parseHookOutput(await runHook(command, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /" } }, 15_000));
	expect(bad.deny).toBeUndefined();
	expect(bad.context).toContain("[atlas advisor]");
	const benign = parseHookOutput(await runHook(command, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }, 15_000));
	expect(benign).toEqual({});
});

test("real docs_drift_watch flags the first non-docs edit in a docs/ repo", async () => {
	const savedGate = process.env.ATLAS_GATE; // the real hook inherits process.env; a developer's kill switch must not leak in
	delete process.env.ATLAS_GATE;
	try {
		const repo = join(dir, "repo");
		const git = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdout: "ignore", stderr: "ignore" });
		mkdirSync(join(repo, "docs"), { recursive: true });
		mkdirSync(join(repo, "src"), { recursive: true });
		writeFileSync(join(repo, "docs", "CHANGELOG.md"), "# Changelog\n");
		writeFileSync(join(repo, "src", "app.ts"), "export {};\n");
		git("init", "-q");
		git("add", "-A");
		git("commit", "-q", "-m", "base");
		writeFileSync(join(repo, "src", "app.ts"), "export const x = 1;\n");
		const out = parseHookOutput(
			await runHook(
				realCommand("PostToolUse", "docs_drift_watch.py"),
				{ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(repo, "src", "app.ts") }, cwd: repo, session_id: "s-drift" },
				15_000,
			),
		);
		expect(out.context).toContain("docs drift");
	} finally {
		if (savedGate === undefined) delete process.env.ATLAS_GATE;
		else process.env.ATLAS_GATE = savedGate;
	}
});

// ---- Timeouts and the 30 s handler budget (omp cuts handlers at 30 s) ----

test("per-hook timeout is min(hooks.json timeout, ATLAS_BRIDGE_HOOK_TIMEOUT_S default 25)", async () => {
	const script = hookScript("cap_boot.py", context("SessionStart", "boot"));
	const config = () => writeConfig({ SessionStart: [{ hooks: [{ command: `python3 "${script}"`, timeout: 120 }] }] }, ["cap_boot.py"]);
	const lowered = harness(config(), { ATLAS_BRIDGE_HOOK_TIMEOUT_S: "2" });
	await lowered.handlers.before_agent_start({ prompt: "x", systemPrompt: [] }, lowered.ctx());
	expect(times["cap_boot.py"]).toEqual([2_000]);
	hookScript("cap_boot.py", context("SessionStart", "boot"));
	const defaulted = harness(config());
	await defaulted.handlers.before_agent_start({ prompt: "x", systemPrompt: [] }, defaulted.ctx());
	expect(times["cap_boot.py"]).toEqual([25_000]);
});

test("the hooks of one event share the handler budget (concurrently); SessionStart stays cached on re-entry", async () => {
	const boot = hookScript("bud_boot.py", context("SessionStart", "booted"));
	const first = hookScript("bud_one.py", context("UserPromptSubmit", "one"));
	const second = hookScript("bud_two.py", context("UserPromptSubmit", "two"));
	const slow: HookRunner = async (command, payload, timeoutMs) => {
		await new Promise(resolve => setTimeout(resolve, 80));
		return recordingRunner(command, payload, timeoutMs);
	};
	const { handlers, ctx } = harness(
		writeConfig(
			{
				SessionStart: [{ hooks: [{ command: `python3 "${boot}"` }] }],
				UserPromptSubmit: [{ hooks: [{ command: `python3 "${first}"` }, { command: `python3 "${second}"` }] }],
			},
			["bud_boot.py", "bud_one.py", "bud_two.py"],
		),
		{ ATLAS_BRIDGE_HOOK_TIMEOUT_S: "60" },
		slow,
	);
	await handlers.before_agent_start({ prompt: "a", systemPrompt: [] }, ctx());
	const [bootMs] = times["bud_boot.py"];
	const [oneMs] = times["bud_one.py"];
	const [twoMs] = times["bud_two.py"];
	expect(bootMs).toBeLessThanOrEqual(HANDLER_BUDGET_MS);
	expect(oneMs).toBeLessThan(bootMs); // SessionStart ran first and spent 80 ms of the shared budget
	expect(Math.abs(oneMs - twoMs)).toBeLessThan(80); // the two UserPromptSubmit hooks started together
	expect(oneMs).toBeGreaterThan(HANDLER_BUDGET_MS - 5_000);
	await handlers.before_agent_start({ prompt: "b", systemPrompt: [] }, ctx());
	expect(times["bud_boot.py"].length).toBe(1);
	expect(times["bud_one.py"][1]).toBeGreaterThan(oneMs);
});

// ---- one per-call budget below omp's 30 s tool_call timeout (a timeout there BLOCKS the call) ----

test("the bridge's budgets sit below omp's 30 s handler timeouts", () => {
	expect(TOOL_CALL_BUDGET_MS).toBeLessThanOrEqual(20_000);
	expect(HANDLER_BUDGET_MS).toBeLessThan(30_000);
});

async function withAtlasHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
	const previous = process.env.ATLAS_HOME;
	const home = join(dir, "atlas-home");
	process.env.ATLAS_HOME = home;
	try {
		return await fn(home);
	} finally {
		if (previous === undefined) delete process.env.ATLAS_HOME;
		else process.env.ATLAS_HOME = previous;
	}
}
const faultsIn = (home: string): Array<{ hook: string; type: string; error: string }> =>
	readFileSync(join(home, "hook-faults.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));

/** A hook that hangs: sleeps to its timeout (plus a kill's worth of overshoot), like the real runner killing it. */
const hangRunner: HookRunner = async (command, payload, timeoutMs) => {
	const name = /([\w.-]+\.py)/.exec(command)?.[1] ?? "";
	(calls[name] ??= []).push(payload);
	await new Promise(resolve => setTimeout(resolve, timeoutMs + 20));
	return "";
};

test("with every hook hanging, a bash tool_call returns inside the call budget, fails open and leaves a fault row", async () => {
	await withAtlasHome(async home => {
		const a = hookScript("hang_a.py", {});
		const b = hookScript("hang_b.py", {});
		const hooks = writeConfig({ PreToolUse: [{ matcher: "Bash", hooks: [{ command: `python3 "${a}"` }, { command: `python3 "${b}"` }] }] }, ["hang_a.py", "hang_b.py"]);
		const { handlers, ctx } = harness(hooks, {}, hangRunner, { budgetMs: 300 });
		const started = Date.now();
		expect(await handlers.tool_call({ toolName: "bash", input: { command: "ls" } }, ctx())).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(900); // baseline: the full 30 s
		expect(faultsIn(home).filter(f => f.type === "BridgeTimeout").map(f => f.hook).sort()).toEqual(["hang_a.py", "hang_b.py"]);
	});
});

test("a runner that ignores its timeout is abandoned at the budget (plus a short grace), not awaited", async () => {
	await withAtlasHome(async home => {
		const a = hookScript("stuck.py", {});
		const never: HookRunner = () => new Promise<string>(() => {});
		const { handlers, ctx } = harness(writeConfig({ PostToolUse: [{ matcher: "Bash", hooks: [{ command: `python3 "${a}"` }] }] }, ["stuck.py"]), {}, never, { budgetMs: 200 });
		const started = Date.now();
		expect(await handlers.tool_result({ toolName: "bash", input: { command: "ls" }, content: "x", isError: false }, ctx())).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(1_000);
		expect(faultsIn(home)[0]).toMatchObject({ hook: "stuck.py", type: "BridgeTimeout" });
	});
});

test("a 3-item task batch with every hook hanging shares ONE budget: later items are skipped, not given a fresh one", async () => {
	await withAtlasHome(async home => {
		const gate = hookScript("hang_task.py", {});
		const { handlers, ctx } = harness(writeConfig({ PreToolUse: [{ matcher: "Task", hooks: [{ command: `python3 "${gate}"` }] }] }, ["hang_task.py"]), {}, hangRunner, { budgetMs: 300 });
		const batch = { tasks: [1, 2, 3].map(n => ({ agent: "implementer", task: `item ${n}`, name: `Impl${n}` })) };
		const started = Date.now();
		expect(await handlers.tool_call({ toolName: "task", input: batch }, ctx())).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(700); // baseline: 3 x the full per-hook slot
		expect(logOf("hang_task.py").length).toBe(1); // items 2 and 3 never started a hook
		expect(faultsIn(home).map(f => f.type)).toEqual(["BridgeTimeout", "BridgeBudget", "BridgeBudget"]);
	});
});

test("a deny from a hook that finishes later still wins by hooks.json order; hooks of one call run concurrently", async () => {
	const a = hookScript("slow_deny.py", {});
	const b = hookScript("fast_deny.py", {});
	const staggered: HookRunner = async command => {
		if (command.includes("slow_deny.py")) await new Promise(resolve => setTimeout(resolve, 60));
		return JSON.stringify(deny(command.includes("slow_deny.py") ? "A first" : "B second"));
	};
	const { handlers, ctx } = harness(writeConfig({ PreToolUse: [{ matcher: "Bash", hooks: [{ command: `python3 "${a}"` }, { command: `python3 "${b}"` }] }] }, ["slow_deny.py", "fast_deny.py"]), {}, staggered);
	const started = Date.now();
	expect(await handlers.tool_call({ toolName: "bash", input: { command: "ls" } }, ctx())).toEqual({ block: true, reason: "A first" });
	expect(Date.now() - started).toBeLessThan(120);
});

test("permissionDecision ask fails closed as a deny; allow stays an allow", () => {
	expect(parseHookOutput(JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "confirm" } }))).toEqual({ deny: "confirm" });
	expect(parseHookOutput(JSON.stringify({ hookSpecificOutput: { permissionDecision: "allow" } }))).toEqual({});
});

// ---- MCP device classification ----

/** Every `xd://mcp__…` device name of a real omp session (the audit's 33), with the Claude name hooks must see. */
const REAL_DEVICES: Array<[string, string]> = [
	["mcp__atlas_falcon_falcon_get_host_details", "mcp__atlas_falcon__get_host_details"],
	["mcp__atlas_knowbe4_knowbe4_account_get", "mcp__atlas_knowbe4__account_get"],
	["mcp__atlas_ninjaone_ninjaone_devices_list", "mcp__atlas_ninjaone__devices_list"],
	["mcp__atlas_panos_panos_status", "mcp__atlas_panos__status"],
	["mcp__atlas_paylocity_paylocity_status", "mcp__atlas_paylocity__status"],
	["mcp__atlas_spanning_spanning_status", "mcp__atlas_spanning__status"],
	["mcp__atlas_threatlocker_threatlocker_status", "mcp__atlas_threatlocker__status"],
	["mcp__atlas_vanta_vanta_status", "mcp__atlas_vanta__status"],
	["mcp__atlas_connectwise_cw_status", "mcp__atlas_connectwise__cw_status"],
	["mcp__atlas_connectwise_cw_test_connection", "mcp__atlas_connectwise__cw_test_connection"],
	["mcp__atlas_auvik_auvik_status", "mcp__atlas_auvik__status"],
	["mcp__atlas_blumira_blumira_status", "mcp__atlas_blumira__status"],
	["mcp__atlas_cipp_cipp_status", "mcp__atlas_cipp__status"],
	["mcp__azure_azure_acr", "mcp__azure__azure_acr"],
	["mcp__azure_azure_role", "mcp__azure__azure_role"],
	["mcp__browser_use_browser_use_browser_exec", "mcp__browser_use__browser_use_browser_exec"],
	["mcp__claude_mem_mcp_search_search", "mcp__claude_mem__mcp_search_search"],
	["mcp__mcp_search_search", "mcp__mcp_search__search"],
	["mcp__mcp_search_get_observations", "mcp__mcp_search__get_observations"],
	["mcp__mcp_search_work_state_write", "mcp__mcp_search__work_state_write"],
	["mcp__clippy_stats", "mcp__clippy__stats"],
	["mcp__clippy_clippy_list", "mcp__clippy__clippy_list"],
	["mcp__context7_query_docs", "mcp__context7__query_docs"],
	["mcp__context7_resolve_library_id", "mcp__context7__resolve_library_id"],
	["mcp__context_mode_context_mode_ctx_execute", "mcp__context_mode_context_mode__ctx_execute"],
	["mcp__lean_ctx_ctx_read", "mcp__lean_ctx__ctx_read"],
	["mcp__lean_ctx_shell", "mcp__lean_ctx__shell"],
	["mcp__microsoft_docs_fetch", "mcp__microsoft_docs__fetch"],
	["mcp__microsoft_docs_search", "mcp__microsoft_docs__search"],
	["mcp__mobbin_search_screens", "mcp__mobbin__search_screens"],
	["mcp__plaid_get_mock_data_prompt", "mcp__plaid__get_mock_data_prompt"],
	["mcp__serena_find_symbol", "mcp__serena__find_symbol"],
	["mcp__serena_initial_instructions", "mcp__serena__initial_instructions"],
];

test("all 33 real device names classify as the MCP tool, never as a file Write", () => {
	expect(REAL_DEVICES.length).toBe(33);
	for (const [device, expected] of REAL_DEVICES) {
		expect(claudeNamesForCall("write", { path: `xd://${device}`, content: "{}" })).toEqual([expected]);
	}
	// a native (non-write) call under the same minted names resolves the same way
	expect(claudeNamesForCall("mcp__atlas_connectwise_cw_status", {})).toEqual(["mcp__atlas_connectwise__cw_status"]);
	expect(claudeNamesForCall("mcp__mcp_search_search", {})).toEqual(["mcp__mcp_search__search"]);
});

test("all 45 cmux-browser tools classify as MCP for server cmux-browser, and the contract partitions them", () => {
	const doc = JSON.parse(readFileSync(join(import.meta.dir, "../contracts/mcp-servers.json"), "utf8"));
	const c = doc.browserServers["cmux-browser"] as Record<"readOnly" | "stateChanging" | "sensitive" | "subagentAllow", string[]>;
	const all = [...c.readOnly, ...c.stateChanging, ...c.sensitive];
	expect(all.length).toBe(45);
	expect(new Set(all).size).toBe(45);
	expect(all.every(t => t.startsWith("browser_"))).toBe(true);
	for (const tool of all) {
		expect(claudeNamesForCall("write", { path: `xd://mcp__cmux_browser_${tool}`, content: "{}" })).toEqual([`mcp__cmux_browser__${tool}`]);
	}
	// sensitive tools are never in the subagent allow-list, and every allowed tool is a known tool
	expect(c.subagentAllow.filter(t => c.sensitive.includes(t))).toEqual([]);
	expect(c.subagentAllow.every(t => all.includes(t))).toBe(true);
	for (const t of ["browser_eval", "browser_cookies", "browser_storage", "browser_state"]) expect(c.sensitive).toContain(t);
});

test("an unrecognised xd://mcp__ device fails closed to an MCP name, a file write stays Write", () => {
	expect(claudeNamesForCall("write", { path: "xd://mcp__brandnew_thing", content: "{}" })).toEqual(["mcp__brandnew_thing"]);
	expect(claudeNamesForCall("write", { path: "xd://mcp__x", content: "{}" })).toEqual(["mcp__x"]);
	expect(claudeNamesForCall("write", { path: "src/app.ts", content: "x" })).toEqual(["Write"]);
	expect(claudeNamesForCall("write", { path: "xd://report_issue", content: "x" })).toEqual(["Write"]); // not an MCP device
});

test("atlas connector calls reach hooks.json's connector_credential_watch matcher (mcp__plugin_atlas_.*)", () => {
	const watch = loadBridgedHooks().find(h => h.command.includes("connector_credential_watch.py"));
	if (!watch?.matcher) throw new Error("connector_credential_watch is not bridged with a matcher");
	const matcher = watch.matcher;
	for (const device of ["mcp__atlas_falcon_falcon_status", "mcp__atlas_connectwise_cw_status", "mcp__atlas_ninjaone_ninjaone_devices_list", "mcp__atlas_vanta_vanta_status", "mcp__atlas_cipp_cipp_status"]) {
		expect(matcherNames(claudeNamesForCall("write", { path: `xd://${device}` })).some(n => matcher.test(n))).toBe(true);
	}
	for (const device of ["mcp__lean_ctx_ctx_read", "mcp__serena_find_symbol", "mcp__mcp_search_search"]) {
		expect(matcherNames(claudeNamesForCall("write", { path: `xd://${device}` })).some(n => matcher.test(n))).toBe(false);
	}
	expect(matcherNames(["Edit", "mcp__atlas_falcon__x"])).toEqual(["Edit", "mcp__atlas_falcon__x", "mcp__plugin_atlas_falcon__x"]);
});

test("a connectwise MCP call is not seen as an Edit/Write by the file hooks", async () => {
	const script = hookScript("edit_only.py", {});
	const { handlers, ctx } = harness(writeConfig({ PreToolUse: [{ matcher: "Edit|Write", hooks: [{ command: `python3 "${script}"` }] }] }, ["edit_only.py"]));
	await handlers.tool_call({ toolName: "write", input: { path: "xd://mcp__atlas_connectwise_cw_status", content: "{}" } }, ctx());
	await handlers.tool_call({ toolName: "write", input: { path: "xd://mcp__mcp_search_search", content: "{}" } }, ctx());
	expect(logOf("edit_only.py").length).toBe(0);
	await handlers.tool_call({ toolName: "write", input: { path: "src/real.ts", content: "x" } }, ctx());
	expect(logOf("edit_only.py").length).toBe(1);
});

// ---- multi-path edits and ast_edit ----

test("a multi-file edit hands hooks EVERY path, once per file, for Pre and Post", async () => {
	const pre = hookScript("multi_pre.py", {});
	const post = hookScript("multi_post.py", {});
	const { handlers, ctx } = harness(
		writeConfig(
			{ PreToolUse: [{ matcher: "Edit", hooks: [{ command: `python3 "${pre}"` }] }], PostToolUse: [{ matcher: "Edit", hooks: [{ command: `python3 "${post}"` }] }] },
			["multi_pre.py", "multi_post.py"],
		),
	);
	const input = { paths: ["src/a.ts", "lib/b.ts"], input: "[src/a.ts#AAAA]\n[lib/b.ts#BBBB]" };
	await handlers.tool_call({ toolName: "edit", input }, ctx());
	await handlers.tool_result({ toolName: "edit", input, content: "ok", isError: false }, ctx());
	for (const name of ["multi_pre.py", "multi_post.py"]) {
		expect(logOf(name).map(p => (p.tool_input as Record<string, unknown>).file_path)).toEqual([join(dir, "src/a.ts"), join(dir, "lib/b.ts")]);
		expect(logOf(name).every(p => p.tool_name === "Edit")).toBe(true);
	}
	// a single-file edit stays one payload (omp also sets `paths: [path]`)
	await handlers.tool_result({ toolName: "edit", input: { path: "one.ts", paths: ["one.ts"] }, content: "ok", isError: false }, ctx());
	expect(logOf("multi_post.py").length).toBe(3);
});

test("ast_edit is an Edit for the hooks, with every path it names", async () => {
	expect(claudeNamesFor("ast_edit")).toEqual(["Edit"]);
	const script = hookScript("ast_pre.py", {});
	const { handlers, ctx } = harness(writeConfig({ PreToolUse: [{ matcher: "Edit", hooks: [{ command: `python3 "${script}"` }] }] }, ["ast_pre.py"]));
	await handlers.tool_call({ toolName: "ast_edit", input: { paths: ["src/x.ts", "src/y.ts"], ops: [{ pat: "a", out: "b" }] } }, ctx());
	expect(logOf("ast_pre.py").map(p => (p.tool_input as Record<string, unknown>).file_path)).toEqual([join(dir, "src/x.ts"), join(dir, "src/y.ts")]);
	expect(logOf("ast_pre.py")[0].tool_name).toBe("Edit");
});
