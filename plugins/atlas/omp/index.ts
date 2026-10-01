/**
 * Atlas enforcement extension for omp (oh-my-pi).
 *
 * Enforces two atlas rules that nothing else enforces in omp:
 *
 * 1. Native-tool tripwire — `grep` / `glob` tool calls are BLOCKED (naming the
 *    lean-ctx replacement devices) when lean-ctx is available and the project
 *    has a docs/ directory. `read` / `bash` receive a one-time per-tool
 *    additionalContext nudge. Applies in subagents too.
 * 2. Delegation-at-Stop — if the main thread edited/wrote non-docs files but
 *    never dispatched a subagent (`task` tool), the session is blocked ONCE at
 *    session_stop with the fix.
 * 3. Task naming — a main-thread `task` dispatch naming atlas subagents while
 *    some targeted item omits `name` gets a one-time additionalContext hint:
 *    named items double as sibling addresses (`write agent://<name>`).
 *
 * Kill switches: ATLAS_GATE=off disables the delegation check; ATLAS_TRIPWIRE_HARD=off
 * disables the native-tool deny (nudges remain). All handlers fail open: any
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

const DENY_REASONS: Record<string, string> = {
	grep:
		"Atlas enforcement: use lean-ctx ctx_search instead of grep — write JSON args to the device xd://mcp__lean_ctx_ctx_search (e.g. {\"pattern\": \"...\", \"path\": \"...\"}).",
	glob:
		"Atlas enforcement: use lean-ctx ctx_glob instead of glob — write JSON args to the device xd://mcp__lean_ctx_ctx_glob (e.g. {\"pattern\": \"**/*.ts\"}).",
};

const NUDGES: Record<string, string> = {
	read:
		"Atlas nudge: for exploration, prefer lean-ctx ctx_read (write JSON args to xd://mcp__lean_ctx_ctx_read). Native Read is still fine immediately before an Edit.",
	bash:
		"Atlas nudge: for anything producing output (~20+ lines, logs, data), prefer lean-ctx ctx_shell (xd://mcp__lean_ctx_ctx_shell) / context-mode ctx_execute (xd://mcp__context_mode_context_mode_ctx_execute). Native Bash remains fine for mutations and short fixed output.",
};

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
	/** Whether lean-ctx is actually available in this runtime. */
	leanCtxAvailable(): boolean;
	/**
	 * Fire-and-forget spawn of the board mirror CLI. The real binding detaches
	 * the child (unref) so the session never waits for python startup; tests
	 * inject a recording or synchronous runner instead.
	 */
	spawnBoardMirror(argv: string[], opts: { cwd: string }): void;
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

			// 1) Native-tool deny: grep/glob -> lean-ctx devices (subagents included).
			if (tool === "grep" || tool === "glob") {
				if (
					deps.leanCtxAvailable() &&
					process.env.ATLAS_TRIPWIRE_HARD !== "off"
				) {
					return { block: true, reason: DENY_REASONS[tool] };
				}
				return undefined;
			}

			// 2) One-time per-tool nudges for read/bash.
			const nudge = NUDGES[tool];
			if (nudge) {
				if (!nudged.has(tool)) {
					nudged.add(tool);
					return { additionalContext: nudge };
				}
				return undefined;
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

/** MCP tool provenance includes configured servers even when tools are inactive. */
export default function atlasOmpExtension(pi: ExtensionAPI): void {
	ensureClaudePluginRoot();
	register(pi, {
		leanCtxAvailable: () => !!Bun.which("lean-ctx") || pi.getAllTools().some(tool =>
			/lean[-_]ctx/i.test(tool.mcpServerName ?? "")),
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
