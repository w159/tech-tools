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
	expect(inner.slice(inner.indexOf("\n\n") + 2)).toBe(translateToolNames(body ?? "", MAP));
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
