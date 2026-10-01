import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	STYLE_BEGIN,
	STYLE_END,
	STYLE_PATH,
	loadStyleBody,
	loadToolNames,
	mcpDevice,
	registerStyle,
	renderOmpStyle,
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

function harness(env: Record<string, string | undefined> = {}, stylePath?: string) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerStyle(api as unknown as Pick<ExtensionAPI, "on">, { env, stylePath });
	return (systemPrompt: string[], kind: "main" | "sub" = "main") =>
		handlers.before_agent_start({ systemPrompt, prompt: "hi" }, { agent: { kind } });
}

const MAP = loadToolNames();
if (!MAP) throw new Error("contracts/tool-names.json must load");

test("main session gets the translated style appended exactly once", () => {
	const run = harness();
	const result = run(["base prompt"]);
	expect(result?.systemPrompt?.length).toBe(2);
	expect(result?.systemPrompt?.[0]).toBe("base prompt");
	const block = result?.systemPrompt?.[1] ?? "";
	expect(block.startsWith(STYLE_BEGIN)).toBe(true);
	expect(block.endsWith(STYLE_END)).toBe(true);
	// handler re-entry with the style already present is a no-op
	expect(run(result?.systemPrompt ?? [])).toBeUndefined();
});

test("subagents never receive the style", () => {
	expect(harness()(["base"], "sub")).toBeUndefined();
});

test("ATLAS_STYLE=off disables injection", () => {
	expect(harness({ ATLAS_STYLE: "off" })(["base"])).toBeUndefined();
});

test("missing or malformed style source fails open", () => {
	expect(harness({}, join(dir, "absent.md"))(["base"])).toBeUndefined();
	const bad = join(dir, "bad.md");
	writeFileSync(bad, "---\nname: x\nno closing fence\n");
	expect(loadStyleBody(bad)).toBeUndefined();
	expect(harness({}, bad)(["base"])).toBeUndefined();
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

test("multi-word entries win over the bare names they contain, across line wraps", () => {
	const src = "and under `ENABLE_TOOL_SEARCH` it is deferred\n(`ToolSearch(\"select:TodoWrite\")`). Check once.";
	const out = translateToolNames(src, MAP);
	expect(out).not.toContain("ToolSearch");
	expect(out).not.toContain("TodoWrite");
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
	expect(rendered).toContain(translateToolNames(body ?? "", MAP));
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
});
