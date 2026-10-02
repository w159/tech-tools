/**
 * Session-end bridge for omp: runs the Claude Code hooks that fire when a
 * session stops, ends or compacts, translating omp events into Claude payloads.
 *
 *   session_stop          -> Stop (main sessions only; omp never fires it for
 *                            subagents). The omp session file is converted to a
 *                            Claude-shaped transcript BEFORE any hook runs: the
 *                            completion gate and the ingest hooks re-read it from
 *                            `transcript_path`. The Stop hooks then ALL run, in
 *                            hooks.json order (the capture hooks must run even when
 *                            the gate blocks), and the first `{decision: "block",
 *                            reason}` becomes the omp session_stop result.
 *   session_shutdown      -> SessionEnd (main) / SubagentStop (sub): ingest spawned
 *                            DETACHED. omp caps a shutdown handler at 2 s and runs
 *                            all of them in parallel, so the child is never awaited.
 *   auto_compaction_start -> PreCompact: ingest spawned detached. NOT
 *                            session_before_compact: registering a handler for that
 *                            event disables omp's async compaction.
 *
 * Self-limits, because omp does not cap what a bridged Stop hook may refuse:
 *   - at most MAX_STOP_BLOCKS consecutive blocks per session; the streak resets on
 *     session_start / session_switch and whenever a Stop passes;
 *   - when omp reports stop_hook_active (it already continued on a block), a block
 *     that repeats the previous reason is dropped.
 *
 * Composition with the native session_stop gates (delegation gate in index.ts,
 * advisor gate in advisor.ts): this handler registers first and omp takes the
 * first `{decision: "block"}` across handlers, so only one refusal reaches the
 * model. The later gates still evaluate and spend their own once/3x allowance.
 *
 * Detached ingest is bounded: per session at most MAX_INGEST_PER_EVENT spawns per
 * event and MAX_INGEST_PER_SESSION overall, PreCompact is throttled, and every
 * tracking map is pruned. Everything fails open: an unreadable session file, a
 * throwing converter, a crashed hook or a failed spawn degrades to "no transcript"
 * / "no ingest" and never wedges or blocks the session.
 *
 * Kill switches: ATLAS_HOOK_BRIDGE=off (all bridges), ATLAS_STOP_BRIDGE=off (this
 * module only), ATLAS_INGEST=off (no detached ingest spawns).
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import {
	type BridgeCtx,
	type BridgedHook,
	HANDLER_BUDGET_MS,
	type HookRunner,
	claudeLifecyclePayload,
	hookTimeoutMs,
	loadBridgedHooksFor,
	parseStopHookOutput,
	runHook,
	SESSION_END_EVENTS,
} from "./hook-bridge";
import { runCapture } from "./proc";

const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");
export const TRANSCRIPT_SCRIPT = nodePath.join(PLUGIN_ROOT, "scripts", "omp_transcript.py");
export const MAX_STOP_BLOCKS = 3;
export const MAX_INGEST_PER_EVENT = 4;
export const MAX_INGEST_PER_SESSION = 12;
const MAX_TRACKED_SESSIONS = 64;
const COMPACT_THROTTLE_MS = 60_000;
/** Conversion budget for tool-hook and Stop payloads. */
const CONVERT_TIMEOUT_MS = 15_000;
/** omp cuts a session_shutdown handler at 2 s: convert fast or not at all. */
const SHUTDOWN_CONVERT_TIMEOUT_MS = 1_200;
/** Tool-hook payloads reuse a conversion this fresh instead of respawning python per call. */
const TOOL_HOOK_REUSE_MS = 5_000;

/** Converts one omp session file into a Claude-shaped transcript at `out`; true when `out` was written. */
export type ConvertFn = (sessionFile: string, out: string, timeoutMs: number) => Promise<boolean>;

/** Real converter: `omp_transcript.py convert`; success means exit 0 and an `{"ok":true}` stdout line. */
export const convertTranscript: ConvertFn = async (sessionFile, out, timeoutMs) => {
	try {
		const { code, stdout } = await runCapture(["python3", TRANSCRIPT_SCRIPT, "convert", "--session-file", sessionFile, "--out", out], { timeoutMs });
		if (code !== 0) return false;
		const parsed: unknown = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
		return typeof parsed === "object" && parsed !== null && "ok" in parsed && parsed.ok === true && fs.existsSync(out);
	} catch {
		return false; // spawn failure, timeout or garbage output: no transcript, fail open
	}
};

export interface TranscriptCache {
	/**
	 * Transcript path for tool-hook payloads. Main sessions get "" (no bridged tool hook reads the
	 * lead's transcript, and dispatch_tripwire reads a path without /subagents/ as "main"); a
	 * subagent gets its converted `.../subagents/agent-<id>.jsonl`, the path shape its
	 * `_in_subagent` check keys on.
	 */
	forToolHook(sessionFile: string | undefined, sessionId: string, kind: "main" | "sub"): Promise<string>;
	/** Convert now (no reuse) and return the transcript path, or undefined when conversion failed. */
	convertFresh(sessionFile: string | undefined, sessionId: string, kind: "main" | "sub", timeoutMs?: number): Promise<string | undefined>;
}

const safeId = (id: string): string => id.replace(/[^\w.-]+/g, "-").slice(0, 80) || "session";

export function createTranscriptCache(deps: { convert?: ConvertFn; baseDir?: string; now?: () => number } = {}): TranscriptCache {
	const convert = deps.convert ?? convertTranscript;
	const now = deps.now ?? Date.now;
	let base: string | undefined;
	const last = new Map<string, { out: string; at: number }>();

	const outFor = (sessionId: string, kind: "main" | "sub"): string => {
		base ??= deps.baseDir ?? fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-omp-"));
		return kind === "sub" ? nodePath.join(base, "subagents", `agent-${safeId(sessionId)}.jsonl`) : nodePath.join(base, `session-${safeId(sessionId)}.jsonl`);
	};
	const convertFresh: TranscriptCache["convertFresh"] = async (sessionFile, sessionId, kind, timeoutMs = CONVERT_TIMEOUT_MS) => {
		try {
			if (!sessionFile || !sessionId) return undefined;
			const out = outFor(sessionId, kind);
			fs.mkdirSync(nodePath.dirname(out), { recursive: true });
			if (!(await convert(sessionFile, out, timeoutMs))) return undefined;
			last.set(`${kind}\0${sessionFile}`, { out, at: now() });
			if (last.size > 256) last.delete(last.keys().next().value as string);
			return out;
		} catch {
			return undefined; // fail open: no transcript
		}
	};
	return {
		convertFresh,
		async forToolHook(sessionFile, sessionId, kind) {
			if (kind === "main") return "";
			const hit = sessionFile ? last.get(`${kind}\0${sessionFile}`) : undefined;
			if (hit && now() - hit.at < TOOL_HOOK_REUSE_MS && fs.existsSync(hit.out)) return hit.out;
			return (await convertFresh(sessionFile, sessionId, kind)) ?? "";
		},
	};
}

export interface StopBridgeDeps {
	/** Stop-family hooks; default: loadBridgedHooksFor(SESSION_END_EVENTS, "bridgedSessionEnd"). */
	hooks?: BridgedHook[];
	run?: HookRunner;
	env?: Record<string, string | undefined>;
	cache?: TranscriptCache;
	/** Detached, never-awaited spawn of `argv` with `stdinFile` as its stdin. Tests inject a recorder. */
	spawnDetached?(argv: string[], opts: { cwd: string; stdinFile: string; env: Record<string, string> }): void;
	now?: () => number;
}

interface StopState {
	streak: number;
	lastReason?: string;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

function sessionIdOf(ctx: BridgeCtx): string {
	try {
		return str(ctx.sessionManager?.getSessionId?.());
	} catch {
		return "";
	}
}

/** The omp session file for a context (shutdown/compaction events carry none themselves). */
export function sessionFileOf(ctx: BridgeCtx): string {
	try {
		return str(ctx.sessionManager?.getSessionFile?.());
	} catch {
		return "";
	}
}

/**
 * Runs `argv` with stdin from `stdinFile`, output discarded. On child exit the stdin file is removed and
 * then its parent temp dir via `rmdir` (not `rm -rf`): `rmdir` only succeeds on an EMPTY directory, so an
 * empty or wrong `$ATLAS_PROC_STDIN` can never delete anything it should not. Without the `rmdir`, every
 * ingest left one empty `atlas-ingest-*` directory behind in the OS temp dir.
 */
export const DETACHED_SCRIPT = `trap 'rm -f "$ATLAS_PROC_STDIN"; rmdir "$(dirname "$ATLAS_PROC_STDIN")" 2>/dev/null' EXIT; ("$@") <"$ATLAS_PROC_STDIN" >/dev/null 2>&1`;

type DetachedOpts = { cwd: string; stdinFile: string; env: Record<string, string> };

/** Starts the detached child and returns its handle; `undefined` if the spawn itself failed (fail open). */
export function startDetached(argv: string[], opts: DetachedOpts): { unref(): void; exited: Promise<number> } | undefined {
	try {
		return Bun.spawn(["/bin/sh", "-c", DETACHED_SCRIPT, "sh", ...argv], {
			cwd: opts.cwd,
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			env: { ...process.env, ...opts.env, ATLAS_PROC_STDIN: opts.stdinFile },
		});
	} catch {
		// fail open: no ingest this time
		return undefined;
	}
}

function spawnDetachedReal(argv: string[], opts: DetachedOpts): void {
	startDetached(argv, opts)?.unref();
}

export function registerStopBridge(pi: Pick<ExtensionAPI, "on">, deps: StopBridgeDeps = {}): void {
	const env = () => deps.env ?? process.env;
	const off = () => env().ATLAS_HOOK_BRIDGE === "off" || env().ATLAS_STOP_BRIDGE === "off";
	const run = deps.run ?? runHook;
	const cache = deps.cache ?? createTranscriptCache();
	const spawnDetached = deps.spawnDetached ?? spawnDetachedReal;
	const now = deps.now ?? Date.now;
	let hooks: BridgedHook[] | undefined = deps.hooks;
	const hooksFor = (event: string): BridgedHook[] => (hooks ??= loadBridgedHooksFor(SESSION_END_EVENTS, "bridgedSessionEnd")).filter(h => h.event === event);

	const stops = new Map<string, StopState>();
	const reset = () => stops.clear();
	pi.on("session_start", reset);
	pi.on("session_switch", reset);

	pi.on("session_stop", async (event, ctx) => {
		try {
			const bridgeCtx = ctx as BridgeCtx;
			if (bridgeCtx.agent?.kind !== "main" || off()) return undefined;
			const raw = event as Record<string, unknown>;
			const sessionId = sessionIdOf(bridgeCtx) || str(raw.session_id);
			// Ordering hazard: convert BEFORE any hook runs. The gate and ingest re-read this file.
			const transcriptPath = await cache.convertFresh(str(raw.session_file) || sessionFileOf(bridgeCtx), sessionId, "main");
			const stopHookActive = raw.stop_hook_active === true;
			const payload = claudeLifecyclePayload("Stop", { sessionId, cwd: bridgeCtx.cwd, transcriptPath, stopHookActive });
			const deadline = now() + HANDLER_BUDGET_MS;
			let blockReason: string | undefined;
			for (const hook of hooksFor("Stop")) {
				const remaining = deadline - now();
				if (remaining <= 0) break; // out of handler budget: skip the rest (fail open)
				const out = parseStopHookOutput(await run(hook.command, payload, Math.min(hookTimeoutMs(hook.timeoutMs, env()), remaining)));
				if (out.block && blockReason === undefined) blockReason = out.reason;
			}
			const state = stops.get(sessionId) ?? { streak: 0 };
			stops.set(sessionId, state);
			if (blockReason === undefined) {
				state.streak = 0; // a passing Stop ends the streak
				state.lastReason = undefined;
				return undefined;
			}
			const repeated = stopHookActive && state.lastReason === blockReason;
			state.lastReason = blockReason;
			if (repeated || state.streak >= MAX_STOP_BLOCKS) return undefined; // never wedge the session
			state.streak += 1;
			return { decision: "block" as const, reason: blockReason };
		} catch {
			return undefined; // fail open
		}
	});

	const ingests = new Map<string, { perEvent: Record<string, number>; total: number }>();
	const compactedAt = new Map<string, number>();
	/** Bounded dedupe: true when one more ingest spawn is allowed for (session, event). */
	const admitIngest = (sessionId: string, event: string): boolean => {
		const entry = ingests.get(sessionId) ?? { perEvent: {}, total: 0 };
		if ((entry.perEvent[event] ?? 0) >= MAX_INGEST_PER_EVENT || entry.total >= MAX_INGEST_PER_SESSION) return false;
		entry.perEvent[event] = (entry.perEvent[event] ?? 0) + 1;
		entry.total += 1;
		ingests.delete(sessionId); // re-insert so the oldest session is the one pruned
		ingests.set(sessionId, entry);
		if (ingests.size > MAX_TRACKED_SESSIONS) ingests.delete(ingests.keys().next().value as string);
		return true;
	};

	/** Converts, then spawns the event's ingest hook detached. Never awaits the child. */
	const ingest = async (hookEvent: "SessionEnd" | "SubagentStop" | "PreCompact", ctx: BridgeCtx, kind: "main" | "sub", timeoutMs: number): Promise<void> => {
		if (off() || env().ATLAS_INGEST === "off") return;
		const sessionId = sessionIdOf(ctx);
		const command = hooksFor(hookEvent)[0]?.command;
		if (!sessionId || !command) return;
		const transcriptPath = await cache.convertFresh(sessionFileOf(ctx), sessionId, kind, timeoutMs);
		if (!transcriptPath || !admitIngest(sessionId, hookEvent)) return;
		const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-ingest-"));
		const stdinFile = nodePath.join(dir, "payload.json");
		fs.writeFileSync(stdinFile, JSON.stringify(claudeLifecyclePayload(hookEvent, { sessionId, cwd: ctx.cwd, transcriptPath })));
		spawnDetached(["/bin/sh", "-c", command], {
			cwd: ctx.cwd,
			stdinFile,
			env: { CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ATLAS_HARNESS: "omp", ATLAS_MANDATES: "off" },
		});
	};

	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			const bridgeCtx = ctx as BridgeCtx;
			const sub = bridgeCtx.agent?.kind === "sub";
			await ingest(sub ? "SubagentStop" : "SessionEnd", bridgeCtx, sub ? "sub" : "main", SHUTDOWN_CONVERT_TIMEOUT_MS);
		} catch {
			// fail open: shutdown must never throw into omp
		}
	});

	pi.on("auto_compaction_start", async (_event, ctx) => {
		try {
			const bridgeCtx = ctx as BridgeCtx;
			const sessionId = sessionIdOf(bridgeCtx);
			const previous = compactedAt.get(sessionId);
			if (previous !== undefined && now() - previous < COMPACT_THROTTLE_MS) return;
			compactedAt.set(sessionId, now());
			if (compactedAt.size > MAX_TRACKED_SESSIONS) compactedAt.delete(compactedAt.keys().next().value as string);
			await ingest("PreCompact", bridgeCtx, bridgeCtx.agent?.kind === "sub" ? "sub" : "main", CONVERT_TIMEOUT_MS);
		} catch {
			// fail open: compaction must never be blocked by telemetry
		}
	});
}
