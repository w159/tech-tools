// Handler logic runs against a recording runner (command -> canned stdout):
// bun's spawned-child stdio is unreliable under some `bun test <relative dir>`
// invocations on this host, and the real runner is proven by the live omp smoke.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	SESSION_MARKER,
	claudeNamesFor,
	loadBridgedHooks,
	parseHookOutput,
	registerHookBridge,
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
function hookScript(name: string, output: unknown): string {
	outputs[name] = typeof output === "string" ? output : JSON.stringify(output);
	calls[name] = [];
	return join(dir, name);
}
const logOf = (name: string) => calls[name] ?? [];
const recordingRunner = async (command: string, payload: Record<string, unknown>) => {
	const name = /([\w.-]+\.py)/.exec(command)?.[1] ?? "";
	if (!(name in outputs)) throw new Error(`unexpected hook ${command}`);
	calls[name].push(payload);
	if (outputs[name] === "CRASH") throw new Error("hook crashed");
	return outputs[name];
};

function writeConfig(hooks: Record<string, unknown>, bridged: string[]) {
	writeFileSync(join(dir, "hooks.json"), JSON.stringify({ hooks }));
	writeFileSync(join(dir, "bridge.json"), JSON.stringify({ bridged, notBridged: {} }));
	return loadBridgedHooks(join(dir, "hooks.json"), join(dir, "bridge.json"));
}

function harness(hooks: ReturnType<typeof loadBridgedHooks>, env: Record<string, string | undefined> = {}) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerHookBridge(api as unknown as Pick<ExtensionAPI, "on">, { hooks, run: recordingRunner, env });
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
