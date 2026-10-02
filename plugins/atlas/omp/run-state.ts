/**
 * Run-state bridge for omp: leaves the atlas observability DB the way Claude
 * Code's hooks would, by calling scripts/omp_runstate.py (which reuses
 * atlas_db / session_boot; no SQL lives here).
 *
 *   begin + snapshot  once per main session, from session_start: the runs row
 *                     and the dirty-tree baseline .atlas/.run/dirty-snapshot-<sid>.json.
 *                     The bridged session_boot.py already creates the row on the
 *                     first prompt; `begin` is create-if-absent, `snapshot`
 *                     rewrites the same file with the same content.
 *   arm               a `task` dispatch no hook denied: the orchestration flag
 *                     (dispatch_tripwire's _arm_orchestrating), with --worktree
 *                     when the dispatch is isolated.
 *   event             tool_result rows: the dispatch (`--tool Task --dispatch
 *                     <agent>`) and file edits/writes (`--tool Edit|Write --path`).
 *
 * arm/event are a FALLBACK for when the bridged dispatch_tripwire.py did not run
 * for the call (ATLAS_TRIPWIRE kill switch, bridge off, hook missing): that hook
 * logs, arms and marks worktrees itself, and a second writer would double-count
 * dispatches and inline ops, which skews the completion gate's verifier pairing
 * and the inline-op threshold.
 *
 * Everything is best-effort: the CLI is only called when its file exists, runs
 * are fire-and-forget, every failure is swallowed, and nothing here can block a
 * tool call.
 */
import { statSync } from "node:fs";
import * as nodePath from "node:path";
import { type ToolEventInfo, claudeNamesFor, taskItems } from "./hook-bridge";
import { runCapture } from "./proc";

const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");
export const RUNSTATE_SCRIPT = nodePath.join(PLUGIN_ROOT, "scripts", "omp_runstate.py");
const CLI_TIMEOUT_MS = 10_000;

export type RunStateCommand = "begin" | "snapshot" | "arm" | "event";

export interface RunStateArgs {
	sessionId: string;
	cwd: string;
	agentType?: string;
	model?: string;
	worktree?: boolean;
	tool?: string;
	path?: string;
	dispatch?: string;
}

/** argv for one omp_runstate.py call (no shell; values travel as separate argv elements). */
export function runStateArgv(command: RunStateCommand, args: RunStateArgs, script: string = RUNSTATE_SCRIPT): string[] {
	const argv = ["python3", script, command, "--session-id", args.sessionId, "--cwd", args.cwd];
	if (command === "arm") {
		if (args.agentType) argv.push("--agent-type", args.agentType);
		if (args.model) argv.push("--model", args.model);
		if (args.worktree) argv.push("--worktree");
	} else if (command === "event") {
		if (args.tool) argv.push("--tool", args.tool);
		if (args.path) argv.push("--path", args.path);
		if (args.dispatch) argv.push("--dispatch", args.dispatch);
	}
	return argv;
}

export interface RunStateSink {
	/** First main session start: begin + snapshot, once. */
	onSessionStart(ctx: { cwd: string; sessionId: string; kind: string }): void;
	/** A `task` call no hook denied: arm orchestration (skipped when dispatch_tripwire ran). */
	onToolAllowed(info: ToolEventInfo): void;
	/** A successful tool result: dispatch / edit event rows (skipped when dispatch_tripwire ran). */
	onToolResult(info: ToolEventInfo): void;
}

export interface RunStateDeps {
	/** Runs one argv; the real binding is fire-and-forget over proc.ts. Tests inject a recorder. */
	run?(argv: string[]): void | Promise<void>;
	/** CLI path; default scripts/omp_runstate.py. The CLI is skipped entirely when this file is absent. */
	script?: string;
}

const defaultRun = async (argv: string[]): Promise<void> => {
	await runCapture(argv, { timeoutMs: CLI_TIMEOUT_MS });
};

/** Claude tool name the CLI logs for an omp tool, or undefined when it is not tracked. */
function trackedTool(toolName: string): "Task" | "Edit" | "Write" | undefined {
	const claude = claudeNamesFor(toolName).find(n => n === "Task" || n === "Edit" || n === "Write");
	return claude === "Task" || claude === "Edit" || claude === "Write" ? claude : undefined;
}

/** First path of an omp edit/write input, resolved against cwd; internal URIs are not files. */
function editedPath(input: unknown, cwd: string): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const { path, paths } = input as { path?: unknown; paths?: unknown };
	const first = typeof path === "string" ? path : Array.isArray(paths) && typeof paths[0] === "string" ? paths[0] : undefined;
	return first && !first.includes("://") ? nodePath.resolve(cwd, first) : undefined;
}

export function createRunStateSink(deps: RunStateDeps = {}): RunStateSink & { idle(): Promise<void> } {
	const script = deps.script ?? RUNSTATE_SCRIPT;
	const run = deps.run ?? defaultRun;
	let available: boolean | undefined;
	let began = false;
	const inflight = new Set<Promise<void>>();

	const cliPresent = (): boolean => {
		available ??= (() => {
			try {
				return statSync(script).isFile();
			} catch {
				return false;
			}
		})();
		return available;
	};
	/** Fire and forget: never throws, never awaited by the caller. `inflight` lets tests await completion. */
	const call = (...invocations: [RunStateCommand, RunStateArgs][]): void => {
		if (!cliPresent()) return;
		const chain = (async () => {
			try {
				for (const [command, args] of invocations) await run(runStateArgv(command, args, script));
			} catch {
				// fail open: run-state is telemetry
			}
		})();
		inflight.add(chain);
		void chain.finally(() => inflight.delete(chain));
	};

	return {
		async idle() {
			await Promise.all([...inflight]);
		},
		onSessionStart({ cwd, sessionId, kind }) {
			if (kind === "sub" || began || !sessionId) return;
			began = true;
			call(["begin", { sessionId, cwd }], ["snapshot", { sessionId, cwd }]);
		},
		onToolAllowed(info) {
			if (info.tripwireRan || !info.sessionId || trackedTool(info.toolName) !== "Task") return;
			const items = taskItems(info.input);
			const agent = items.map(i => (typeof i.agent === "string" ? i.agent.trim() : "")).find(Boolean);
			const worktree = items.some(i => i.isolated === true || (typeof i.isolation === "string" && i.isolation.trim() === "worktree"));
			call(["arm", { sessionId: info.sessionId, cwd: info.cwd, agentType: agent, worktree }]);
		},
		onToolResult(info) {
			if (info.tripwireRan || !info.sessionId) return;
			const tool = trackedTool(info.toolName);
			if (tool === "Task") {
				const agent = taskItems(info.input).map(i => (typeof i.agent === "string" ? i.agent.trim() : "")).find(Boolean);
				call(["event", { sessionId: info.sessionId, cwd: info.cwd, tool, dispatch: agent }]);
			} else if (tool === "Edit" || tool === "Write") {
				call(["event", { sessionId: info.sessionId, cwd: info.cwd, tool, path: editedPath(info.input, info.cwd) }]);
			}
		},
	};
}
