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

export interface ExtensionDeps {
	/** Whether lean-ctx is actually available in this runtime. */
	leanCtxAvailable(): boolean;
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
	const nudged = new Set<string>();
	let stopBlocked = false;
	const reset = () => {
		try {
			nondocsEdits = 0;
			taskCalls = 0;
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
				}
			}
			return undefined;
		} catch {
			return undefined; // fail open — never strand the agent
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
	register(pi, {
		leanCtxAvailable: () => !!Bun.which("lean-ctx") || pi.getAllTools().some(tool =>
			/lean[-_]ctx/i.test(tool.mcpServerName ?? "")),
	});
}
