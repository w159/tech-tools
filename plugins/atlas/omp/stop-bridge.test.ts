// session-end bridge: Stop synthesis and ordering, block mapping and self-limits,
// composition with the native gates, detached SessionEnd/SubagentStop/PreCompact
// ingest, and fail-open behavior. Handler logic runs against recording fakes; one
// test drives the REAL completion_gate.py end to end through the real runner.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type BridgedHook, type HookRunner, claudeLifecyclePayload, loadBridgedHooksFor, parseStopHookOutput, runHook } from "./hook-bridge";
import { register } from "./index";
import { type TranscriptCache, MAX_INGEST_PER_EVENT, MAX_STOP_BLOCKS, createTranscriptCache, registerStopBridge, startDetached } from "./stop-bridge";

type Ctx = { cwd: string; agent: { kind: "main" | "sub" }; sessionManager: { getSessionId(): string; getSessionFile(): string } };
type Handler = (event: Record<string, unknown>, ctx: Ctx) => unknown;
type Spawn = { argv: string[]; opts: { cwd: string; stdinFile: string; env: Record<string, string> } };

let dir: string;
let realTmpdir: string | undefined;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-stop-"));
	// The bridge creates its ingest temp dirs under os.tmpdir(). Tests that inject a spy spawner never run the
	// child's cleanup trap, so those dirs piled up in the real OS temp dir (9 per run). Redirecting TMPDIR into
	// the per-test dir lets the afterEach below remove them along with everything else.
	realTmpdir = process.env.TMPDIR;
	process.env.TMPDIR = dir;
});
afterEach(() => {
	if (realTmpdir === undefined) delete process.env.TMPDIR;
	else process.env.TMPDIR = realTmpdir;
	rmSync(dir, { recursive: true, force: true });
});

const hook = (name: string, event: BridgedHook["event"] = "Stop"): BridgedHook => ({ event, matcher: undefined, command: `python3 "/x/${name}"`, timeoutMs: 60_000 });
const scriptOf = (command: string) => /([\w.-]+\.py)/.exec(command)?.[1] ?? "";
const block = (reason: string) => JSON.stringify({ decision: "block", reason });

/** Event log shared by the fakes so cross-component ORDER is assertable. */
function harness(opts: { stdout?: Record<string, string>; hooks?: BridgedHook[]; convertOk?: boolean; env?: Record<string, string | undefined> } = {}) {
	const log: string[] = [];
	const payloads: Record<string, unknown>[] = [];
	const spawns: Spawn[] = [];
	const converts: { sessionFile: string; out: string }[] = [];
	const handlers: Record<string, Handler[]> = {};
	const api = { on: (name: string, h: Handler) => (handlers[name] ??= []).push(h) };
	const run: HookRunner = async (command, payload) => {
		const name = scriptOf(command);
		log.push(`hook:${name}`);
		payloads.push(payload);
		return opts.stdout?.[name] ?? "";
	};
	const cache = createTranscriptCache({
		baseDir: join(dir, "cache"),
		convert: async (sessionFile, out) => {
			log.push("convert");
			converts.push({ sessionFile, out });
			if (opts.convertOk === false) return false;
			writeFileSync(out, "{}\n");
			return true;
		},
	});
	const hooks = opts.hooks ?? [hook("completion_gate.py"), hook("ingest_session.py"), hook("chronicle_facet.py"), hook("memory_capture.py"), hook("nudge.py"), hook("ingest_session.py", "SessionEnd"), hook("ingest_session.py", "SubagentStop"), hook("ingest_session.py", "PreCompact")];
	registerStopBridge(api as unknown as Pick<ExtensionAPI, "on">, {
		hooks,
		run,
		cache,
		env: opts.env ?? {},
		spawnDetached: (argv, o) => {
			log.push("spawn");
			spawns.push({ argv, opts: o });
		},
	});
	const ctx = (kind: "main" | "sub" = "main", sid = "s-1"): Ctx => ({ cwd: dir, agent: { kind }, sessionManager: { getSessionId: () => sid, getSessionFile: () => join(dir, `${sid}.jsonl`) } });
	const emit = async (name: string, event: Record<string, unknown>, c: Ctx) => {
		let first: unknown;
		for (const h of handlers[name] ?? []) {
			const r = await h(event, c);
			if (first === undefined && r !== undefined) first = r;
		}
		return first;
	};
	const stop = (extra: Record<string, unknown> = {}, c: Ctx = ctx()) => emit("session_stop", { session_id: "s-1", session_file: join(dir, "s-1.jsonl"), stop_hook_active: false, ...extra }, c);
	return { handlers, ctx, emit, stop, log, payloads, spawns, converts, cache };
}

test("Stop payload is the Claude shape and the transcript is converted before ANY hook runs", async () => {
	const h = harness();
	expect(await h.stop()).toBeUndefined();
	expect(h.log[0]).toBe("convert"); // ordering hazard: the gate re-reads the transcript
	expect(h.log.indexOf("convert")).toBeLessThan(h.log.indexOf("hook:completion_gate.py"));
	expect(h.converts[0].sessionFile).toBe(join(dir, "s-1.jsonl"));
	expect(h.payloads[0]).toEqual({ hook_event_name: "Stop", session_id: "s-1", cwd: dir, transcript_path: h.converts[0].out, stop_hook_active: false });
	expect(h.converts[0].out).not.toContain("/subagents/"); // dispatch_tripwire would read the lead as a subagent
});

test("all five Stop hooks run in hooks.json order, even after the gate blocks", async () => {
	const h = harness({ stdout: { "completion_gate.py": block("(d) ROADMAP missing") } });
	const result = await h.stop();
	expect(result).toEqual({ decision: "block", reason: "(d) ROADMAP missing" });
	expect(h.log.filter(l => l.startsWith("hook:"))).toEqual(["hook:completion_gate.py", "hook:ingest_session.py", "hook:chronicle_facet.py", "hook:memory_capture.py", "hook:nudge.py"]);
});

test("a Stop block is a decision:block refusal, never plain context", async () => {
	const h = harness({ stdout: { "nudge.py": block("late nudge block") } });
	expect(await h.stop()).toEqual({ decision: "block", reason: "late nudge block" });
	expect(parseStopHookOutput(JSON.stringify({ hookSpecificOutput: { additionalContext: "ctx only" } }))).toEqual({});
	expect(parseStopHookOutput(JSON.stringify({ decision: "block" }))).toMatchObject({ block: true });
	expect(parseStopHookOutput("garbage")).toEqual({});
});

test("the first blocking hook's reason wins", async () => {
	const h = harness({ stdout: { "completion_gate.py": block("gate"), "nudge.py": block("nudge") } });
	expect((await h.stop()) as { reason: string }).toMatchObject({ reason: "gate" });
});

test("a repeating blocker is stopped at MAX_STOP_BLOCKS even when stop_hook_active is never reported", async () => {
	const h = harness({ stdout: { "completion_gate.py": block("still open") } });
	const verdicts: (string | undefined)[] = [];
	for (let i = 0; i < MAX_STOP_BLOCKS + 2; i++) verdicts.push(((await h.stop()) as { decision?: string } | undefined)?.decision);
	expect(verdicts).toEqual(["block", "block", "block", undefined, undefined]);
});

test("streak cap counts distinct-reason blocks and the 4th passes", async () => {
	let n = 0;
	const log: string[] = [];
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [hook("completion_gate.py")],
		run: async () => block(`reason ${n++}`),
		cache: { convertFresh: async () => "/t.jsonl", forToolHook: async () => "" } satisfies TranscriptCache,
		env: {},
	});
	const ctx: Ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "f" } };
	const stop = () => handlers.session_stop[0]({ session_id: "s", session_file: "f", stop_hook_active: false }, ctx);
	const out = [await stop(), await stop(), await stop(), await stop(), await stop()];
	expect(out.map(o => (o as { decision?: string } | undefined)?.decision)).toEqual(["block", "block", "block", undefined, undefined]);
	void log;
});

test("a passing Stop resets the streak; session_start and session_switch reset it too", async () => {
	let blocking = true;
	let n = 0;
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [hook("completion_gate.py")],
		run: async () => (blocking ? block(`r${n++}`) : ""),
		cache: { convertFresh: async () => "/t.jsonl", forToolHook: async () => "" },
		env: {},
	});
	const ctx: Ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "f" } };
	const stop = async () => ((await handlers.session_stop[0]({ session_id: "s", session_file: "f" }, ctx)) as { decision?: string } | undefined)?.decision;
	expect([await stop(), await stop()]).toEqual(["block", "block"]);
	blocking = false;
	expect(await stop()).toBeUndefined(); // pass resets
	blocking = true;
	expect([await stop(), await stop(), await stop(), await stop()]).toEqual(["block", "block", "block", undefined]); // full allowance again
	for (const event of ["session_start", "session_switch"]) {
		for (const fn of handlers[event]) await fn({}, ctx);
		expect(await stop()).toBe("block");
		expect(await stop()).toBe("block");
		expect(await stop()).toBe("block");
		expect(await stop()).toBeUndefined();
	}
});

test("stop_hook_active with a repeated reason never blocks; a different reason does", async () => {
	const reasons = ["same", "same", "other"];
	let i = 0;
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [hook("completion_gate.py")],
		run: async () => block(reasons[i++]),
		cache: { convertFresh: async () => "/t.jsonl", forToolHook: async () => "" },
		env: {},
	});
	const ctx: Ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "f" } };
	const stop = async (active: boolean) => (await handlers.session_stop[0]({ session_id: "s", session_file: "f", stop_hook_active: active }, ctx)) as { reason?: string } | undefined;
	expect(await stop(false)).toEqual({ decision: "block", reason: "same" });
	expect(await stop(true)).toBeUndefined(); // omp already continued on "same"; it repeats
	expect((await stop(true))?.reason).toBe("other");
});

test("Stop is main-only and the kill switches stand down", async () => {
	const sub = harness({ stdout: { "completion_gate.py": block("x") } });
	expect(await sub.stop({}, sub.ctx("sub"))).toBeUndefined();
	expect(sub.log).toEqual([]);
	const off = harness({ stdout: { "completion_gate.py": block("x") }, env: { ATLAS_STOP_BRIDGE: "off" } });
	expect(await off.stop()).toBeUndefined();
	const bridgeOff = harness({ stdout: { "completion_gate.py": block("x") }, env: { ATLAS_HOOK_BRIDGE: "off" } });
	expect(await bridgeOff.stop()).toBeUndefined();
	expect(off.log.concat(bridgeOff.log)).toEqual([]);
});

test("a failed conversion still runs the hooks, with an empty transcript path", async () => {
	const h = harness({ convertOk: false });
	expect(await h.stop()).toBeUndefined();
	expect(h.payloads[0]).toMatchObject({ transcript_path: "" });
	expect(h.log.filter(l => l.startsWith("hook:")).length).toBe(5);
});

// ---- composition with the native session_stop gates ----

test("bridged block wins over the native delegation gate: omp's first-block-wins merge yields one refusal", async () => {
	mkdirSync(join(dir, "docs"));
	const h = harness();
	// Same registration order as the factory: bridge first, then the delegation gate, on ONE api.
	const handlers: Record<string, Handler[]> = {};
	const shared = { on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">;
	registerStopBridge(shared, { hooks: [hook("completion_gate.py")], run: async () => block("BRIDGED gate"), cache: h.cache, env: {} });
	register(shared, { activeTools: () => [], spawnBoardMirror: () => { } });
	const ctx = h.ctx();
	await handlers.tool_call.at(-1)?.({ toolName: "write", input: { path: "src/app.ts" } }, ctx); // a real delegation violation
	const results: ({ decision?: string; reason?: string } | undefined)[] = [];
	for (const fn of handlers.session_stop) results.push((await fn({ session_id: "s-1", session_file: join(dir, "s-1.jsonl") }, ctx)) as { decision?: string; reason?: string } | undefined);
	// Both gates evaluate (each spends its own allowance); omp keeps the FIRST block, which is the bridged one.
	expect(results.filter(r => r?.decision === "block").length).toBe(2);
	const merged = results.find(r => r?.decision === "block");
	expect(merged?.reason).toBe("BRIDGED gate");
	expect(merged?.reason).not.toContain("delegation gate");
});

test("when the bridged chain passes, the delegation gate still blocks once", async () => {
	mkdirSync(join(dir, "docs"));
	const h = harness();
	const apiHandlers: Record<string, Handler[]> = {};
	const shared = { on: (name: string, fn: Handler) => (apiHandlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">;
	registerStopBridge(shared, { hooks: [hook("completion_gate.py")], run: async () => "", cache: h.cache, env: {} });
	register(shared, { activeTools: () => [], spawnBoardMirror: () => { } });
	const ctx = h.ctx();
	await apiHandlers.tool_call.at(-1)?.({ toolName: "write", input: { path: "src/app.ts" } }, ctx);
	const first: unknown[] = [];
	for (const fn of apiHandlers.session_stop) first.push(await fn({ session_id: "s-1", session_file: join(dir, "s-1.jsonl") }, ctx));
	expect(first.filter(Boolean).length).toBe(1);
	expect(first.find(Boolean)).toMatchObject({ decision: "block", reason: expect.stringContaining("delegation gate") });
});

// ---- detached SessionEnd / SubagentStop / PreCompact ingest ----

test("session_shutdown spawns a detached ingest: SessionEnd for main, SubagentStop for sub", async () => {
	const main = harness();
	await main.emit("session_shutdown", {}, main.ctx("main", "m-1"));
	expect(main.log).toEqual(["convert", "spawn"]); // converted first, child never awaited
	const payload = JSON.parse(readFileSync(main.spawns[0].opts.stdinFile, "utf8"));
	expect(payload).toEqual({ hook_event_name: "SessionEnd", session_id: "m-1", cwd: dir, transcript_path: main.converts[0].out });
	expect(main.spawns[0].argv.join(" ")).toContain("ingest_session.py");
	expect(main.spawns[0].opts.env).toMatchObject({ ATLAS_HARNESS: "omp", ATLAS_MANDATES: "off" });

	const sub = harness();
	await sub.emit("session_shutdown", {}, sub.ctx("sub", "agent-7"));
	expect(JSON.parse(readFileSync(sub.spawns[0].opts.stdinFile, "utf8"))).toMatchObject({ hook_event_name: "SubagentStop", session_id: "agent-7" });
	expect(sub.converts[0].out).toContain("/subagents/agent-agent-7.jsonl"); // the path dispatch_tripwire keys _in_subagent on
});

test("ingest spawns are deduped per session and event, and bounded per session", async () => {
	const h = harness();
	const c = h.ctx("main", "dup");
	for (let i = 0; i < MAX_INGEST_PER_EVENT + 3; i++) await h.emit("session_shutdown", {}, c);
	expect(h.spawns.length).toBe(MAX_INGEST_PER_EVENT);
	await h.emit("session_shutdown", {}, h.ctx("main", "other"));
	expect(h.spawns.length).toBe(MAX_INGEST_PER_EVENT + 1); // a different session is independent
});

test("auto_compaction_start ingests as PreCompact and is throttled", async () => {
	let t = 1_000_000;
	const handlers: Record<string, Handler[]> = {};
	const spawns: Spawn[] = [];
	registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [hook("ingest_session.py", "PreCompact")],
		run: async () => "",
		cache: { convertFresh: async () => "/t.jsonl", forToolHook: async () => "" },
		env: {},
		now: () => t,
		spawnDetached: (argv, opts) => spawns.push({ argv, opts }),
	});
	const ctx: Ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "c", getSessionFile: () => "f" } };
	await handlers.auto_compaction_start[0]({ reason: "threshold", action: "context-full" }, ctx);
	await handlers.auto_compaction_start[0]({}, ctx); // inside the throttle window
	expect(spawns.length).toBe(1);
	expect(JSON.parse(readFileSync(spawns[0].opts.stdinFile, "utf8")).hook_event_name).toBe("PreCompact");
	t += 61_000;
	await handlers.auto_compaction_start[0]({}, ctx);
	expect(spawns.length).toBe(2);
	expect(handlers.session_before_compact).toBeUndefined(); // registering it would disable async compaction
});

test("no spawn without a converted transcript, a session id, or with ATLAS_INGEST=off", async () => {
	const failed = harness({ convertOk: false });
	await failed.emit("session_shutdown", {}, failed.ctx());
	expect(failed.spawns).toEqual([]);
	const noId = harness();
	await noId.emit("session_shutdown", {}, { ...noId.ctx(), sessionManager: { getSessionId: () => "", getSessionFile: () => "f" } });
	expect(noId.spawns).toEqual([]);
	const off = harness({ env: { ATLAS_INGEST: "off" } });
	await off.emit("session_shutdown", {}, off.ctx());
	expect(off.spawns).toEqual([]);
});

// ---- fail-open ----

test("a throwing converter, runner and spawner never reach omp", async () => {
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [hook("completion_gate.py"), hook("ingest_session.py", "SessionEnd")],
		run: async () => {
			throw new Error("runner exploded");
		},
		cache: {
			convertFresh: async () => {
				throw new Error("convert exploded");
			},
			forToolHook: async () => "",
		},
		env: {},
		spawnDetached: () => {
			throw new Error("spawn exploded");
		},
	});
	const ctx: Ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "f" } };
	expect(await handlers.session_stop[0]({ session_id: "s", session_file: "f" }, ctx)).toBeUndefined();
	await handlers.session_shutdown[0]({}, ctx);
	await handlers.auto_compaction_start[0]({}, ctx);
	// a throwing ctx getter too
	const hostile = { cwd: dir, agent: { kind: "main" }, get sessionManager(): never { throw new Error("no session manager"); } } as unknown as Ctx;
	expect(await handlers.session_stop[0]({}, hostile)).toBeUndefined();
});

test("a really broken python hook neither wedges nor blocks the stop", async () => {
	const broken = join(dir, "broken.py");
	writeFileSync(broken, "import sys\nsys.stdin.read()\nraise SystemExit(7)\n");
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [{ event: "Stop", matcher: undefined, command: `python3 "${broken}"`, timeoutMs: 5_000 }],
		run: runHook,
		cache: { convertFresh: async () => "/t.jsonl", forToolHook: async () => "" },
		env: {},
	});
	const ctx: Ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "f" } };
	const started = Date.now();
	expect(await handlers.session_stop[0]({ session_id: "s", session_file: "f" }, ctx)).toBeUndefined();
	expect(Date.now() - started).toBeLessThan(10_000);
});

test("a hung python hook is killed at its timeout and the stop passes", async () => {
	const handlers: Record<string, Handler[]> = {};
	registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [{ event: "Stop", matcher: undefined, command: 'python3 -c "import time; time.sleep(30)"', timeoutMs: 600 }],
		run: runHook,
		cache: { convertFresh: async () => "/t.jsonl", forToolHook: async () => "" },
		env: {},
	});
	const ctx: Ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "f" } };
	const started = Date.now();
	expect(await handlers.session_stop[0]({ session_id: "s", session_file: "f" }, ctx)).toBeUndefined();
	expect(Date.now() - started).toBeLessThan(6_000);
});

// ---- the REAL hooks.json -> runHook -> completion_gate.py path ----

test("real completion_gate.py blocks an orchestrating run with no ROADMAP, through the real wiring", async () => {
	const saved = { db: process.env.ATLAS_DB, gate: process.env.ATLAS_GATE };
	delete process.env.ATLAS_GATE;
	process.env.ATLAS_DB = join(dir, "atlas.db");
	try {
		const repo = join(dir, "repo");
		mkdirSync(join(repo, "docs"), { recursive: true });
		writeFileSync(join(repo, "docs", "CHANGELOG.md"), "# Changelog\n- seeded\n");
		writeFileSync(join(repo, "README.md"), "# repo\n");
		// What omp_runstate.py begin/arm produce: a run row flagged orchestrating (the gate is silent without it).
		const seed = Bun.spawnSync(
			["python3", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import atlas_db as d; c=d.connect(); d.init(c); d.start_run(c, 's-real', sys.argv[2]); d.mark_orchestrating(c, 's-real', sys.argv[2])", join(import.meta.dir, "..", "scripts"), repo],
			{ env: { ...process.env, ATLAS_DB: join(dir, "atlas.db") }, stdout: "ignore", stderr: "ignore" },
		);
		expect(seed.exitCode).toBe(0);

		const hooks = loadBridgedHooksFor(["Stop"], "bridgedSessionEnd");
		expect(hooks.map(h => scriptOf(h.command))).toEqual(["completion_gate.py", "ingest_session.py", "chronicle_facet.py", "memory_capture.py", "nudge.py"]); // hooks.json order
		const handlers: Record<string, Handler[]> = {};
		registerStopBridge({ on: (name: string, fn: Handler) => (handlers[name] ??= []).push(fn) } as unknown as Pick<ExtensionAPI, "on">, {
			hooks,
			cache: { convertFresh: async () => "", forToolHook: async () => "" },
			env: { ATLAS_BRIDGE_HOOK_TIMEOUT_S: "20" },
		});
		const ctx: Ctx = { cwd: repo, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s-real", getSessionFile: () => "" } };
		const result = (await handlers.session_stop[0]({ session_id: "s-real", session_file: "", stop_hook_active: false }, ctx)) as { decision?: string; reason?: string } | undefined;
		expect(result?.decision).toBe("block");
		expect(result?.reason).toContain("ROADMAP");

		// Same project with the gap closed passes: the gate speaks only when it blocks.
		writeFileSync(join(repo, "docs", "ROADMAP.md"), "# Roadmap\n- next\n");
		expect(await handlers.session_stop[0]({ session_id: "s-real", session_file: "", stop_hook_active: false }, ctx)).toBeUndefined();
	} finally {
		if (saved.db === undefined) delete process.env.ATLAS_DB;
		else process.env.ATLAS_DB = saved.db;
		if (saved.gate === undefined) delete process.env.ATLAS_GATE;
		else process.env.ATLAS_GATE = saved.gate;
	}
});

test("claudeLifecyclePayload carries stop_hook_active only on Stop", () => {
	const fields = { sessionId: "s", cwd: "/p", transcriptPath: "/t" };
	expect(claudeLifecyclePayload("Stop", { ...fields, stopHookActive: true })).toEqual({ hook_event_name: "Stop", session_id: "s", cwd: "/p", transcript_path: "/t", stop_hook_active: true });
	expect(claudeLifecyclePayload("SessionEnd", fields)).toEqual({ hook_event_name: "SessionEnd", session_id: "s", cwd: "/p", transcript_path: "/t" });
	expect(claudeLifecyclePayload("PreCompact", { sessionId: "s", cwd: "/p" })).toMatchObject({ transcript_path: "" });
});

// The detached ingest child is the one place the bridge shells out for real; every other test injects a fake
// spawner, which is how a leaked temp dir per ingest shipped past the whole suite. These run the REAL script.
async function runDetached(argv: string[], setup: (spawnDir: string) => void = () => { }) {
	const spawnDir = mkdtempSync(join(tmpdir(), "atlas-ingest-test-"));
	const stdinFile = join(spawnDir, "payload.json");
	writeFileSync(stdinFile, "{}");
	setup(spawnDir);
	const child = startDetached(argv, { cwd: dir, stdinFile, env: {} });
	expect(child).toBeDefined();
	await child!.exited;
	return { spawnDir, stdinFile };
}

test("detached ingest removes its stdin file AND its temp dir on success", async () => {
	const { spawnDir, stdinFile } = await runDetached(["true"]);
	expect(existsSync(stdinFile)).toBe(false);
	expect(existsSync(spawnDir)).toBe(false);
});

test("detached ingest still cleans up when the child command fails", async () => {
	const { spawnDir, stdinFile } = await runDetached(["false"]);
	expect(existsSync(stdinFile)).toBe(false);
	expect(existsSync(spawnDir)).toBe(false);
});

test("detached cleanup never deletes a temp dir that holds anything besides the payload (rmdir, not rm -rf)", async () => {
	const { spawnDir, stdinFile } = await runDetached(["true"], d => writeFileSync(join(d, "keep.txt"), "do not delete"));
	expect(existsSync(stdinFile)).toBe(false);
	expect(existsSync(join(spawnDir, "keep.txt"))).toBe(true);
	rmSync(spawnDir, { recursive: true, force: true });
});
