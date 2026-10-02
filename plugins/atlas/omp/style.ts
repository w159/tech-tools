/**
 * Atlas output style for omp.
 *
 * Claude Code applies `output-styles/atlas-orchestrator.md` to the main thread
 * (frontmatter `force-for-plugin: true`). omp has no output-style feature, so
 * this module renders the SAME source file — frontmatter stripped, Claude tool
 * names translated through `contracts/tool-names.json` — and appends it to the
 * main session's system prompt from `before_agent_start`. Subagents receive
 * nothing, matching Claude Code (a style never reaches a fresh subagent).
 *
 * Idempotent: `before_agent_start` handlers re-run on source-base retries
 * (omp://extensions.md), so an entry already carrying the begin marker means
 * the style is present and the handler returns undefined. Fails open: any
 * error returns undefined. Kill switch: ATLAS_STYLE=off.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import * as nodePath from "node:path";

export const STYLE_PATH = nodePath.resolve(import.meta.dir, "..", "output-styles", "atlas-orchestrator.md");
export const TOOL_NAMES_PATH = nodePath.resolve(import.meta.dir, "..", "contracts", "tool-names.json");

export const STYLE_BEGIN = "<!-- atlas-orchestrator-style:begin -->";
export const STYLE_END = "<!-- atlas-orchestrator-style:end -->";
const PREFACE =
	"Atlas output style (source: plugins/atlas/output-styles/atlas-orchestrator.md, Claude tool names translated to omp). It governs this main session only; subagents get their rules from the dispatch brief.";

export interface ToolNameMap {
	claudeToOmp: Record<string, string>;
	/** Bare lean-ctx/context-mode names (`ctx_search`) → the omp device a real session mints. */
	bareTools: Record<string, string>;
	mcp: { prefix: string; separator: string };
}

/** The style body with its YAML frontmatter removed; undefined when missing or malformed. */
export function loadStyleBody(path: string = STYLE_PATH): string | undefined {
	try {
		const text = fs.readFileSync(path, "utf8");
		if (!text.startsWith("---")) return text.trim() || undefined;
		const end = text.indexOf("\n---", 3);
		if (end < 0) return undefined;
		const body = text.slice(text.indexOf("\n", end + 1) + 1).trim();
		return body || undefined;
	} catch {
		return undefined;
	}
}

export function loadToolNames(path: string = TOOL_NAMES_PATH): ToolNameMap | undefined {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || !("claudeToOmp" in parsed) || !("mcp" in parsed)) return undefined;
		const { claudeToOmp, mcp } = parsed;
		if (!claudeToOmp || typeof claudeToOmp !== "object" || !mcp || typeof mcp !== "object") return undefined;
		if (!("prefix" in mcp) || typeof mcp.prefix !== "string" || !("separator" in mcp) || typeof mcp.separator !== "string") return undefined;
		const bare = "bareTools" in parsed ? parsed.bareTools : undefined;
		const bareTools = bare && typeof bare === "object" && !Array.isArray(bare) ? (bare as Record<string, string>) : {};
		return {
			claudeToOmp: claudeToOmp as Record<string, string>,
			bareTools,
			mcp: { prefix: mcp.prefix, separator: mcp.separator },
		};
	} catch {
		return undefined;
	}
}

/** Key → regex source: whitespace runs tolerate prose reflow; word edges get \b guards. */
function keyPattern(key: string): string {
	const body = key
		.trim()
		.split(/\s+/)
		.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("\\s+");
	return (/\w/.test(key[0]) ? "\\b" : "") + body + (/\w/.test(key[key.length - 1]) ? "\\b" : "");
}

/** omp's MCP mint: lowercased, non-[a-z0-9_] runs → _, underscores collapsed and trimmed. */
function sanitize(part: string): string {
	return part.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

/** `mcp__<server>__<tool>` → `xd://mcp__<server>_<tool>` (tool loses a redundant `<server>_` prefix). */
export function mcpDevice(server: string, tool: string, map: ToolNameMap): string {
	const s = sanitize(server);
	let t = sanitize(tool);
	if (t.startsWith(`${s}_`)) t = t.slice(s.length + 1);
	return `${map.mcp.prefix}${s}${map.mcp.separator}${t}`;
}

const MCP_TOKEN = "\\bmcp__([A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*)__([A-Za-z0-9_-]+)";

/**
 * Single-pass translation: longest key first, and inserted text is never
 * rescanned. Keys come from claudeToOmp (single tokens, no whitespace, so prose
 * reflow cannot break them) and bareTools (bare `ctx_*` names → omp devices).
 */
export function translateToolNames(text: string, map: ToolNameMap): string {
	const table: Record<string, string> = { ...map.bareTools, ...map.claudeToOmp };
	const keys = Object.keys(table).sort((a, b) => b.length - a.length);
	const parts = [MCP_TOKEN, ...keys.map(keyPattern)];
	const re = new RegExp(parts.map(p => `(?:${p})`).join("|"), "g");
	return text.replace(re, (match: string, server?: string, tool?: string) => {
		if (server && tool) return mcpDevice(server, tool, map);
		return table[match] ?? match;
	});
}

let cached: { key: string; text: string } | undefined;

/** The style block appended to the omp system prompt; undefined when sources are unreadable. */
export function renderOmpStyle(stylePath: string = STYLE_PATH, namesPath: string = TOOL_NAMES_PATH): string | undefined {
	const key = `${stylePath}\0${namesPath}`;
	if (cached?.key === key) return cached.text;
	const body = loadStyleBody(stylePath);
	const map = loadToolNames(namesPath);
	if (!body || !map) return undefined;
	const text = `${STYLE_BEGIN}\n${PREFACE}\n\n${translateToolNames(body, map)}\n${STYLE_END}`;
	cached = { key, text };
	return text;
}

export interface StyleDeps {
	env?: Record<string, string | undefined>;
	stylePath?: string;
	namesPath?: string;
}

export function registerStyle(pi: Pick<ExtensionAPI, "on">, deps: StyleDeps = {}): void {
	pi.on("before_agent_start", (event, ctx) => {
		try {
			if (ctx.agent.kind !== "main") return undefined;
			if ((deps.env ?? process.env).ATLAS_STYLE === "off") return undefined;
			const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
			if (base.some(entry => typeof entry === "string" && entry.includes(STYLE_BEGIN))) return undefined;
			const rendered = renderOmpStyle(deps.stylePath, deps.namesPath);
			if (!rendered) return undefined;
			return { systemPrompt: [...base, rendered] };
		} catch {
			return undefined; // fail open — a missing style never strands the session
		}
	});
}
