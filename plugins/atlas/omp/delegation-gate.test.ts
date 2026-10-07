import { afterEach, beforeEach, expect, test } from "bun:test";
// Fixtures use temp dirs as cwd, where the scope check (omp/scope.ts) leaves gates unarmed.
process.env.ATLAS_GATES = "always";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { register } from "./index";
import { runCaptureSync } from "./proc";

// End-to-end through index.ts register(): a main-thread `bash` that rewrites
// code (sed -i) must trip the session_stop delegation gate exactly like an
// edit/write call does, in a real git repo.
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
/** Run argv via the temp-file transport (bun's piped child stdio breaks under a relative-path filter); throws on non-zero exit. */
function run(argv: string[]): void {
	const { code } = runCaptureSync(argv);
	if (code !== 0) throw new Error(`${argv.join(" ")} failed (exit ${code})`);
}
let repo: string;
let oldGate: string | undefined;
beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "atlas-shell-gate-"));
	mkdirSync(join(repo, "docs"));
	mkdirSync(join(repo, "src"));
	writeFileSync(join(repo, "docs", "CHANGELOG.md"), "# c\n");
	writeFileSync(join(repo, "src", "calc.py"), "def f(a, b):\n    return a + b\n");
	const git = (...args: string[]) => run(["git", "-C", repo, ...args]);
	git("init", "-q");
	git("-c", "user.email=a@b", "-c", "user.name=t", "add", "-A");
	git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "init");
	oldGate = process.env.ATLAS_GATE;
	delete process.env.ATLAS_GATE;
});
afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
	if (oldGate === undefined) delete process.env.ATLAS_GATE;
	else process.env.ATLAS_GATE = oldGate;
});

function harness() {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	register(api as unknown as Pick<ExtensionAPI, "on">, { activeTools: () => ["read", "write", "edit", "bash", "task"], spawnBoardMirror: () => { } });
	const ctx = { cwd: repo, agent: { kind: "main" } };
	handlers.session_start({}, ctx);
	return { handlers, ctx };
}

test("a shell-written code change with no dispatch blocks session_stop", () => {
	const { handlers, ctx } = harness();
	handlers.tool_call({ toolName: "bash", input: { command: "sed -i '' 's/a + b/a * b/' src/calc.py" } }, ctx);
	writeFileSync(join(repo, "src", "calc.py"), "def f(a, b):\n    return a * b\n"); // what the sed did
	const result = handlers.session_stop({}, ctx) as { decision?: string; reason?: string } | undefined;
	expect(result?.decision).toBe("block");
});

test("a shell-written change plus a task dispatch is allowed; docs-only shell writes never count", () => {
	const a = harness();
	a.handlers.tool_call({ toolName: "bash", input: { command: "true" } }, a.ctx);
	writeFileSync(join(repo, "src", "calc.py"), "def f(a, b):\n    return a * b\n");
	a.handlers.tool_call({ toolName: "task", input: { tasks: [{ name: "Impl", agent: "task" }] } }, a.ctx);
	expect(a.handlers.session_stop({}, a.ctx)).toBeUndefined();
	run(["git", "-C", repo, "checkout", "-q", "--", "src/calc.py"]);
	const b = harness();
	b.handlers.tool_call({ toolName: "bash", input: { command: "true" } }, b.ctx);
	writeFileSync(join(repo, "docs", "CHANGELOG.md"), "# c\n- fixed\n");
	expect(b.handlers.session_stop({}, b.ctx)).toBeUndefined();
});

// An atlas_mux worker is a standalone `omp -p` that omp reports as a main session, so ctx.agent.kind never says "sub".
// Its lead already owns delegation; telling a leaf implementer to dispatch a subagent only costs an extra turn.
// atlas_mux pins ATLAS_WORKER_NAME in the worker env, and that is the leaf marker.
test("a mux worker (ATLAS_WORKER_NAME set) is never told to delegate; the same edit still blocks a lead", () => {
	const old = process.env.ATLAS_WORKER_NAME;
	try {
		delete process.env.ATLAS_WORKER_NAME;
		const lead = harness();
		lead.handlers.tool_call({ toolName: "edit", input: { path: "src/calc.py" } }, lead.ctx);
		expect((lead.handlers.session_stop({}, lead.ctx) as { decision?: string } | undefined)?.decision).toBe("block");

		process.env.ATLAS_WORKER_NAME = "money";
		const worker = harness();
		worker.handlers.tool_call({ toolName: "edit", input: { path: "src/calc.py" } }, worker.ctx);
		expect(worker.handlers.session_stop({}, worker.ctx)).toBeUndefined();
	} finally {
		if (old === undefined) delete process.env.ATLAS_WORKER_NAME;
		else process.env.ATLAS_WORKER_NAME = old;
	}
});
