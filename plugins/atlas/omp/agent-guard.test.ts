import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadAgentDisallowed, loadGuardContract, parseDisallowedTools, registerAgentGuard } from "./agent-guard";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");

type Ctx = { cwd: string; agent: { kind: "main" | "sub"; id: string; name: string; depth: number } };
type Result = { block?: boolean; reason?: string } | undefined;
type Handler = (event: { type: "tool_call"; toolName: string; toolCallId: string; input: Record<string, unknown> }, ctx: Ctx) => Result;

const sub = (name: string): Ctx => ({ cwd: "/tmp", agent: { kind: "sub", id: `0-${name}`, name, depth: 1 } });
const main: Ctx = { cwd: "/tmp", agent: { kind: "main", id: "Main", name: "main", depth: 0 } };

function harness(deps: Parameters<typeof registerAgentGuard>[1] = {}) {
	const handlers: Handler[] = [];
	const pi = { on: (name: string, handler: Handler) => { if (name === "tool_call") handlers.push(handler); } };
	registerAgentGuard(pi as unknown as Pick<ExtensionAPI, "on">, deps);
	const call = (ctx: Ctx, toolName: string, input: Record<string, unknown> = {}): Result =>
		handlers[0]({ type: "tool_call", toolName, toolCallId: "t1", input }, ctx);
	return { handlers, call };
}

let oldHard: string | undefined;
beforeEach(() => {
	oldHard = process.env.ATLAS_TRIPWIRE_HARD;
	delete process.env.ATLAS_TRIPWIRE_HARD;
});
afterEach(() => {
	if (oldHard === undefined) delete process.env.ATLAS_TRIPWIRE_HARD; else process.env.ATLAS_TRIPWIRE_HARD = oldHard;
});

// ── the real agent files: parsed lists equal what the files say ──

const MCP_EDIT_TOOLS = [
	"mcp__serena__replace_symbol_body",
	"mcp__serena__insert_after_symbol",
	"mcp__serena__insert_before_symbol",
	"mcp__serena__replace_content",
	"mcp__serena__replace_in_files",
	"mcp__serena__rename_symbol",
	"mcp__serena__safe_delete_symbol",
	"mcp__lean-ctx__ctx_patch",
];
const FULL_READONLY = [
	"Agent", "Task", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "Write", "Edit", "MultiEdit", "NotebookEdit",
	...MCP_EDIT_TOOLS,
];
const NO_EDIT_RESTRICTION = ["Agent", "Task", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "NotebookEdit"];
// cmux-browser tools a subagent may NOT call: every contract tool outside subagentAllow (agents/ui-runtime-tester.md lists them).
const CMUX = JSON.parse(readFileSync(join(PLUGIN_ROOT, "contracts", "mcp-servers.json"), "utf8")).browserServers["cmux-browser"];
const CMUX_LEAD_ONLY: string[] = [...CMUX.readOnly, ...CMUX.stateChanging, ...CMUX.sensitive]
	.filter((t: string) => !CMUX.subagentAllow.includes(t))
	.map((t: string) => `mcp__cmux-browser__${t}`);
const EXPECTED: Record<string, string[]> = {
	"completeness-critic": FULL_READONLY,
	"db-prober": FULL_READONLY,
	"docs-auditor": FULL_READONLY,
	"docs-curator": NO_EDIT_RESTRICTION,
	explorer: FULL_READONLY,
	implementer: NO_EDIT_RESTRICTION,
	"naming-glossary-audit": FULL_READONLY,
	planner: FULL_READONLY,
	"rls-privilege-audit": FULL_READONLY,
	runner: NO_EDIT_RESTRICTION,
	"schema-inventory": FULL_READONLY,
	"ui-runtime-tester": [...FULL_READONLY, ...CMUX_LEAD_ONLY],
	verifier: FULL_READONLY,
};

test("all 13 real agents/*.md parse to exactly the disallowedTools their frontmatter lists", () => {
	const files = readdirSync(AGENTS_DIR).filter(f => f.endsWith(".md")).map(f => f.slice(0, -3)).sort();
	expect(files).toEqual(Object.keys(EXPECTED).sort());
	for (const name of files) {
		expect(parseDisallowedTools(readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8"))).toEqual(EXPECTED[name]);
		expect(loadAgentDisallowed(name, AGENTS_DIR)).toEqual(EXPECTED[name]);
	}
});

test("parser accepts the bracket form, the YAML list form, CSV and the kebab key; ignores body text", () => {
	expect(parseDisallowedTools("---\nname: a\ndisallowedTools: [Write, 'Edit', \"Task\"]\n---\nbody")).toEqual(["Write", "Edit", "Task"]);
	expect(parseDisallowedTools("---\nname: a\ndisallowedTools:\n  - Write\n  - Edit # why\n  - Task\nmodel: x\n---\n")).toEqual(["Write", "Edit", "Task"]);
	expect(parseDisallowedTools("---\nname: a\ndisallowedTools: Write, Edit\n---\n")).toEqual(["Write", "Edit"]);
	expect(parseDisallowedTools("---\nname: a\ndisallowed-tools: [Task]\n---\n")).toEqual(["Task"]);
	expect(parseDisallowedTools("---\nname: a\n---\ndisallowedTools: [Write]\n")).toEqual([]);
	expect(parseDisallowedTools("no frontmatter\ndisallowedTools: [Write]\n")).toEqual([]);
	expect(parseDisallowedTools("---\nname: a\ndisallowedTools: []\n---\n")).toEqual([]);
});

// ── enforcement ──

test("explorer: edit is blocked and the reason names the agent, the tool and its definition file", () => {
	const edit = harness().call(sub("explorer"), "edit", { path: "src/a.ts" });
	expect(edit?.block).toBe(true);
	for (const text of ["explorer", "edit", "agents/explorer.md"]) expect(edit?.reason).toContain(text);
});

const BLOCKED_WRITES: Record<string, unknown>[] = [
	{ path: "src/a.ts", content: "x" },
	{ path: "/etc/hosts", content: "x" },
	{ path: "C:/work/a.txt", content: "x" },
	{}, // no usable path cannot be shown to be a URI target: blocked, never silently allowed
];

test("explorer: write to a file path is blocked, including absolute and drive paths and a missing path", () => {
	const h = harness();
	const results = BLOCKED_WRITES.map(input => h.call(sub("explorer"), "write", input));
	expect(results.map(result => result?.block)).toEqual(BLOCKED_WRITES.map(() => true));
	expect(results[0]?.reason).toContain("write");
});

test("explorer: write to agent://, xd://, local:// and proc:// targets is allowed", () => {
	const h = harness();
	const allowedInputs = [
		{ path: "agent://X", content: "hi" },
		{ path: "xd://Y", content: "{}" },
		{ path: "local://Z", content: "note" },
		{ path: "proc://job/kill" },
	];
	for (const input of allowedInputs) expect(h.call(sub("explorer"), "write", input)).toBeUndefined();
});

test("explorer: ast_edit and task are blocked, read-only tools are untouched", () => {
	const h = harness();
	expect(h.call(sub("explorer"), "ast_edit", { path: "src" })?.block).toBe(true);
	expect(h.call(sub("explorer"), "task", { tasks: [] })?.block).toBe(true);
	for (const tool of ["read", "grep", "glob", "bash", "find", "todo"]) expect(h.call(sub("explorer"), tool, {})).toBeUndefined();
});

test("implementer: write and edit allowed (its disallowedTools lists neither), ast_edit allowed, task blocked", () => {
	const h = harness();
	expect(h.call(sub("implementer"), "write", { path: "src/a.ts", content: "x" })).toBeUndefined();
	expect(h.call(sub("implementer"), "edit", { path: "src/a.ts" })).toBeUndefined();
	expect(h.call(sub("implementer"), "ast_edit", { path: "src" })).toBeUndefined();
	const task = h.call(sub("implementer"), "task", { tasks: [] });
	expect(task?.block).toBe(true);
	expect(task?.reason).toContain("implementer");
	expect(task?.reason).toContain("agents/implementer.md");
});

test("verifier is blocked exactly like explorer", () => {
	const h = harness();
	expect(h.call(sub("verifier"), "edit", {})?.block).toBe(true);
	expect(h.call(sub("verifier"), "write", { path: "a.ts", content: "x" })?.block).toBe(true);
	expect(h.call(sub("verifier"), "write", { path: "agent://Main", content: "verdict" })).toBeUndefined();
	expect(h.call(sub("verifier"), "task", {})?.block).toBe(true);
});

test("ast_edit is blocked when only Edit or only Write is disallowed", () => {
	const dir = mkdtempSync(join(tmpdir(), "agent-guard-"));
	try {
		writeFileSync(join(dir, "editonly.md"), "---\nname: editonly\ndisallowedTools: [Edit]\n---\n");
		writeFileSync(join(dir, "writeonly.md"), "---\nname: writeonly\ndisallowedTools:\n  - Write\n---\n");
		const h = harness({ agentsDir: dir });
		const file = { path: "a.ts", content: "x" };
		const cases: [string, string, Record<string, unknown>, boolean][] = [
			["editonly", "ast_edit", {}, true],
			["editonly", "edit", {}, true],
			["editonly", "write", file, false],
			["writeonly", "ast_edit", {}, true],
			["writeonly", "write", file, true],
			["writeonly", "edit", {}, false],
		];
		for (const [agent, tool, input, blocked] of cases) {
			expect(h.call(sub(agent), tool, input)?.block === true).toBe(blocked);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("never blocks the lead, a non-atlas subagent, an unknown agent, or a sub with no usable identity", () => {
	const h = harness();
	expect(h.call(main, "edit", {})).toBeUndefined();
	expect(h.call(main, "write", { path: "a.ts", content: "x" })).toBeUndefined();
	// A main session whose name happens to match an atlas agent is still the lead.
	expect(h.call({ ...main, agent: { ...main.agent, name: "explorer" } }, "edit", {})).toBeUndefined();
	expect(h.call(sub("task"), "edit", {})).toBeUndefined();
	expect(h.call(sub("explore"), "write", { path: "a.ts", content: "x" })).toBeUndefined();
	expect(h.call(sub("sub"), "edit", {})).toBeUndefined();
	expect(h.call(sub("no-such-agent"), "edit", {})).toBeUndefined();
	expect(h.call(sub("../explorer"), "edit", {})).toBeUndefined(); // path traversal in the name never resolves a file
	expect(h.call({ cwd: "/tmp" } as unknown as Ctx, "edit", {})).toBeUndefined();
	expect(h.call(undefined as unknown as Ctx, "edit", {})).toBeUndefined();
});

test("fails open on an unreadable agents dir, a malformed agent file, and a missing contract", () => {
	expect(harness({ agentsDir: "/nonexistent/agents-dir" }).call(sub("explorer"), "edit", {})).toBeUndefined();
	const dir = mkdtempSync(join(tmpdir(), "agent-guard-"));
	try {
		writeFileSync(join(dir, "broken.md"), "---\nname: broken\ndisallowedTools: [Write, \n");
		expect(harness({ agentsDir: dir }).call(sub("broken"), "edit", {})).toBeUndefined();
		expect(harness({ contractPath: join(dir, "missing.json") }).call(sub("explorer"), "edit", {})).toBeUndefined();
		writeFileSync(join(dir, "bad.json"), "{not json");
		expect(harness({ contractPath: join(dir, "bad.json") }).call(sub("explorer"), "edit", {})).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("ATLAS_TRIPWIRE_HARD=off disables the guard, read per call", () => {
	const h = harness();
	expect(h.call(sub("explorer"), "edit", {})?.block).toBe(true);
	process.env.ATLAS_TRIPWIRE_HARD = "off";
	expect(h.call(sub("explorer"), "edit", {})).toBeUndefined();
	expect(h.call(sub("implementer"), "task", {})).toBeUndefined();
	delete process.env.ATLAS_TRIPWIRE_HARD;
	expect(h.call(sub("explorer"), "edit", {})?.block).toBe(true);
	// The injected env wins over process.env when supplied.
	expect(harness({ env: { ATLAS_TRIPWIRE_HARD: "off" } }).call(sub("explorer"), "edit", {})).toBeUndefined();
});

test("the shipped contract carries the guard mapping as data, including the not-applicable Claude tools", () => {
	const contract = loadGuardContract(join(PLUGIN_ROOT, "contracts", "tool-names.json"));
	expect(contract).toBeDefined();
	expect(contract?.notApplicable).toEqual(["NotebookEdit", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]);
	expect(contract?.ompTools.write).toEqual({ blockedByClaude: ["Write"], onlyWhenPath: "notUri" });
	expect(contract?.ompTools.task.blockedByClaude).toEqual(["Task", "Agent"]);
	expect(contract?.ompTools.edit.blockedByClaude).toEqual(["Edit", "MultiEdit"]);
	expect(contract?.ompTools.ast_edit.blockedByClaude).toEqual(["Edit", "Write"]);
});

test("read-only agents are blocked from serena/lean-ctx edit devices; reads and writable agents are not", () => {
	const h = harness();
	for (const device of [
		"xd://mcp__serena_replace_symbol_body",
		"xd://mcp__serena_insert_after_symbol",
		"xd://mcp__serena_replace_content",
		"xd://mcp__lean_ctx_ctx_patch",
	]) {
		const denied = h.call(sub("verifier"), "write", { path: device, content: "{}" });
		expect(denied?.block).toBe(true);
		expect(denied?.reason).toContain("agents/verifier.md");
		expect(h.call(sub("implementer"), "write", { path: device, content: "{}" })).toBeUndefined();
	}
	for (const device of ["xd://mcp__serena_find_symbol", "xd://mcp__lean_ctx_ctx_read", "agent://Main", "local://x.md"]) {
		expect(h.call(sub("verifier"), "write", { path: device, content: "{}" })).toBeUndefined();
	}
});

test("every real read-only agent definition lists no edit tool in its load list and denies every MCP edit tool", () => {
	for (const [name, list] of Object.entries(EXPECTED)) {
		const text = readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8");
		const body = text.slice(text.indexOf("\n---", 3));
		const readOnly = list.includes("Write");
		for (const tool of MCP_EDIT_TOOLS) {
			expect(list.includes(tool)).toBe(readOnly);
			if (readOnly) expect(body.includes(tool)).toBe(false);
		}
	}
});

// ── role-independent write/edit misuse guard ──

const BIG = "x".repeat(300);
test("misuse: bare tool name path is denied for main and subs, write and edit", () => {
	const { call } = harness();
	for (const ctx of [main, sub("anyone")]) {
		for (const tool of ["write", "edit"]) {
			const r = call(ctx, tool, { path: "bash", content: "ls" });
			expect(r?.block).toBe(true);
			expect(r?.reason).toContain("path=agent://<id>");
		}
	}
	expect(call(main, "write", { path: "xd://bash", content: "{}" })).toBeUndefined();
});

test("misuse: prose, JSON or multi-line path is denied", () => {
	const { call } = harness();
	for (const path of ["Please note: this", '{"pattern": "x"}', "[1,2]", "a\nb"]) {
		expect(call(main, "write", { path, content: "hi" })?.block).toBe(true);
	}
});

test("misuse: swapped args (content is agent://) with a non-scheme path is denied", () => {
	const { call } = harness();
	expect(call(sub("w"), "write", { path: "Here is my report", content: "agent://Main" })?.block).toBe(true);
	expect(call(sub("w"), "write", { path: "notes.md", content: "agent://Main" })?.block).toBe(true);
});

test("misuse: 'full' or a line range over an existing big file is denied; small or new files are allowed", () => {
	const dir = mkdtempSync(join(tmpdir(), "guard-"));
	try {
		writeFileSync(join(dir, "big.txt"), BIG);
		writeFileSync(join(dir, "small.txt"), "tiny");
		const { call } = harness();
		const ctx = { ...main, cwd: dir };
		expect(call(ctx, "write", { path: "big.txt", content: "full" })?.block).toBe(true);
		expect(call(ctx, "write", { path: join(dir, "big.txt"), content: "100-150" })?.block).toBe(true);
		expect(call(ctx, "write", { path: "small.txt", content: "full" })).toBeUndefined();
		expect(call(ctx, "write", { path: "new.txt", content: "full" })).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("misuse: a normal file write is allowed", () => {
	const { call } = harness();
	expect(call(main, "write", { path: "src/app.ts", content: "export const a = 1;\n" })).toBeUndefined();
	expect(call(sub("w"), "write", { path: "/tmp/out.txt", content: "hello" })).toBeUndefined();
});

test("misuse: an agent:// path write is allowed", () => {
	const { call } = harness();
	expect(call(sub("w"), "write", { path: "agent://Main", content: "agent://x is done" })).toBeUndefined();
});
