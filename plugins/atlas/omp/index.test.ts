import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import extension, { ensureClaudePluginRoot, register } from "./index";

type Context = {
	cwd: string;
	agent: { kind: "main" | "sub" };
	sessionManager?: { getSessionId(): string };
};
type Result = { block?: boolean; reason?: string; additionalContext?: string; decision?: string } | undefined;
type Handler = (
	event: { toolName?: string; input: Record<string, unknown>; details?: unknown; isError?: boolean },
	ctx: Context,
) => Result;
type SpawnCapture = { argv: string[]; opts: { cwd: string } };
let root: string;
let oldGate: string | undefined;
let oldHard: string | undefined;
let oldPluginRoot: string | undefined;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "atlas-omp-"));
	mkdirSync(join(root, "project", "docs"), { recursive: true });
	oldGate = process.env.ATLAS_GATE;
	oldHard = process.env.ATLAS_TRIPWIRE_HARD;
	oldPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
	delete process.env.ATLAS_GATE;
	delete process.env.ATLAS_TRIPWIRE_HARD;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (oldGate === undefined) delete process.env.ATLAS_GATE; else process.env.ATLAS_GATE = oldGate;
	if (oldHard === undefined) delete process.env.ATLAS_TRIPWIRE_HARD; else process.env.ATLAS_TRIPWIRE_HARD = oldHard;
	if (oldPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT; else process.env.CLAUDE_PLUGIN_ROOT = oldPluginRoot;
});
// omp tool surfaces. A connected lean-ctx MCP server presents its tools as
// xd:// devices under minted names (mcp__lean_ctx_ctx_search); a first-class
// registration exposes plain ctx_* names. Both are "callable in this session".
const BASE_TOOLS = ["read", "write", "edit", "bash", "grep", "glob", "task", "todo"];
const ACTIVE_DEVICES: string[] = [...BASE_TOOLS, "mcp__lean_ctx_ctx_search", "mcp__lean_ctx_ctx_glob", "mcp__lean_ctx_ctx_read", "mcp__lean_ctx_ctx_shell"];
const ACTIVE_BUILTINS: string[] = [...BASE_TOOLS, "ctx_search", "ctx_glob", "ctx_read", "ctx_shell"];
const ACTIVE_NONE: string[] = [...BASE_TOOLS];
function harness(
	active: () => string[] | undefined = () => ACTIVE_DEVICES,
	spawnBoardMirror?: (argv: string[], opts: { cwd: string }) => void,
) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, handler: Handler) => { handlers[name] = handler; } };
	// Capture the two host-typed callbacks; the fake only supplies fields they consume.
	const pi = api as unknown as Pick<ExtensionAPI, "on">;
	const spawns: SpawnCapture[] = [];
	register(pi, {
		activeTools: active,
		spawnBoardMirror: spawnBoardMirror ?? ((argv, opts) => { spawns.push({ argv, opts }); }),
	});
	const ctx: Context = { cwd: join(root, "project"), agent: { kind: "main" } };
	return {
		ctx, handlers, pi, spawns,
		call: (toolName: string, input: Record<string, unknown> = {}) => handlers.tool_call({ toolName, input }, ctx),
		result: (event: { toolName: string; details?: unknown; isError?: boolean }) =>
			handlers.tool_result({ toolName: event.toolName, input: {}, details: event.details, isError: event.isError }, ctx),
		stop: () => handlers.session_stop({ input: {} }, ctx),
	};
}
test("grep and glob deny with exact reachable replacements", () => {
	const h = harness();
	expect(h.call("grep")).toMatchObject({ block: true, reason: expect.stringContaining("xd://mcp__lean_ctx_ctx_search") });
	expect(h.call("glob")).toMatchObject({ block: true, reason: expect.stringContaining("xd://mcp__lean_ctx_ctx_glob") });
});
test("no reachable lean-ctx allows native search with one nudge per tool", () => {
	const h = harness(() => ACTIVE_NONE);
	expect(h.call("grep")).toMatchObject({ additionalContext: expect.stringContaining("not reachable") });
	expect(h.call("grep")).toBeUndefined();
	expect(h.call("glob")?.block).toBeUndefined();
});
test("builtin ctx tools are named directly in the deny", () => {
	const h = harness(() => ACTIVE_BUILTINS);
	const r = h.call("grep");
	expect(r?.block).toBe(true);
	expect(r?.reason).toContain("call ctx_search directly");
	expect(r?.reason).not.toContain("xd://");
});
test("device routes need the write tool to be callable", () => {
	const h = harness(() => ACTIVE_DEVICES.filter(name => name !== "write"));
	expect(h.call("grep")?.block).toBeUndefined();
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
test("read and bash nudge once independently, naming the reachable route", () => {
	const h = harness();
	expect(h.call("read")?.additionalContext).toContain("xd://mcp__lean_ctx_ctx_read");
	expect(h.call("read")).toBeUndefined();
	expect(h.call("bash")?.additionalContext).toContain("xd://mcp__lean_ctx_ctx_shell");
	expect(h.call("bash")).toBeUndefined();
});
test("read and bash stay silent when no replacement is reachable", () => {
	const h = harness(() => ACTIVE_NONE);
	expect(h.call("read")).toBeUndefined();
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
test("internal availability failures fail open silently", () => {
	const h = harness(() => { throw new Error("discovery unavailable"); });
	expect(h.call("grep")).toBeUndefined();
	expect(h.call("glob")).toBeUndefined();
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
test("runtime factory arms only on session-active tools, not the binary or configured servers", () => {
	const h = harness();
	const base = { ...h.pi, getAllTools: () => [{ name: "mcp__lean_ctx_ctx_search", mcpServerName: "lean-ctx" }] };
	// Configured server + binary on PATH but no active ctx tool: allowed (nudge only).
	extension({ ...base, getActiveTools: () => ACTIVE_NONE } as unknown as ExtensionAPI);
	expect(h.call("grep")?.block).toBeUndefined();
	// Same server once its device is live in the session: denied.
	extension({ ...base, getActiveTools: () => ACTIVE_DEVICES } as unknown as ExtensionAPI);
	expect(h.call("grep")?.block).toBe(true);
});

// ── Task naming notice (atlas colony sibling addressing) ──

test("unnamed atlas batch items get exactly one naming notice", () => {
	const h = harness();
	const batch = {
		tasks: [
			{ agent: "explorer", task: "map the flow", solutionSpace: "open" },
			{ agent: "verifier", task: "verify the fix", solutionSpace: "open" },
		],
	};
	const first = h.call("task", batch);
	expect(first?.additionalContext).toContain("write agent://<name>");
	expect(first?.additionalContext).toContain("explorer");
	expect(first?.additionalContext).toContain("verifier");
	expect(first?.block).toBeUndefined();
	expect(first?.decision).toBeUndefined();
	expect(h.call("task", batch)).toBeUndefined();
	// The dispatch still satisfies the delegation gate.
	expect(h.stop()).toBeUndefined();
});

test("named atlas items and non-atlas dispatches stay silent", () => {
	const h = harness();
	expect(h.call("task", { tasks: [{ name: "ScoutA", agent: "explorer", task: "x", solutionSpace: "y" }] })).toBeUndefined();
	// No agent field defaults to the generic `task` agent, not an atlas agent.
	expect(h.call("task", { tasks: [{ task: "x", solutionSpace: "y" }] })).toBeUndefined();
	expect(h.call("task", { agent: "unrelated-agent", task: "x" })).toBeUndefined();
});

test("single-form unnamed atlas dispatch gets the notice", () => {
	const h = harness();
	const first = h.call("task", { agent: "db-prober", task: "inspect the schema" });
	expect(first?.additionalContext).toContain("write agent://<name>");
	expect(h.call("task", { agent: "planner", task: "plan it" })).toBeUndefined();
});

test("mixed named and unnamed atlas batch flags only the unnamed tier", () => {
	const h = harness();
	const first = h.call("task", {
		tasks: [
			{ name: "ScoutA", agent: "explorer", task: "x", solutionSpace: "y" },
			{ agent: "verifier", task: "y", solutionSpace: "z" },
		],
	});
	expect(first?.additionalContext).toContain("verifier");
	expect(first?.additionalContext).not.toContain("explorer, verifier");
});

test("naming notice is main-thread only and silent outside docs scope", () => {
	const h = harness();
	h.ctx.agent.kind = "sub";
	expect(h.call("task", { tasks: [{ agent: "explorer", task: "x" }] })).toBeUndefined();
	h.ctx.agent.kind = "main";
	h.ctx.cwd = root;
	expect(h.call("task", { tasks: [{ agent: "explorer", task: "x" }] })).toBeUndefined();
});

// ── CLAUDE_PLUGIN_ROOT default (omp workers' board CLI path) ──

test("factory sets CLAUDE_PLUGIN_ROOT to the atlas plugin root when unset", () => {
	delete process.env.CLAUDE_PLUGIN_ROOT;
	const api = { on: () => { }, getAllTools: () => [] };
	extension(api as unknown as ExtensionAPI);
	expect(process.env.CLAUDE_PLUGIN_ROOT).toBe(resolve(import.meta.dir, ".."));
});

test("factory preserves a non-empty CLAUDE_PLUGIN_ROOT", () => {
	process.env.CLAUDE_PLUGIN_ROOT = "/custom/plugin-root";
	const api = { on: () => { }, getAllTools: () => [] };
	extension(api as unknown as ExtensionAPI);
	expect(process.env.CLAUDE_PLUGIN_ROOT).toBe("/custom/plugin-root");
});

test("ensureClaudePluginRoot skips an unset value only when the CLI is missing", () => {
	delete process.env.CLAUDE_PLUGIN_ROOT;
	const env: Record<string, string | undefined> = {};
	expect(ensureClaudePluginRoot(env, "/nowhere/scripts/atlas_todo.py")).toBe(false);
	expect(env.CLAUDE_PLUGIN_ROOT).toBeUndefined();
	expect(ensureClaudePluginRoot(env, resolve(import.meta.dir, "..", "scripts", "atlas_todo.py"))).toBe(true);
	expect(env.CLAUDE_PLUGIN_ROOT).toBe(resolve(import.meta.dir, ".."));
});

// ── Board mirror: the omp lead's todo plan lands in .atlas/.run/todos.json ──

const TODO_PHASES = {
	op: "init",
	phases: [
		{
			name: "Tasks",
			tasks: [
				{ content: "map the flow", status: "in_progress" },
				{ content: "verify the fix", status: "blocked" },
				{ content: "ship it", status: "completed" },
			],
		},
	],
};

test("main-thread todo results mirror the plan with session attribution", () => {
	const h = harness();
	h.ctx.sessionManager = { getSessionId: () => "sess-omp-42" };
	h.result({ toolName: "todo", details: TODO_PHASES });
	expect(h.spawns).toHaveLength(1);
	expect(h.spawns[0].argv.slice(0, 5)).toEqual([
		"python3", expect.any(String), "set", "--root", join(root, "project"),
	]);
	expect(h.spawns[0].argv[5]).toBe("--session");
	expect(h.spawns[0].argv[6]).toBe("sess-omp-42");
	expect(h.spawns[0].argv[7]).toBe(JSON.stringify([
		{ content: "map the flow", status: "in_progress" },
		{ content: "verify the fix", status: "pending" },
		{ content: "ship it", status: "completed" },
	]));
	expect(h.spawns[0].opts.cwd).toBe(join(root, "project"));
});

test("board mirror argv runs the real python CLI and writes the board", () => {
	const h = harness();
	h.ctx.sessionManager = { getSessionId: () => "sess-omp-42" };
	h.result({ toolName: "todo", details: TODO_PHASES });
	expect(h.spawns).toHaveLength(1);
	const run = Bun.spawnSync(h.spawns[0].argv, { cwd: h.spawns[0].opts.cwd, stdout: "pipe", stderr: "pipe" });
	expect(run.exitCode).toBe(0);
	const board = JSON.parse(readFileSync(join(root, "project", ".atlas", ".run", "todos.json"), "utf8")) as {
		items: { content: string; status: string; session_id: string; origin: string }[];
	};
	const contents = board.items.map(item => item.content);
	expect(contents).toContain("map the flow");
	expect(contents).toContain("ship it");
	const inProgress = board.items.find(item => item.content === "map the flow");
	expect(inProgress?.status).toBe("in_progress");
	expect(inProgress?.session_id).toBe("sess-omp-42");
	expect(inProgress?.origin).toBe("session");
});

test("todo mirror is main-thread, docs-scoped, and error-tolerant", () => {
	const sub = harness();
	sub.ctx.agent.kind = "sub";
	sub.ctx.sessionManager = { getSessionId: () => "sess-x" };
	sub.result({ toolName: "todo", details: TODO_PHASES });
	expect(sub.spawns).toHaveLength(0);

	const outside = harness();
	outside.ctx.cwd = root;
	outside.result({ toolName: "todo", details: TODO_PHASES });
	expect(outside.spawns).toHaveLength(0);

	const errored = harness();
	errored.result({ toolName: "todo", details: TODO_PHASES, isError: true });
	expect(errored.spawns).toHaveLength(0);

	const otherTool = harness();
	otherTool.result({ toolName: "bash", details: TODO_PHASES });
	expect(otherTool.spawns).toHaveLength(0);

	const empty = harness();
	empty.result({ toolName: "todo", details: { op: "view", phases: [] } });
	expect(empty.spawns).toHaveLength(0);
	empty.result({ toolName: "todo", details: undefined });
	expect(empty.spawns).toHaveLength(0);

	const throwingSession = harness();
	throwingSession.ctx.sessionManager = { getSessionId: () => { throw new Error("boom"); } };
	throwingSession.result({ toolName: "todo", details: TODO_PHASES });
	expect(throwingSession.spawns).toHaveLength(0); // fail open, never block
});

test("todo mirror tolerates a spawning failure", () => {
	const h = harness(() => true, () => { throw new Error("spawn unavailable"); });
	h.ctx.sessionManager = { getSessionId: () => "sess-x" };
	expect(h.result({ toolName: "todo", details: TODO_PHASES })).toBeUndefined();
});
