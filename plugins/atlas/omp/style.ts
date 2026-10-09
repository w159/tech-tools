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
import { loadNativeTools } from "./contracts";

export const STYLE_PATH = nodePath.resolve(import.meta.dir, "..", "output-styles", "atlas-orchestrator.md");
export const TOOL_NAMES_PATH = nodePath.resolve(import.meta.dir, "..", "contracts", "tool-names.json");

export const STYLE_BEGIN = "<!-- atlas-orchestrator-style:begin -->";
export const STYLE_END = "<!-- atlas-orchestrator-style:end -->";
/** omp-only lead guidance (atlas-specific deltas omp's own prompts do not teach). Lives in omp/, never in output-styles/, which Claude Code scans. */
export const ADDENDUM_PATH = nodePath.resolve(import.meta.dir, "lead-addendum.md");
export const ADDENDUM_BEGIN = "<!-- atlas-omp-lead:begin -->";
export const ADDENDUM_END = "<!-- atlas-omp-lead:end -->";
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

/**
 * The style's paragraph on why `TodoWrite` may be missing is Claude Code mechanics (`CLAUDE_CODE_ENABLE_TODO_TOOLS`,
 * `ENABLE_TOOL_SEARCH`, a ToolSearch select) with nothing omp can act on; translated, it read as a nonsense
 * `xd:// device catalog("select:todo")` instruction. Under omp keep only the actionable part: check once, then the
 * LEDGER line. The source file is untouched, so the contract test that pins the Claude wording still holds.
 * A source that no longer matches is passed through unchanged.
 */
const CLAUDE_TODO_GATING = /`TodoWrite` is not always in the toolset:[\s\S]*?Check once, silently\. Without it, carry one\s+line under the header:/;

export function adaptTodoGatingForOmp(body: string): string {
	return body.replace(CLAUDE_TODO_GATING, "If `TodoWrite` is not callable (check once, silently), carry one line under the header:");
}

let cached: { key: string; text: string } | undefined;

/**
 * `tool-names.json` bareTools says where each bare `ctx_*` name lives in a session that
 * has lean-ctx/context-mode connected as MCP. That is a guess about the session, so at
 * injection time resolve each name against the tools actually callable now (same rules as
 * index.ts `resolveLeanReplacement`, which cannot be imported here: index.ts imports this
 * module): a directly callable bare tool keeps its name, a connected MCP device maps to
 * its `xd://` route (devices are invoked by writing to them, so that needs `write`), and
 * anything unreachable is left bare instead of pointing at a dead device. `active`
 * unknown (undefined or not an array) → the static map.
 */
export function resolveBareTools(map: ToolNameMap, active: string[] | undefined): Record<string, string> {
	if (!Array.isArray(active)) return map.bareTools;
	const contract = loadNativeTools();
	if (!contract) return map.bareTools; // cannot tell which servers own which tool: keep the static map
	const servers: Record<string, RegExp[]> = {};
	for (const { replacements } of Object.values(contract.kinds)) {
		for (const { tool, servers: patterns } of replacements) servers[tool] = [...(servers[tool] ?? []), ...patterns];
	}
	const canWrite = active.includes("write");
	const resolved: Record<string, string> = {};
	for (const bare of Object.keys(map.bareTools)) {
		if (active.includes(bare)) {
			resolved[bare] = bare;
			continue;
		}
		if (!canWrite) continue;
		const patterns = servers[bare] ?? [];
		const device = active.find(name => {
			if (!name.startsWith("mcp__") || !name.toLowerCase().endsWith(`_${bare}`)) return false;
			const server = name.slice("mcp__".length, name.length - bare.length - 1);
			return patterns.some(p => p.test(server));
		});
		if (device) resolved[bare] = `xd://${device}`;
	}
	return resolved;
}

/** The style block appended to the omp system prompt; undefined when sources are unreadable. */
export function renderOmpStyle(
	stylePath: string = STYLE_PATH,
	namesPath: string = TOOL_NAMES_PATH,
	active?: string[],
): string | undefined {
	const body = loadStyleBody(stylePath);
	const loaded = loadToolNames(namesPath);
	if (!body || !loaded) return undefined;
	const map = { ...loaded, bareTools: resolveBareTools(loaded, active) };
	const key = `${stylePath}\0${namesPath}\0${JSON.stringify(map.bareTools)}`;
	if (cached?.key === key) return cached.text;
	const text = `${STYLE_BEGIN}\n${PREFACE}\n\n${translateToolNames(adaptTodoGatingForOmp(body), map)}\n${STYLE_END}`;
	cached = { key, text };
	return text;
}

/** The omp lead addendum as its own marked block; undefined when the file is missing or blank. */
export function renderOmpAddendum(path: string = ADDENDUM_PATH): string | undefined {
	try {
		const body = fs.readFileSync(path, "utf8").trim();
		return body ? `${ADDENDUM_BEGIN}\n${body}\n${ADDENDUM_END}` : undefined;
	} catch {
		return undefined;
	}
}

export interface StyleDeps {
	env?: Record<string, string | undefined>;
	stylePath?: string;
	namesPath?: string;
	addendumPath?: string;
	/** The session's currently callable tool names; undefined (or a throw) means availability is unknown. */
	activeTools?: () => string[] | undefined;
}

/**
 * The blocks injected for one session. Rendered once and then re-served byte for byte: the style text depends on
 * which tools are callable (`resolveBareTools`), so re-rendering after xd:// devices mount changes the system
 * prompt mid-session, and the provider's prompt cache then rewrites every token after the shared prefix
 * (measured: one gated stop cost a 55k-token cache write). `undefined` means "not rendered yet or failed", so
 * a failed render is retried on the next turn instead of being frozen.
 */
export interface FrozenBlocks {
	style?: string;
	addendum?: string;
}

export function registerStyle(pi: Pick<ExtensionAPI, "on">, deps: StyleDeps = {}): void {
	let frozen: FrozenBlocks = {};
	const reset = () => {
		frozen = {};
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);
	pi.on("before_agent_start", (event, ctx) => {
		try {
			if (ctx.agent.kind !== "main") return undefined;
			if ((deps.env ?? process.env).ATLAS_STYLE === "off") return undefined;
			const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
			const has = (marker: string) => base.some(entry => typeof entry === "string" && entry.includes(marker));
			const additions: string[] = [];
			if (!has(STYLE_BEGIN)) {
				if (frozen.style === undefined) {
					let active: string[] | undefined;
					try {
						active = deps.activeTools?.();
					} catch {
						active = undefined; // availability unknown: render with the static bareTools map
					}
					frozen.style = renderOmpStyle(deps.stylePath, deps.namesPath, active);
				}
				if (frozen.style) additions.push(frozen.style);
			}
			if (!has(ADDENDUM_BEGIN)) {
				frozen.addendum ??= renderOmpAddendum(deps.addendumPath);
				if (frozen.addendum) additions.push(frozen.addendum);
			}
			return additions.length ? { systemPrompt: [...base, ...additions] } : undefined;
		} catch {
			return undefined; // fail open — a missing style never strands the session
		}
	});
}
