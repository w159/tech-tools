/**
 * Atlas enforcement extension for omp (oh-my-pi).
 *
 * Enforces two atlas rules that nothing else enforces in omp:
 *
 * 1. Native-tool tripwire — in a docs/ project, `grep` / `glob` are BLOCKED
 *    only when a lean-ctx replacement is actually callable in THIS session,
 *    decided per call: a bare `ctx_search` / `ctx_glob` tool being named when
 *    the session exposes one directly, otherwise the connected lean-ctx MCP
 *    device named as `xd://mcp__lean_ctx_ctx_search` / `…_ctx_glob`. When
 *    neither is reachable the call is allowed with a one-time nudge saying
 *    lean-ctx is not reachable here — the lean-ctx binary on PATH alone no
 *    longer arms the deny. `read` / `bash` receive a one-time per-tool
 *    additionalContext nudge that names the actually-reachable replacement
 *    (or stays silent when nothing is reachable). Applies in subagents too.
 * 2. Delegation-at-Stop — if the main thread edited/wrote non-docs files but
 *    never dispatched a subagent (`task` tool), the session is blocked ONCE at
 *    session_stop with the fix.
 * 3. Task naming — a main-thread `task` dispatch naming atlas subagents while
 *    some targeted item omits `name` gets a one-time additionalContext hint:
 *    named items double as sibling addresses (`write agent://<name>`).
 *
 * Kill switches: ATLAS_GATE=off disables the delegation check; ATLAS_TRIPWIRE_HARD=off
 * disables the whole native-tool tripwire (grep/glob deny and its unreachable
 * nudge), while read/bash preference nudges remain. All handlers fail open: any
 * internal error returns undefined (omp's tool_call dispatch is fail-closed,
 * so an uncaught throw here would strand the agent).
 *
 * Discovery: loaded via the atlas plugin package manifest (`omp.extensions`)
 * or an explicit `extensions:` path in ~/.omp/agent/config.yml — see README.md.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { statSync } from "node:fs";
import * as nodePath from "node:path";
import { ATLAS_AGENT_TARGETABLE } from "./atlas-agents";

/** Absolute atlas plugin root: the directory containing scripts/atlas_todo.py. */
const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");

/** The durable todo board CLI, shipped alongside this module. */
const TODO_SCRIPT = nodePath.join(PLUGIN_ROOT, "scripts", "atlas_todo.py");

/** The only item statuses the atlas board vocabulary accepts. */
const BOARD_STATUSES: Record<string, true> = { pending: true, in_progress: true, completed: true };

/**
 * Point `CLAUDE_PLUGIN_ROOT` at the atlas plugin root when it is unset, so omp
 * workers can run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" ...`.
 * omp substitutes that placeholder only during Claude-plugin discovery, so it
 * is unset for omp-native agents; the value comes from this module's own
 * location and is only written when the board CLI actually exists there. A
 * non-empty pre-existing value is never overwritten.
 */
export function ensureClaudePluginRoot(
	env: Record<string, string | undefined> = process.env,
	scriptPath: string = TODO_SCRIPT,
): boolean {
	const current = env.CLAUDE_PLUGIN_ROOT;
	if (typeof current === "string" && current.trim() !== "") return true;
	try {
		if (statSync(scriptPath).isFile()) {
			env.CLAUDE_PLUGIN_ROOT = PLUGIN_ROOT;
			return true;
		}
	} catch {
		return false; // fail open: the CLI path stays unresolved, nothing crashes
	}
	return false;
}

/**
 * Flatten the omp `todo` tool's phase-shaped result details into atlas board
 * items. `details.phases` is the full current plan ({ name, tasks:
 * [{content, status}] }) after every state-changing op, so the board mirror is
 * a whole-plan replacement, exactly like a TodoWrite mirror. Statuses outside
 * the board vocabulary (blocked, abandoned) normalize to pending.
 */
export function boardItemsFromTodoDetails(details: unknown): { content: string; status: string }[] {
	if (!details || typeof details !== "object" || !Array.isArray((details as Record<string, unknown>).phases)) return [];
	const items: { content: string; status: string }[] = [];
	for (const phase of (details as Record<string, unknown>).phases) {
		if (!phase || typeof phase !== "object" || !Array.isArray((phase as Record<string, unknown>).tasks)) continue;
		for (const task of (phase as Record<string, unknown>).tasks) {
			const content = (task as Record<string, unknown> | null)?.content;
			if (typeof content !== "string" || content.trim() === "") continue;
			const rawStatus = (task as Record<string, unknown>).status;
			items.push({
				content: content.trim(),
				status: typeof rawStatus === "string" && BOARD_STATUSES[rawStatus] ? rawStatus : "pending",
			});
		}
	}
	return items;
}

/** Session id for board attribution; absent or blank ids are skipped (fail open). */
function sessionIdOf(ctx: { sessionManager?: { getSessionId?: () => unknown } }): string | undefined {
	const id = ctx.sessionManager?.getSessionId?.();
	return typeof id === "string" && id.trim() !== "" ? id : undefined;
}

/**
 * CLI for `atlas_todo.py set`, which mirrors a JSON array of {content,status}
 * into the board for one session. Passing the list as a single argv element
 * avoids any shell interpolation.
 */
export function boardMirrorArgv(
	items: { content: string; status: string }[],
	sessionId: string | undefined,
	root: string,
): string[] {
	const argv = ["python3", TODO_SCRIPT, "set", "--root", root];
	if (sessionId) argv.push("--session", sessionId);
	argv.push(JSON.stringify(items));
	return argv;
}

/** Kinds of native tool calls the tripwire redirects to a lean-ctx replacement. */
export type LeanKind = "search" | "glob" | "read" | "shell";

/**
 * A lean-ctx replacement actually callable in the session right now: either a
 * first-class tool to call directly, or an xd:// device route to write JSON
 * args to.
 */
export type LeanReplacement = { via: "tool"; name: string } | { via: "device"; device: string };

const LEAN_CTX_SERVER = /lean[-_]?ctx/i;
const CONTEXT_MODE_SERVER = /context[-_]?mode/i;

/** Plain tool-name candidates per kind, in preference order. */
const BUILTIN_CANDIDATES: Record<LeanKind, string[]> = {
	search: ["ctx_search"],
	glob: ["ctx_glob"],
	read: ["ctx_read"],
	shell: ["ctx_shell", "ctx_execute"],
};

/** MCP device-name candidates per kind (server provenance + tool name). */
const DEVICE_CANDIDATES: Record<LeanKind, Array<{ server: RegExp; tool: string }>> = {
	search: [{ server: LEAN_CTX_SERVER, tool: "ctx_search" }],
	glob: [{ server: LEAN_CTX_SERVER, tool: "ctx_glob" }],
	read: [{ server: LEAN_CTX_SERVER, tool: "ctx_read" }],
	shell: [
		{ server: LEAN_CTX_SERVER, tool: "ctx_shell" },
		{ server: LEAN_CTX_SERVER, tool: "ctx_execute" },
		{ server: CONTEXT_MODE_SERVER, tool: "ctx_execute" },
	],
};

/**
 * The xd:// device route for one MCP tool. omp mints MCP tool names as
 * `mcp__<sanitized server>_<tool>` and presents connected MCP tools as `xd://`
 * devices; the route is live exactly when the minted name is in the session's
 * enabled set (session-tools: every connected MCP tool is enabled; loadMode
 * only decides top-level vs device presentation). Matching is by tool-name
 * suffix plus server-name shape, so mint collisions/caps and server spellings
 * (`lean-ctx`, `lean_ctx`) both resolve.
 */
function deviceRoute(active: string[], serverName: RegExp, mcpToolName: string): string | undefined {
	for (const name of active) {
		if (!name.startsWith("mcp__")) continue;
		const rest = name.slice("mcp__".length);
		if (!rest.toLowerCase().endsWith(`_${mcpToolName.toLowerCase()}`)) continue;
		const server = rest.slice(0, rest.length - mcpToolName.length - 1);
		if (serverName.test(server)) return `xd://${name}`;
	}
	return undefined;
}

/**
 * Resolve the lean-ctx replacement for one kind from the session's currently
 * enabled tool names: a bare builtin/custom `ctx_*` tool first (callable
 * directly), otherwise the connected lean-ctx MCP device route
 * (`xd://mcp__lean_ctx_ctx_search`; context-mode's execute device is accepted
 * as a shell surrogate). `undefined` means nothing is reachable in this
 * session and the caller must allow the native tool (fail open).
 */
export function resolveLeanReplacement(kind: LeanKind, active: string[] | undefined): LeanReplacement | undefined {
	if (!Array.isArray(active)) return undefined;
	for (const name of BUILTIN_CANDIDATES[kind]) {
		if (active.includes(name)) return { via: "tool", name };
	}
	// xd:// devices are invoked by writing to them, so without `write` the route is not callable.
	if (!active.includes("write")) return undefined;
	for (const { server, tool } of DEVICE_CANDIDATES[kind]) {
		const route = deviceRoute(active, server, tool);
		if (route) return { via: "device", device: route };
	}
	return undefined;
}

const REPLACEMENT_EXAMPLES: Record<"search" | "glob", { tool: string; example: string }> = {
	search: { tool: "ctx_search", example: '{"pattern": "...", "path": "..."}' },
	glob: { tool: "ctx_glob", example: '{"pattern": "**/*.ts"}' },
};

/** Deny text naming the replacement form the session can actually reach. */
function denyReason(tool: "grep" | "glob", replacement: LeanReplacement): string {
	const spec = REPLACEMENT_EXAMPLES[tool === "grep" ? "search" : "glob"];
	if (replacement.via === "tool") {
		return `Atlas enforcement: use the lean-ctx ${spec.tool} TOOL instead of ${tool} — call ${replacement.name} directly with JSON args (e.g. ${spec.example}).`;
	}
	return `Atlas enforcement: use lean-ctx ${spec.tool} instead of ${tool} — write JSON args to the device ${replacement.device} (e.g. ${spec.example}).`;
}

/** One-time nudge when grep/glob is allowed because nothing lean-ctx is reachable. */
const UNREACHABLE_NUDGE = (tool: "grep" | "glob") =>
	`Atlas nudge: lean-ctx is not reachable in this session, so native ${tool} stays allowed. The lean-ctx binary on PATH is not, by itself, a callable session tool; the deny arms only when a ctx_* replacement (tool or xd:// device) is live here.`;

/** Read nudge naming the replacement form the session can actually reach. */
function readNudge(replacement: LeanReplacement): string {
	const how =
		replacement.via === "tool"
			? `call the lean-ctx ${replacement.name} tool directly`
			: `write JSON args to ${replacement.device}`;
	return `Atlas nudge: for exploration, prefer lean-ctx ctx_read (${how}). Native Read is still fine immediately before an Edit.`;
}

/** Bash nudge naming the replacement form the session can actually reach. */
function bashNudge(replacement: LeanReplacement, active: string[]): string {
	const via =
		replacement.via === "tool"
			? `the lean-ctx ${replacement.name} tool`
			: `lean-ctx ctx_shell (write JSON args to ${replacement.device})`;
	const contextMode = deviceRoute(active, CONTEXT_MODE_SERVER, "ctx_execute");
	const alt = contextMode && contextMode !== replacement.device ? ` or context-mode ctx_execute (${contextMode})` : "";
	return `Atlas nudge: for anything producing output (~20+ lines, logs, data), prefer ${via}${alt}. Native Bash remains fine for mutations and short fixed output.`;
}

const STOP_MESSAGE = (n: number) =>
	`Atlas delegation gate: this session issued ${n} non-docs edit/write call(s) without dispatching a single subagent (task tool). The orchestrator must delegate code changes to subagents instead of writing them itself. Fix: dispatch the code change via the task tool (e.g. to an atlas:implementer subagent), then verify its result. Inline edits already made may stand; the delegation must still happen. (Set ATLAS_GATE=off to disable this check.)`;

/** True if the path is a non-docs code file: outside docs/ and .atlas/, not *.md, not an internal URI. */
export function isNonDocsPath(p: string): boolean {
	if (typeof p !== "string" || p.length === 0) return false;
	if (p.includes("://")) return false;
	const normalized = nodePath.normalize(p).replaceAll("\\", "/");
	if (normalized.endsWith(".md")) return false;
	for (const seg of normalized.split("/")) {
		if (seg === "docs" || seg === ".atlas") return false;
	}
	return true;
}

function inputPaths(input: Record<string, unknown>): string[] {
	const paths = Array.isArray(input.paths)
		? input.paths.filter((p): p is string => typeof p === "string")
		: [];
	if (typeof input.path === "string") paths.push(input.path);
	return paths;
}

/** Walk ancestors exactly as the completion gate's docs/ project scope does. */
function docsRoot(cwd: string): string | undefined {
	let root = nodePath.resolve(cwd);
	for (;;) {
		try {
			if (statSync(nodePath.join(root, "docs")).isDirectory()) return root;
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
		}
		const parent = nodePath.dirname(root);
		if (parent === root) return undefined;
		root = parent;
	}
}

const TASK_NAMING_HINT = (count: number, agents: string) =>
	`Atlas colony: ${count} task item(s) dispatched to ${agents} carry no name. omp auto-generates one, but unnamed workers cannot be addressed by their siblings. Give every atlas-bound item a stable \`name\` (unique, CamelCase, <= 32 chars) — it doubles as the worker's spawn handle and its address for sibling messaging: \`write agent://<name>\`. This notice fires once per session; unnamed dispatches still run.`;

/**
 * Atlas-targeted, unnamed task dispatches for one `task` tool_call input.
 * Handles both shapes: the batch `tasks[]` items and the single top-level
 * dispatch (`agent` + `task`). Items defaulting to the generic `task` agent
 * do not count as atlas-targeted.
 */
function taskNamingHint(input: Record<string, unknown>): { count: number; agents: string } | undefined {
	const items: Record<string, unknown>[] = Array.isArray(input.tasks)
		? (input.tasks.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object"))
		: [input];
	const unnamed = items.filter(item => {
		const agent = typeof item.agent === "string" ? item.agent.trim() : undefined;
		if (!agent || !ATLAS_AGENT_TARGETABLE[agent]) return false;
		return typeof item.name !== "string" || item.name.trim() === "";
	});
	if (unnamed.length === 0) return undefined;
	const agents = [...new Set(unnamed.map(item => item.agent as string))].sort().join(", ");
	return { count: unnamed.length, agents };
}

export interface ExtensionDeps {
	/**
	 * Names of the tools callable in the session RIGHT NOW — omp's enabled set
	 * (top-level names plus live `xd://` device mounts). Returning undefined
	 * means availability is unknown and every native call fails open (allowed).
	 * Evaluated per call: tool surfaces change mid-session (MCP connect, code
	 * mode partitions, restricted subagent sets).
	 */
	activeTools(): string[] | undefined;
	/**
	 * Fire-and-forget spawn of the board mirror CLI. The real binding detaches
	 * the child (unref) so the session never waits for python startup; tests
	 * inject a recording or synchronous runner instead.
	 */
	spawnBoardMirror(argv: string[], opts: { cwd: string }): void;
}

/** Per-call availability read; any internal failure means unknown (allow). */
function activeToolsOf(deps: ExtensionDeps): string[] | undefined {
	try {
		return deps.activeTools();
	} catch {
		return undefined;
	}
}

/**
 * Registers the enforcement handlers on the given extension API.
 * Exported for tests; the default export binds real dependencies.
 * All state lives in this closure, which omp rebinds per session
 * (module-level variables would be shared across subagent sessions).
 */
export function register(pi: Pick<ExtensionAPI, "on">, deps: ExtensionDeps): void {
	let nondocsEdits = 0;
	let taskCalls = 0;
	let namingNoticeGiven = false;
	const nudged = new Set<string>();
	let stopBlocked = false;
	const reset = () => {
		try {
			nondocsEdits = 0;
			taskCalls = 0;
			namingNoticeGiven = false;
			nudged.clear();
			stopBlocked = false;
		} catch { return undefined; }
	};
	pi.on("session_start", reset);
	pi.on("session_switch", reset);


	pi.on("tool_call", (event, ctx) => {
		try {
			const tool = (event.toolName ?? "").toLowerCase();
			const cwd = ctx.cwd;
			if (!docsRoot(cwd)) return undefined;
			const isSub = ctx.agent.kind === "sub";

			// 1) Native-tool tripwire: grep/glob -> the replacement reachable NOW,
			// checked per call (subagents included). Hard-off silences the whole
			// tripwire; otherwise deny when a replacement is live, else one-time
			// allow-nudge naming the unavailability.
			if (tool === "grep" || tool === "glob") {
				if (process.env.ATLAS_TRIPWIRE_HARD === "off") return undefined;
				const active = activeToolsOf(deps);
				if (!active) return undefined; // availability unknown: allow silently, never claim "unreachable"
				const replacement = resolveLeanReplacement(tool === "grep" ? "search" : "glob", active);
				if (replacement) return { block: true, reason: denyReason(tool, replacement) };
				if (!nudged.has(tool)) {
					nudged.add(tool);
					return { additionalContext: UNREACHABLE_NUDGE(tool) };
				}
				return undefined;
			}

			// 2) One-time per-tool nudges for read/bash, naming a reachable form;
			// silent when nothing lean-ctx/context-mode is reachable to prefer.
			if (tool === "read" || tool === "bash") {
				if (nudged.has(tool)) return undefined;
				const active = activeToolsOf(deps);
				const replacement = resolveLeanReplacement(tool === "read" ? "read" : "shell", active);
				if (!replacement) return undefined;
				nudged.add(tool);
				return { additionalContext: tool === "read" ? readNudge(replacement) : bashNudge(replacement, active ?? []) };
			}

			// 3) Delegation tracking — main thread only.
			if (!isSub) {
				if (tool === "edit" || tool === "write") {
					if (inputPaths(event.input).some(p => !p.includes("://") && isNonDocsPath(nodePath.resolve(cwd, p)))) nondocsEdits++;
				} else if (tool === "task") {
					taskCalls++;
					const hint = taskNamingHint(event.input);
					if (hint && !namingNoticeGiven) {
						namingNoticeGiven = true;
						return { additionalContext: TASK_NAMING_HINT(hint.count, hint.agents) };
					}
				}
			}
			return undefined;
		} catch {
			return undefined; // fail open — never strand the agent
		}
	});

	// 4) Board mirror: the omp lead's todo plan lands in .atlas/.run/todos.json
	// so workers can claim items. Main thread only; fails open, never blocks.
	pi.on("tool_result", (event, ctx) => {
		try {
			if (event.isError) return undefined;
			if ((event.toolName ?? "").toLowerCase() !== "todo") return undefined;
			if (ctx.agent.kind !== "main") return undefined;
			const root = docsRoot(ctx.cwd);
			if (!root) return undefined;
			const items = boardItemsFromTodoDetails(event.details);
			if (items.length === 0) return undefined;
			deps.spawnBoardMirror(boardMirrorArgv(items, sessionIdOf(ctx), root), { cwd: root });
			return undefined;
		} catch {
			return undefined; // fail open — mirroring never blocks the session
		}
	});

	pi.on("session_stop", (_event, ctx) => {
		try {
			if (stopBlocked || ctx.agent.kind === "sub" || !docsRoot(ctx.cwd)) return undefined;
			if (process.env.ATLAS_GATE === "off") return undefined;
			// session_stop never fires for task/subagent sessions, so reaching this
			// handler already implies the main thread.
			if (nondocsEdits > 0 && taskCalls === 0) {
				stopBlocked = true;
				return { decision: "block", reason: STOP_MESSAGE(nondocsEdits) };
			}
			return undefined;
		} catch {
			return undefined; // fail open
		}
	});
}

/** Session tool surfaces are per-session: omp rebinds the factory, so state and availability stay session-local. */
export default function atlasOmpExtension(pi: ExtensionAPI): void {
	ensureClaudePluginRoot();
	register(pi, {
		// getActiveTools() is omp's enabled set (top-level names plus live xd://
		// device mounts) — exactly the callable surface. getAllTools() provenance
		// is deliberately NOT consulted: it lists configured servers even when
		// their tools are inactive, which must not arm the deny. The lean-ctx
		// binary on PATH is likewise not a session tool and never consulted.
		activeTools: () => {
			try {
				return pi.getActiveTools();
			} catch {
				return undefined; // fail open — runtime not wired yet or API absent means allow
			}
		},
		spawnBoardMirror: (argv, opts) => {
			try {
				const child = Bun.spawn(argv, { cwd: opts.cwd, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
				child.unref();
			} catch {
				// fail open — the board stays stale, the session keeps running
			}
		},
	});
}
