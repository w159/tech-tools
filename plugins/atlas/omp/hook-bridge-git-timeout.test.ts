// git_guard is the only bridged hook that fails closed on a timeout/budget skip, and only for git commands.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadBridgedHooks, registerHookBridge, type HookRunner } from "./hook-bridge";

process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), "hook-bridge-git-home-"));

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-bridge-git-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Result = { block?: boolean; reason?: string; additionalContext?: string } | undefined;
type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<Result> | Result;

function setup(script: string, event: "PreToolUse" | "PostToolUse", mode: "slow" | "budget") {
	writeFileSync(join(dir, "hooks.json"), JSON.stringify({ hooks: { [event]: [{ matcher: "Bash", hooks: [{ command: `python3 "${join(dir, script)}"`, timeout: 5 }] }] } }));
	writeFileSync(join(dir, "bridge.json"), JSON.stringify({ bridged: [script], notBridged: {} }));
	const hooks = loadBridgedHooks(join(dir, "hooks.json"), join(dir, "bridge.json"));
	let clock = Date.now();
	// slow: the hook "runs" for an hour of fake time and returns nothing; budget: the clock is already past the deadline.
	const run: HookRunner = async () => {
		clock += 3_600_000;
		return "";
	};
	const handlers: Record<string, Handler> = {};
	registerHookBridge({ on: (n: string, h: Handler) => { handlers[n] = h; } } as unknown as Pick<ExtensionAPI, "on">, {
		hooks,
		run,
		env: {},
		now: () => (mode === "budget" ? Date.now() + 3_600_000 : clock),
	});
	const ctx = { cwd: dir, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s-1" } };
	const call = (command: string) =>
		handlers[event === "PreToolUse" ? "tool_call" : "tool_result"]({ toolName: "bash", input: { command }, content: [{ type: "text", text: "" }], isError: false }, ctx);
	return call;
}

for (const mode of ["slow", "budget"] as const) {
	test(`git_guard ${mode}: git commands are denied`, async () => {
		const call = setup("git_guard.py", "PreToolUse", mode);
		for (const command of ["git push --force", "cd x && git reset --hard", "/usr/bin/git status"]) {
			const r = await call(command);
			expect(r).toMatchObject({ block: true });
			const reason = String(r?.reason);
			expect(reason).toStartWith("atlas git policy:");
			expect(reason).toContain("timed out");
			expect(reason).toContain("nothing ran");
			expect(reason).toContain("Retry");
		}
	});

	test(`git_guard ${mode}: non-git commands fail open`, async () => {
		const call = setup("git_guard.py", "PreToolUse", mode);
		for (const command of ["ls .git", "echo digit", "ls"]) expect((await call(command))?.block).toBeUndefined();
	});

	test(`${mode}: other hooks and PostToolUse stay fail-open`, async () => {
		expect((await setup("other_hook.py", "PreToolUse", mode)("git push --force"))?.block).toBeUndefined();
		expect((await setup("git_guard.py", "PostToolUse", mode)("git push --force"))?.block).toBeUndefined();
	});
}
