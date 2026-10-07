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
	type StopHookOutput,
	recordFault,
	type HookRunner,
	claudeLifecyclePayload,
	hookTimeoutMs,
	loadBridgedHooksFor,
	parseStopHookOutput,
	runHook,
	SESSION_END_EVENTS,
} from "./hook-bridge";
import { runCapture } from "./proc";
import { runStateArgv } from "./run-state";

const PLUGIN_ROOT = nodePath.resolve(import.meta.dir, "..");
export const TRANSCRIPT_SCRIPT = nodePath.join(PLUGIN_ROOT, "scripts", "omp_transcript.py");
export const MAX_STOP_BLOCKS = 3;
export const MAX_INGEST_PER_EVENT = 4;
export const MAX_INGEST_PER_SESSION = 12;
const MAX_TRACKED_SESSIONS = 64;
/** Budget for folding tool state into the dirty snapshot; the gate runs after it, so it must stay small. */
export const REBASELINE_BUDGET_MS = 3_000;
const COMPACT_THROTTLE_MS = 60_000;
/** Conversion budget for tool-hook and Stop payloads. */
const CONVERT_TIMEOUT_MS = 15_000;
/** Stop-path conversion: a real one takes under 0.5 s (17 MB: 175 ms), so a slow one must not eat the handler budget the gate needs. */
const STOP_CONVERT_TIMEOUT_MS = 8_000;
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
	/**
	 * Delete a converted transcript this cache wrote, then its now-empty parents up to the cache base. The converted
	 * file is a plaintext copy of the whole session (prompts, tool output, anything a client file contained), so it
	 * must not outlive the hook that read it. Uses unlink + rmdir only (never a recursive delete) and refuses any
	 * path outside the base, so a bad argument cannot remove anything else.
	 */
	discard?(transcriptPath: string | undefined): void;
}

const safeId = (id: string): string => id.replace(/[^\w.-]+/g, "-").slice(0, 80) || "session";

export function createTranscriptCache(deps: { convert?: ConvertFn; baseDir?: string; tmpDir?: string; now?: () => number } = {}): TranscriptCache {
	const convert = deps.convert ?? convertTranscript;
	const now = deps.now ?? Date.now;
	let base: string | undefined;
	let ownsBase = false; // true only when this cache made the base with mkdtemp; an injected baseDir is never forgotten
	const last = new Map<string, { out: string; at: number }>();

	// A MAIN conversion gets its own fresh directory under the base. omp_transcript.py writes the lead's colony and
	// advisor files next to its output as `subagents/agent-*.jsonl` and prunes any such file it did not just write, so
	// a shared `subagents/` would let one conversion delete a running subagent's transcript (reproduced). Isolating
	// each main conversion keeps those sidecars, and that prune, inside a directory nothing else uses.
	// A SUB conversion keeps a stable path of its own: `<base>/subagents/agent-<id>.jsonl`.
	const outFor = (sessionId: string, kind: "main" | "sub"): string => {
		if (base === undefined) {
			ownsBase = deps.baseDir === undefined;
			base = deps.baseDir ?? fs.mkdtempSync(nodePath.join(deps.tmpDir ?? os.tmpdir(), "atlas-omp-"));
		}
		if (kind === "sub") return nodePath.join(base, "subagents", `agent-${safeId(sessionId)}.jsonl`);
		fs.mkdirSync(base, { recursive: true });
		return nodePath.join(fs.mkdtempSync(nodePath.join(base, "main-")), `session-${safeId(sessionId)}.jsonl`);
	};
	const discard: TranscriptCache["discard"] = transcriptPath => {
		try {
			if (!transcriptPath || !base) return;
			const root = nodePath.resolve(base);
			const target = nodePath.resolve(transcriptPath);
			if (!target.startsWith(root + nodePath.sep)) return; // never touch anything outside the cache base
			const dir = nodePath.dirname(target);
			if (nodePath.basename(dir).startsWith("main-") && nodePath.dirname(dir) === root) {
				// A main conversion directory: this cache made it for exactly one conversion, so everything in it is that
				// conversion's own output (the transcript and its sidecars). Delete those files by name, then the directory.
				for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
					if (entry.isDirectory()) {
						for (const sidecar of fs.readdirSync(nodePath.join(dir, entry.name))) fs.rmSync(nodePath.join(dir, entry.name, sidecar), { force: true });
						fs.rmdirSync(nodePath.join(dir, entry.name));
					} else {
						fs.rmSync(nodePath.join(dir, entry.name), { force: true });
					}
				}
			} else {
				fs.rmSync(target, { force: true }); // a sub transcript: exactly one file
			}
			// Walk upward removing EMPTY directories only (rmdir refuses a non-empty one, so a sibling transcript
			// survives), and stop at the base: never above it, and never a sibling like `<base>-other`.
			for (let up = dir; up === root || up.startsWith(root + nodePath.sep); up = nodePath.dirname(up)) {
				try {
					fs.rmdirSync(up);
				} catch {
					break;
				}
				if (up === root) {
					if (ownsBase) base = undefined; // the next conversion makes a fresh mkdtemp base
					break;
				}
			}
			for (const [key, hit] of last) if (hit.out === target) last.delete(key);
		} catch {
			// fail open: a leftover file is a privacy nit, never a reason to break the hook chain
		}
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
		discard,
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
	spawnDetached?(argv: string[], opts: DetachedOpts): void;
	/** Base directory for the per-ingest owned dirs; default os.tmpdir(). Tests pass a per-test dir. */
	tmpDir?: string;
	/** Converter used for the detached ingest, which converts into the spawn's own directory; default omp_transcript.py. */
	convert?: ConvertFn;
	/** Folds tool state written after SessionStart into the dirty snapshot (omp_runstate.py rebaseline); awaited before the gate. */
	rebaseline?(cwd: string, sessionId: string): Promise<void>;
	now?: () => number;
}

interface StopState {
	streak: number;
	lastReason?: string;
	/** Last non-blocking Stop-hook context delivered, and how many were: a nudge speaks once per distinct text, a bounded number of times. */
	lastContext?: string;
	contextCount: number;
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** The non-empty string `text` of a `{type:"text", text}` content block; undefined for any other block. */
function blockText(block: unknown): string | undefined {
	if (typeof block !== "object" || block === null) return undefined;
	if (!("type" in block) || block.type !== "text" || !("text" in block)) return undefined;
	return typeof block.text === "string" && block.text.length > 0 ? block.text : undefined;
}

/**
 * The text of an omp AgentMessage (`session_stop.last_assistant_message`): its `{type:"text", text}` content blocks
 * joined by newlines. Thinking and tool blocks are not part of the reply the user reads, so they are dropped. Returns
 * "" for anything that is not an object with an array `content`, so a malformed event can only cost the check, never
 * the Stop.
 */
function lastAssistantMessageText(message: unknown): string {
	if (typeof message !== "object" || message === null || !("content" in message) || !Array.isArray(message.content)) return "";
	return message.content.map(blockText).filter((text): text is string => text !== undefined).join("\n");
}

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
 * Removes a converted transcript, never letting cleanup affect a hook verdict: a cache without `discard` (a test
 * double, an older custom cache) or one that throws just leaves the file, which is a privacy nit, not a reason to
 * lose the gate's block.
 */
function discardQuietly(cache: TranscriptCache, transcriptPath: string | undefined): void {
	try {
		cache.discard?.(transcriptPath);
	} catch {
		// ignore: cleanup is best effort
	}
}

/**
 * Runs `argv` with stdin from `stdinFile`, output discarded. The spawn owns `ownedDir` (an `atlas-ingest-*`
 * directory the bridge made for this one ingest, holding the payload, the converted transcript, and the lead's
 * colony and advisor sidecars under `subagents/`). On child exit the trap removes exactly that directory:
 *   - `rm -f` on the files directly inside it and inside its `subagents/` (named globs, never `rm -rf`);
 *   - then `rmdir` on `subagents/` and the directory, which refuse to remove anything non-empty, so an unexpected
 *     extra file survives loudly instead of being deleted.
 * The shell refuses to act unless the directory's name starts with `atlas-ingest-`, so an empty or wrong
 * variable cannot point the cleanup anywhere else. No path is shared with another child or with the synchronous
 * Stop path, so one child's exit can never remove a file another child is about to open.
 */
export const DETACHED_SCRIPT = `trap 'case "$(basename "$ATLAS_OWNED_DIR")" in atlas-ingest-*) rm -f "$ATLAS_OWNED_DIR"/*.json "$ATLAS_OWNED_DIR"/*.jsonl "$ATLAS_OWNED_DIR"/subagents/*.jsonl; rmdir "$ATLAS_OWNED_DIR"/subagents "$ATLAS_OWNED_DIR" 2>/dev/null;; esac' EXIT; ("$@") <"$ATLAS_PROC_STDIN" >/dev/null 2>&1`;

type DetachedOpts = { cwd: string; stdinFile: string; env: Record<string, string>; ownedDir: string };

/** Starts the detached child and returns its handle; `undefined` if the spawn itself failed (fail open). */
export function startDetached(argv: string[], opts: DetachedOpts): { unref(): void; exited: Promise<number> } | undefined {
	try {
		return Bun.spawn(["/bin/sh", "-c", DETACHED_SCRIPT, "sh", ...argv], {
			cwd: opts.cwd,
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
			env: { ...process.env, ...opts.env, ATLAS_PROC_STDIN: opts.stdinFile, ATLAS_OWNED_DIR: opts.ownedDir },
		});
	} catch {
		// fail open: no ingest this time
		return undefined;
	}
}

function spawnDetachedReal(argv: string[], opts: DetachedOpts): void {
	startDetached(argv, opts)?.unref();
}

/** Removes a directory this bridge just made for one ingest, only if it is empty after its known files are gone. */
function removeOwnedDir(dir: string): void {
	try {
		for (const sub of [nodePath.join(dir, "subagents"), dir]) {
			if (!fs.existsSync(sub)) continue;
			for (const name of fs.readdirSync(sub, { withFileTypes: true })) if (name.isFile()) fs.rmSync(nodePath.join(sub, name.name), { force: true });
		}
		for (const sub of [nodePath.join(dir, "subagents"), dir]) if (fs.existsSync(sub)) fs.rmdirSync(sub);
	} catch {
		// best effort: a leftover empty directory is not worth failing the ingest path
	}
}

export function registerStopBridge(pi: Pick<ExtensionAPI, "on">, deps: StopBridgeDeps = {}): void {
	const env = () => deps.env ?? process.env;
	const off = () => env().ATLAS_HOOK_BRIDGE === "off" || env().ATLAS_STOP_BRIDGE === "off";
	const run = deps.run ?? runHook;
	const cache = deps.cache ?? createTranscriptCache({ tmpDir: deps.tmpDir });
	const spawnDetached = deps.spawnDetached ?? spawnDetachedReal;
	const convert = deps.convert ?? convertTranscript;
	/** Convert `sessionFile` into exactly `out`; false (never a throw) when there is nothing to convert or it failed. */
	const convertInto = async (sessionFile: string, out: string, timeoutMs: number): Promise<boolean> => {
		try {
			return sessionFile.length > 0 && (await convert(sessionFile, out, timeoutMs));
		} catch {
			return false;
		}
	};
	const now = deps.now ?? Date.now;
	/** Default: omp_runstate.py rebaseline. Fire-and-forget callers would race the gate, so this is awaited (and time-boxed) below. */
	const rebaseline = deps.rebaseline ?? (async (cwd: string, sessionId: string) => void (await runCapture(runStateArgv("rebaseline", { sessionId, cwd }), { timeoutMs: REBASELINE_BUDGET_MS })));
	/** Never throws and never waits longer than REBASELINE_BUDGET_MS, whatever `rebaseline` does. */
	const rebaselineBounded = async (cwd: string, sessionId: string): Promise<void> => {
		const budget = Promise.withResolvers<void>();
		const timer = setTimeout(budget.resolve, REBASELINE_BUDGET_MS);
		try {
			await Promise.race([rebaseline(cwd, sessionId), budget.promise]);
		} catch {
			// fail open: a missed rebaseline only means a possible false (m), never a lost verdict
		} finally {
			clearTimeout(timer);
		}
	};
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
			// The budget starts HERE, before conversion and rebaseline: omp cuts a session_stop handler at 30 s and
			// then delivers nothing, so everything below (convert + rebaseline + hooks) has to fit inside it.
			const deadline = now() + HANDLER_BUDGET_MS;
			// Typed off omp's SessionStopEvent so tsc checks these names against the host; the coercion stays because
			// the event comes from a runtime we do not control and tests hand-build partial events.
			const sessionId = sessionIdOf(bridgeCtx) || str(event.session_id);
			// Ordering hazard: convert BEFORE any hook runs. The gate and ingest re-read this file.
			const transcriptPath = await cache.convertFresh(str(event.session_file) || sessionFileOf(bridgeCtx), sessionId, "main", STOP_CONVERT_TIMEOUT_MS);
			if (sessionId) await rebaselineBounded(bridgeCtx.cwd, sessionId); // tool state written since SessionStart must be in the snapshot BEFORE the gate compares
			const stopHookActive = event.stop_hook_active === true;
			const payload = claudeLifecyclePayload("Stop", { sessionId, cwd: bridgeCtx.cwd, transcriptPath, stopHookActive });
			// Claude Code's Stop payload carries the final reply as `last_assistant_message` (text); condition (n) of
			// completion_gate.py reads it. omp's session_stop hands over the AgentMessage itself, so no converted transcript
			// is needed. Absent or text-less means the key is left off and the gate fails open.
			const lastText = lastAssistantMessageText(event.last_assistant_message);
			if (lastText) payload.last_assistant_message = lastText;
			let blockReason: string | undefined;
			const contexts: string[] = [];
			try {
				// All Stop hooks run at once (as Claude Code does), so the gate is never queued behind the capture hooks and
				// the chain costs its slowest hook, not the sum. Each gets what is left of the handler budget; results are
				// folded in hooks.json order, so the first blocking hook's reason still wins.
				const outs = await Promise.all(
					hooksFor("Stop").map(async (hook): Promise<StopHookOutput> => {
						const remaining = deadline - now();
						if (remaining <= 0) {
							recordFault(hook.command, "Stop skipped: bridge budget exhausted", "BridgeBudget", bridgeCtx.cwd);
							return {};
						}
						return parseStopHookOutput(await run(hook.command, payload, Math.min(hookTimeoutMs(hook.timeoutMs, env()), remaining)));
					}),
				);
				for (const out of outs) {
					if (out.block && blockReason === undefined) blockReason = out.reason;
					if (out.context) contexts.push(out.context);
				}
			} finally {
				// Every Stop hook has been awaited, so nothing is reading the converted copy any more. It is a plaintext
				// copy of the whole session; do not leave it in the OS temp dir.
				discardQuietly(cache, transcriptPath);
			}
			const state: StopState = stops.get(sessionId) ?? { streak: 0, contextCount: 0 };
			stops.set(sessionId, state);
			if (blockReason === undefined) {
				state.streak = 0; // a passing Stop ends the streak
				state.lastReason = undefined;
				// A non-blocking hook that spoke (nudge.py) is delivered as a continuation with its context, which costs the
				// session one more turn: so only once per distinct text, never while omp is already continuing a block
				// (stop_hook_active), and never past the same MAX_STOP_BLOCKS cap.
				const context = contexts.join("\n\n");
				if (!context || stopHookActive || context === state.lastContext || state.contextCount >= MAX_STOP_BLOCKS) return undefined;
				state.lastContext = context;
				state.contextCount += 1;
				return { continue: true as const, additionalContext: context };
			}
			const repeated = stopHookActive && state.lastReason === blockReason;
			state.lastReason = blockReason;
			if (repeated || state.streak >= MAX_STOP_BLOCKS) return undefined; // never wedge the session
			state.streak += 1;
			return { decision: "block" as const, reason: blockReason };
		} catch (error) {
			recordFault("stop-bridge", String(error), "BridgeError", undefined);
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
		if (!admitIngest(sessionId, hookEvent)) return; // refused before any conversion: nothing to clean up
		// This spawn owns a directory of its own. The transcript (and the lead's colony and advisor sidecars, which
		// omp_transcript.py writes next to it) are converted INTO it, so no path is shared with another child or the
		// synchronous Stop path, and the child's exit trap removes exactly this directory's files.
		const dir = fs.mkdtempSync(nodePath.join(deps.tmpDir ?? os.tmpdir(), "atlas-ingest-"));
		const transcriptPath = nodePath.join(dir, kind === "sub" ? `agent-${safeId(sessionId)}.jsonl` : `session-${safeId(sessionId)}.jsonl`);
		if (!(await convertInto(sessionFileOf(ctx), transcriptPath, timeoutMs))) {
			removeOwnedDir(dir); // conversion failed: leave nothing behind and spawn nothing
			return;
		}
		const stdinFile = nodePath.join(dir, "payload.json");
		fs.writeFileSync(stdinFile, JSON.stringify(claudeLifecyclePayload(hookEvent, { sessionId, cwd: ctx.cwd, transcriptPath })));
		spawnDetached(["/bin/sh", "-c", command], {
			cwd: ctx.cwd,
			stdinFile,
			ownedDir: dir,
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
