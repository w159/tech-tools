import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { runCaptureSync } from "./proc";
import { defaultLeanCtxBin, findExecutableOnPath, registerShellRoute, wrapCommand, type ShellRouteDeps } from "./shell-route";

// Parity with Claude Code's lean-ctx PreToolUse hook: a tool_call handler must
// rewrite every non-pty bash command (main AND sub sessions) to
// `<lean-ctx> -c '<command>'` whenever the binary resolves, a lean-ctx route is
// active in this session, and the env kill switches are off; anything else must
// return undefined and fail open. Escaping is proven by EXECUTION: a fake
// lean-ctx shim on PATH (it logs the received -c argument, then runs
// /bin/sh -c "$2") must receive and reproduce the original command
// byte-for-byte. All child IO goes through ./proc's temp-file transport, never
// pipes (bun's child stdio is broken under a relative-path bun test filter).

type Handler = (event: Record<string, unknown>, ctx?: unknown) => unknown;
type Call = { toolName: string; input?: Record<string, unknown> };

let root = "";

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "shell-route-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Fake `lean-ctx` on a PATH dir: marker-writes its -c argument, then executes it verbatim. */
function shimEnv(extra: Record<string, string | undefined> = {}): { env: Record<string, string | undefined>; marker: string; bin: string } {
	const binDir = join(root, "bin");
	mkdirSync(binDir, { recursive: true });
	const bin = join(binDir, "lean-ctx");
	const marker = join(root, "shim-marker.txt");
	writeFileSync(bin, `#!/bin/sh\nprintf '%s' "$2" > "$SHIM_MARKER"\nexec /bin/sh -c "$2"\n`);
	chmodSync(bin, 0o755);
	return {
		env: { ...process.env, ...extra, PATH: `${binDir}:${process.env.PATH ?? ""}`, SHIM_MARKER: marker },
		marker,
		bin,
	};
}

function harness(overrides: Partial<ShellRouteDeps> = {}) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, handler: Handler) => {
		handlers[name] = handler;
	} };
	registerShellRoute(api as unknown as Pick<ExtensionAPI, "on">, {
		leanCtxBin: () => "/opt/bin/lean-ctx",
		activeTools: () => ["bash", "mcp__lean_ctx_ctx_shell"],
		...overrides,
	});
	return handlers;
}

const MAIN = { cwd: "/tmp", agent: { kind: "main" } };
const SUB = { cwd: "/tmp/sub", agent: { kind: "sub" } };
const call = (command: string, extra: Record<string, unknown> = {}): Call => ({ toolName: "bash", input: { command, ...extra } });

// ---------------------------------------------------------------------------
// wrapCommand: pure POSIX wrapping + escaping, verified by actually executing
// /bin/sh -c <wrapped> and comparing against the bare command.
// ---------------------------------------------------------------------------

const PARITY_CASES: Array<[string, string]> = [
	["plain words", "echo plain"],
	["single-quoted $var must stay literal", "echo 'single $VOLT quoted'"],
	["embedded single quote inside double quotes", `echo "it's done"`],
	["double-quoted var expands identically", "echo hello $VOLT"],
	["quoted-delim heredoc keeps $var literal", "cat <<'EOF'\nheredoc $VOLT line\nEOF"],
	["pipe chain", "printf 'a b\\nc d\\n' | wc -l"],
	["command substitution + redirect", `echo "$(echo inner)" > rr.txt && cat rr.txt`],
	["stderr-producing command", "echo oops >&2; echo fine"],
];

test("wrapCommand escaping: executing the wrapped form reproduces the original command exactly", () => {
	for (const [name, cmd] of PARITY_CASES) {
		const { env, marker, bin } = shimEnv({ VOLT: "world" });
		const baseline = runCaptureSync(["/bin/sh", "-c", cmd], { env, cwd: root });
		const routed = runCaptureSync(["/bin/sh", "-c", wrapCommand(cmd, bin)], { env, cwd: root });
		expect(baseline.code, name).toBe(0);
		expect(routed.code, name).toBe(baseline.code);
		expect(routed.stdout, name).toBe(baseline.stdout);
		// the shim received the original command byte-for-byte: quote fidelity
		expect(readFileSync(marker, "utf8"), name).toBe(cmd);
	}
});

test("wrapCommand: wrapped shape is `<bin> -c '<cmd>'` and preserves $ vars literally", () => {
	const { bin: shimBin, env } = shimEnv({ HOME: "/nowhere-home" });
	const bin = "/usr/local/bin/lean-ctx";
	expect(wrapCommand("echo hi", bin)).toBe(`${bin} -c 'echo hi'`);
	const wrapped = wrapCommand("echo $HOME", shimBin);
	expect(wrapped.startsWith(`${shimBin} -c '`)).toBe(true);
	expect(wrapped.endsWith("'")).toBe(true);
	const out = runCaptureSync(["/bin/sh", "-c", wrapped], { env, cwd: root });
	expect(out.stdout).toBe("/nowhere-home\n");
});

test("wrapCommand idempotence: already-wrapped input passes through unchanged", () => {
	const bin = "/usr/local/bin/lean-ctx";
	const once = wrapCommand("echo 'spaced  msg'", bin);
	expect(wrapCommand(once, bin)).toBe(once);
	expect(wrapCommand(`lean-ctx -c 'echo hi'`, bin)).toBe(`lean-ctx -c 'echo hi'`);
	expect(wrapCommand(`${bin} -c 'echo hi'`, bin)).toBe(`${bin} -c 'echo hi'`);
});

// ---------------------------------------------------------------------------
// registerShellRoute: gating rules, one per skip; then the happy path for
// main and sub sessions, end-to-end through a real shell.
// ---------------------------------------------------------------------------

test("routes bash in main AND sub sessions to `<bin> -c '<cmd>'`", () => {
	const { bin } = shimEnv();
	const h = harness({ leanCtxBin: () => bin });
	for (const ctx of [MAIN, SUB]) {
		const r = h.tool_call(call("echo hi"), ctx) as { input?: Record<string, unknown> } | undefined;
		expect(typeof r?.input?.command).toBe("string");
		expect(r?.input?.command).toBe(`${bin} -c 'echo hi'`);
	}
});

test("end-to-end: routed input executed under sh reproduces the original command", () => {
	const { env, marker, bin } = shimEnv({ VOLT: "world" });
	const h = harness({ leanCtxBin: () => bin });
	const cmd = `echo "it's $VOLT" | tr a-z A-Z`;
	const r = h.tool_call(call(cmd), MAIN) as { input?: { command?: string } } | undefined;
	expect(typeof r?.input?.command).toBe("string");
	const routed = runCaptureSync(["/bin/sh", "-c", r?.input?.command as string], { env, cwd: root });
	const baseline = runCaptureSync(["/bin/sh", "-c", cmd], { env, cwd: root });
	expect(routed.code).toBe(0);
	expect(routed.stdout).toBe(baseline.stdout);
	expect(routed.stdout).toBe("IT'S WORLD\n");
	expect(readFileSync(marker, "utf8")).toBe(cmd);
});

test("skip: binary not resolvable", () => {
	expect(harness({ leanCtxBin: () => undefined }).tool_call(call("echo hi"), MAIN)).toBeUndefined();
});

test("skip: no lean-ctx route active in the session", () => {
	expect(harness({ activeTools: () => ["read", "bash", "task"] }).tool_call(call("echo hi"), MAIN)).toBeUndefined();
	expect(harness({ activeTools: () => undefined }).tool_call(call("echo hi"), MAIN)).toBeUndefined();
	expect(harness({ activeTools: () => {
		throw new Error("probe failed");
	} }).tool_call(call("echo hi"), MAIN)).toBeUndefined();
});

test("routes when any lean-ctx MCP route or bare ctx_shell is active", () => {
	for (const active of [["mcp__lean_ctx_ctx_read"], ["mcp__lean-ctx_ctx_glob"], ["ctx_shell"], ["bash", "mcp__lean_ctx_ctx_search"]]) {
		const r = harness({ activeTools: () => active }).tool_call(call("echo hi"), MAIN) as { input?: { command?: string } } | undefined;
		expect(r?.input?.command).toBe(`/opt/bin/lean-ctx -c 'echo hi'`);
	}
});

test("skip: env kill switches", () => {
	expect(harness({ env: { LEAN_CTX_DISABLED: "1" } }).tool_call(call("echo hi"), MAIN)).toBeUndefined();
	expect(harness({ env: { ATLAS_LEAN_SHELL: "off" } }).tool_call(call("echo hi"), MAIN)).toBeUndefined();
	expect(harness({ env: { ATLAS_LEAN_SHELL: "on" } }).tool_call(call("echo hi"), MAIN)).toBeDefined();
	expect(harness({ env: { LEAN_CTX_DISABLED: "" } }).tool_call(call("echo hi"), MAIN)).toBeDefined();
});

test("skip: interactive pty calls are left alone; pty false and absent route", () => {
	const h = harness({});
	expect(h.tool_call(call("vim", { pty: true }), MAIN)).toBeUndefined();
	expect(h.tool_call(call("echo hi", { pty: false }), MAIN)).toBeDefined();
	expect(h.tool_call(call("echo hi", { pty: undefined }), MAIN)).toBeDefined();
});

test("skip: empty, whitespace-only and non-string commands", () => {
	const h = harness({});
	expect(h.tool_call(call(""), MAIN)).toBeUndefined();
	expect(h.tool_call(call("   "), MAIN)).toBeUndefined();
	expect(h.tool_call({ toolName: "bash", input: {} }, MAIN)).toBeUndefined();
	expect(h.tool_call({ toolName: "bash", input: { command: 42 } }, MAIN)).toBeUndefined();
});

test("skip: non-bash tools and bash calls without input", () => {
	const h = harness({});
	expect(h.tool_call({ toolName: "read", input: { command: "echo hi" } }, MAIN)).toBeUndefined();
	expect(h.tool_call({ toolName: "bash" }, MAIN)).toBeUndefined();
});

test("skip: commands already starting with the lean-ctx binary or bare name", () => {
	const bin = "/opt/bin/lean-ctx";
	const h = harness({ leanCtxBin: () => bin, activeTools: () => ["ctx_shell"] });
	expect(h.tool_call(call(`${bin} -c 'echo hi'`), MAIN)).toBeUndefined();
	expect(h.tool_call(call(`lean-ctx -c 'echo hi'`), MAIN)).toBeUndefined();
	expect(h.tool_call(call("lean-ctx"), MAIN)).toBeUndefined();
	expect(h.tool_call(call(` lean-ctx -c 'echo hi'`), MAIN)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// Binary resolution.
// ---------------------------------------------------------------------------

test("findExecutableOnPath: finds an executable file on PATH, skips non-executables, undefined off-PATH", () => {
	const binDir = join(root, "tools");
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, "lean-ctx"), "#!/bin/sh\n");
	chmodSync(join(binDir, "lean-ctx"), 0o755);
	expect(findExecutableOnPath("lean-ctx", { PATH: `/nowhere:${binDir}` })).toBe(join(binDir, "lean-ctx"));
	writeFileSync(join(binDir, "lean-ctx"), "#!/bin/sh\n"); // rewrite as non-executable
	chmodSync(join(binDir, "lean-ctx"), 0o644);
	expect(findExecutableOnPath("lean-ctx", { PATH: binDir })).toBeUndefined();
	expect(findExecutableOnPath("lean-ctx", { PATH: "" })).toBeUndefined();
	expect(findExecutableOnPath("lean-ctx", {})).toBeUndefined();
});

const realBin = defaultLeanCtxBin();

test.skipIf(!realBin)("defaultLeanCtxBin resolves lean-ctx on this host's PATH", () => {
	// Bun.which walks env.PATH: removing /opt/homebrew/bin-style dirs must yield undefined
	expect(defaultLeanCtxBin({ PATH: "/no-such-dir" })).toBeUndefined();
});

test.skipIf(!realBin)("real lean-ctx host check: `lean-ctx -c 'echo routed-ok'` stdout contains routed-ok", () => {
	const r = runCaptureSync([realBin as string, "-c", "echo routed-ok"]);
	expect(r.code).toBe(0);
	expect(r.stdout).toContain("routed-ok");
});