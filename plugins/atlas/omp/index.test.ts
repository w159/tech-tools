import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import extension, {
	boardItemsFromTodoDetails,
	boardMirrorArgv,
	ensureClaudePluginRoot,
	ircNoteArgv,
	modelOverrideReason,
	register,
} from "./index";
import { frontmatterModelFor, isInheritedSelector } from "./atlas-agents";

type Context = {
	cwd: string;
	agent: { kind: "main" | "sub"; id?: string };
	sessionManager?: { getSessionId(): string };
	model?: { provider: string; id: string };
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
	const ctx: Context = { cwd: join(root, "project"), agent: { kind: "main", id: "Main" } };
	return {
		ctx, handlers, pi, spawns,
		call: (toolName: string, input: Record<string, unknown> = {}) => handlers.tool_call({ toolName, input }, ctx),
		result: (event: { toolName: string; input?: Record<string, unknown>; details?: unknown; isError?: boolean }) =>
			handlers.tool_result({ toolName: event.toolName, input: event.input ?? {}, details: event.details, isError: event.isError }, ctx),
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
test("exploration deny names the device of the ctx tool the command maps to", () => {
	const tree = [...ACTIVE_DEVICES, "mcp__lean_ctx_ctx_tree"];
	const h = harness(() => tree);
	const deny = (command: string) => h.call("bash", { command })?.reason ?? "";
	const read = deny("cat x");
	expect(read).toContain("lean-ctx ctx_read");
	expect(read).toContain("xd://mcp__lean_ctx_ctx_read");
	expect(read).not.toContain("ctx_shell");
	expect(deny("grep -rn x .")).toContain("xd://mcp__lean_ctx_ctx_search");
	expect(deny("find . -name '*.ts'")).toContain("xd://mcp__lean_ctx_ctx_glob");
	expect(deny("ls -la .atlas/.run 2>&1")).toContain("xd://mcp__lean_ctx_ctx_tree");
	expect(deny("cat a | wc -l")).toContain("xd://mcp__lean_ctx_ctx_shell");
});
test("exploration deny names a builtin ctx tool directly, per the picked tool", () => {
	const h = harness(() => ACTIVE_BUILTINS);
	const reason = h.call("bash", { command: "cat x" })?.reason ?? "";
	expect(reason).toContain("call ctx_read directly");
	expect(reason).not.toContain("ctx_shell");
});
test("exploration deny falls back to the nudge when the picked ctx tool is unreachable", () => {
	const h = harness(() => [...BASE_TOOLS, "write", "mcp__lean_ctx_ctx_shell"]);
	const r = h.call("bash", { command: "ls" });
	expect(r?.block).toBeUndefined(); // ctx_tree not reachable -> never a contradictory deny
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

test("factory preserves a CLAUDE_PLUGIN_ROOT that contains the board CLI", () => {
	const custom = join(root, "custom-plugin-root");
	mkdirSync(join(custom, "scripts"), { recursive: true });
	writeFileSync(join(custom, "scripts", "atlas_todo.py"), "");
	process.env.CLAUDE_PLUGIN_ROOT = custom;
	const api = { on: () => { }, getAllTools: () => [] };
	extension(api as unknown as ExtensionAPI);
	expect(process.env.CLAUDE_PLUGIN_ROOT).toBe(custom);
	expect(custom).not.toBe(resolve(import.meta.dir, ".."));
});

test("factory replaces a stale CLAUDE_PLUGIN_ROOT whose board CLI is gone", () => {
	process.env.CLAUDE_PLUGIN_ROOT = "/nowhere/tech-tools___atlas___8.6.0";
	const api = { on: () => { }, getAllTools: () => [] };
	extension(api as unknown as ExtensionAPI);
	expect(process.env.CLAUDE_PLUGIN_ROOT).toBe(resolve(import.meta.dir, ".."));
});


test("ircNoteArgv maps Main and parent to lead and records the sender, recipient and text", () => {
	const main = ircNoteArgv("Main", "write", { path: "agent://BetaSend", content: "hi" }, "/proj") ?? [];
	expect(main.slice(2)).toEqual(["note", "--root", "/proj", "--owner", "lead", "--to", "BetaSend", "hi"]);
	for (const address of ["agent://Main", "agent://main", "agent://parent"]) {
		const reply = ircNoteArgv("BetaSend", "write", { path: address, content: "done" }, "/p") ?? [];
		expect(reply.slice(2)).toEqual(["note", "--root", "/p", "--owner", "BetaSend", "--to", "lead", "done"]);
	}
	const broadcast = ircNoteArgv("GammaRun", "write", { path: "agent://all", content: "x" }, "/p") ?? [];
	expect(broadcast.slice(2)).toEqual(["note", "--root", "/p", "--owner", "GammaRun", "--to", "all", "x"]);
	expect((ircNoteArgv(undefined, "write", { path: "agent://A", content: "x" }, "/p") ?? [])[6]).toBe("lead");
});

test("ircNoteArgv truncates long messages to 500 chars with a [+N chars] suffix", () => {
	const exact = "a".repeat(500);
	expect((ircNoteArgv("Main", "write", { path: "agent://A", content: exact }, "/p") ?? []).at(-1)).toBe(exact);
	const long = "b".repeat(1234);
	expect((ircNoteArgv("Main", "write", { path: "agent://A", content: long }, "/p") ?? []).at(-1)).toBe(`${"b".repeat(500)} [+734 chars]`);
});

test("ircNoteArgv ignores non-IRC writes and empty messages", () => {
	expect(ircNoteArgv("Main", "write", { path: "src/a.ts", content: "x" }, "/p")).toBeUndefined();
	expect(ircNoteArgv("Main", "write", { path: "xd://mcp__x", content: "{}" }, "/p")).toBeUndefined();
	expect(ircNoteArgv("Main", "write", { path: "agent://A", content: "  " }, "/p")).toBeUndefined();
	expect(ircNoteArgv("Main", "read", { path: "agent://A", content: "x" }, "/p")).toBeUndefined();
	expect(ircNoteArgv("Main", "write", undefined, "/p")).toBeUndefined();
});

test("IRC mirror fires on a delivered write result from any agent, not on errors or non-agent writes", () => {
	const main = harness();
	main.result({ toolName: "write", input: { path: "agent://BetaSend", content: "start" } });
	expect(main.spawns).toHaveLength(1);
	expect(main.spawns[0].argv.slice(2)).toEqual([
		"note", "--root", join(root, "project"), "--owner", "lead", "--to", "BetaSend", "start",
	]);
	expect(main.spawns[0].opts.cwd).toBe(join(root, "project"));

	const sub = harness();
	sub.ctx.agent = { kind: "sub", id: "BetaSend" };
	sub.result({ toolName: "write", input: { path: "agent://Main", content: "reply" } });
	expect(sub.spawns).toHaveLength(1);
	expect(sub.spawns[0].argv.slice(2)).toEqual([
		"note", "--root", join(root, "project"), "--owner", "BetaSend", "--to", "lead", "reply",
	]);

	const errored = harness();
	errored.result({ toolName: "write", input: { path: "agent://BetaSend", content: "x" }, isError: true });
	expect(errored.spawns).toHaveLength(0);

	const plain = harness();
	plain.result({ toolName: "write", input: { path: join(root, "project", "src", "a.ts"), content: "x" } });
	expect(plain.spawns).toHaveLength(0);

	const beforeDelivery = harness();
	beforeDelivery.call("write", { path: "agent://BetaSend", content: "x" });
	expect(beforeDelivery.spawns).toHaveLength(0); // tool_call no longer logs undelivered sends
});

test("IRC mirror falls back to the cwd when no docs root exists and tolerates a spawn failure", () => {
	const outside = harness();
	outside.ctx.cwd = root;
	outside.result({ toolName: "write", input: { path: "agent://A", content: "x" } });
	expect(outside.spawns).toHaveLength(1);
	expect(outside.spawns[0].argv[4]).toBe(root);

	const failing = harness(() => ACTIVE_NONE, () => { throw new Error("spawn unavailable"); });
	expect(failing.result({ toolName: "write", input: { path: "agent://A", content: "x" } })).toBeUndefined();
});

test("IRC mirror argv runs the real CLI: a sub's reply to agent://Main is readable by lead", () => {
	const sub = harness();
	sub.ctx.agent = { kind: "sub", id: "BetaSend" };
	sub.result({ toolName: "write", input: { path: "agent://Main", content: "shipped the fix" } });
	expect(sub.spawns).toHaveLength(1);
	const run = Bun.spawnSync(sub.spawns[0].argv, { cwd: sub.spawns[0].opts.cwd, stdout: "pipe", stderr: "pipe" });
	expect(run.exitCode).toBe(0);
	const read = Bun.spawnSync(
		["python3", resolve(import.meta.dir, "..", "scripts", "atlas_todo.py"), "notes", "--to", "lead", "--root", join(root, "project")],
		{ stdout: "pipe", stderr: "pipe" },
	);
	expect(read.exitCode).toBe(0);
	const out = JSON.parse(read.stdout.toString()) as { notes: { owner: string; to: string; text: string }[] };
	expect(out.notes).toHaveLength(1);
	expect(out.notes[0]).toMatchObject({ owner: "BetaSend", to: "lead", text: "shipped the fix" });
	expect(readFileSync(join(root, "project", ".atlas", ".run", "board", "BetaSend.jsonl"), "utf8")).toContain("shipped the fix");
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

const PHASED_TODO = {
	op: "init",
	phases: [
		{ name: "Research", tasks: [{ content: "map the flow", status: "completed" }] },
		{ name: "implement", tasks: [{ content: "wire the board", status: "in_progress" }] },
		{ name: " VERIFY ", tasks: [{ content: "run the suites", status: "blocked" }] },
		{ name: "Tasks", tasks: [{ content: "ship it", status: "pending" }] },
		{ name: "Phase 2", tasks: [{ content: "later", status: "pending" }] },
	],
};

test("omp phase names that are contract phases become the board item phase, lowercased", () => {
	expect(boardItemsFromTodoDetails(PHASED_TODO)).toEqual([
		{ content: "map the flow", status: "completed", phase: "research" },
		{ content: "wire the board", status: "in_progress", phase: "implement" },
		{ content: "run the suites", status: "pending", phase: "verify" },
		{ content: "ship it", status: "pending" },
		{ content: "later", status: "pending" },
	]);
});

test("unknown omp phase names leave phase absent (no key at all) and legacy items are unchanged", () => {
	const items = boardItemsFromTodoDetails(TODO_PHASES);
	expect(items).toEqual([
		{ content: "map the flow", status: "in_progress" },
		{ content: "verify the fix", status: "pending" },
		{ content: "ship it", status: "completed" },
	]);
	for (const item of items) expect("phase" in item).toBe(false);
	// "done" and "blocked" are visible-contract phases but NOT todoPhases, so they stay absent
	const closing = boardItemsFromTodoDetails({
		phases: [{ name: "done", tasks: [{ content: "a", status: "pending" }] }, { name: "blocked", tasks: [{ content: "b", status: "pending" }] }],
	});
	expect(closing.map(i => "phase" in i)).toEqual([false, false]);
});

test("the mirrored JSON given to atlas_todo.py set carries the phase, and the real CLI stores it", () => {
	const h = harness();
	h.ctx.sessionManager = { getSessionId: () => "sess-omp-42" };
	h.result({ toolName: "todo", details: PHASED_TODO });
	expect(h.spawns).toHaveLength(1);
	expect(JSON.parse(h.spawns[0].argv[7])).toEqual(boardItemsFromTodoDetails(PHASED_TODO));
	expect(boardMirrorArgv([{ content: "x", status: "pending", phase: "test" }], undefined, "/r").at(-1)).toBe(
		JSON.stringify([{ content: "x", status: "pending", phase: "test" }]),
	);
	const run = Bun.spawnSync(h.spawns[0].argv, { cwd: h.spawns[0].opts.cwd, stdout: "pipe", stderr: "pipe" });
	expect(run.exitCode).toBe(0);
	const board = JSON.parse(readFileSync(join(root, "project", ".atlas", ".run", "todos.json"), "utf8")) as {
		items: { content: string; phase?: string }[];
	};
	const phaseOf = (content: string) => board.items.find(item => item.content === content);
	expect(phaseOf("map the flow")?.phase).toBe("research");
	expect(phaseOf("wire the board")?.phase).toBe("implement");
	expect(phaseOf("run the suites")?.phase).toBe("verify");
	expect(phaseOf("ship it") && "phase" in (phaseOf("ship it") as object)).toBe(false);
	expect(phaseOf("later") && "phase" in (phaseOf("later") as object)).toBe(false);
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

// ── Model-override deny (twin of dispatch_tripwire._model_override), via before_subagent_spawn ──

type SpawnResult = { block?: boolean; reason?: string; model?: string[]; note?: string } | undefined;
type SpawnHandler = (event: Record<string, unknown>, ctx: Context) => SpawnResult;
const spawnHandler = (h: { handlers: object }) => (h.handlers as Record<string, SpawnHandler>).before_subagent_spawn;

test("a per-call model override of an atlas colony agent is blocked with the tripwire's reason", () => {
	const h = harness();
	const spawn = spawnHandler(h);
	// modelRole "task" is outside implementer's pinned roles, so the selector is a real override.
	const result = spawn({ type: "before_subagent_spawn", agent: "implementer", invocationKind: "task", modelRole: "task", patterns: ["ollama/glm-5.3-flash:cloud:medium"], spawnKey: "OverrideOne" }, h.ctx);
	expect(result?.block).toBe(true);
	expect(result?.reason).toBe(modelOverrideReason("Task", "implementer", "ollama/glm-5.3-flash:cloud:medium", "@atlas-worker"));
	expect(result?.reason).toContain("overrides model with 'ollama/glm-5.3-flash:cloud:medium'");
	expect(result?.reason).toContain("The agent definition pins model: @atlas-worker");
	expect(result?.reason).toContain("Fix the definition, not the dispatch.");
	// Same for a verifier-tier agent overridden off its pinned roles.
	expect(spawn({ type: "before_subagent_spawn", agent: "verifier", invocationKind: "task", modelRole: "task", patterns: ["anthropic/claude-opus-5-5:high"], spawnKey: "OverrideTwo" }, h.ctx)?.reason).toContain("pins model: @atlas-verifier");
});

test("the expanded pinned tier, no override, other agents and the kill switch all pass", () => {
	const h = harness();
	const spawn = spawnHandler(h);
	expect(spawn({ type: "before_subagent_spawn", agent: "implementer", invocationKind: "task", modelRole: "smol", patterns: ["@atlas-worker", "anthropic/claude-sonnet-5-5:off"], spawnKey: "SpawnOne" }, h.ctx)).toBeUndefined(); // omp's own expansion of the definition's list
	expect(spawn({ agent: "implementer", invocationKind: "task", modelRole: "smol", patterns: ["anthropic/claude-sonnet-5-5:off", "@Atlas-Worker"] }, h.ctx)).toBeUndefined(); // order and case do not matter
	const WORKER_TIER = ["@atlas-worker", "@smol"];
	expect(spawn({ agent: "implementer", modelRole: "smol", patterns: [] }, h.ctx)?.model).toEqual(WORKER_TIER); // omitted model: restore the tier
	expect(spawn({ agent: "implementer", modelRole: "smol", patterns: ["  ", ""] }, h.ctx)?.model).toEqual(WORKER_TIER); // blank patterns are no override
	expect(spawn({ agent: "implementer", modelRole: "smol" }, h.ctx)).toBeUndefined(); // no patterns array at all: nothing to rewrite
	expect(spawn({ agent: "task", modelRole: "smol", patterns: ["ollama/glm-5.3-flash:cloud:medium"] }, h.ctx)).toBeUndefined(); // not an atlas colony agent
	expect(spawn({ agent: 7, patterns: ["x"] }, h.ctx)).toBeUndefined();
	process.env.ATLAS_TRIPWIRE_HARD = "off";
	expect(spawn({ agent: "implementer", modelRole: "task", patterns: ["ollama/glm-5.3-flash:cloud:medium"] }, h.ctx)).toBeUndefined();
});

test("pinned-alias-only lists pass even when partial, unpinned bare tokens deny", () => {
	const h = harness();
	expect(spawnHandler(h)({ agent: "implementer", modelRole: "smol", patterns: ["@atlas-worker"] }, h.ctx)).toBeUndefined(); // subset of pinned aliases carries no override evidence
	expect(spawnHandler(h)({ agent: "verifier", modelRole: "task", patterns: ["@atlas-verifier", "extra"] }, h.ctx)?.block).toBe(true); // "extra" is neither a pinned alias nor a selector
});

test("the exact captured omp spawn event for implementer is allowed", () => {
	const h = harness();
	expect(spawnHandler(h)({ type: "before_subagent_spawn", agent: "implementer", invocationKind: "task", modelRole: "smol", patterns: ["@atlas-worker", "anthropic/claude-sonnet-5-5:off"], spawnKey: "ProbeThree" }, h.ctx)).toBeUndefined();
});

test("the expanded verifier event with a pinned-role modelRole is allowed", () => {
	const h = harness();
	expect(spawnHandler(h)({ type: "before_subagent_spawn", agent: "verifier", invocationKind: "task", modelRole: "default", patterns: ["@atlas-verifier", "anthropic/claude-opus-5-5:medium"], spawnKey: "VerifyOne" }, h.ctx)).toBeUndefined();
});

test("a concrete selector with a modelRole outside the pinned roles denies", () => {
	const h = harness();
	const result = spawnHandler(h)({ type: "before_subagent_spawn", agent: "implementer", invocationKind: "task", modelRole: "task", patterns: ["ollama/glm-5.3-flash:cloud:medium"], spawnKey: "ForeignTier" }, h.ctx);
	expect(result?.block).toBe(true);
	expect(result?.reason).toBe(modelOverrideReason("Task", "implementer", "ollama/glm-5.3-flash:cloud:medium", "@atlas-worker"));
});

test("a concrete selector with modelRole undefined denies", () => {
	const h = harness();
	const result = spawnHandler(h)({ type: "before_subagent_spawn", agent: "implementer", invocationKind: "task", patterns: ["anthropic/claude-sonnet-5-5:high"], spawnKey: "NoRole" }, h.ctx);
	expect(result?.block).toBe(true);
});

// A marketplace install does not discover the pinned generated agents, so omp resolves the child to the parent's live model.
// A selector equal to that model (optionally with one thinking-level suffix) is the inherited default, not a per-call override.
const LIVE_MODEL = { provider: "anthropic", id: "claude-sonnet-5-5" };
const inheritedSpawn = (patterns: string[]) => ({ type: "before_subagent_spawn", agent: "implementer", invocationKind: "task", patterns, spawnKey: "Inherited" });

test("a selector equal to the parent's live model plus a thinking level is inherited, not an override", () => {
	const h = harness();
	h.ctx.model = LIVE_MODEL;
	expect(spawnHandler(h)(inheritedSpawn(["anthropic/claude-sonnet-5-5:low"]), h.ctx)?.block).toBeUndefined();
	expect(spawnHandler(h)(inheritedSpawn(["Anthropic/Claude-Sonnet-5-5:HIGH"]), h.ctx)?.block).toBeUndefined(); // case does not matter
});

test("the same inherited selector denies when the context carries no model", () => {
	const h = harness();
	const result = spawnHandler(h)(inheritedSpawn(["anthropic/claude-sonnet-5-5:low"]), h.ctx);
	expect(result?.block).toBe(true);
	expect(result?.reason).toBe(modelOverrideReason("Task", "implementer", "anthropic/claude-sonnet-5-5:low", "@atlas-worker"));
});

test("a different concrete selector still denies when the parent's live model is known", () => {
	const h = harness();
	h.ctx.model = LIVE_MODEL;
	expect(spawnHandler(h)(inheritedSpawn(["ollama/glm-5.3-flash:cloud:medium"]), h.ctx)?.block).toBe(true);
	expect(spawnHandler(h)(inheritedSpawn(["anthropic/claude-opus-5-5:low"]), h.ctx)?.block).toBe(true); // same provider, other model
	expect(spawnHandler(h)(inheritedSpawn(["anthropic/claude-sonnet-5-5:low:high"]), h.ctx)?.block).toBe(true); // one suffix only
	expect(spawnHandler(h)(inheritedSpawn(["anthropic/claude-sonnet-5-5:low", "ollama/glm-5.3-flash:cloud:medium"]), h.ctx)?.block).toBe(true); // every token must be inherited
});

test("the bare live model selector with no thinking suffix is inherited", () => {
	const h = harness();
	h.ctx.model = LIVE_MODEL;
	expect(spawnHandler(h)(inheritedSpawn(["anthropic/claude-sonnet-5-5"]), h.ctx)?.block).toBeUndefined();
});

// ── Both pin representations pass this gate AND dispatch_tripwire.py's: `@atlas-worker` (omp role) and `sonnet` (agents/*.md) ──

const pinSpawn = (agent: string, patterns: string[], modelRole?: string) => ({ type: "before_subagent_spawn", agent, invocationKind: "task", modelRole, patterns, spawnKey: "Pin" });

test("an omitted model is rewritten to the pinned tier instead of running on the parent's model", () => {
	const h = harness();
	const result = spawnHandler(h)(pinSpawn("implementer", []), h.ctx);
	expect(result?.block).toBeUndefined();
	expect(result?.model).toEqual(["@atlas-worker", "@smol"]);
	expect(result?.note).toBe("atlas: implementer pinned to @atlas-worker");
});

test("the omp role pin passes for its own tier", () => {
	const h = harness();
	expect(spawnHandler(h)(pinSpawn("implementer", ["@atlas-worker"]), h.ctx)).toBeUndefined();
	expect(spawnHandler(h)(pinSpawn("implementer", ["@smol"]), h.ctx)).toBeUndefined();
	expect(spawnHandler(h)(pinSpawn("verifier", ["@atlas-verifier"]), h.ctx)).toBeUndefined();
});

test("the Claude-format pin (`model: sonnet`) passes too, in any case", () => {
	const h = harness();
	expect(spawnHandler(h)(pinSpawn("implementer", ["sonnet"]), h.ctx)).toBeUndefined();
	expect(spawnHandler(h)(pinSpawn("implementer", ["Sonnet"]), h.ctx)).toBeUndefined();
	expect(spawnHandler(h)(pinSpawn("docs-auditor", ["haiku"]), h.ctx)).toBeUndefined(); // that agent pins haiku
});

test("a parent-model injection passes for any provider, with or without a level on either side", () => {
	for (const [provider, id] of [["anthropic", "claude-opus-5-5"], ["ollama", "glm-5.3-flash:cloud"], ["openai", "gpt-5"]]) {
		const live = `${provider}/${id}`;
		const h = harness();
		h.ctx.model = { provider, id };
		for (const patterns of [[live], [`${live}:medium`]]) {
			const result = spawnHandler(h)(pinSpawn("implementer", patterns), h.ctx);
			expect(result?.block).toBeUndefined();
			expect(result?.model).toEqual(["@atlas-worker", "@smol"]); // inherited parent model is replaced by the tier
		}
		const withLevel = harness();
		withLevel.ctx.model = { provider, id: `${id}:medium` }; // live model string already carries its level
		expect(spawnHandler(withLevel)(pinSpawn("implementer", [live]), withLevel.ctx)?.model).toEqual(["@atlas-worker", "@smol"]);
	}
});

test("the rewrite carries each tier's own pinned list", () => {
	const h = harness();
	h.ctx.model = { provider: "anthropic", id: "claude-opus-5-5" };
	const live = "anthropic/claude-opus-5-5:medium";
	expect(spawnHandler(h)(pinSpawn("verifier", [live]), h.ctx)?.model).toEqual(["@atlas-verifier", "@default", "@smol"]);
	expect(spawnHandler(h)(pinSpawn("verifier", [live]), h.ctx)?.note).toBe("atlas: verifier pinned to @atlas-verifier");
	expect(spawnHandler(h)(pinSpawn("runner", [live]), h.ctx)?.model).toEqual(["@atlas-mechanic", "@smol"]);
	expect(spawnHandler(h)(pinSpawn("explorer", []), h.ctx)?.model).toEqual(["@atlas-worker", "@smol"]);
});

test("a list that already carries the tier is left untouched, even beside the inherited parent model", () => {
	const h = harness();
	h.ctx.model = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(spawnHandler(h)(pinSpawn("implementer", ["@atlas-worker", "anthropic/claude-opus-5-5:low"], "smol"), h.ctx)).toBeUndefined();
	expect(spawnHandler(h)(pinSpawn("implementer", ["sonnet"]), h.ctx)).toBeUndefined(); // Claude-format pin
	expect(spawnHandler(h)(pinSpawn("implementer", ["anthropic/claude-opus-5-5:low", "@smol"]), h.ctx)).toBeUndefined();
});

test("no rewrite when the gate is off, the agent is not an atlas colony agent, or the model is a real override", () => {
	const h = harness();
	h.ctx.model = { provider: "anthropic", id: "claude-opus-5-5" };
	expect(spawnHandler(h)(pinSpawn("general-purpose", []), h.ctx)).toBeUndefined();
	expect(spawnHandler(h)(pinSpawn("implementer", ["openai/gpt-5"]), h.ctx)?.model).toBeUndefined(); // still a deny, never a rewrite
	expect(spawnHandler(h)(pinSpawn("implementer", ["openai/gpt-5"]), h.ctx)?.block).toBe(true);
	process.env.ATLAS_TRIPWIRE_HARD = "off";
	expect(spawnHandler(h)(pinSpawn("implementer", []), h.ctx)).toBeUndefined();
});

test("genuine overrides are still denied: opus, another provider, another tier's role", () => {
	const h = harness();
	h.ctx.model = { provider: "anthropic", id: "claude-opus-5-5" };
	for (const patterns of [["opus"], ["openai/gpt-5"], ["anthropic/claude-sonnet-5-5"], ["@atlas-verifier"], ["sonnet", "opus"]]) {
		const result = spawnHandler(h)(pinSpawn("implementer", patterns), h.ctx);
		expect(result?.block).toBe(true);
		expect(result?.reason).toBe(modelOverrideReason("Task", "implementer", patterns.join(", "), "@atlas-worker"));
	}
	expect(spawnHandler(h)(pinSpawn("verifier", ["opus"]), h.ctx)?.block).toBe(true);
});

test("isInheritedSelector: equal, or one `:level` suffix on either side, never two or a path", () => {
	expect(isInheritedSelector("a/b", "a/b")).toBe(true);
	expect(isInheritedSelector("A/B:low", "a/b")).toBe(true);
	expect(isInheritedSelector("a/b", "a/b:low")).toBe(true);
	expect(isInheritedSelector("a/b:low:high", "a/b")).toBe(false);
	expect(isInheritedSelector("a/b:x/y", "a/b")).toBe(false);
	expect(isInheritedSelector("a/b2", "a/b")).toBe(false);
	expect(isInheritedSelector("", "a/b")).toBe(false);
	expect(isInheritedSelector("a/b", "")).toBe(false);
});

test("frontmatterModelFor reads the Claude-format pin and fails open to empty", () => {
	expect(frontmatterModelFor("implementer")).toBe("sonnet");
	expect(frontmatterModelFor("docs-auditor")).toBe("haiku");
	expect(frontmatterModelFor("not-an-agent")).toBe("");
	expect(frontmatterModelFor("../index")).toBe("");
});

test("a hostile spawn event fails open", () => {
	const h = harness();
	const hostile = { get agent(): string { throw new Error("boom"); }, patterns: ["x"] };
	expect(spawnHandler(h)(hostile, h.ctx)).toBeUndefined();
});

// ── Run-state: begin + snapshot once, on the main session start ──

test("session_start hands the run-state sink the project root and session id, main sessions only", () => {
	const started: { cwd: string; sessionId: string; kind: string }[] = [];
	const handlers: Record<string, Handler> = {};
	register({ on: (name: string, handler: Handler) => { handlers[name] = handler; } } as unknown as Pick<ExtensionAPI, "on">, {
		activeTools: () => [],
		spawnBoardMirror: () => { },
		runState: { onSessionStart: info => void started.push(info), onTurnStart: () => { }, onToolAllowed: () => { }, onToolResult: () => { } },
	});
	const project = join(root, "project", "src", "nested");
	const ctx: Context = { cwd: project, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s-9" } };
	(handlers.session_start as unknown as (e: unknown, c: Context) => void)({}, ctx);
	(handlers.session_start as unknown as (e: unknown, c: Context) => void)({}, { ...ctx, agent: { kind: "sub" } });
	// Docs-scoped: the run row is keyed on the project root that holds docs/, not the nested cwd.
	expect(started).toEqual([{ cwd: join(root, "project"), sessionId: "s-9", kind: "main" }]);
});

test("a throwing run-state sink does not break session start or the shell-edit baseline", () => {
	const handlers: Record<string, Handler> = {};
	register({ on: (name: string, handler: Handler) => { handlers[name] = handler; } } as unknown as Pick<ExtensionAPI, "on">, {
		activeTools: () => [],
		spawnBoardMirror: () => { },
		runState: { onSessionStart: () => { throw new Error("sink exploded"); }, onTurnStart: () => { }, onToolAllowed: () => { }, onToolResult: () => { } },
	});
	const ctx: Context = { cwd: join(root, "project"), agent: { kind: "main" } };
	expect(() => (handlers.session_start as unknown as (e: unknown, c: Context) => void)({}, ctx)).not.toThrow();
});

test("before_agent_start hands the run-state sink each main turn, never a sub turn, and survives a throwing sink", () => {
	const turns: { cwd: string; sessionId: string; kind: string }[] = [];
	const handlers: Record<string, Handler> = {};
	register({ on: (name: string, handler: Handler) => { handlers[name] = handler; } } as unknown as Pick<ExtensionAPI, "on">, {
		activeTools: () => [],
		spawnBoardMirror: () => { },
		runState: { onSessionStart: () => { }, onTurnStart: info => void turns.push(info), onToolAllowed: () => { }, onToolResult: () => { } },
	});
	const fire = (ctx: Context) => (handlers.before_agent_start as unknown as (e: unknown, c: Context) => unknown)({}, ctx);
	const ctx: Context = { cwd: join(root, "project", "src"), agent: { kind: "main" }, sessionManager: { getSessionId: () => "s-9" } };
	fire(ctx);
	fire(ctx); // second turn: begin is handed over again
	fire({ ...ctx, agent: { kind: "sub" } });
	expect(turns).toEqual([
		{ cwd: join(root, "project"), sessionId: "s-9", kind: "main" },
		{ cwd: join(root, "project"), sessionId: "s-9", kind: "main" },
	]);
	const boom: Record<string, Handler> = {};
	register({ on: (name: string, handler: Handler) => { boom[name] = handler; } } as unknown as Pick<ExtensionAPI, "on">, {
		activeTools: () => [],
		spawnBoardMirror: () => { },
		runState: { onSessionStart: () => { }, onTurnStart: () => { throw new Error("sink exploded"); }, onToolAllowed: () => { }, onToolResult: () => { } },
	});
	expect(() => (boom.before_agent_start as unknown as (e: unknown, c: Context) => unknown)({}, ctx)).not.toThrow();
});

// ── Agent guard: disallowedTools of atlas agents enforced on omp (omp/agent-guard.ts) ──

test("the default export wires the agent guard: an explorer edit is blocked through the registered tool_call chain", () => {
	type Chain = (event: { toolName: string; toolCallId: string; input: Record<string, unknown> }, ctx: unknown) => Result;
	const chain: Chain[] = [];
	const api = {
		on: (name: string, handler: Chain) => { if (name === "tool_call") chain.push(handler); },
		getActiveTools: () => ACTIVE_NONE,
	};
	extension(api as unknown as ExtensionAPI);
	// omp's emitToolCall: handlers run in registration order and the first `block` wins.
	const emit = (agent: Context["agent"] & { name: string }, toolName: string, input: Record<string, unknown>): Result => {
		for (const handler of chain) {
			const out = handler({ toolName, toolCallId: "t1", input }, { cwd: join(root, "project"), agent });
			if (out?.block) return out;
		}
		return undefined;
	};
	const explorer = { kind: "sub" as const, id: "0-explorer", name: "explorer" };
	const blocked = emit(explorer, "edit", { path: "src/a.ts" });
	expect(blocked?.block).toBe(true);
	expect(blocked?.reason).toContain("agents/explorer.md");
	expect(emit(explorer, "write", { path: "agent://Main", content: "report" })?.block).toBeUndefined();
	expect(emit({ kind: "sub", id: "0-implementer", name: "implementer" }, "edit", { path: "src/a.ts" })?.block).toBeUndefined();
	expect(emit({ kind: "main", id: "Main", name: "main" }, "edit", { path: "src/a.ts" })?.block).toBeUndefined();
	process.env.ATLAS_TRIPWIRE_HARD = "off";
	expect(emit(explorer, "edit", { path: "src/a.ts" })?.block).toBeUndefined();
});
