// Regression tests for the omp extension core fixes: advisor gate state across failures and session switches,
// run-state per-session begin, delegation negative-cache, ast_edit visibility to the delegation gate, and the
// CLAUDE_PLUGIN_ROOT rewrite composing with the lean-ctx wrap.
import { afterEach, beforeEach, expect, test } from "bun:test";
process.env.ATLAS_GATES = "always"; // temp-dir cwd leaves gates unarmed otherwise (omp/scope.ts)
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAdvisorGate } from "./advisor";
import { createShellEditTracker } from "./delegation";
import extension, { register } from "./index";
import { createRunStateSink } from "./run-state";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-core-fixes-"));
	mkdirSync(join(dir, "docs"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ---- F4 advisor ----------------------------------------------------------------------------------------------------

type Handler = (event: unknown, ctx: unknown) => unknown;
function advisor(opts: { failFirst?: boolean; open?: string[] } = {}) {
	const handlers: Record<string, Handler> = {};
	const added: string[] = [];
	let failures = opts.failFirst ? 1 : 0;
	registerAdvisorGate({ on: (name: string, h: Handler) => (handlers[name] = h) } as never, {
		addBoardItem(text) {
			if (failures-- > 0) throw new Error("board down");
			added.push(text);
		},
		openAdvisorItems: () => opts.open ?? ["id-1"],
		env: {},
	});
	const ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s-1" } };
	const notes = (...texts: string[]) => ({
		messages: [{ role: "custom", customType: "advisor", details: { notes: texts.map(note => ({ note, severity: "blocker" })) } }],
	});
	return { handlers, added, ctx, notes };
}

test("F4: a note whose board write failed is retried, not marked seen, and later notes still land", () => {
	const a = advisor({ failFirst: true });
	a.handlers.context(a.notes("first", "second"), a.ctx);
	expect(a.added).toEqual(["advisor[blocker]: second"]); // loop was not aborted by the throw
	a.handlers.context(a.notes("first", "second"), a.ctx);
	expect(a.added).toEqual(["advisor[blocker]: second", "advisor[blocker]: first"]); // retried once, second not duplicated
});

test("F4: session_switch clears the seen set and the stop-block cap", () => {
	const a = advisor();
	a.handlers.context(a.notes("same"), a.ctx);
	a.handlers.context(a.notes("same"), a.ctx);
	expect(a.added).toHaveLength(1);
	for (let i = 0; i < 3; i++) expect(a.handlers.session_stop({}, a.ctx)).toMatchObject({ decision: "block" });
	expect(a.handlers.session_stop({}, a.ctx)).toBeUndefined(); // cap of 3 reached
	a.handlers.session_switch({}, a.ctx);
	a.handlers.context(a.notes("same"), a.ctx);
	expect(a.added).toHaveLength(2); // same text lands on the new session's board
	for (let i = 0; i < 3; i++) expect(a.handlers.session_stop({}, a.ctx)).toMatchObject({ decision: "block" });
});

// ---- F5 run-state --------------------------------------------------------------------------------------------------

test("F5: a second session id gets its own begin+snapshot; the same id is still once", async () => {
	const script = join(dir, "omp_runstate.py");
	writeFileSync(script, "# stub\n");
	const calls: string[][] = [];
	const s = createRunStateSink({ script, run: argv => void calls.push(argv) });
	s.onSessionStart({ cwd: "/p", sessionId: "s1", kind: "main" });
	s.onSessionStart({ cwd: "/p", sessionId: "s1", kind: "main" });
	s.onSessionStart({ cwd: "/p", sessionId: "s2", kind: "main" });
	await s.idle();
	expect(calls.map(c => `${c[2]}:${c[4]}`)).toEqual(["begin:s1", "snapshot:s1", "begin:s2", "snapshot:s2"]);
});

// ---- F6 delegation -------------------------------------------------------------------------------------------------

test("F6: a non-git dir is probed once per TTL, not on every capture, and re-probed after reset or expiry", () => {
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const log = join(dir, "git.log");
	writeFileSync(join(bin, "git"), `#!/bin/sh\necho x >> '${log}'\nexit 128\n`);
	chmodSync(join(bin, "git"), 0o755);
	const oldPath = process.env.PATH;
	process.env.PATH = `${bin}:${oldPath}`;
	try {
		let t = 1_000;
		const tracker = createShellEditTracker(() => t);
		const spawns = () => (readFileSync(log, "utf8").match(/x/g) ?? []).length;
		for (let i = 0; i < 25; i++) tracker.capture(dir);
		expect(spawns()).toBe(1);
		t += 61_000;
		tracker.capture(dir);
		expect(spawns()).toBe(2); // TTL expired
		tracker.reset();
		tracker.capture(dir);
		expect(spawns()).toBe(3); // new session probes at once
		expect(tracker.stop(dir)).toEqual([]); // still fails open
	} finally {
		process.env.PATH = oldPath;
	}
});

// ---- F8 ast_edit / multi-path edit ---------------------------------------------------------------------------------

function gate() {
	const handlers: Record<string, (e: unknown, c: unknown) => any> = {};
	register({ on: (name: string, h: never) => (handlers[name] = h) } as never, { activeTools: () => ["read", "edit", "bash", "task"], spawnBoardMirror: () => {} });
	const ctx = { cwd: dir, agent: { kind: "main", id: "Main" } };
	return {
		call: (toolName: string, input: Record<string, unknown>) => handlers.tool_call({ toolName, input }, ctx),
		stop: () => handlers.session_stop({ input: {} }, ctx),
	};
}

test("F8: ast_edit on code (or with no path) counts toward the delegation gate; on docs it does not", () => {
	const g = gate();
	g.call("ast_edit", { path: "docs/wiki.txt" });
	expect(g.stop()).toBeUndefined();
	g.call("ast_edit", { path: "src/main.ts" });
	expect(g.stop()).toMatchObject({ decision: "block" });
	const g2 = gate();
	g2.call("ast_edit", {});
	expect(g2.stop()).toMatchObject({ decision: "block" });
});

test("F8: a multi-path edit with one code path among docs paths counts", () => {
	const g = gate();
	g.call("edit", { paths: ["docs/a.txt", "src/b.ts"] });
	expect(g.stop()).toMatchObject({ decision: "block" });
});

// ---- F10 CLAUDE_PLUGIN_ROOT rewrite composes with the lean-ctx wrap ------------------------------------------------

test("F10: bash with ${CLAUDE_PLUGIN_ROOT} is both rewritten and wrapped in lean-ctx -c", () => {
	const bin = join(dir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "lean-ctx"), "#!/bin/sh\n");
	chmodSync(join(bin, "lean-ctx"), 0o755);
	const old = { PATH: process.env.PATH, LD: process.env.LEAN_CTX_DISABLED, SH: process.env.ATLAS_LEAN_SHELL, ROOT: process.env.CLAUDE_PLUGIN_ROOT };
	process.env.PATH = `${bin}:${old.PATH}`;
	delete process.env.LEAN_CTX_DISABLED;
	delete process.env.ATLAS_LEAN_SHELL;
	try {
		const first: Record<string, Handler> = {};
		const pi = new Proxy(
			{ getActiveTools: () => ["bash", "mcp__lean_ctx_ctx_shell"] },
			{
				get: (t, k: string) => (k in t ? (t as never)[k] : k === "on" ? (n: string, h: Handler) => void (first[n] ??= h) : () => {}),
			},
		);
		extension(pi as never);
		const handler = first.tool_call;
		const out = handler({ toolName: "bash", input: { command: "python3 ${CLAUDE_PLUGIN_ROOT}/scripts/x.py" } }, {}) as { input: { command: string } };
		expect(out.input.command).toStartWith(`${join(bin, "lean-ctx")} -c '`);
		expect(out.input.command).not.toContain("CLAUDE_PLUGIN_ROOT");
		expect(out.input.command).toContain("/scripts/x.py");
		// no placeholder: still wrapped; no wrap target (non-bash): untouched
		expect((handler({ toolName: "bash", input: { command: "ls" } }, {}) as { input: { command: string } }).input.command).toBe(`${join(bin, "lean-ctx")} -c 'ls'`);
		expect(handler({ toolName: "read", input: {} }, {})).toBeUndefined();
	} finally {
		process.env.PATH = old.PATH;
		if (old.LD !== undefined) process.env.LEAN_CTX_DISABLED = old.LD;
		if (old.SH !== undefined) process.env.ATLAS_LEAN_SHELL = old.SH;
		if (old.ROOT === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
		else process.env.CLAUDE_PLUGIN_ROOT = old.ROOT;
	}
});
