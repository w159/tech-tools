/**
 * Per-agent tool restrictions for atlas subagents on omp.
 *
 * The atlas agent definitions (agents/<name>.md) carry a Claude Code `disallowedTools`
 * frontmatter list. omp 18.6.1 does not parse that key (nor `permissionMode`), and it has
 * no Claude->omp tool-name map beyond lowercasing, so on omp those restrictions would be
 * silently ignored. This module enforces them with one extension `tool_call` handler:
 * when `ctx.agent.kind === "sub"` and `ctx.agent.name` (omp's lowercased agent definition
 * name, sdk.ts `resolvedAgentName`) is an atlas agent, the agent's `disallowedTools` are
 * read from agents/<name>.md — the single source of truth shared with Claude Code — and a
 * call whose omp tool is mapped from a disallowed Claude tool is blocked. The mapping is
 * data: contracts/tool-names.json -> `agentGuard`.
 *
 * Why a handler and not a narrower `tools:` list: omp's `write` tool also carries the
 * `xd://` MCP device calls, outbound IRC (`write agent://<id>`) and shared artifacts
 * (`local://`, `proc://`), so removing `write` from a child would cut all of those. The
 * handler therefore blocks `write` only when its `path` is not a `scheme://` target.
 *
 * NOT COVERED: writes made through the `bash` tool (`sed -i`, `tee`, `>` redirects, ...).
 * `disallowedTools` names no shell restriction and omp has no per-agent shell policy, so a
 * restricted agent that runs a shell command can still modify files. This guard narrows
 * the file-editing tools; it is not a sandbox.
 *
 * Never blocks the lead (`ctx.agent.kind` other than "sub"), a subagent that is not an
 * atlas agent, or an unknown agent. Kill switch: ATLAS_TRIPWIRE_HARD=off (the same switch
 * as the model-override and native-tool guards in index.ts), read per call. Every parse or
 * read failure fails open: omp's tool_call dispatch is fail-closed, so a throw here would
 * strand the agent.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";

import { isRecord } from "./workers";

const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");
const DEFAULT_AGENTS_DIR = nodePath.join(PLUGIN_ROOT, "agents");
const DEFAULT_CONTRACT = nodePath.join(PLUGIN_ROOT, "contracts", "tool-names.json");

/** One omp tool's guard rule: blocked when any listed Claude tool is in the agent's disallowedTools. */
export interface GuardRule {
	blockedByClaude: string[];
	/** "notUri": block only when the call's `path` is not a `scheme://` target. */
	onlyWhenPath?: "notUri";
}

export interface GuardContract {
	uriSchemeRegex: RegExp;
	ompTools: Record<string, GuardRule>;
	notApplicable: string[];
}

export interface AgentGuardDeps {
	env?: Record<string, string | undefined>;
	/** Directory holding <name>.md agent definitions. Default: <plugin root>/agents. */
	agentsDir?: string;
	/** contracts/tool-names.json path. Default: <plugin root>/contracts/tool-names.json. */
	contractPath?: string;
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string");

/** Only plain definition names resolve to a file: no separators, no traversal, lowercase. */
const SAFE_AGENT_NAME = /^[a-z0-9][a-z0-9._-]*$/;

const isQuoted = (text: string): boolean => /^(["'])[\s\S]*\1$/.test(text);

function unquote(item: string): string {
	const trimmed = item.trim();
	return isQuoted(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
}

const stripComment = (text: string): string => text.replace(/\s+#.*$/, "");

/** The lines between the first two `---` fences; [] when the file has no closed frontmatter. */
function frontmatterLines(markdown: string): string[] {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	if (lines[0]?.trim() !== "---") return [];
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	return end < 0 ? [] : lines.slice(1, end);
}

/** Items of the inline form: `[A, B]` (throws when unclosed) or a bare CSV. */
function inlineItems(rest: string): string[] {
	if (!rest.startsWith("[")) return rest.split(",");
	if (!rest.endsWith("]")) throw new Error("unterminated disallowedTools bracket list");
	return rest.slice(1, -1).split(",");
}

const DASH_ENTRY = /^\s+-\s*(.*)$/;
const isBlankOrComment = (line: string): boolean => line.trim() === "" || /^\s*#/.test(line);

/** Items of the dash-list form that follows a bare `key:` line; stops at the next key. */
function dashItems(lines: string[]): string[] {
	const entries = lines.map(line => ({ line, entry: DASH_ENTRY.exec(line) }));
	const stop = entries.findIndex(({ line, entry }) => !entry && !isBlankOrComment(line)); // next key
	const block = stop < 0 ? entries : entries.slice(0, stop);
	return block.flatMap(({ entry }) => (entry ? [stripComment(entry[1])] : []));
}

/**
 * The `disallowedTools` (or kebab `disallowed-tools`) list from a markdown file's YAML
 * frontmatter. Accepts the bracket form (`[A, B]`), the dash-list form, and a bare CSV.
 * Text outside the first `---` block is ignored. Returns [] when there is no frontmatter
 * or no such key; throws on a malformed bracket (unclosed `[`) so the caller can fail open.
 */
export function parseDisallowedTools(markdown: string): string[] {
	const front = frontmatterLines(markdown);
	const start = front.findIndex(line => /^(disallowedTools|disallowed-tools)\s*:/.test(line));
	if (start < 0) return [];
	const rest = stripComment(front[start].replace(/^[^:]*:/, "")).trim();
	const items = rest === "" ? dashItems(front.slice(start + 1)) : inlineItems(rest);
	return items.map(unquote).filter(item => item !== "");
}

/** Runs `load`, mapping a throw to null (fail open). */
function tryLoad<T>(load: () => T | null): T | null {
	try {
		return load();
	} catch {
		return null;
	}
}

/** Memoises `load` per key; a null result or throw is cached as null and surfaces as undefined (fail open). */
function cachedLoad<T>(cache: Map<string, T | null>, key: string, load: () => T | null): T | undefined {
	const hit = cache.get(key);
	if (hit !== undefined) return hit ?? undefined;
	const loaded = tryLoad(load);
	cache.set(key, loaded);
	return loaded ?? undefined;
}

const agentCache = new Map<string, string[] | null>();

const isSafeAgentName = (name: string): boolean => SAFE_AGENT_NAME.test(name) && !name.includes("..");

/**
 * Cached `disallowedTools` of agents/<name>.md. Undefined when the agent has no readable,
 * parseable definition (unknown agent, bad name, I/O or parse error): callers fail open.
 */
export function loadAgentDisallowed(name: string, agentsDir: string = DEFAULT_AGENTS_DIR): string[] | undefined {
	return cachedLoad(agentCache, `${agentsDir}\0${name}`, () =>
		isSafeAgentName(name) ? parseDisallowedTools(readFileSync(nodePath.join(agentsDir, `${name}.md`), "utf8")) : null);
}

const contractCache = new Map<string, GuardContract | null>();

type GuardShape = { uriSchemeRegex: string; ompTools: Record<string, unknown>; notApplicable: string[] };

function isGuardShape(guard: unknown): guard is GuardShape {
	if (!isRecord(guard)) return false;
	return typeof guard.uriSchemeRegex === "string" && isRecord(guard.ompTools) && isStringArray(guard.notApplicable);
}

const guardShape = (parsed: unknown): GuardShape | undefined => {
	const guard = isRecord(parsed) ? parsed.agentGuard : undefined;
	return isGuardShape(guard) ? guard : undefined;
};

const isOnlyWhenPath = (value: unknown): value is GuardRule["onlyWhenPath"] => value === undefined || value === "notUri";

/** A rule that omits `onlyWhenPath` entirely when the contract does, so it round-trips unchanged. */
const buildRule = (blockedByClaude: string[], onlyWhenPath: GuardRule["onlyWhenPath"]): GuardRule =>
	onlyWhenPath === undefined ? { blockedByClaude } : { blockedByClaude, onlyWhenPath };

function parseRule(rule: unknown): GuardRule | undefined {
	if (!isRecord(rule)) return undefined;
	const { blockedByClaude, onlyWhenPath } = rule;
	return isStringArray(blockedByClaude) && isOnlyWhenPath(onlyWhenPath) ? buildRule(blockedByClaude, onlyWhenPath) : undefined;
}

function parseOmpTools(tools: Record<string, unknown>): Record<string, GuardRule> | undefined {
	const parsed: Record<string, GuardRule> = {};
	for (const [tool, raw] of Object.entries(tools)) {
		const rule = parseRule(raw);
		if (!rule) return undefined;
		parsed[tool] = rule;
	}
	return parsed;
}

function parseGuardContract(parsed: Record<string, unknown> | null): GuardContract | null {
	const guard = guardShape(parsed);
	const ompTools = guard && parseOmpTools(guard.ompTools);
	if (!guard || !ompTools) return null;
	return { uriSchemeRegex: new RegExp(guard.uriSchemeRegex), ompTools, notApplicable: guard.notApplicable };
}

/** The parsed JSON object in `file`, or null when it is unreadable, malformed or not an object (fail open). */
function readJsonObject(file: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Parsed `agentGuard` section of contracts/tool-names.json, cached; undefined when absent or malformed. */
export function loadGuardContract(contractPath: string = DEFAULT_CONTRACT): GuardContract | undefined {
	return cachedLoad(contractCache, contractPath, () => parseGuardContract(readJsonObject(contractPath)));
}

function blockReason(agent: string, tool: string, claudeTool: string, detail: string): string {
	return `DENY - atlas agent '${agent}' may not call '${tool}'${detail}: its definition lists ${claudeTool} under disallowedTools (plugins/atlas/agents/${agent}.md). omp does not enforce disallowedTools itself, so this extension does. Report what you found and let the lead make the change; if this restriction is wrong for the role, fix the agent definition, not the call.`;
}

const NOT_URI_DETAIL = " to a file path (only scheme:// targets such as agent://, xd:// and local:// are allowed)";

type GuardEvent = { toolName?: unknown; input?: unknown };
type GuardCtx = { agent?: { kind?: unknown; name?: unknown } } | undefined;
type Hit = { tool: string; rule: GuardRule; claudeTool: string; contract: GuardContract };

/** The name of the calling subagent; undefined for the lead. */
function subAgentName(ctx: GuardCtx): string | undefined {
	if (ctx?.agent?.kind !== "sub") return undefined;
	return typeof ctx.agent.name === "string" ? ctx.agent.name : "";
}

const toolKey = (event: GuardEvent): string => (typeof event.toolName === "string" ? event.toolName : "").toLowerCase();

/** The rule registered for this tool name; own keys only, so `constructor` and friends never match. */
function ruleFor(contract: GuardContract, tool: string): GuardRule | undefined {
	return Object.hasOwn(contract.ompTools, tool) ? contract.ompTools[tool] : undefined;
}

/** The tool rule the call trips, given the agent's disallowed Claude tools. */
function findHit(event: GuardEvent, disallowed: string[], deps: AgentGuardDeps): Hit | undefined {
	const contract = loadGuardContract(deps.contractPath);
	if (!contract) return undefined;
	const tool = toolKey(event);
	const rule = ruleFor(contract, tool);
	const claudeTool = rule?.blockedByClaude.find(name => disallowed.includes(name));
	return rule && claudeTool ? { tool, rule, claudeTool, contract } : undefined;
}

/** True when the call's `path` is a `scheme://` target (agent://, xd://, local://, proc://): IRC, a device call or a shared artifact. */
function targetsUri(hit: Hit, input: unknown): boolean {
	const target = (input as Record<string, unknown> | undefined)?.path;
	return typeof target === "string" && hit.contract.uriSchemeRegex.test(target);
}

/** Extra text for the deny reason; undefined when the call is allowed. */
function pathDetail(hit: Hit, input: unknown): string | undefined {
	if (hit.rule.onlyWhenPath !== "notUri") return "";
	return targetsUri(hit, input) ? undefined : NOT_URI_DETAIL;
}

/** The deny reason for a call by `agent`, or undefined when it is allowed. */
function denyReason(agent: string, hit: Hit, input: unknown): string | undefined {
	const detail = pathDetail(hit, input);
	return detail === undefined ? undefined : blockReason(agent, hit.tool, hit.claudeTool, detail);
}

/** The calling subagent and its non-empty disallowed list; undefined for the lead or an agent with nothing to enforce. */
function restrictedAgent(ctx: GuardCtx, deps: AgentGuardDeps): { agent: string; disallowed: string[] } | undefined {
	const agent = subAgentName(ctx);
	if (agent === undefined) return undefined;
	const disallowed = loadAgentDisallowed(agent, deps.agentsDir) ?? [];
	return disallowed.length > 0 ? { agent, disallowed } : undefined;
}

function decide(event: GuardEvent, ctx: GuardCtx, deps: AgentGuardDeps): { block: true; reason: string } | undefined {
	const who = restrictedAgent(ctx, deps);
	if (!who) return undefined;
	const hit = findHit(event, who.disallowed, deps);
	const reason = hit ? denyReason(who.agent, hit, event.input) : undefined;
	return reason === undefined ? undefined : { block: true, reason };
}

/** Registers the per-agent tool restriction handler. Exported for tests; index.ts binds real defaults. */
export function registerAgentGuard(pi: Pick<ExtensionAPI, "on">, deps: AgentGuardDeps = {}): void {
	pi.on("tool_call", (event, ctx) => {
		try {
			return (deps.env ?? process.env).ATLAS_TRIPWIRE_HARD === "off" ? undefined : decide(event, ctx, deps);
		} catch {
			return undefined; // fail open — never strand the agent
		}
	});
}
