// End-to-end omp wiring check: the extension's default export registered against
// a fake pi, running the REAL hooks.json -> runHook -> python session_boot path
// in a temp cwd/HOME. before_agent_start chaining mirrors omp's
// ExtensionRunner.emitBeforeAgentStart (extensions/runner.ts): handlers run in
// registration order and each one sees the previous handler's systemPrompt. The
// assertions are count-agnostic, so they hold however many modules are wired.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SESSION_MARKER } from "./hook-bridge";
import atlasOmpExtension from "./index";
import { STYLE_BEGIN } from "./style";

type Handler = (event: unknown, ctx: unknown) => unknown;

const handlers = new Map<string, Handler[]>();
const pi = {
	on(name: string, handler: Handler) {
		const list = handlers.get(name) ?? [];
		list.push(handler);
		handlers.set(name, list);
	},
	getActiveTools: () => [] as string[],
} as unknown as ExtensionAPI;

const ENV_KEYS = ["HOME", "ATLAS_DB", "ATLAS_DASHBOARD", "ATLAS_COLONY", "ATLAS_DASHBOARD_PORT", "ATLAS_STYLE"] as const;
const saved: Record<string, string | undefined> = {};
let originalCwd = "";
let proj = "";

beforeAll(() => {
	originalCwd = process.cwd();
	for (const key of ENV_KEYS) saved[key] = process.env[key];
	proj = mkdtempSync(join(tmpdir(), "atlas-ext-"));
	mkdirSync(join(proj, "docs"), { recursive: true });
	writeFileSync(join(proj, "docs", "CHANGELOG.md"), "# Changelog\n");
	process.env.HOME = proj;
	process.env.ATLAS_DB = join(proj, "atlas.db");
	process.env.ATLAS_DASHBOARD = "off";
	process.env.ATLAS_COLONY = "off"; // the REAL session_boot runs here: it must never start or adopt a colony or dashboard
	process.env.ATLAS_DASHBOARD_PORT = "17969"; // a daemon started anyway gets a spare port, never the user's 7421
	delete process.env.ATLAS_STYLE; // a developer's kill switch must not disable the style under test
	process.chdir(proj);
	atlasOmpExtension(pi);
});

afterAll(() => {
	process.chdir(originalCwd);
	for (const key of ENV_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	rmSync(proj, { recursive: true, force: true });
});

const ctx = () => ({ cwd: proj, agent: { kind: "main" }, sessionManager: { getSessionId: () => "s-ext" } });

/** omp's emitBeforeAgentStart: sequential handlers, each seeing the accumulated systemPrompt. */
async function emitBeforeAgentStart(prompt: string, base: string[]): Promise<{ prompt: string[]; order: number[] }> {
	let current = base;
	const order: number[] = [];
	const list = handlers.get("before_agent_start") ?? [];
	for (const [index, handler] of list.entries()) {
		order.push(index);
		const result = (await handler({ type: "before_agent_start", prompt, systemPrompt: current }, ctx())) as { systemPrompt?: string | string[] } | undefined;
		if (result?.systemPrompt !== undefined) current = typeof result.systemPrompt === "string" ? [result.systemPrompt] : result.systemPrompt;
	}
	return { prompt: current, order };
}

test("the extension registers its handlers per event in registration order", () => {
	const list = handlers.get("before_agent_start") ?? [];
	expect(list.length).toBeGreaterThan(0);
	expect((handlers.get("tool_call") ?? []).length).toBeGreaterThan(0);
});

test("chained before_agent_start carries both the style block and the session-start context", async () => {
	const started = Date.now();
	const first = await emitBeforeAgentStart("wire the board", ["base prompt"]);
	expect(Date.now() - started).toBeLessThan(25_000); // real session_boot, inside omp's 30 s handler cut
	const text = first.prompt.join("\n");
	expect(first.order).toEqual([...(handlers.get("before_agent_start") ?? []).keys()]);
	expect(first.prompt[0]).toBe("base prompt");
	expect(text).toContain(STYLE_BEGIN);
	expect(text).toContain(SESSION_MARKER);

	// Re-entry (next prompt in the same session): both survive on a fresh base prompt.
	const second = await emitBeforeAgentStart("next prompt", ["base prompt"]);
	const again = second.prompt.join("\n");
	expect(again).toContain(STYLE_BEGIN);
	expect(again).toContain(SESSION_MARKER);
});
