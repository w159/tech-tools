import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USAGE_STATUSLINE_WIDGET_KEY, fetchAtlasSegment, registerUsageStatusline, userStatuslineCopyExists } from "./usage-statusline";

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

// Parity with scripts/test_atlas_status_segment.py: the same fixture must give the same literal.
test("atlas segment text matches the Claude Code statusline literal for one fixture", async () => {
	const NOW = 1_800_000_000;
	const tmp = mkdtempSync(join(tmpdir(), "seg-"));
	const root = join(tmp, "proj");
	const home = join(tmp, "home");
	mkdirSync(join(root, ".atlas", ".run"), { recursive: true });
	mkdirSync(join(home, ".atlas"), { recursive: true });
	const item = (status: string, extra: object = {}, session_id = "s1") => ({ status, session_id, origin: "manual", ...extra });
	const items = [item("completed"), item("completed"), item("in_progress", { phase: "implement" }), item("pending"), item("pending"), item("pending"), item("pending", {}, "other")];
	writeFileSync(join(root, ".atlas", ".run", "todos.json"), JSON.stringify({ last_session_id: "s1", items }));
	const members = [{ name: "lead-x", role: "lead", joined: NOW - 900 }, ...[0, 1, 2].map(i => ({ name: `w${i}`, role: "subagent", joined: NOW - 60 })), { name: "done", role: "subagent", joined: NOW - 60, ended_at: NOW - 5 }];
	writeFileSync(join(root, ".atlas", ".run", "channels.json"), JSON.stringify({ channels: { c: { members } } }));
	writeFileSync(join(root, ".atlas", ".run", "findings.json"), JSON.stringify([{ status: "verified", verified_at: new Date((NOW - 240) * 1000).toISOString() }]));
	const key = createHash("sha1").update(`${realpathSync(root)}|s1`).digest("hex").slice(0, 12);
	writeFileSync(join(home, ".atlas", `status-gates-${key}.json`), JSON.stringify({ at: NOW, failing: 0 }));
	const db = new Database(join(home, ".atlas", "atlas.db"));
	db.run("CREATE TABLE turn_scores (id INTEGER PRIMARY KEY, session_id TEXT, message_uuid TEXT, judgment TEXT, kind TEXT, label TEXT, scored_at REAL)");
	db.run("INSERT INTO turn_scores (session_id, message_uuid, judgment, kind, scored_at) VALUES ('s1','m','verbosity','score',?)", [NOW - 100]);
	db.close();
	const line = await fetchAtlasSegment(root, home, NOW);
	expect(strip(line)).toBe("atlas  implement 2/6 · 3 live · gates ✔ · verified 4m · scoring ok");
});

test("atlas segment is empty for a project without .atlas", async () => {
	expect(await fetchAtlasSegment(mkdtempSync(join(tmpdir(), "noatlas-")), mkdtempSync(join(tmpdir(), "h-")))).toBe("");
});

test("atlas segment shows red scoring error when the newest row is an error", async () => {
	const tmp = mkdtempSync(join(tmpdir(), "seg-err-"));
	mkdirSync(join(tmp, "p", ".atlas"), { recursive: true });
	mkdirSync(join(tmp, "h", ".atlas"), { recursive: true });
	const db = new Database(join(tmp, "h", ".atlas", "atlas.db"));
	db.run("CREATE TABLE turn_scores (id INTEGER PRIMARY KEY, session_id TEXT, message_uuid TEXT, judgment TEXT, kind TEXT, label TEXT, scored_at REAL)");
	db.run("INSERT INTO turn_scores (session_id, message_uuid, judgment, kind, scored_at) VALUES ('s','m','verbosity','score',100)");
	db.run("INSERT INTO turn_scores (session_id, message_uuid, judgment, kind, label, scored_at) VALUES ('s','m','scoring_error','error','TypeSafe API error 400: x',200)");
	db.close();
	const line = await fetchAtlasSegment(join(tmp, "p"), join(tmp, "h"), 300);
	expect(line).toContain("\x1b[1;31mscoring error (api 400)");
});
