import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	ADDENDUM_BEGIN,
	ADDENDUM_END,
	ADDENDUM_PATH,
	STYLE_BEGIN,
	STYLE_END,
	STYLE_PATH,
	adaptTodoGatingForOmp,
	loadStyleBody,
	loadToolNames,
	mcpDevice,
	registerStyle,
	renderOmpAddendum,
	renderOmpStyle,
	resolveBareTools,
	translateToolNames,
} from "./style";

type Ctx = { agent: { kind: "main" | "sub" } };
type Result = { systemPrompt?: string[] } | undefined;
type Handler = (event: { systemPrompt: string[]; prompt: string }, ctx: Ctx) => Result;

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-style-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function harness(env: Record<string, string | undefined> = {}, stylePath?: string, addendumPath?: string) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerStyle(api as unknown as Pick<ExtensionAPI, "on">, { env, stylePath, addendumPath });
	return (systemPrompt: string[], kind: "main" | "sub" = "main") =>
		handlers.before_agent_start({ systemPrompt, prompt: "hi" }, { agent: { kind } });
}

const MAP = loadToolNames();
if (!MAP) throw new Error("contracts/tool-names.json must load");

test("main session gets the translated style appended exactly once, then the lead addendum", () => {
	const run = harness();
	const result = run(["base prompt"]);
	expect(result?.systemPrompt?.length).toBe(3);
	expect(result?.systemPrompt?.[0]).toBe("base prompt");
	const block = result?.systemPrompt?.[1] ?? "";
	expect(block.startsWith(STYLE_BEGIN)).toBe(true);
	expect(block.endsWith(STYLE_END)).toBe(true);
	// handler re-entry with both blocks already present is a no-op
	expect(run(result?.systemPrompt ?? [])).toBeUndefined();
});

test("subagents never receive the style", () => {
	expect(harness()(["base"], "sub")).toBeUndefined();
});

test("ATLAS_STYLE=off disables injection", () => {
	expect(harness({ ATLAS_STYLE: "off" })(["base"])).toBeUndefined();
});

test("missing or malformed style source fails open: no style block, and the independent addendum still arrives", () => {
	const none = join(dir, "absent-addendum.md");
	expect(harness({}, join(dir, "absent.md"), none)(["base"])).toBeUndefined();
	expect(harness({}, join(dir, "absent.md"))(["base"])?.systemPrompt?.length).toBe(2); // addendum only
	const bad = join(dir, "bad.md");
	writeFileSync(bad, "---\nname: x\nno closing fence\n");
	expect(loadStyleBody(bad)).toBeUndefined();
	expect(harness({}, bad, none)(["base"])).toBeUndefined();
});

test("the omp lead addendum is its own marked block after the style block, main session only", () => {
	const result = harness()(["base"]);
	expect(result?.systemPrompt?.length).toBe(3);
	const [, style, addendum] = result?.systemPrompt ?? [];
	expect(style.startsWith(STYLE_BEGIN) && style.endsWith(STYLE_END)).toBe(true); // the drift-guarded block is untouched
	expect(addendum.startsWith(ADDENDUM_BEGIN) && addendum.endsWith(ADDENDUM_END)).toBe(true);
	expect(addendum).toContain(readFileSync(ADDENDUM_PATH, "utf8").trim());
	expect(harness()(["base"], "sub")).toBeUndefined();
	expect(harness()(result?.systemPrompt ?? [])).toBeUndefined(); // re-entry adds neither block again
});

test("the addendum is small and restates nothing omp's own task and wait prompts teach", () => {
	const text = readFileSync(ADDENDUM_PATH, "utf8");
	expect(text.length).toBeLessThan(900); // it rides on every lead turn
	for (const taught of ["auto-deliver", "Never poll", "outputSchema", "local://"]) expect(text).not.toContain(taught);
});

test("the addendum names every dispatch-spec label dispatch_tripwire requires, so the lead writes them before the deny teaches it", () => {
	const text = readFileSync(ADDENDUM_PATH, "utf8");
	const tripwire = readFileSync(join(import.meta.dir, "..", "hooks", "dispatch_tripwire.py"), "utf8");
	const block = /REQUIRED_SPEC_BLOCKS = \(([\s\S]*?)\n\)/.exec(tripwire)?.[1] ?? "";
	const labels = [...block.matchAll(/\("([A-Z ]+:)"/g)].map(m => m[1]); // first variant of each required block
	expect(labels).toEqual(["GOAL:", "DELIVERABLE:", "SUCCESS CRITERIA:", "OUT OF SCOPE:", "STOP CONDITIONS:", "REPORT:"]);
	for (const label of labels) expect(text).toContain(label);
	expect(text.length).toBeLessThan(900);
});

test("an unreadable addendum degrades to the style block alone; a half-present pair still adds only what is missing", () => {
	expect(renderOmpAddendum(join(dir, "absent.md"))).toBeUndefined();
	const blank = join(dir, "blank.md");
	writeFileSync(blank, "  \n");
	expect(renderOmpAddendum(blank)).toBeUndefined();
	const run = harness({}, undefined, join(dir, "absent.md"));
	expect(run(["base"])?.systemPrompt?.length).toBe(2);
	const addendumOnly = harness()(["base", `${STYLE_BEGIN}\nalready\n${STYLE_END}`]);
	expect(addendumOnly?.systemPrompt?.length).toBe(3);
	expect(addendumOnly?.systemPrompt?.[2].startsWith(ADDENDUM_BEGIN)).toBe(true);
});

test("tool names translate on word boundaries only", () => {
	expect(translateToolNames("Use TodoWrite, then Grep and Glob; Read before Edit.", MAP)).toBe(
		"Use todo, then grep and glob; read before edit.",
	);
	expect(translateToolNames("TodoWriter and Grepping and Taskbar stay", MAP)).toBe("TodoWriter and Grepping and Taskbar stay");
	expect(translateToolNames("dispatch via Agent or Task, reply with SendMessage", MAP)).toBe(
		"dispatch via task or task, reply with write agent://<name>",
	);
	expect(translateToolNames("ask with AskUserQuestion", MAP)).toBe("ask with an inline user question");
});

test("phrase keys are gone; single-token names still translate across wraps", () => {
	for (const key of Object.keys(MAP.claudeToOmp)) expect(key).not.toMatch(/\s/);
	expect(Object.keys(MAP.claudeToOmp).filter(k => /^[A-Z]\w*$/.test(k)).length).toBeGreaterThan(0);
	expect(translateToolNames("carries the ToolSearch\n+ serena/lean-ctx TOOLS block", MAP)).toBe(
		"carries the xd:// device catalog\n+ serena/lean-ctx TOOLS block",
	);
	expect(translateToolNames("(`ToolSearch(\"select:TodoWrite\")`)", MAP)).toBe("(`xd:// device catalog(\"select:todo\")`)");
});

test("mcp__server__tool maps to omp's xd device mint", () => {
	expect(mcpDevice("lean-ctx", "ctx_search", MAP)).toBe("xd://mcp__lean_ctx_ctx_search");
	expect(mcpDevice("claude-mem", "claude-mem_search", MAP)).toBe("xd://mcp__claude_mem_search");
	expect(translateToolNames("call mcp__lean-ctx__ctx_read now", MAP)).toBe("call xd://mcp__lean_ctx_ctx_read now");
});

test("drift: the injected block is exactly the translated single-source style", () => {
	const body = loadStyleBody(STYLE_PATH);
	expect(body).toBeDefined();
	const rendered = renderOmpStyle() ?? "";
	expect(rendered).toContain(STYLE_BEGIN);
	expect(rendered).toContain(STYLE_END);
	const begin = rendered.indexOf(STYLE_BEGIN);
	const end = rendered.indexOf(STYLE_END);
	expect(begin).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(begin);
	const inner = rendered.slice(begin + STYLE_BEGIN.length + 1, end - 1);
	// "preface\n\n" then exactly translate(source) up to the end marker
	expect(inner.slice(inner.indexOf("\n\n") + 2)).toBe(translateToolNames(adaptTodoGatingForOmp(body ?? ""), MAP));
	expect(rendered).not.toContain("CLAUDE_CODE_ENABLE_TODO_TOOLS");
	expect(rendered).not.toContain("ENABLE_TOOL_SEARCH");
	expect(rendered).not.toContain("device catalog(");
	expect(rendered).toContain("If `todo` is not callable (check once, silently), carry one line under the header:");
	expect(body).toContain("CLAUDE_CODE_ENABLE_TODO_TOOLS"); // Claude Code's source text is unchanged
	expect(rendered).not.toContain("force-for-plugin");
});

test("drift: every Claude tool name in the style source has an omp mapping", () => {
	const CLAUDE_TOOLS = [
		"AskUserQuestion", "Agent", "Bash", "BashOutput", "Edit", "EnterPlanMode", "ExitPlanMode", "Glob", "Grep",
		"KillShell", "MultiEdit", "NotebookEdit", "Read", "SendMessage", "SlashCommand", "Task", "TodoRead",
		"TodoWrite", "ToolSearch", "WebFetch", "WebSearch", "Write",
	];
	const body = loadStyleBody(STYLE_PATH) ?? "";
	const used = CLAUDE_TOOLS.filter(t => new RegExp(`\\b${t}\\b`).test(body));
	expect(used.length).toBeGreaterThan(0);
	const unmapped = used.filter(t => !(t in MAP.claudeToOmp));
	expect(unmapped).toEqual([]);
	const rendered = renderOmpStyle() ?? "";
	const leaked = used.filter(t => new RegExp(`\\b${t}\\b`).test(rendered));
	expect(leaked).toEqual([]);
	const bareUsed = [...new Set(body.match(/\bctx_\w+/g) ?? [])];
	expect(bareUsed.length).toBeGreaterThan(0);
	const bareUnmapped = bareUsed.filter(t => !((MAP.bareTools ?? {})[t]));
	expect(bareUnmapped).toEqual([]);
	const bareLeaked = bareUsed.filter(t => new RegExp(`\\b${t}\\b`).test(rendered.replace(/\bxd:\/\/mcp__\w+/g, "")));
	expect(bareLeaked).toEqual([]);
});

test("bare lean-ctx and context-mode names map to the devices a real omp session mints", () => {
	expect(translateToolNames("use `ctx_search`/`ctx_glob` when lean-ctx MCP is configured", MAP)).toBe(
		"use `xd://mcp__lean_ctx_ctx_search`/`xd://mcp__lean_ctx_ctx_glob` when lean-ctx MCP is configured",
	);
	expect(translateToolNames("exploration Read uses `ctx_read`, noisy Bash uses `ctx_shell`", MAP)).toBe(
		"exploration read uses `xd://mcp__lean_ctx_ctx_read`, noisy bash uses `xd://mcp__lean_ctx_ctx_shell`",
	);
	expect(translateToolNames("context-mode `ctx_execute`", MAP)).toBe(
		"context-mode `xd://mcp__context_mode_context_mode_ctx_execute`",
	);
	expect(translateToolNames("ctx_searching and my_ctx_search stay", MAP)).toBe("ctx_searching and my_ctx_search stay");
});

// --- bareTools resolved from the session's active tools at injection time ---

const BARE_PROSE = "`ctx_search` `ctx_glob` `ctx_read` `ctx_shell` `ctx_execute`";

test("active tools: a directly callable ctx_* tool keeps its bare name; a connected MCP device maps to its xd route", () => {
	const active = ["write", "ctx_search", "mcp__lean_ctx_ctx_glob", "mcp__lean_ctx_ctx_read", "mcp__context_mode_context_mode_ctx_execute"];
	expect(resolveBareTools(MAP, active)).toEqual({
		ctx_search: "ctx_search",
		ctx_glob: "xd://mcp__lean_ctx_ctx_glob",
		ctx_read: "xd://mcp__lean_ctx_ctx_read",
		ctx_execute: "xd://mcp__context_mode_context_mode_ctx_execute",
	});
	expect(translateToolNames(BARE_PROSE, { ...MAP, bareTools: resolveBareTools(MAP, active) ?? {} })).toBe(
		"`ctx_search` `xd://mcp__lean_ctx_ctx_glob` `xd://mcp__lean_ctx_ctx_read` `ctx_shell` `xd://mcp__context_mode_context_mode_ctx_execute`",
	);
});

test("active tools: a device route needs `write`, and an unreachable tool is left bare rather than pointed at a dead device", () => {
	expect(resolveBareTools(MAP, ["mcp__lean_ctx_ctx_glob"])).toEqual({}); // no write: devices are not callable
	expect(resolveBareTools(MAP, ["write", "read", "bash"])).toEqual({}); // nothing lean-ctx connected
	// a differently spelled server still resolves through the contract's server pattern
	expect(resolveBareTools(MAP, ["write", "mcp__lean-ctx_ctx_search"])).toEqual({ ctx_search: "xd://mcp__lean-ctx_ctx_search" });
});

test("unknown availability falls back to the static bareTools map", () => {
	expect(resolveBareTools(MAP, undefined)).toEqual(MAP.bareTools);
	expect(resolveBareTools(MAP, "nope" as unknown as string[])).toEqual(MAP.bareTools);
});

test("registerStyle resolves bareTools from activeTools at injection time, and falls back when activeTools is unknown or throws", () => {
	const render = (activeTools?: () => string[] | undefined) => {
		const handlers: Record<string, Handler> = {};
		const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
		registerStyle(api as unknown as Pick<ExtensionAPI, "on">, { env: {}, activeTools });
		return handlers.before_agent_start({ systemPrompt: [], prompt: "hi" }, { agent: { kind: "main" } })?.systemPrompt?.[0] ?? "";
	};
	const live = render(() => ["write", "ctx_search", "ctx_glob", "mcp__lean_ctx_ctx_read", "mcp__lean_ctx_ctx_shell"]);
	const dead = render(() => ["read", "bash"]);
	const unknown = render(() => undefined);
	const throwing = render(() => { throw new Error("boom"); });
	const omitted = render();
	expect(live).not.toBe(dead); // the active set changes what is rendered
	expect(live).toContain("xd://mcp__lean_ctx_ctx_read");
	expect(live).not.toContain("xd://mcp__lean_ctx_ctx_search"); // callable directly, so no device rewrite
	expect(dead).not.toMatch(/xd:\/\/mcp__lean_ctx_ctx_/); // unreachable: nothing points at a dead device
	for (const fallback of [unknown, throwing, omitted]) expect(fallback).toBe(renderOmpStyle());
});

// --- one stable prefix per session: a re-render mid-session rewrites the whole prompt cache ---

function frozenHarness(active: { current: string[] | undefined }) {
	const handlers: Record<string, (event: never, ctx: never) => unknown> = {};
	const api = { on: (name: string, h: (event: never, ctx: never) => unknown) => { handlers[name] = h; } };
	registerStyle(api as unknown as Pick<ExtensionAPI, "on">, { env: {}, activeTools: () => active.current });
	const turn = () => (handlers.before_agent_start as unknown as Handler)({ systemPrompt: ["base"], prompt: "hi" }, { agent: { kind: "main" } })?.systemPrompt?.slice(1) ?? [];
	return { turn, reset: (name: "session_start" | "session_switch") => handlers[name]?.({} as never, {} as never) };
}

const EARLY = ["read", "bash", "write"];
const LATE = ["write", "mcp__lean_ctx_ctx_read", "mcp__lean_ctx_ctx_shell", "mcp__lean_ctx_ctx_search", "mcp__lean_ctx_ctx_glob"];

test("the rendered blocks are frozen for the session: devices mounting later do not change the prompt bytes", () => {
	const active = { current: EARLY as string[] | undefined };
	const h = frozenHarness(active);
	const first = h.turn();
	active.current = LATE; // xd:// devices mounted after turn 1, as in a real session
	const second = h.turn();
	expect(first.length).toBe(2);
	expect(second).toEqual(first); // byte-identical: the cached prefix survives the next agent loop
	expect(renderOmpStyle(undefined, undefined, LATE)).not.toBe(first[0]); // the freeze, not coincidence, is what holds it
});

test("session_start and session_switch drop the frozen render so a new session renders against its own tools", () => {
	for (const event of ["session_start", "session_switch"] as const) {
		const active = { current: EARLY as string[] | undefined };
		const h = frozenHarness(active);
		const before = h.turn();
		active.current = LATE;
		h.reset(event);
		const after = h.turn();
		expect(after).not.toEqual(before);
		expect(after[0]).toBe(renderOmpStyle(undefined, undefined, LATE));
	}
});

test("a render that failed (unreadable sources) is not frozen: the next turn retries", () => {
	const active = { current: EARLY as string[] | undefined };
	const handlers: Record<string, unknown> = {};
	const api = { on: (name: string, h: unknown) => { handlers[name] = h; } };
	const bad = join(dir, "later.md");
	registerStyle(api as unknown as Pick<ExtensionAPI, "on">, { env: {}, stylePath: bad, addendumPath: join(dir, "none.md"), activeTools: () => active.current });
	const turn = () => (handlers.before_agent_start as Handler)({ systemPrompt: ["base"], prompt: "hi" }, { agent: { kind: "main" } });
	expect(turn()).toBeUndefined(); // style missing
	writeFileSync(bad, "---\nname: x\n---\nbody\n");
	expect(turn()?.systemPrompt?.length).toBe(2); // now readable: rendered, not stuck on the earlier failure
});
