// session-end bridge: Stop synthesis and ordering, block mapping and self-limits,
// composition with the native gates, detached SessionEnd/SubagentStop/PreCompact
// ingest, and fail-open behavior. Handler logic runs against recording fakes; one
// test drives the REAL completion_gate.py end to end through the real runner.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type BridgedHook, type HookRunner, claudeLifecyclePayload, loadBridgedHooksFor, parseStopHookOutput, runHook } from "./hook-bridge";
import { register } from "./index";
import { type TranscriptCache, MAX_INGEST_PER_EVENT, MAX_STOP_BLOCKS, convertTranscript, createTranscriptCache, registerStopBridge, startDetached } from "./stop-bridge";

type Ctx = { cwd: string; agent: { kind: "main" | "sub" }; sessionManager: { getSessionId(): string; getSessionFile(): string } };
type Handler = (event: Record<string, unknown>, ctx: Ctx) => unknown;
type Spawn = { argv: string[]; opts: { cwd: string; stdinFile: string; env: Record<string, string> } };

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-stop-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const hook = (name: string, event: BridgedHook["event"] = "Stop"): BridgedHook => ({ event, matcher: undefined, command: `python3 "/x/${name}"`, timeoutMs: 60_000 });
const scriptOf = (command: string) => /([\w.-]+\.py)/.exec(command)?.[1] ?? "";
const block = (reason: string) => JSON.stringify({ decision: "block", reason });

/** Event log shared by the fakes so cross-component ORDER is assertable. */
function harness(opts: { stdout?: Record<string, string>; hooks?: BridgedHook[]; convertOk?: boolean; env?: Record<string, string | undefined>; rebaseline?: (cwd: string, sessionId: string) => Promise<void> } = {}) {
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
	const convert = async (sessionFile: string, out: string) => {
		log.push("convert");
		converts.push({ sessionFile, out });
		if (opts.convertOk === false) return false;
		writeFileSync(out, "{}\n");
		return true;
	};
	const cache = createTranscriptCache({ baseDir: join(dir, "cache"), convert });
	const hooks = opts.hooks ?? [hook("completion_gate.py"), hook("ingest_session.py"), hook("chronicle_facet.py"), hook("memory_capture.py"), hook("nudge.py"), hook("ingest_session.py", "SessionEnd"), hook("ingest_session.py", "SubagentStop"), hook("ingest_session.py", "PreCompact")];
	registerStopBridge(api as unknown as Pick<ExtensionAPI, "on">, {
		rebaseline: async (cwd, sessionId) => {
			log.push(`rebaseline:${sessionId}`);
			await opts.rebaseline?.(cwd, sessionId);
		},
		hooks,
		run,
		cache,
		convert,
		env: opts.env ?? {},
		tmpDir: dir,
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

test("Stop folds tool state into the dirty snapshot after conversion and strictly before the gate reads it", async () => {
	const h = harness();
	await h.stop();
	expect(h.log.filter(l => l === "convert" || l.startsWith("rebaseline:") || l === "hook:completion_gate.py")).toEqual(["convert", "rebaseline:s-1", "hook:completion_gate.py"]);
	expect(h.log.filter(l => l.startsWith("rebaseline:")).length).toBe(1);
});

test("a throwing rebaseline costs the gate nothing: the block still reaches omp", async () => {
	const h = harness({ stdout: { "completion_gate.py": block("(d) ROADMAP missing") }, rebaseline: async () => { throw new Error("boom"); } });
	expect(await h.stop()).toEqual({ decision: "block", reason: "(d) ROADMAP missing" });
	expect(h.log).toContain("hook:completion_gate.py");
});

test("a hung rebaseline is abandoned at its budget and the gate still runs", async () => {
	const h = harness({ rebaseline: () => new Promise<void>(() => { }) }); // never settles
	const t0 = Date.now();
	await h.stop();
	expect(Date.now() - t0).toBeLessThan(5_000);
	expect(h.log).toContain("hook:completion_gate.py");
});

test("rebaseline is main-only and stands down with the bridge", async () => {
	const sub = harness();
	await sub.stop({}, sub.ctx("sub"));
	expect(sub.log.some(l => l.startsWith("rebaseline:"))).toBe(false);
	const off = harness({ env: { ATLAS_STOP_BRIDGE: "off" } });
	await off.stop();
	expect(off.log.some(l => l.startsWith("rebaseline:"))).toBe(false);
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
	// the child owns the directory its payload AND its transcript live in: nothing is shared with another child
	expect(main.converts[0].out.startsWith(main.spawns[0].opts.ownedDir + "/")).toBe(true);
	expect(main.spawns[0].opts.stdinFile.startsWith(main.spawns[0].opts.ownedDir + "/")).toBe(true);

	const sub = harness();
	await sub.emit("session_shutdown", {}, sub.ctx("sub", "agent-7"));
	expect(JSON.parse(readFileSync(sub.spawns[0].opts.stdinFile, "utf8"))).toMatchObject({ hook_event_name: "SubagentStop", session_id: "agent-7" });
	expect(sub.converts[0].out).toContain("agent-agent-7.jsonl");
});

test("every detached ingest converts into its OWN directory, so no two children can share or delete a file", async () => {
	const h = harness();
	const c = h.ctx("main", "dup");
	for (let i = 0; i < MAX_INGEST_PER_EVENT; i++) await h.emit("session_shutdown", {}, c);
	const dirs = h.spawns.map(sp => sp.opts.ownedDir);
	const transcripts = h.converts.map(cv => cv.out);
	expect(new Set(dirs).size).toBe(MAX_INGEST_PER_EVENT);
	expect(new Set(transcripts).size).toBe(MAX_INGEST_PER_EVENT);
	for (const sp of h.spawns) expect(existsSync(sp.opts.ownedDir)).toBe(true);
});

test("ingest spawns are deduped per session and event, and bounded per session", async () => {
	const h = harness();
	const c = h.ctx("main", "dup");
	for (let i = 0; i < MAX_INGEST_PER_EVENT + 3; i++) await h.emit("session_shutdown", {}, c);
	expect(h.spawns.length).toBe(MAX_INGEST_PER_EVENT);
	// a refused ingest converts nothing, so there is nothing to clean up and nothing it can disturb
	expect(h.converts.length).toBe(MAX_INGEST_PER_EVENT);
	expect(readdirSync(dir).filter(n => n.startsWith("atlas-ingest-")).length).toBe(MAX_INGEST_PER_EVENT);
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
		convert: async (_f, out) => (writeFileSync(out, "{}\n"), true),
		env: {},
		tmpDir: dir,
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

test("a failed detached conversion spawns nothing and leaves no directory behind", async () => {
	const h = harness({ convertOk: false });
	await h.emit("session_shutdown", {}, h.ctx());
	expect(h.spawns).toEqual([]);
	expect(readdirSync(dir).filter(n => n.startsWith("atlas-ingest-"))).toEqual([]);
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
		const sid = `s-real-${process.pid}-${Date.now()}`; // hook state (block-once, circuit breaker) is keyed by session id under ~/.atlas/hookstate: a fixed id leaks across runs
		const repo = join(dir, "repo");
		mkdirSync(join(repo, "docs"), { recursive: true });
		writeFileSync(join(repo, "docs", "CHANGELOG.md"), "# Changelog\n- seeded\n");
		writeFileSync(join(repo, "README.md"), "# repo\n");
		// What omp_runstate.py begin/arm produce: a run row flagged orchestrating (the gate is silent without it).
		const seed = Bun.spawnSync(
			["python3", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import atlas_db as d; c=d.connect(); d.init(c); d.start_run(c, d.register_project(c, sys.argv[2], 'repo'), sys.argv[3]); d.mark_orchestrating(c, sys.argv[3], sys.argv[2])", join(import.meta.dir, "..", "scripts"), repo, sid],
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
		const ctx: Ctx = { cwd: repo, agent: { kind: "main" }, sessionManager: { getSessionId: () => sid, getSessionFile: () => "" } };
		const result = (await handlers.session_stop[0]({ session_id: sid, session_file: "", stop_hook_active: false }, ctx)) as { decision?: string; reason?: string } | undefined;
		expect(result?.decision).toBe("block");
		expect(result?.reason).toContain("ROADMAP");

		// Same project with the gap closed passes: the gate speaks only when it blocks.
		writeFileSync(join(repo, "docs", "ROADMAP.md"), "# Roadmap\n- next\n");
		expect(await handlers.session_stop[0]({ session_id: sid, session_file: "", stop_hook_active: false }, ctx)).toBeUndefined();
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

test("session_stop's last_assistant_message reaches the Stop payload as the joined text of its text blocks", async () => {
	const h = harness();
	await h.stop({
		last_assistant_message: { role: "assistant", content: [{ type: "text", text: "ATLAS | ✅ verify | green" }, { type: "thinking", thinking: "private reasoning" }, { type: "text", text: "second paragraph" }] },
	});
	expect(h.payloads[0].last_assistant_message).toBe("ATLAS | ✅ verify | green\nsecond paragraph");
	expect(h.payloads[0]).toMatchObject({ hook_event_name: "Stop", session_id: "s-1", stop_hook_active: false });
});

test("a session_stop without usable last_assistant_message text leaves the Claude-shaped payload untouched", async () => {
	const unusable = [{}, { last_assistant_message: undefined }, { last_assistant_message: { role: "assistant", content: [] } }, { last_assistant_message: { role: "assistant", content: [{ type: "thinking", thinking: "only thoughts" }] } }, { last_assistant_message: "not an AgentMessage" }, { last_assistant_message: { role: "assistant", content: "bare string" } }];
	for (const extra of unusable) {
		const h = harness();
		await h.stop(extra);
		expect(h.payloads[0]).toEqual({ hook_event_name: "Stop", session_id: "s-1", cwd: dir, transcript_path: h.converts[0].out, stop_hook_active: false });
	}
});

// ---- converted transcripts are plaintext copies of whole sessions: none may outlive the hook that read it ----

/** Every file or directory left anywhere under `root` (relative), so a leak shows up by name. */
function leftovers(root: string): string[] {
	if (!existsSync(root)) return [];
	const out: string[] = [];
	const walk = (d: string) => {
		for (const name of readdirSync(d, { withFileTypes: true })) {
			const full = join(d, name.name);
			out.push(full.slice(root.length + 1));
			if (name.isDirectory()) walk(full);
		}
	};
	walk(root);
	return out.sort();
}

test("Stop deletes the converted transcript after the hooks have read it, whether they pass or block", async () => {
	for (const stdout of [{}, { "completion_gate.py": block("not done") }]) {
		const h = harness({ stdout });
		const seenDuringHooks: boolean[] = [];
		const realRun = h.payloads; // payload.transcript_path is what each hook was handed
		await h.stop({ session_id: "s-1", session_file: join(dir, "s-1.jsonl") }, h.ctx());
		const handed = String((realRun[0] as Record<string, unknown>).transcript_path);
		seenDuringHooks.push(handed.length > 0);
		expect(seenDuringHooks).toEqual([true]); // the hooks were given a real path...
		expect(existsSync(handed)).toBe(false); // ...and it is gone once they finished
		expect(leftovers(join(dir, "cache"))).toEqual([]); // no file and no empty dir left
	}
});

test("Stop's transcript still exists while each hook runs (deletion happens after, never before)", async () => {
	const existedAt: boolean[] = [];
	const h = harness({ hooks: [hook("completion_gate.py"), hook("ingest_session.py")] });
	// replace the recording runner by checking the file from inside a second harness run
	const handlers: Record<string, Handler[]> = {};
	const cache = createTranscriptCache({
		baseDir: join(dir, "cache2"),
		convert: async (_f, out) => {
			writeFileSync(out, "{}\n");
			return true;
		},
	});
	registerStopBridge({ on: (n: string, f: Handler) => (handlers[n] ??= []).push(f) } as unknown as Pick<ExtensionAPI, "on">, {
		hooks: [hook("completion_gate.py"), hook("ingest_session.py")],
		run: async (_cmd, payload) => {
			existedAt.push(existsSync(String((payload as Record<string, unknown>).transcript_path)));
			return "";
		},
		cache,
		env: {},
		tmpDir: dir,
	});
	void h;
	await handlers.session_stop[0]({ session_id: "s", session_file: join(dir, "s.jsonl") }, { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => join(dir, "s.jsonl") } });
	expect(existedAt).toEqual([true, true]);
	expect(leftovers(join(dir, "cache2"))).toEqual([]);
});

// The advisor's scenario: a running subagent's transcript lives in the shared base; a main conversion and its
// discard must not touch it. Uses the REAL converter so its sidecar writing and pruning are exercised too.
test("a main conversion and its discard leave a running subagent's transcript alone (real converter)", async () => {
	const fixture = join(import.meta.dir, "..", "scripts", "fixtures", "omp_session", "omp-fixture-session.jsonl");
	const base = join(dir, "shared-base");
	const cache = createTranscriptCache({ baseDir: base });
	mkdirSync(join(base, "subagents"), { recursive: true });
	const live = join(base, "subagents", "agent-live-sub-1.jsonl");
	writeFileSync(live, "{\"type\":\"user\",\"sessionId\":\"live-sub-1\"}\n");

	const main = await cache.convertFresh(fixture, "lead", "main");
	expect(main).toBeDefined();
	expect(readdirSync(join(main!, "..", "subagents")).length).toBeGreaterThan(0); // the real converter wrote sidecars...
	expect(readFileSync(live, "utf8")).toContain("live-sub-1"); // ...without pruning the live subagent's file

	cache.discard!(main);
	expect(existsSync(main!)).toBe(false);
	expect(existsSync(join(main!, ".."))).toBe(false); // the whole per-conversion directory is gone, sidecars included
	expect(readFileSync(live, "utf8")).toContain("live-sub-1"); // and the live subagent's transcript still exists
});

test("two overlapping main conversions for one session do not share files, so discarding one leaves the other", async () => {
	const fixture = join(import.meta.dir, "..", "scripts", "fixtures", "omp_session", "omp-fixture-session.jsonl");
	const cache = createTranscriptCache({ baseDir: join(dir, "b2") });
	const first = await cache.convertFresh(fixture, "lead", "main");
	const second = await cache.convertFresh(fixture, "lead", "main");
	expect(first).not.toBe(second);
	cache.discard!(first);
	expect(existsSync(first!)).toBe(false);
	expect(existsSync(second!)).toBe(true);
	expect(readdirSync(join(second!, "..", "subagents")).length).toBeGreaterThan(0); // its sidecars are intact too
	cache.discard!(second);
	expect(leftovers(join(dir, "b2"))).toEqual([]);
});

test("discard removes only the named file and empty parents, never a sibling transcript", () => {
	const base = join(dir, "base");
	const cache = createTranscriptCache({ baseDir: base, convert: async () => true });
	mkdirSync(join(base, "subagents"), { recursive: true });
	const a = join(base, "subagents", "agent-a.jsonl");
	const b = join(base, "subagents", "agent-b.jsonl");
	writeFileSync(a, "a");
	writeFileSync(b, "b");
	void cache.convertFresh; // primes nothing; base is set lazily by convertFresh below
	return cache.convertFresh("f", "s", "main").then(() => {
		cache.discard!(a);
		expect(existsSync(a)).toBe(false);
		expect(existsSync(b)).toBe(true); // sibling survives, so subagents/ and base survive too
		expect(existsSync(join(base, "subagents"))).toBe(true);
		cache.discard!(b);
		expect(existsSync(b)).toBe(false);
		expect(existsSync(join(base, "subagents"))).toBe(false);
	});
});

test("discard refuses a path outside the cache base, including a sibling that merely shares its prefix", async () => {
	const base = join(dir, "base");
	const cache = createTranscriptCache({ baseDir: base, convert: async (_f, out) => (writeFileSync(out, "{}"), true) });
	await cache.convertFresh("f", "s", "main");
	const outside = join(dir, "important.txt");
	const prefixSibling = join(dir, "base-other");
	mkdirSync(prefixSibling);
	const sibFile = join(prefixSibling, "x.jsonl");
	writeFileSync(outside, "keep");
	writeFileSync(sibFile, "keep");
	cache.discard!(outside);
	cache.discard!(sibFile);
	cache.discard!(join(base, "..", "important.txt")); // traversal that resolves outside
	cache.discard!("");
	cache.discard!(undefined);
	expect(readFileSync(outside, "utf8")).toBe("keep");
	expect(readFileSync(sibFile, "utf8")).toBe("keep");
	expect(existsSync(prefixSibling)).toBe(true);
});

test("a cache without discard (or one that throws) never costs the gate its verdict", async () => {
	for (const discard of [undefined, () => { throw new Error("boom"); }]) {
		const handlers: Record<string, Handler[]> = {};
		registerStopBridge({ on: (n: string, f: Handler) => (handlers[n] ??= []).push(f) } as unknown as Pick<ExtensionAPI, "on">, {
			hooks: [hook("completion_gate.py")],
			run: async () => block("still blocks"),
			cache: { convertFresh: async () => "/t.jsonl", forToolHook: async () => "", discard },
			env: {},
			tmpDir: dir,
		});
		const result = await handlers.session_stop[0]({ session_id: "s", session_file: "f" }, { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s", getSessionFile: () => "f" } });
		expect(result).toMatchObject({ decision: "block", reason: "still blocks" });
	}
});

// ---- the detached child owns one directory and removes exactly that directory (real /bin/sh, real converter) ----

const FIXTURE = join(import.meta.dir, "..", "scripts", "fixtures", "omp_session", "omp-fixture-session.jsonl");

/** Makes an `atlas-ingest-*` dir, converts the fixture into it with the REAL converter, and runs `argv` as the child. */
async function runOwned(argv: string[], opts: { name?: string; extra?: (d: string) => void } = {}) {
	const owned = mkdtempSync(join(dir, opts.name ?? "atlas-ingest-"));
	const transcript = join(owned, "session-x.jsonl");
	expect(await convertTranscript(FIXTURE, transcript, 10_000)).toBe(true);
	const stdinFile = join(owned, "payload.json");
	writeFileSync(stdinFile, "{}");
	opts.extra?.(owned);
	await startDetached(argv, { cwd: dir, stdinFile, ownedDir: owned, env: {} })!.exited;
	return owned;
}

test("the real converter really does write colony and advisor sidecars next to its output (precondition of the next tests)", async () => {
	const owned = mkdtempSync(join(dir, "atlas-ingest-"));
	expect(await convertTranscript(FIXTURE, join(owned, "session-x.jsonl"), 10_000)).toBe(true);
	expect(readdirSync(join(owned, "subagents")).length).toBeGreaterThan(0);
});

test("the detached child removes the transcript, every sidecar and the directory: no atlas-ingest-* survives", async () => {
	const owned = await runOwned(["true"]);
	expect(existsSync(owned)).toBe(false);
	expect(readdirSync(dir).filter(n => n.startsWith("atlas-ingest-"))).toEqual([]);
});

test("the detached child cleans up the same way when the ingest command fails", async () => {
	const owned = await runOwned(["false"]);
	expect(existsSync(owned)).toBe(false);
});

test("the shell refuses to clean a directory that is not named atlas-ingest-*", async () => {
	const owned = await runOwned(["true"], { name: "precious-" });
	expect(existsSync(join(owned, "session-x.jsonl"))).toBe(true); // wrong name: nothing deleted
	expect(existsSync(join(owned, "subagents"))).toBe(true);
});

test("an unexpected extra file survives (rmdir, not rm -rf), and so does its directory", async () => {
	const owned = await runOwned(["true"], { extra: d => writeFileSync(join(d, "keep.txt"), "do not delete") });
	expect(readFileSync(join(owned, "keep.txt"), "utf8")).toBe("do not delete");
	expect(existsSync(join(owned, "session-x.jsonl"))).toBe(false); // the files it owns are still gone
});

test("two children running at once each remove only their own directory", async () => {
	const a = mkdtempSync(join(dir, "atlas-ingest-"));
	const b = mkdtempSync(join(dir, "atlas-ingest-"));
	for (const d of [a, b]) {
		expect(await convertTranscript(FIXTURE, join(d, "session-x.jsonl"), 10_000)).toBe(true);
		writeFileSync(join(d, "payload.json"), "{}");
	}
	const slow = startDetached(["sh", "-c", "sleep 0.4"], { cwd: dir, stdinFile: join(a, "payload.json"), ownedDir: a, env: {} })!;
	const fast = startDetached(["true"], { cwd: dir, stdinFile: join(b, "payload.json"), ownedDir: b, env: {} })!;
	await fast.exited;
	expect(existsSync(b)).toBe(false); // the fast child cleaned its own
	expect(existsSync(join(a, "session-x.jsonl"))).toBe(true); // and did not touch the slow child's still-running files
	await slow.exited;
	expect(existsSync(a)).toBe(false);
});
