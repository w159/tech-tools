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
	SESSION_MARKER,
	claudeNamesFor,
	loadBridgedHooks,
	parseHookOutput,
	registerHookBridge,
	runHook,
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

function harness(hooks: ReturnType<typeof loadBridgedHooks>, env: Record<string, string | undefined> = {}, run: HookRunner = recordingRunner) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerHookBridge(api as unknown as Pick<ExtensionAPI, "on">, { hooks, run, env });
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

test("hooks share the 30 s handler budget; SessionStart stays cached on re-entry", async () => {
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
	expect(bootMs).toBeLessThanOrEqual(30_000);
	expect(oneMs).toBeLessThan(bootMs);
	expect(twoMs).toBeLessThan(oneMs);
	expect(oneMs).toBeGreaterThan(20_000);
	await handlers.before_agent_start({ prompt: "b", systemPrompt: [] }, ctx());
	expect(times["bud_boot.py"].length).toBe(1);
	expect(times["bud_one.py"][1]).toBeGreaterThan(oneMs);
});
