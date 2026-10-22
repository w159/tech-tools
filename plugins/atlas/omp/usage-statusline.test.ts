import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USAGE_STATUSLINE_WIDGET_KEY, registerUsageStatusline, userStatuslineCopyExists } from "./usage-statusline";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function fakePi() {
	const handlers = new Map<string, (...a: any[]) => any>();
	const pi = { on: (n: string, h: (...a: any[]) => any) => void handlers.set(n, h), getThinkingLevel: () => "high" };
	return { pi: pi as any, handlers };
}

test("registers the lifecycle handlers", () => {
	const { pi, handlers } = fakePi();
	registerUsageStatusline(pi);
	for (const n of ["session_start", "before_agent_start", "agent_end"]) expect(handlers.has(n)).toBe(true);
});

test("session_start renders the widget below the editor", async () => {
	const { pi, handlers } = fakePi();
	registerUsageStatusline(pi);
	const usage = { input: 1000, output: 200, cacheRead: 500, cacheWrite: 0, totalTokens: 1700, cost: { total: 0.5 } };
	const msg = { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", usage };
	const widgets: any[] = [];
	const ctx = {
		cwd: "/tmp/proj",
		model: { name: "Claude Opus 5.5", id: "claude-opus-5-5", provider: "anthropic", contextWindow: 1_000_000 },
		sessionManager: { getBranch: () => [{ type: "message", message: msg }, { type: "message", message: msg }] },
		getContextUsage: () => ({ tokens: 513_300, contextWindow: 1_000_000, percent: 51 }),
		modelRegistry: {
			authStorage: {
				credentials: { hasOAuth: () => true },
				usage: { reports: async () => [] },
				oauth: { identity: () => undefined },
			},
		},
		setInterval: () => ({}),
		clearTimer: () => {},
		ui: { setWidget: (...a: any[]) => widgets.push(a), setStatus: () => {} },
	};
	await handlers.get("session_start")!({}, ctx);
	const call = widgets.find(w => w[0] === USAGE_STATUSLINE_WIDGET_KEY && w[1]);
	expect(call).toBeDefined();
	expect(JSON.stringify(call.slice(2))).toContain("belowEditor");
	const rows = typeof call[1] === "function" ? call[1]({ requestRender() {} }, {}).render(200) : call[1];
	const text = strip(rows.join("\n"));
	for (const s of ["proj", "Claude Opus 5.5", "ctx", "51%", "5h", "7d", "session", "plan", "anthropic"]) expect(text).toContain(s);
});

test("userStatuslineCopyExists checks home and project copies", () => {
	const home = mkdtempSync(join(tmpdir(), "sl-home-"));
	const cwd = mkdtempSync(join(tmpdir(), "sl-cwd-"));
	expect(userStatuslineCopyExists(cwd, home)).toBe(false);
	mkdirSync(join(home, ".omp", "agent", "extensions"), { recursive: true });
	writeFileSync(join(home, ".omp", "agent", "extensions", "usage-statusline.ts"), "");
	expect(userStatuslineCopyExists(cwd, home)).toBe(true);
	const home2 = mkdtempSync(join(tmpdir(), "sl-home-"));
	mkdirSync(join(cwd, ".omp", "extensions"), { recursive: true });
	writeFileSync(join(cwd, ".omp", "extensions", "usage-statusline.ts"), "");
	expect(userStatuslineCopyExists(cwd, home2)).toBe(true);
});
