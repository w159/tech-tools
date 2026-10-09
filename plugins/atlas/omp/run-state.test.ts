// Run-state sink: argv shapes, once-per-session begin+snapshot, arm/event
// attribution, the tripwireRan double-write guard, and fail-open behavior against
// a recorder and against a really broken python CLI.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolEventInfo } from "./hook-bridge";
import { RUNSTATE_SCRIPT, createRunStateSink, runStateArgv } from "./run-state";

let dir: string;
let script: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-runstate-"));
	script = join(dir, "omp_runstate.py");
	writeFileSync(script, "# stub\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Sink over a recorder; `flush` awaits the sink's own in-flight chains (no wall-clock guessing). */
function sink(extra: { script?: string; run?: (argv: string[]) => void | Promise<void> } = {}) {
	const calls: string[][] = [];
	const s = createRunStateSink({
		script: extra.script ?? script,
		run: extra.run ?? (argv => void calls.push(argv)),
	});
	return { s, calls, flush: () => s.idle() };
}
const info = (over: Partial<ToolEventInfo>): ToolEventInfo => ({ toolName: "task", input: {}, cwd: "/p", sessionId: "s-1", tripwireRan: false, isError: false, ...over });
const sub = (call: string[]) => call[2];

test("argv shapes follow the omp_runstate.py contract", () => {
	expect(runStateArgv("begin", { sessionId: "s", cwd: "/p" }, "/x/r.py")).toEqual(["python3", "/x/r.py", "begin", "--session-id", "s", "--cwd", "/p"]);
	expect(runStateArgv("snapshot", { sessionId: "s", cwd: "/p", agentType: "ignored" }, "/x/r.py")).toEqual(["python3", "/x/r.py", "snapshot", "--session-id", "s", "--cwd", "/p"]);
	expect(runStateArgv("arm", { sessionId: "s", cwd: "/p", agentType: "implementer", model: "m", worktree: true }, "/x/r.py").slice(7)).toEqual(["--agent-type", "implementer", "--model", "m", "--worktree"]);
	expect(runStateArgv("arm", { sessionId: "s", cwd: "/p" }, "/x/r.py").slice(7)).toEqual([]);
	expect(runStateArgv("event", { sessionId: "s", cwd: "/p", tool: "Edit", path: "/p/a.ts", dispatch: "x" }, "/x/r.py").slice(7)).toEqual(["--tool", "Edit", "--path", "/p/a.ts", "--dispatch", "x"]);
	expect(RUNSTATE_SCRIPT.endsWith("scripts/omp_runstate.py")).toBe(true);
});

test("begin then snapshot run once, in order, for the first main session start only", async () => {
	const { s, calls, flush } = sink();
	s.onSessionStart({ cwd: "/p", sessionId: "s-1", kind: "main" });
	s.onSessionStart({ cwd: "/p", sessionId: "s-1", kind: "main" }); // omp may re-fire session_start
	await flush();
	expect(calls.map(sub)).toEqual(["begin", "snapshot"]);
	expect(calls[0]).toContain("s-1");
});

test("subagent sessions and blank session ids never begin a run", async () => {
	const { s, calls, flush } = sink();
	s.onSessionStart({ cwd: "/p", sessionId: "agent-1", kind: "sub" });
	s.onSessionStart({ cwd: "/p", sessionId: "", kind: "main" });
	await flush();
	expect(calls).toEqual([]);
	s.onSessionStart({ cwd: "/p", sessionId: "s-2", kind: "main" }); // a blank id must not burn the once-flag
	await flush();
	expect(calls.map(sub)).toEqual(["begin", "snapshot"]);
});

test("begin is invoked again on a later turn after a Stop finalized the run; session start stays once", async () => {
	const { s, calls, flush } = sink();
	const turn = { cwd: "/p", sessionId: "s-1", kind: "main" };
	s.onSessionStart(turn);
	await flush();
	s.onTurnStart(turn); // turn 1
	await flush();
	expect(calls.map(sub)).toEqual(["begin", "snapshot", "begin"]);
	// Stop finalizes the run (hooks/completion_gate.py finalize_run); the resumed session never fires session_start again,
	// so the next turn's begin is what reopens the run. No snapshot rides along.
	s.onSessionStart(turn);
	s.onTurnStart(turn); // turn 2, after the stop
	await flush();
	expect(calls.map(sub)).toEqual(["begin", "snapshot", "begin", "begin"]);
	expect(calls[3]).toEqual(["python3", script, "begin", "--session-id", "s-1", "--cwd", "/p"]);
});

test("a turn start begins even without a prior session start (resumed session)", async () => {
	const { s, calls, flush } = sink();
	s.onTurnStart({ cwd: "/p", sessionId: "s-r", kind: "main" });
	await flush();
	expect(calls.map(sub)).toEqual(["begin"]);
});

test("subagent turns, blank session ids and a missing CLI never begin on a turn", async () => {
	const { s, calls, flush } = sink();
	s.onTurnStart({ cwd: "/p", sessionId: "agent-1", kind: "sub" });
	s.onTurnStart({ cwd: "/p", sessionId: "", kind: "main" });
	await flush();
	expect(calls).toEqual([]);
	const missing = sink({ script: join(dir, "absent.py") });
	missing.s.onTurnStart({ cwd: "/p", sessionId: "s-1", kind: "main" });
	await missing.flush();
	expect(missing.calls).toEqual([]);
});

test("an allowed task dispatch arms with the first agent and detects isolation", async () => {
	const { s, calls, flush } = sink();
	s.onToolAllowed(info({ input: { tasks: [{ agent: "implementer", name: "A", isolated: true }, { agent: "explorer" }] } }));
	await flush();
	expect(calls[0].slice(2)).toEqual(["arm", "--session-id", "s-1", "--cwd", "/p", "--agent-type", "implementer", "--worktree"]);
	const plain = sink();
	plain.s.onToolAllowed(info({ input: { agent: "verifier", task: "x" } }));
	await plain.flush();
	expect(plain.calls[0]).not.toContain("--worktree");
	const claudeStyle = sink();
	claudeStyle.s.onToolAllowed(info({ input: { tasks: [{ agent: "implementer", isolation: "worktree" }] } }));
	await claudeStyle.flush();
	expect(claudeStyle.calls[0]).toContain("--worktree");
});

test("task results log the dispatch; edit and write results log the resolved path", async () => {
	const { s, calls, flush } = sink();
	s.onToolResult(info({ input: { agent: "implementer", task: "x" } }));
	s.onToolResult(info({ toolName: "edit", input: { path: "src/a.ts" } }));
	s.onToolResult(info({ toolName: "write", input: { paths: ["src/b.ts"] } }));
	s.onToolResult(info({ toolName: "read", input: { path: "a.ts" } })); // not tracked
	await flush();
	expect(calls.map(c => c.slice(2).join(" "))).toEqual([
		"event --session-id s-1 --cwd /p --tool Task --dispatch implementer",
		"event --session-id s-1 --cwd /p --tool Edit --path /p/src/a.ts",
		"event --session-id s-1 --cwd /p --tool Write --path /p/src/b.ts",
	]);
});

// An omp `write` to an `xd://mcp__...` URI is an MCP device call, not a file edit. Logged as a pathless Write event it
// counted toward the inline-op threshold and could register as a main-thread code write for condition (m).
test("an xd:// device write is an MCP call: it is neither armed nor logged as an inline Write", async () => {
	const { s, calls, flush } = sink();
	for (const path of ["xd://mcp__claude_mem_mcp_search_search", "xd://mcp__lean_ctx_ctx_search", "xd://mcp__atlas_falcon_falcon_status"]) {
		s.onToolAllowed(info({ toolName: "write", input: { path, content: "{}" } }));
		s.onToolResult(info({ toolName: "write", input: { path, content: "{}" } }));
	}
	s.onToolResult(info({ toolName: "write", input: { path: "local://notes.md", content: "x" } })); // not an MCP device: still a Write
	await flush();
	expect(calls.map(c => c.slice(2).join(" "))).toEqual(["event --session-id s-1 --cwd /p --tool Write"]);
});

test("nothing is written when the bridged dispatch_tripwire already ran (no double-counting)", async () => {
	const { s, calls, flush } = sink();
	s.onToolAllowed(info({ tripwireRan: true, input: { agent: "implementer" } }));
	s.onToolResult(info({ tripwireRan: true, input: { agent: "implementer" } }));
	s.onToolResult(info({ tripwireRan: true, toolName: "edit", input: { path: "a.ts" } }));
	await flush();
	expect(calls).toEqual([]);
});

test("a missing CLI is never called", async () => {
	const { s, calls, flush } = sink({ script: join(dir, "absent.py") });
	s.onSessionStart({ cwd: "/p", sessionId: "s-1", kind: "main" });
	s.onToolAllowed(info({ input: { agent: "implementer" } }));
	await flush();
	expect(calls).toEqual([]);
});

test("a throwing runner is swallowed and the chain stops without throwing into the caller", async () => {
	const seen: string[] = [];
	const { s, flush } = sink({
		run: argv => {
			seen.push(argv[2]);
			throw new Error("python exploded");
		},
	});
	expect(() => s.onSessionStart({ cwd: "/p", sessionId: "s-1", kind: "main" })).not.toThrow();
	expect(() => s.onToolResult(info({ toolName: "edit", input: { path: "a.ts" } }))).not.toThrow();
	await flush();
	expect(seen).toEqual(["begin", "event"]); // begin failed so snapshot was skipped; the edit event still ran
});

// Race: session_start and the first before_agent_start both fire `begin`. Run as independent chains they became two
// concurrent python processes and the check-then-insert in cmd_begin could open two runs for one session.
test("two begins fired in the same tick run strictly one after the other, even if the first fails", async () => {
	const events: string[] = [];
	const gates: PromiseWithResolvers<void>[] = [];
	const started: PromiseWithResolvers<void>[] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
	let active = 0;
	let maxActive = 0;
	const { s, flush } = sink({
		run: async argv => {
			const n = gates.length;
			const gate = Promise.withResolvers<void>();
			gates.push(gate);
			events.push(`start ${argv[2]}#${n}`);
			active++;
			maxActive = Math.max(maxActive, active);
			started[n]?.resolve();
			try {
				await gate.promise;
			} finally {
				active--;
				events.push(`end ${argv[2]}#${n}`);
			}
		},
	});
	const ctx = { cwd: "/p", sessionId: "s-1", kind: "main" };
	s.onSessionStart(ctx); // begin (then snapshot)
	s.onTurnStart(ctx); // begin, same tick
	await started[0].promise;
	expect(events).toEqual(["start begin#0"]); // the second begin is queued behind the first, not spawned alongside it
	gates[0].reject(new Error("first begin failed")); // its snapshot is skipped, but the tail must keep going
	await started[1].promise;
	expect(events).toEqual(["start begin#0", "end begin#0", "start begin#1"]);
	gates[1].resolve();
	await flush();
	expect(events).toEqual(["start begin#0", "end begin#0", "start begin#1", "end begin#1"]);
	expect(maxActive).toBe(1);
});

test("a really broken python CLI is fail-open and fast through the real runner", async () => {
	const broken = join(dir, "broken_runstate.py");
	writeFileSync(broken, "import sys\nsys.stderr.write('boom')\nraise SystemExit(9)\n");
	const s = createRunStateSink({ script: broken });
	const started = Date.now();
	s.onSessionStart({ cwd: dir, sessionId: "s-1", kind: "main" });
	s.onToolResult(info({ toolName: "edit", input: { path: "a.ts" }, cwd: dir }));
	await s.idle(); // the real children ran, exited non-zero, and nothing threw
	expect(Date.now() - started).toBeLessThan(10_000);
});
