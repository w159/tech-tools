/**
 * Claude Code hook bridge for omp.
 *
 * hooks/hooks.json is the single wiring source for the Python hooks. This
 * module reads it and runs the hooks that contracts/hook-bridge.json marks as
 * bridgeable, translating omp events into Claude Code hook payloads:
 *
 *   SessionStart     — first main-session before_agent_start; its
 *                      additionalContext is appended to every main prompt
 *   UserPromptSubmit — each main-session before_agent_start (prompt text)
 *   PreToolUse       — tool_call (main and subagents, as in Claude Code);
 *                      permissionDecision "deny" blocks the call
 *   PostToolUse      — tool_result; additionalContext / block reason is
 *                      returned as additionalContext; the payload carries
 *                      tool_response (stringified result), is_error and
 *                      transcript_path (subagents only)
 *
 * The session-end family (Stop, SessionEnd, SubagentStop, PreCompact) is driven by
 * omp/stop-bridge.ts from the same hooks.json through loadBridgedHooksFor; this
 * module owns the shared loader, payload builders and output parsers.
 *
 * Tool names translate through contracts/tool-names.json (omp → every Claude
 * name that maps to it), so hooks.json matchers apply unchanged. Hooks run via
 * /bin/sh with CLAUDE_PLUGIN_ROOT set, ATLAS_HARNESS=omp and
 * ATLAS_MANDATES=off (omp/mandates.ts owns mandates). Every failure, timeout
 * or unparseable output allows. Each hook is killed at min(its hooks.json
 * timeout, ATLAS_BRIDGE_HOOK_TIMEOUT_S, default 25 s) and all hooks of one
 * before_agent_start share omp's 30 s handler budget. Kill switch:
 * ATLAS_HOOK_BRIDGE=off.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { resolveTarget } from "./contracts";
import { ATLAS_AGENT_TARGETABLE } from "./atlas-agents";
import { runCapture } from "./proc";

const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");
export const HOOKS_JSON = nodePath.join(PLUGIN_ROOT, "hooks", "hooks.json");
export const BRIDGE_CONTRACT = nodePath.join(PLUGIN_ROOT, "contracts", "hook-bridge.json");
export const TOOL_NAMES = nodePath.join(PLUGIN_ROOT, "contracts", "tool-names.json");
export const MCP_SERVERS = nodePath.join(PLUGIN_ROOT, "contracts", "mcp-servers.json");
const DEFAULT_TIMEOUT_S = 60;
/** Default per-hook hard cap (s); ATLAS_BRIDGE_HOOK_TIMEOUT_S overrides. omp cuts a handler at 30 s. */
export const DEFAULT_HOOK_CAP_S = 25;
/**
 * Budget shared by every hook of one before_agent_start or session_stop handler. omp cuts those handlers at 30 s
 * (extensions/runner.ts EXTENSION_HANDLER_TIMEOUT_MS) and then delivers NOTHING, so the bridge stays 5 s under it.
 */
export const HANDLER_BUDGET_MS = 25_000;
/**
 * Budget for ALL hooks of one tool_call / tool_result, across every task batch item. omp's tool_call timeout is also
 * 30 s but a timeout there BLOCKS the call (`block: true, "Extension ... timed out"`), so this sits 10 s under it.
 */
export const TOOL_CALL_BUDGET_MS = 20_000;
/** A runner that ignores its timeoutMs is abandoned this long after the slot ends. */
export const HOOK_KILL_GRACE_MS = 250;
export const SESSION_MARKER = "<!-- atlas-session-start -->";

export type ClaudeEvent =
	| "SessionStart"
	| "UserPromptSubmit"
	| "PreToolUse"
	| "PostToolUse"
	| "Stop"
	| "SessionEnd"
	| "SubagentStop"
	| "PreCompact";
/** Events driven per turn / tool call by registerHookBridge. */
export const TURN_EVENTS: readonly ClaudeEvent[] = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"];
/** Events driven at session end by omp/stop-bridge.ts. */
export const SESSION_END_EVENTS: readonly ClaudeEvent[] = ["Stop", "SessionEnd", "SubagentStop", "PreCompact"];
export interface BridgedHook {
	event: ClaudeEvent;
	matcher: RegExp | undefined;
	command: string;
	timeoutMs: number;
}

export interface HookOutput {
	deny?: string;
	context?: string;
}

/** A parsed JSON document: an object, array, or scalar. Callers narrow it before use. */
type JsonDocument = Record<string, unknown> | unknown[] | string | number | boolean | null;

/**
 * Reads and parses a JSON file. Rethrows with the file path on a read or parse failure so a caller's
 * try/catch can fail open and still say which contract file was bad.
 */
function readJson(path: string): JsonDocument {
	try {
		return JSON.parse(fs.readFileSync(path, "utf8")) as JsonDocument;
	} catch (error) {
		throw new Error(`unreadable JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Bridgeable turn-event hook commands from hooks.json, filtered by the contract's `bridged` list. */
export function loadBridgedHooks(hooksPath: string = HOOKS_JSON, contractPath: string = BRIDGE_CONTRACT): BridgedHook[] {
	return loadBridgedHooksFor(TURN_EVENTS, "bridged", hooksPath, contractPath);
}

/**
 * Hook commands for `events` from hooks.json (group order, then hook order, as
 * written), filtered by the contract list named `listKey`. hooks.json stays the
 * only source of order, matchers and timeouts; the contract only allowlists.
 */
export function loadBridgedHooksFor(
	events: readonly ClaudeEvent[],
	listKey: "bridged" | "bridgedSessionEnd",
	hooksPath: string = HOOKS_JSON,
	contractPath: string = BRIDGE_CONTRACT,
): BridgedHook[] {
	try {
		const contract = readJson(contractPath) as Record<string, unknown> | null;
		const list = contract && typeof contract === "object" ? contract[listKey] : undefined;
		if (!Array.isArray(list)) return [];
		const allowed = new Set(list.filter((s: unknown): s is string => typeof s === "string"));
		const root = readJson(hooksPath);
		if (!root || typeof root !== "object" || !("hooks" in root) || !root.hooks || typeof root.hooks !== "object") return [];
		const out: BridgedHook[] = [];
		for (const [event, groups] of Object.entries(root.hooks as Record<string, unknown>)) {
			if (!events.includes(event as ClaudeEvent) || !Array.isArray(groups)) continue;
			for (const group of groups) {
				if (!group || typeof group !== "object" || !("hooks" in group) || !Array.isArray(group.hooks)) continue;
				const rawMatcher = "matcher" in group && typeof group.matcher === "string" ? group.matcher : "";
				const matcher = rawMatcher && rawMatcher !== "*" ? new RegExp(`^(?:${rawMatcher})$`) : undefined;
				for (const hook of group.hooks) {
					if (!hook || typeof hook !== "object" || !("command" in hook) || typeof hook.command !== "string") continue;
					const script = /([\w.-]+\.py)/.exec(hook.command)?.[1];
					if (!script || !allowed.has(script)) continue;
					const timeout = "timeout" in hook && typeof hook.timeout === "number" ? hook.timeout : DEFAULT_TIMEOUT_S;
					out.push({ event: event as ClaudeEvent, matcher, command: hook.command, timeoutMs: timeout * 1000 });
				}
			}
		}
		return out;
	} catch {
		return [];
	}
}

/** omp tool name → every Claude tool name mapping to it (contracts/tool-names.json `claudeToOmp`, then `ompAliases`); itself when unmapped. */
export function claudeNamesFor(ompTool: string, namesPath: string = TOOL_NAMES): string[] {
	try {
		const parsed = readJson(namesPath);
		if (!parsed || typeof parsed !== "object" || !("claudeToOmp" in parsed) || !parsed.claudeToOmp || typeof parsed.claudeToOmp !== "object") return [ompTool];
		const names = Object.entries(parsed.claudeToOmp as Record<string, unknown>)
			.filter(([claude, omp]) => omp === ompTool && /^[A-Z]\w*$/.test(claude))
			.map(([claude]) => claude);
		const alias = "ompAliases" in parsed && parsed.ompAliases && typeof parsed.ompAliases === "object" ? (parsed.ompAliases as Record<string, unknown>)[ompTool] : undefined;
		if (typeof alias === "string" && /^[A-Z]\w*$/.test(alias)) names.push(alias);
		return names.length ? names : [ompTool];
	} catch {
		return [ompTool];
	}
}

/** Parse a Claude Code hook's stdout into a deny reason and/or context text. */
export function parseHookOutput(stdout: string): HookOutput {
	const text = stdout.trim();
	if (!text) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== "object") return {};
	const out: HookOutput = {};
	const spec = "hookSpecificOutput" in parsed ? parsed.hookSpecificOutput : undefined;
	if (spec && typeof spec === "object") {
		// omp has no interactive permission prompt for a hook, so `ask` fails closed as a deny (a hook that wanted a
		// human in the loop must not silently become an allow). Exit code 2 never reaches here: the runner returns stdout only.
		if ("permissionDecision" in spec && (spec.permissionDecision === "deny" || spec.permissionDecision === "ask")) {
			out.deny = "permissionDecisionReason" in spec && typeof spec.permissionDecisionReason === "string" ? spec.permissionDecisionReason : "denied by atlas hook";
		}
		if ("additionalContext" in spec && typeof spec.additionalContext === "string" && spec.additionalContext.trim()) out.context = spec.additionalContext;
	}
	if ("decision" in parsed && parsed.decision === "block" && "reason" in parsed && typeof parsed.reason === "string") {
		out.context = [out.context, parsed.reason].filter(Boolean).join("\n");
	}
	return out;
}

export interface StopHookOutput {
	/** True when the hook printed `{decision: "block"}`. */
	block?: true;
	reason?: string;
	/** `hookSpecificOutput.additionalContext` (non-blank), which a non-blocking Stop hook uses to speak to the model. */
	context?: string;
}

/**
 * Parse a Stop-family hook's stdout. Unlike parseHookOutput (turn hooks, where a
 * block reason is advisory context), a Stop hook's `{decision: "block", reason}` is
 * a real refusal and maps to the omp session_stop result `{decision, reason}`; a
 * non-blank `hookSpecificOutput.additionalContext` is returned as `context`.
 * Anything else (silence, garbage, other decisions) is ignored.
 */
export function parseStopHookOutput(stdout: string): StopHookOutput {
	const text = stdout.trim();
	if (!text) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return {};
	}
	if (!parsed || typeof parsed !== "object") return {};
	const out: StopHookOutput = {};
	const spec = "hookSpecificOutput" in parsed ? parsed.hookSpecificOutput : undefined;
	if (spec && typeof spec === "object" && "additionalContext" in spec && typeof spec.additionalContext === "string" && spec.additionalContext.trim()) out.context = spec.additionalContext;
	if ("decision" in parsed && parsed.decision === "block") {
		out.block = true;
		out.reason = "reason" in parsed && typeof parsed.reason === "string" && parsed.reason.trim() ? parsed.reason : "blocked by an atlas Stop hook";
	}
	return out;
}

/** Claude lifecycle payload for the session-end family (Stop, SessionEnd, SubagentStop, PreCompact). */
export function claudeLifecyclePayload(
	event: ClaudeEvent,
	fields: { sessionId: string; cwd: string; transcriptPath?: string; stopHookActive?: boolean },
): Record<string, unknown> {
	const payload: Record<string, unknown> = {
		hook_event_name: event,
		session_id: fields.sessionId,
		cwd: fields.cwd,
		transcript_path: fields.transcriptPath ?? "",
	};
	if (event === "Stop") payload.stop_hook_active = fields.stopHookActive === true;
	return payload;
}

/** Built-in connectorWatch list: the fail-open fallback when contracts/mcp-servers.json is unreadable. */
const CONNECTOR_SERVERS_FALLBACK: readonly string[] = ["plugin_atlas", "falcon-mcp", "connectwise", "gcloud", "plaid", "cipp"];

/** `connectorWatch` from the MCP server contract; the built-in list when the file is unreadable or malformed. */
export function loadConnectorServers(path: string = MCP_SERVERS, fallback: readonly string[] = CONNECTOR_SERVERS_FALLBACK): readonly string[] {
	try {
		const doc = readJson(path);
		const list = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.connectorWatch : undefined;
		if (Array.isArray(list) && list.length > 0 && list.every((s): s is string => typeof s === "string" && s.length > 0)) return list;
	} catch {
		// fail open: keep the built-in list
	}
	return fallback;
}

/**
 * MCP servers hooks.json's connector matcher names (`mcp__plugin_atlas_.*|mcp__falcon-mcp__.*|
 * mcp__cipp.*|mcp__connectwise.*|mcp__plaid__.*|mcp__gcloud__.*`). omp mints
 * `mcp__<server>_<tool>` with ONE underscore, so the server/tool boundary is lost;
 * this table (longest prefix first) recovers it for the servers hooks.json cares about.
 * Read from contracts/mcp-servers.json `connectorWatch`.
 */
export const CONNECTOR_SERVERS: readonly string[] = loadConnectorServers();

/**
 * The Claude-style `mcp__<server>__<tool>` name for an omp-minted MCP tool name of
 * a known connector server (also accepts the `xd://mcp__<server>_<tool>` device
 * path form); any other name is returned unchanged.
 */
export function claudeMcpName(name: string): string {
	const bare = name.startsWith("xd://") ? name.slice("xd://".length) : name;
	if (!bare.startsWith("mcp__")) return name;
	const rest = bare.slice("mcp__".length);
	for (const server of CONNECTOR_SERVERS) {
		if (rest.startsWith(`${server}_`) && rest.length > server.length + 1) return `mcp__${server}__${rest.slice(server.length + 1)}`;
	}
	return name;
}

/** Built-in underscoredServers list: the fail-open fallback when contracts/mcp-servers.json is unreadable (twin of omp_transcript._KNOWN_MCP_SERVERS_FALLBACK). */
const UNDERSCORED_SERVERS_FALLBACK: readonly string[] = [
	"lean_ctx", "context_mode_context_mode", "context_mode", "claude_mem", "browser_use", "azure", "serena", "context7", "microsoft_docs", "plaid", "mobbin", "clippy",
	"atlas_connectwise", "mcp_search", "cmux_browser",
];

/** `underscoredServers` from the MCP server contract, longest first; the built-in list when the file is unreadable or malformed. */
export function loadUnderscoredServers(path: string = MCP_SERVERS, fallback: readonly string[] = UNDERSCORED_SERVERS_FALLBACK): readonly string[] {
	let list: readonly string[] = fallback;
	try {
		const doc = readJson(path);
		const found = doc && typeof doc === "object" && !Array.isArray(doc) ? doc.underscoredServers : undefined;
		if (Array.isArray(found) && found.length > 0 && found.every((s): s is string => typeof s === "string" && s.length > 0)) list = found;
	} catch {
		// fail open: keep the built-in list
	}
	return [...list].sort((a, b) => b.length - a.length);
}

const UNDERSCORED_SERVERS: readonly string[] = loadUnderscoredServers();

/**
 * `xd://mcp__<server>_<tool>` → `mcp__<server>__<tool>`, the same split scripts/omp_transcript.py `_split_mcp_xd` makes,
 * so the live hooks and the converted transcript name one device the same way: a listed server prefix (longest wins),
 * else the doubled token omp mints for a tool that repeats its server (`atlas_falcon` + `falcon_status`).
 * Undefined when the shape is not recognisable.
 */
export function splitMcpDevice(path: string): string | undefined {
	const m = /^xd:\/\/mcp__([A-Za-z0-9_]+)$/.exec(path);
	if (!m) return undefined;
	const rest = m[1];
	for (const server of UNDERSCORED_SERVERS) {
		if (rest.startsWith(`${server}_`) && rest.length > server.length + 1) return `mcp__${server}__${rest.slice(server.length + 1)}`;
	}
	const tokens = rest.split("_");
	for (let i = 0; i < tokens.length - 1; i++) {
		if (tokens[i] && tokens[i] === tokens[i + 1]) {
			const tool = tokens.slice(i + 2).join("_");
			return tool ? `mcp__${tokens.slice(0, i + 1).join("_")}__${tool}` : undefined;
		}
	}
	return undefined;
}

/**
 * Claude name for one MCP device/tool `mcp__<server>_<tool>`: the split name (contract server list, doubled token),
 * else `mcp__<rest>` unchanged (fail closed: never a file Write).
 */
function mcpClaudeName(bare: string): string {
	return splitMcpDevice(`xd://${bare}`) ?? claudeMcpName(bare); // claudeMcpName only on an UNSPLIT name: re-splitting `mcp__plaid__x` gave `mcp__plaid___x`
}

/**
 * Names a hooks.json matcher is tested against. omp mints atlas connectors as `mcp__atlas_<srv>_<tool>` (split:
 * `mcp__atlas_<srv>__<tool>`); Claude Code names them `mcp__plugin_atlas_<srv>__<tool>`, which is what the
 * connector_credential_watch matcher (`mcp__plugin_atlas_.*`) names. Without the alias that watcher never fires on omp.
 */
export function matcherNames(names: string[]): string[] {
	return names.flatMap(n => (n.startsWith("mcp__atlas_") ? [n, n.replace("mcp__atlas_", "mcp__plugin_atlas_")] : [n]));
}

/**
 * The Claude tool names for one omp call. An omp `write` whose `path` is an `xd://mcp__…` URI is an MCP device CALL, not a
 * file edit, so it is that MCP tool, whatever its name shape (the production-edit deny and the Edit/Write matchers must
 * not see it: an unrecognised device is still `mcp__<rest>`, never a file Write); every other call maps by tool name.
 */
export function claudeNamesForCall(tool: string, input: unknown, namesPath?: string): string[] {
	if (tool === "write" && input && typeof input === "object" && "path" in input && typeof input.path === "string" && input.path.startsWith("xd://mcp__")) {
		return [mcpClaudeName(input.path.slice("xd://".length))];
	}
	if (/^mcp__[A-Za-z0-9_]+$/.test(tool) && !tool.slice("mcp__".length).includes("__")) return [mcpClaudeName(tool)];
	return claudeNamesFor(tool, namesPath).map(claudeMcpName);
}

/** The omp `task` tool's dispatch items: `tasks[]` entries, else the single top-level dispatch. */
export function taskItems(input: unknown): Record<string, unknown>[] {
	if (!input || typeof input !== "object") return [];
	const tasks = (input as Record<string, unknown>).tasks;
	if (Array.isArray(tasks)) return tasks.filter((t): t is Record<string, unknown> => t !== null && typeof t === "object" && !Array.isArray(t));
	return [input as Record<string, unknown>];
}

/**
 * One omp task item as a Claude `Task` tool_input, which is what dispatch_tripwire's
 * spec guards read. Atlas colony agents become `atlas:<agent>` (the guards only
 * police atlas:* dispatches); `task` becomes `prompt`, `name` becomes `description`,
 * and omp's `isolated: true` becomes Claude's `isolation: "worktree"`.
 */
export function claudeTaskInput(item: Record<string, unknown>): Record<string, unknown> {
	const agent = typeof item.agent === "string" ? item.agent.trim() : "";
	const mapped: Record<string, unknown> = {
		...item,
		subagent_type: agent && ATLAS_AGENT_TARGETABLE[agent] ? `atlas:${agent}` : agent,
		prompt: typeof item.task === "string" ? item.task : "",
	};
	if (typeof item.name === "string" && item.name.trim()) mapped.description = item.name;
	if (item.isolated === true) mapped.isolation = "worktree";
	return mapped;
}

/**
 * Every dispatch in an omp `task` call as a Claude `Task` input. omp gives each child the batch-level `context` AND its
 * own `task` (and its prompt tells the lead to put the shared `# Goal`/contract in `context`, never per task), so the
 * dispatch_tripwire guards, which read `prompt`, must see the same text the child sees: `context`, then `task`.
 * A blank or non-string `context` adds nothing; the single-dispatch form has none.
 */
export function claudeTaskInputs(input: unknown): Record<string, unknown>[] {
	const context = input && typeof input === "object" && "context" in input && typeof input.context === "string" ? input.context.trim() : "";
	return taskItems(input).map(item => {
		const mapped = claudeTaskInput(item);
		const task = typeof mapped.prompt === "string" ? mapped.prompt : "";
		mapped.prompt = context && task ? `${context}\n\n${task}` : context || task;
		return mapped;
	});
}

/** PostToolUse `tool_response`: string content as-is, anything else JSON-stringified; absent → "". */
export function toolResponseText(content: unknown): string {
	if (typeof content === "string") return content;
	if (content === undefined || content === null) return "";
	try {
		return JSON.stringify(content) ?? "";
	} catch {
		return "";
	}
}

/** Hard per-hook cap in ms: min(the hooks.json timeout, ATLAS_BRIDGE_HOOK_TIMEOUT_S or the 25 s default). */
export function hookTimeoutMs(configuredMs: number, env: Record<string, string | undefined> = process.env): number {
	const requested = Number(env.ATLAS_BRIDGE_HOOK_TIMEOUT_S);
	const capS = env.ATLAS_BRIDGE_HOOK_TIMEOUT_S && Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_HOOK_CAP_S;
	return Math.min(configuredMs, capS * 1000);
}

export type HookRunner = (command: string, payload: Record<string, unknown>, timeoutMs: number) => Promise<string>;

/**
 * Env layered over process.env for every bridged hook.
 * ATLAS_NATIVE_POLICY=off: omp/index.ts already denies/nudges native Read/Grep/Glob/Bash, so the tripwire must not
 * repeat that text; it still runs the inline-op threshold tiers. ATLAS_TOOLKIT_LOAD=omp: omp has no ToolSearch, so the
 * tripwire waives only that load step of the atlas-dispatch TOOLS requirement. Only dispatch_tripwire.py reads either.
 * ATLAS_ENGINE_ARM=off for an atlas_mux worker (ATLAS_WORKER_NAME, pinned by atlas_mux and nothing else): the worker is a
 * standalone `omp -p` that omp reports as a main session, and prompt_optimizer.py arms a session as an orchestrator from
 * its prompt text alone. A worker's task prompt reads as engineering work, so it was armed and the tripwire then denied
 * every edit it was spawned to make. A lead (no marker) is armed exactly as before.
 */
export function hookEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
	const base: Record<string, string> = { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ATLAS_HARNESS: "omp", ATLAS_MANDATES: "off", ATLAS_NATIVE_POLICY: "off", ATLAS_TOOLKIT_LOAD: "omp" };
	if ((env.ATLAS_WORKER_NAME ?? "").trim() !== "") base.ATLAS_ENGINE_ARM = "off";
	return base;
}

/**
 * Real runner: /bin/sh -c <command>, payload on stdin, stdout captured; any
 * failure → "". Transport (temp files, own process group, timeout kill) lives
 * in ./proc.
 */
export const runHook: HookRunner = async (command, payload, timeoutMs) => {
	try {
		const { stdout } = await runCapture(["/bin/sh", "-c", command], { input: JSON.stringify(payload), timeoutMs, env: hookEnv() });
		return stdout;
	} catch {
		return "";
	}
};

/**
 * Claude-shaped tool_input(s): omp `path` becomes an absolute `file_path` too. omp's multi-file hashline `edit`
 * (`{paths}`) and `ast_edit` (`{paths}`) name several targets; hooks read ONE `file_path`, so each path gets its own
 * payload (the production-edit deny, the formatter and the drift watch must see every file, not the first).
 */
function claudeToolInputs(input: unknown, cwd: string): Record<string, unknown>[] {
	const base: Record<string, unknown> = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {};
	const listed = Array.isArray(base.paths) ? base.paths.filter((p): p is string => typeof p === "string") : [];
	const targets = typeof base.path === "string" ? [base.path] : listed;
	const withFile = (target: string | undefined): Record<string, unknown> => {
		const one = { ...base };
		if (target !== undefined && one.file_path === undefined) {
			if (typeof one.path !== "string") one.path = target;
			if (!target.includes("://")) one.file_path = resolveTarget(cwd, target);
		}
		return one;
	};
	return targets.length > 1 ? targets.map(withFile) : [withFile(targets[0])];
}

/** Resolves to `promise`'s value, or undefined once `ms` has passed (a rejection also yields undefined). The loser keeps running; callers bound it with their own timeout. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
	const expired = Promise.withResolvers<undefined>();
	const timer = setTimeout(expired.resolve, Math.max(0, ms));
	try {
		return await Promise.race([promise.catch(() => undefined), expired.promise]);
	} finally {
		clearTimeout(timer);
	}
}

const FAULT_LOG_MAX_BYTES = 1 << 20;

/**
 * One row in `<ATLAS_HOME or ~/.atlas>/hook-faults.jsonl`, the same file and row shape scripts/atlas_faults.py writes,
 * so the doctor sees bridge fail-opens beside python hook crashes. Best effort, never throws.
 * ponytail: skipped once the file passes 1 MiB (atlas_faults.py owns truncation), so a flood cannot grow it.
 */
export function recordFault(hook: string, error: string, type: string, cwd: string | undefined): void {
	try {
		const file = nodePath.join(process.env.ATLAS_HOME || nodePath.join(os.homedir(), ".atlas"), "hook-faults.jsonl");
		fs.mkdirSync(nodePath.dirname(file), { recursive: true });
		if (fs.existsSync(file) && fs.statSync(file).size > FAULT_LOG_MAX_BYTES) return;
		fs.appendFileSync(file, `${JSON.stringify({ ts: Date.now() / 1000, hook, error: error.slice(0, 500), type, cwd: cwd ?? process.cwd() })}\n`);
	} catch {
		// the fault log must never be the thing that fails
	}
}

/** One executed hook: its script name and parsed output. */
interface HookRun {
	script: string;
	out: HookOutput;
}

const TRIPWIRE_SCRIPT = "dispatch_tripwire.py";
const scriptOf = (command: string): string => /([\w.-]+\.py)/.exec(command)?.[1] ?? "";
const tripwireRan = (runs: HookRun[]): boolean => runs.some(r => r.script === TRIPWIRE_SCRIPT);

/** The slice of an omp extension context the bridge reads. */
export interface BridgeCtx {
	cwd: string;
	agent?: { kind?: string };
	sessionManager?: { getSessionId?: () => unknown; getSessionFile?: () => unknown };
	/** The parent's live model; absent in tests and when omp has none selected. */
	model?: { provider?: unknown; id?: unknown };
}

/**
 * The parent's live model as `provider/id`, or "" when the context carries none. dispatch_tripwire.py reads it as
 * `session_model` to tell the parent selector omp injects for a model-less dispatch (inherited) from a real override.
 */
function sessionModelOf(ctx: BridgeCtx): string {
	const { provider, id } = ctx.model ?? {};
	return typeof provider === "string" && typeof id === "string" && provider !== "" && id !== "" ? `${provider}/${id}` : "";
}

/** One tool event handed to a run-state sink after the bridged hooks allowed it. */
export interface ToolEventInfo {
	/** omp tool name (`task`, `edit`, ...). */
	toolName: string;
	/** The omp tool input, unmapped. */
	input: unknown;
	cwd: string;
	sessionId: string;
	/** True when the bridged dispatch_tripwire.py ran for this event (it logs and arms itself). */
	tripwireRan: boolean;
	isError: boolean;
}

/** Best-effort sink call: a throwing sink must never affect the tool call. */
function notifySink(sink: ((info: ToolEventInfo) => void) | undefined, info: ToolEventInfo): void {
	try {
		sink?.(info);
	} catch {
		// fail open: run-state telemetry never blocks a tool call
	}
}

/**
 * The context's transcript path, or "" when there is no provider or it throws or rejects.
 * Degrading here (rather than letting the handler fail open) keeps the bridged deny tiers
 * armed: dispatch_tripwire reads "" as a main session, which is correct for the lead.
 */
async function transcriptPathOf(deps: BridgeDeps, ctx: BridgeCtx): Promise<string> {
	try {
		return (await deps.transcriptPath?.(ctx)) ?? "";
	} catch {
		return "";
	}
}

export interface BridgeDeps {
	hooks?: BridgedHook[];
	run?: HookRunner;
	namesPath?: string;
	env?: Record<string, string | undefined>;
	/** Claude-shaped transcript path for this context's tool-hook payloads (subagents need a `/subagents/` path). */
	transcriptPath?(ctx: BridgeCtx): string | undefined | Promise<string | undefined>;
	/** A tool_call the bridged hooks allowed (run-state arm). */
	onToolAllowed?(info: ToolEventInfo): void;
	/** A successful tool_result (run-state event rows). */
	onToolResult?(info: ToolEventInfo): void;
	/** Whole-call hook budget in ms for tool_call / tool_result; default TOOL_CALL_BUDGET_MS. Tests shrink it. */
	budgetMs?: number;
}

export function registerHookBridge(pi: Pick<ExtensionAPI, "on">, deps: BridgeDeps = {}): void {
	let hooks: BridgedHook[] | undefined = deps.hooks;
	const all = () => (hooks ??= loadBridgedHooks());
	const run = deps.run ?? runHook;
	const off = () => (deps.env ?? process.env).ATLAS_HOOK_BRIDGE === "off";
	let sessionContext: Promise<string> | undefined;
	const reset = () => {
		sessionContext = undefined;
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);

	/**
	 * Runs the matching hooks CONCURRENTLY (Claude Code runs a matcher group's hooks in parallel too), each with
	 * min(its capped timeout, what is left before the shared `deadline`); results keep hooks.json order, so the
	 * first deny in that order wins. dispatch_tripwire.py runs for every matched tool, including Read/Grep/Glob/Bash:
	 * its inline-op threshold deny lives in PreToolUse and counts exactly those tools, so skipping it removed the
	 * deny tier. The native-tool deny/nudge text index.ts already produces is suppressed at the source instead, by
	 * ATLAS_NATIVE_POLICY=off in runHook, so one native-tool message reaches the model, not two.
	 * A hook that outlives its slot is abandoned even if the runner ignores its timeout, and every skip or abandon
	 * leaves a hook-faults.jsonl row: fail open, never silently.
	 */
	const runAllRuns = async (event: ClaudeEvent, toolNames: string[] | undefined, payload: Record<string, unknown>, deadline: number = Date.now() + HANDLER_BUDGET_MS): Promise<HookRun[]> => {
		const matchNames = toolNames && matcherNames(toolNames);
		const selected = all().filter(h => h.event === event && (!h.matcher || !matchNames || matchNames.some(n => h.matcher?.test(n))));
		const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
		const runOne = async (hook: BridgedHook): Promise<HookRun | undefined> => {
			const script = scriptOf(hook.command);
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				recordFault(script || hook.command, `${event} skipped: bridge budget exhausted`, "BridgeBudget", cwd);
				return undefined; // out of budget: fail open
			}
			const timeoutMs = Math.min(hookTimeoutMs(hook.timeoutMs, deps.env ?? process.env), remaining);
			const started = Date.now();
			const stdout = await withDeadline(run(hook.command, payload, timeoutMs), timeoutMs + HOOK_KILL_GRACE_MS);
			if (stdout === undefined || Date.now() - started >= timeoutMs) recordFault(script || hook.command, `${event} hook hit its ${timeoutMs} ms slot`, "BridgeTimeout", cwd);
			return { script, out: parseHookOutput(stdout ?? "") };
		};
		return (await Promise.all(selected.map(runOne))).filter((r): r is HookRun => r !== undefined);
	};
	const runAll = async (event: ClaudeEvent, toolNames: string[] | undefined, payload: Record<string, unknown>, deadline?: number): Promise<HookOutput[]> =>
		(await runAllRuns(event, toolNames, payload, deadline)).map(r => r.out);
	const join = (outs: HookOutput[]) => outs.map(o => o.context).filter((c): c is string => Boolean(c)).join("\n\n");
	const sessionIdOf = (ctx: { sessionManager?: { getSessionId?: () => unknown } }) => {
		try {
			const id = ctx.sessionManager?.getSessionId?.();
			return typeof id === "string" ? id : "";
		} catch {
			return "";
		}
	};
	const toolBudgetMs = () => deps.budgetMs ?? TOOL_CALL_BUDGET_MS;

	pi.on("before_agent_start", async (event, ctx) => {
		try {
			if (ctx.agent.kind !== "main" || off()) return undefined;
			const base = Array.isArray(event.systemPrompt) ? event.systemPrompt : [];
			const common = { session_id: sessionIdOf(ctx), cwd: ctx.cwd };
			const deadline = Date.now() + HANDLER_BUDGET_MS;
			sessionContext ??= runAll("SessionStart", undefined, { ...common, hook_event_name: "SessionStart", source: "startup" }, deadline).then(join);
			const startText = await sessionContext;
			const promptText = join(await runAll("UserPromptSubmit", undefined, { ...common, hook_event_name: "UserPromptSubmit", prompt: event.prompt ?? "" }, deadline));
			const additions: string[] = [];
			if (startText && !base.some(e => typeof e === "string" && e.includes(SESSION_MARKER))) additions.push(`${SESSION_MARKER}\n${startText}`);
			if (promptText) additions.push(promptText);
			return additions.length ? { systemPrompt: [...base, ...additions] } : undefined;
		} catch {
			return undefined; // fail open
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		try {
			if (off()) return undefined;
			// ONE budget for the whole call (hooks of every batch item and the transcript lookup): omp blocks the
			// call when its handler passes its own 30 s tool_call timeout, so the bridge must give up first.
			const deadline = Date.now() + toolBudgetMs();
			const tool = event.toolName ?? "";
			// omp mints `mcp__<server>_<tool>` and a `write` to an xd:// device is an MCP call; hooks.json matchers expect Claude's names.
			const names = claudeNamesForCall(tool, event.input, deps.namesPath);
			const cwd = ctx.cwd;
			const sessionId = sessionIdOf(ctx);
			const transcriptPath = (await withDeadline(transcriptPathOf(deps, ctx as BridgeCtx), Math.max(0, deadline - Date.now()))) ?? "";
			// omp `task` carries a batch; each item is one Claude Task dispatch and any deny blocks the batch.
			const inputs = names[0] === "Task" ? claudeTaskInputs(event.input) : claudeToolInputs(event.input, cwd);
			const runs: HookRun[] = [];
			for (const toolInput of inputs.length ? inputs : [{}]) {
				const sessionModel = sessionModelOf(ctx as BridgeCtx);
				const batch = await runAllRuns("PreToolUse", names, {
					hook_event_name: "PreToolUse",
					session_id: sessionId,
					cwd,
					tool_name: names[0],
					tool_input: toolInput,
					transcript_path: transcriptPath,
					...(sessionModel ? { session_model: sessionModel } : {}),
				}, deadline);
				const deny = batch.find(r => r.out.deny)?.out.deny;
				if (deny) return { block: true, reason: deny };
				runs.push(...batch);
			}
			notifySink(deps.onToolAllowed, { toolName: tool, input: event.input, cwd, sessionId, tripwireRan: tripwireRan(runs), isError: false });
			const context = join(runs.map(r => r.out));
			return context ? { additionalContext: context } : undefined;
		} catch (error) {
			recordFault("hook-bridge", String(error), "BridgeError", undefined);
			return undefined;
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		try {
			if (off() || event.isError) return undefined;
			const deadline = Date.now() + toolBudgetMs();
			const tool = event.toolName ?? "";
			// omp mints `mcp__<server>_<tool>` and a `write` to an xd:// device is an MCP call; hooks.json matchers expect Claude's names.
			const names = claudeNamesForCall(tool, event.input, deps.namesPath);
			const cwd = ctx.cwd;
			const sessionId = sessionIdOf(ctx);
			const transcriptPath = (await withDeadline(transcriptPathOf(deps, ctx as BridgeCtx), Math.max(0, deadline - Date.now()))) ?? "";
			const toolResponse = toolResponseText(event.content);
			const inputs = names[0] === "Task" ? claudeTaskInputs(event.input) : claudeToolInputs(event.input, cwd);
			const runs: HookRun[] = [];
			for (const toolInput of inputs.length ? inputs : [{}]) {
				runs.push(
					...(await runAllRuns("PostToolUse", names, {
						hook_event_name: "PostToolUse",
						session_id: sessionId,
						cwd,
						tool_name: names[0],
						tool_input: toolInput,
						tool_response: toolResponse,
						is_error: false,
						transcript_path: transcriptPath,
						// omp subagents carry no env: their agent id lets worker_inbox.py resolve the channel member
						...(ctx.agent?.kind === "sub" && (ctx.agent as { id?: string }).id ? { agent_name: (ctx.agent as { id?: string }).id } : {}),
					}, deadline)),
				);
			}
			notifySink(deps.onToolResult, { toolName: tool, input: event.input, cwd, sessionId, tripwireRan: tripwireRan(runs), isError: false });
			const context = join(runs.map(r => r.out));
			return context ? { additionalContext: context } : undefined;
		} catch (error) {
			recordFault("hook-bridge", String(error), "BridgeError", undefined);
			return undefined;
		}
	});
}
