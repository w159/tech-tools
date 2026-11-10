import { Database } from "bun:sqlite";
import { afterEach, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as os from "node:os";
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
	const key = createHash("sha256").update(`${realpathSync(root)}|s1`).digest("hex").slice(0, 12);
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

// ---------------------------------------------------------------------------------------------------------
// Rendered-widget behavior. The module keeps its layout/run state in module globals and reads its config from
// the user's home, so each scenario imports a FRESH instance (query-string cache bust) with node:os.homedir
// pointed at a temp dir for the duration of the import. No test touches the real ~/.omp.
// ---------------------------------------------------------------------------------------------------------

const realOs = { ...os };
const realNow = Date.now;
const realCols = process.stdout.columns;
const realPath = process.env.PATH;
let freshSeq = 0;
let clock: number | undefined;
Date.now = () => clock ?? realNow();

afterEach(() => {
	clock = undefined;
	(process.stdout as any).columns = realCols;
	process.env.PATH = realPath;
});

const CLOCK0 = 1_700_000_000_000;
const raw = (rows: string[], needle: string) => rows.find(r => strip(r).includes(needle)) ?? "";

type Mount = Awaited<ReturnType<typeof mount>>;

/** One assistant branch entry. */
const asst = (usage: object | undefined, provider: string | null = "anthropic", model: string | null = "claude-opus-5-5") => ({
	type: "message",
	message: { role: "assistant", provider, model, usage },
});

async function mount(
	o: {
		cfg?: unknown;
		branch?: any[];
		model?: any;
		usage?: { tokens: number; contextWindow: number; percent?: number } | "absent";
		reports?: any[];
		oauth?: (p: string) => boolean;
		credentials?: "absent";
		identity?: (p: string, sid: string) => any;
		thinking?: () => string;
		cols?: number;
		cwd?: string;
	} = {},
) {
	const home = mkdtempSync(join(tmpdir(), "sl-render-"));
	if (o.cfg !== undefined) {
		mkdirSync(join(home, ".omp", "agent"), { recursive: true });
		writeFileSync(join(home, ".omp", "agent", "usage-statusline.json"), typeof o.cfg === "string" ? o.cfg : JSON.stringify(o.cfg));
	}
	mock.module("node:os", () => ({ ...realOs, default: { ...realOs, homedir: () => home }, homedir: () => home }));
	let mod: typeof import("./usage-statusline");
	try {
		mod = await import(`./usage-statusline.ts?fresh=${++freshSeq}`);
	} finally {
		mock.module("node:os", () => ({ ...realOs, default: realOs }));
	}
	(process.stdout as any).columns = o.cols ?? 140;
	const handlers = new Map<string, (...a: any[]) => any>();
	const pi = { on: (n: string, h: (...a: any[]) => any) => void handlers.set(n, h), getThinkingLevel: o.thinking ?? (() => "high") };
	mod.registerUsageStatusline(pi as any);
	const widgets: any[][] = [];
	const statuses: Array<[string, string | undefined]> = [];
	const state = { branch: o.branch ?? [], usage: o.usage, reportCalls: 0, reports: o.reports ?? [], intervals: [] as Array<[() => void, number]>, cleared: [] as unknown[], widgetThrows: false };
	const ctx: any = {
		cwd: o.cwd ?? "/tmp/proj",
		model: o.model === undefined ? { name: "Claude Opus 5.5", id: "claude-opus-5-5", provider: "anthropic", contextWindow: 1_000_000 } : o.model,
		sessionManager: { getSessionId: () => "sess-1", getBranch: () => state.branch },
		modelRegistry: {
			authStorage: {
				credentials: o.credentials === "absent" ? undefined : { hasOAuth: (p: string) => (o.oauth ?? (() => false))(p) },
				usage: { reports: async () => { state.reportCalls++; return state.reports; } },
				oauth: { identity: o.identity ?? (() => undefined) },
			},
		},
		setInterval: (fn: () => void, ms: number) => { state.intervals.push([fn, ms]); return { id: state.intervals.length }; },
		clearTimer: (t: unknown) => void state.cleared.push(t),
		ui: {
			setWidget: (...a: any[]) => { if (state.widgetThrows) throw new Error("ui gone"); widgets.push(a); },
			setStatus: (k: string, t: string | undefined) => void statuses.push([k, t]),
		},
	};
	if (o.usage !== "absent") ctx.getContextUsage = () => state.usage;
	const fire = async (ev: string, payload: object = {}) => { await handlers.get(ev)?.(payload, ctx); };
	const last = () => widgets.filter(w => w[0] === mod.USAGE_STATUSLINE_WIDGET_KEY).at(-1)![1] as string[];
	return { mod, ctx, state, fire, last, text: () => last().map(strip), widgets, statuses, handlers, home };
}

const settle = () => Bun.sleep(5);
const lineWith = (m: Mount, needle: string) => m.text().find(r => r.includes(needle)) ?? "";

test("a fresh mount renders: project and model first, spacer rows around, meters then right table", async () => {
	const m = await mount({ usage: { tokens: 513_300, contextWindow: 1_000_000, percent: 51 }, branch: [asst({ input: 1000, output: 200, cacheRead: 500, totalTokens: 1700, cost: { total: 0.5 } })] });
	await m.fire("session_start");
	const rows = m.last();
	expect(rows.length).toBe(6);
	expect(strip(rows[0])).toBe("📁  proj   🌱  ready    👾  Claude Opus 5.5  ·  high");
	expect(rows[1]).toBe("​");
	expect(rows.at(-1)).toBe("​");
	expect(strip(rows[2])).toBe("📚  ctx  51% ▅▅▅▅▅▅▅▁▁▁▁▁▁▁  513.3k / 1M       │  💰  session      $0.50     1.7k tok  cache 33%");
	expect(strip(rows[3])).toBe("⏳  5h   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │  🔌  anthropic    $0.50     1.7k tok  claude-opus-5-5"); // U+23F3 is 2 cells wide, so the rule lines up with the 7d row below
	expect(strip(rows[4])).toBe("📅  7d   --% ▁▁▁▁▁▁▁▁▁▁▁▁▁▁                    │"); // the rule runs the full height, the right cell is just empty
	expect(m.widgets[0][2]).toEqual({ placement: "belowEditor" });
	expect(m.statuses[0]).toEqual(["zzz-usage-statusline-spacer", "​"]);
});

test("tokens use bc-style truncation and costs pick their precision by magnitude", async () => {
	const m = await mount({
		cfg: { provRows: 4 },
		branch: [
			asst({ input: 1_250_000, cost: { total: 100.7 } }, "p1"),
			asst({ input: 12_999, cost: { total: 0.5 } }, "p2"),
			asst({ input: 999, cost: { total: 0.004 } }, "p3"),
			asst({ input: 5, cost: { total: 0 } }, "p4"),
		],
	});
	await m.fire("session_start");
	expect(lineWith(m, "p1")).toMatch(/p1\s+\$100\s+1\.2M tok/); // truncated, not rounded to 1.3M; >= $100 drops cents
	expect(lineWith(m, "p2")).toMatch(/p2\s+\$0\.50\s+12\.9k tok/);
	expect(lineWith(m, "p3")).toMatch(/p3\s+<\$0\.01\s+999 tok/);
	expect(lineWith(m, "p4")).toMatch(/p4\s+\$0\.00\s+5 tok/);
	expect(lineWith(m, "session")).toMatch(/session\s+\$101\s+1\.2M tok/);
	const b = await mount({ branch: [asst({ input: 1_000_000, cost: { total: 99.99 } }, "a"), asst({ input: 1000, cost: { total: 0.01 } }, "b"), asst({ input: 10, cost: { total: 0.0099 } }, "c")] });
	await b.fire("session_start");
	expect(lineWith(b, "a ")).toMatch(/\$99\.99\s+1\.0M tok/);
	expect(lineWith(b, "b ")).toMatch(/\$0\.01\s+1\.0k tok/);
	expect(lineWith(b, "c ")).toMatch(/<\$0\.01\s+10 tok/);
});

test("providers sort by token volume and overflow folds into a '+N more' row", async () => {
	const branch = [asst({ input: 10, cost: { total: 1 } }, "small"), asst({ input: 3000, cost: { total: 3 } }, "big"), asst({ input: 200, cost: { total: 2 } }, "mid"), asst({ input: 50, cost: { total: 4 } }, "tiny")];
	const m = await mount({ branch, oauth: p => p === "tiny" });
	await m.fire("session_start");
	const rows = m.text().filter(r => r.includes("│") || r.includes("tok"));
	const right = rows.map(r => r.split("│")[1] ?? "");
	expect(right[0]).toContain("session");
	expect(right[1]).toMatch(/big\s+\$3\.00/);
	expect(right[2]).toMatch(/mid\s+\$2\.00/);
	expect(right[3]).toMatch(/\+2 more\s+\$1\.00\s+60 tok\s+tiny \+ small/); // metered rest only: the subscription provider adds no spend
	expect(m.text().some(r => /\bsmall\s+\$/.test(r))).toBe(false);
	const sub = await mount({ branch, oauth: () => true, cfg: { provRows: 1 } });
	await sub.fire("session_start");
	expect(lineWith(sub, "session")).toMatch(/session\s+plan\s+3\.2k tok/);
	expect(lineWith(sub, "more")).toMatch(/\+4 more\s+plan/); // provRows 1: no room for a named row
	const none = await mount({ branch, cfg: { provRows: 0 } });
	await none.fire("session_start");
	expect(none.text().filter(r => r.includes("tok")).length).toBe(1);
});

test("subscription providers read 'plan' and stay out of the metered session total", async () => {
	const branch = [asst({ input: 100, cost: { total: 7 } }, "anthropic"), asst({ input: 50, cost: { total: 2.5 } }, "openrouter")];
	const mixed = await mount({ branch, oauth: p => p === "anthropic" });
	await mixed.fire("session_start");
	expect(lineWith(mixed, "session")).toMatch(/session\s+\$2\.50/);
	expect(lineWith(mixed, "anthropic")).toMatch(/anthropic\s+plan/);
	expect(lineWith(mixed, "openrouter")).toMatch(/openrouter\s+\$2\.50/);
	const allSub = await mount({ branch, oauth: () => true });
	await allSub.fire("session_start");
	expect(lineWith(allSub, "session")).toMatch(/session\s+plan/);
	expect(raw(allSub.last(), "session")).toContain("\u001b[1;32m"); // plan is green, not money-colored
	const empty = await mount();
	await empty.fire("session_start");
	expect(lineWith(empty, "session")).toMatch(/session\s+\$0\.00\s+0 tok\s+cache 0%/);
});

test("billing mode falls back to metered when it cannot be determined", async () => {
	const branch = [asst({ input: 100, cost: { total: 4 } }, "anthropic")];
	const noCreds = await mount({ branch, credentials: "absent" });
	await noCreds.fire("session_start");
	expect(lineWith(noCreds, "anthropic")).toMatch(/anthropic\s+\$4\.00/);
	const throwing = await mount({ branch, oauth: () => { throw new Error("registry offline"); } });
	await throwing.fire("session_start");
	expect(lineWith(throwing, "anthropic")).toMatch(/anthropic\s+\$4\.00/);
	expect(lineWith(throwing, "session")).toMatch(/session\s+\$4\.00/);
});

test("per-provider top model: most output wins, first wins ties, input-only usage names none, ids are shortened", async () => {
	const m = await mount({
		cfg: { provRows: 4 },
		branch: [
			asst({ input: 1, output: 100 }, "multi", "multi-a"),
			asst({ input: 1, output: 300 }, "multi", "vendor/multi-b-20250805"),
			asst({ input: 1, output: 200 }, "multi", "multi-a"), // multi-a now 300: ties multi-b, which got there first
			asst({ input: 500, output: 0 }, "inonly", "inonly-model"),
			asst({ output: 40 }, "dated", "x/y/dated-model-20240101"),
			asst({ output: 5 }, "nomodel", null),
		],
	});
	await m.fire("session_start");
	expect(lineWith(m, "multi ")).toMatch(/multi\s+\$0\.00.*multi-b$/);
	expect(lineWith(m, "inonly").trimEnd()).toMatch(/inonly\s+\$0\.00\s+500 tok$/);
	expect(lineWith(m, "dated").trimEnd()).toMatch(/dated-model$/);
	expect(lineWith(m, "nomodel").trimEnd()).toMatch(/nomodel\s+\$0\.00\s+5 tok$/);
});

test("provider name falls back to the model's vendor prefix, then 'unknown'; empty usage is ignored", async () => {
	const m = await mount({
		cfg: { provRows: 4 },
		branch: [
			asst({ input: 10 }, "", "acme/gpt-x"),
			asst({ input: 20 }, null, "plain-model"),
			asst({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 999 }, "zero"),
			asst(undefined, "nousage"),
		],
	});
	await m.fire("session_start");
	expect(lineWith(m, "acme")).toMatch(/acme\s+\$0\.00\s+10 tok/);
	expect(lineWith(m, "unknown")).toMatch(/unknown\s+\$0\.00\s+20 tok/);
	expect(m.text().join("\n")).not.toMatch(/zero|nousage/);
	expect(lineWith(m, "session")).toMatch(/session\s+\$0\.00\s+30 tok/); // the zero block's bogus totalTokens never counts
});

test("totalTokens prefers the persisted figure, else sums the parts; cache share is over prompt tokens", async () => {
	const m = await mount({ branch: [asst({ input: 100, output: 50, cacheRead: 300, cacheWrite: 100 }), asst({ input: 100, output: 50, totalTokens: 5000 })] });
	await m.fire("session_start");
	expect(lineWith(m, "session")).toMatch(/session\s+\$0\.00\s+5\.5k tok\s+cache 50%/); // 5500 tokens; 300 cache reads over 600 prompt tokens
	const off = await mount({ cfg: { showCache: false }, branch: [asst({ input: 100, cacheRead: 100 })] });
	await off.fire("session_start");
	expect(lineWith(off, "session")).not.toContain("cache");
});

test("branch entries that are not assistant messages with usage are skipped without aborting the scan", async () => {
	const m = await mount({
		branch: [
			{ type: "message", message: null },
			{ type: "message", message: "text" },
			{ type: "message", message: {} },
			{ type: "message", message: { role: "user", usage: { input: 999_999 } } },
			{ type: "message" },
			{ type: "custom_message" },
			asst({ input: 7, cost: { total: 1 } }, "good"),
		],
	});
	await m.fire("session_start");
	expect(lineWith(m, "good")).toMatch(/good\s+\$1\.00\s+7 tok/);
	expect(lineWith(m, "session")).toMatch(/\$1\.00\s+7 tok/);
	const broken = await mount();
	broken.ctx.sessionManager.getBranch = () => { throw new Error("branch unreadable"); };
	await broken.fire("session_start");
	expect(lineWith(broken, "session")).toMatch(/session\s+\$0\.00\s+0 tok/);
});

test("context meter: percent, thresholds, size units, and fallback to the last snapshot", async () => {
	const at = async (tokens: number, win = 1000) => {
		const m = await mount({ usage: { tokens, contextWindow: win } });
		await m.fire("session_start");
		return m;
	};
	const green = "\u001b[1m\u001b[1;32m📚";
	const yellow = "\u001b[1m\u001b[1;33m📚";
	const red = "\u001b[1m\u001b[1;31m📚";
	expect(raw((await at(600)).last(), "ctx")).toContain(green);
	expect(raw((await at(604)).last(), "ctx")).toContain(green); // the cut is on the rounded percent: 60.4 -> 60
	expect(raw((await at(606)).last(), "ctx")).toContain(yellow);
	expect(raw((await at(610)).last(), "ctx")).toContain(yellow);
	expect(raw((await at(850)).last(), "ctx")).toContain(yellow);
	expect(raw((await at(860)).last(), "ctx")).toContain(red);
	const big = await at(150_000, 200_000);
	expect(strip(raw(big.last(), "ctx"))).toContain("75%");
	expect(strip(raw(big.last(), "ctx"))).toContain("150.0k / 200k");
	expect(strip(raw((await at(5, 500)).last(), "ctx"))).toContain("5 / 500");
	expect(strip(raw((await at(1_500_000, 1_500_000)).last(), "ctx"))).toContain("1.5M / 1M"); // window is whole units, used is one decimal
	// a frame without usage shows an empty meter sized by the model window; later frames reuse the last good snapshot
	const empty = await mount({ usage: undefined });
	await empty.fire("session_start");
	expect(lineWith(empty, "ctx")).toMatch(/ctx\s+--%.*0 \/ 1M/);
	empty.state.usage = { tokens: 250, contextWindow: 1000 };
	await empty.fire("turn_end");
	expect(lineWith(empty, "ctx")).toMatch(/ctx\s+25%/);
	empty.state.usage = undefined;
	await empty.fire("turn_end");
	expect(lineWith(empty, "ctx")).toMatch(/ctx\s+25%/);
	empty.ctx.getContextUsage = () => { throw new Error("no usage yet"); };
	await empty.fire("turn_end");
	expect(lineWith(empty, "ctx")).toMatch(/ctx\s+25%/);
	delete empty.ctx.getContextUsage;
	await empty.fire("turn_end");
	expect(lineWith(empty, "ctx")).toMatch(/ctx\s+25%/);
	const noWindow = await mount({ usage: undefined, model: { name: "m", id: "m", provider: "x" } });
	await noWindow.fire("session_start");
	expect(strip(raw(noWindow.last(), "ctx"))).toMatch(/^📚  ctx  --% ▁{14} +│/); // no window, no detail text
});

test("meters round and clamp their percent and always show a cell for any nonzero reading", async () => {
	const cells = async (pct: number) => {
		const m = await mount({ usage: { tokens: pct * 10, contextWindow: 1000 } });
		await m.fire("session_start");
		const row = strip(raw(m.last(), "ctx")).split("│")[0];
		return { filled: (row.match(/▅/g) ?? []).length, track: (row.match(/▁/g) ?? []).length, label: row.match(/(\d+)%/)?.[1] };
	};
	expect(await cells(0)).toEqual({ filled: 0, track: 14, label: "0" });
	expect(await cells(1)).toEqual({ filled: 1, track: 13, label: "1" });
	expect(await cells(50)).toEqual({ filled: 7, track: 7, label: "50" });
	expect(await cells(62)).toEqual({ filled: 9, track: 5, label: "62" });
	expect(await cells(100)).toEqual({ filled: 14, track: 0, label: "100" });
	expect(await cells(250)).toEqual({ filled: 14, track: 0, label: "100" }); // clamped
	const lone = await mount({ usage: { tokens: 5, contextWindow: 1000 } }); // 0.5% -> 1% (round) with a cell
	await lone.fire("session_start");
	expect(strip(raw(lone.last(), "ctx"))).toMatch(/ctx\s+1%\s+▅▁{13}/);
	expect(strip(raw(lone.last(), "ctx"))).toContain("ctx   1% "); // percent is right-aligned in 4 columns
});

const NOW_USAGE = (fraction: number, extra: object = {}) => ({ provider: "anthropic", limits: [{ window: { id: "5h", resetsAt: CLOCK0 + (4 * 60 + 40) * 60_000 }, amount: { usedFraction: fraction } }], ...extra });

test("rate-limit windows appear after the async report poll and are colored by the used share", async () => {
	clock = CLOCK0;
	const colorOf = async (fraction: number) => {
		const m = await mount({ reports: [NOW_USAGE(fraction)] });
		await m.fire("session_start");
		await settle();
		await m.fire("turn_end");
		return raw(m.last(), "5h");
	};
	const g = "\u001b[1m\u001b[1;32m⏳", y = "\u001b[1m\u001b[1;33m⏳", r = "\u001b[1m\u001b[1;31m⏳";
	expect(await colorOf(0.5)).toContain(g);
	expect(await colorOf(0.504)).toContain(g);
	expect(await colorOf(0.51)).toContain(y);
	expect(await colorOf(0.75)).toContain(y);
	expect(await colorOf(0.76)).toContain(r);
	const m = await mount({ reports: [NOW_USAGE(0.62)] });
	await m.fire("session_start");
	expect(lineWith(m, "5h")).toMatch(/5h\s+--%/); // first frame: poll not back yet
	await settle();
	await m.fire("turn_end");
	expect(lineWith(m, "5h")).toMatch(/⏳\s+5h\s+62% ▅{9}▁{5}\s+4h40m anthropic/);
});

test("usage polling is throttled by the poll interval and never overlaps", async () => {
	clock = CLOCK0;
	const m = await mount({ reports: [NOW_USAGE(0.1)], cfg: { pollS: 15 } });
	await m.fire("session_start");
	const tick = m.state.intervals[0][0];
	tick(); // still in flight: no second request
	tick();
	expect(m.state.reportCalls).toBe(1);
	await settle();
	clock = CLOCK0 + 14_000;
	tick();
	expect(m.state.reportCalls).toBe(1); // inside the interval
	clock = CLOCK0 + 15_000;
	tick();
	expect(m.state.reportCalls).toBe(2);
	await settle();
	clock = CLOCK0 + 40_000;
	tick();
	expect(m.state.reportCalls).toBe(3);
});

test("a failing poll keeps the stale windows and waits a full interval before retrying", async () => {
	clock = CLOCK0;
	const m = await mount({ reports: [NOW_USAGE(0.3)] });
	await m.fire("session_start");
	const tick = m.state.intervals[0][0];
	await settle();
	await m.fire("turn_end");
	expect(lineWith(m, "5h")).toMatch(/30%/);
	m.ctx.modelRegistry.authStorage.usage.reports = async () => { m.state.reportCalls++; throw new Error("offline"); };
	clock = CLOCK0 + 60_000;
	tick();
	await settle();
	expect(m.state.reportCalls).toBe(2);
	tick();
	expect(m.state.reportCalls).toBe(2); // the failure still counts as a poll
	expect(lineWith(m, "5h")).toMatch(/30%/);
	m.ctx.modelRegistry.authStorage.usage.reports = async () => null; // null report set keeps the old data too
	clock = CLOCK0 + 130_000;
	tick();
	await settle();
	await m.fire("turn_end");
	expect(lineWith(m, "5h")).toMatch(/30%/);
	const noApi = await mount();
	delete noApi.ctx.modelRegistry.authStorage.usage;
	await noApi.fire("session_start");
	expect(noApi.state.reportCalls).toBe(0);
});

test("windows are scoped to the session's provider, model tier and OAuth account; the tightest limit wins", async () => {
	clock = CLOCK0;
	const win = (id: string, used: number, over: object = {}) => ({ window: { id }, amount: { usedFraction: used }, ...over });
	const reports = [
		{ provider: "other", limits: [win("5h", 0.99)] }, // another provider: ignored
		{ provider: "anthropic", metadata: { accountId: "A", email: "a@x" }, limits: [win("5h", 0.2), win("7d", 0.9, { scope: { tier: "fable" } }), win("7d", 0.4, { scope: { tier: "opus" } })] },
		{ provider: "anthropic", metadata: { accountId: "B", email: "b@x" }, limits: [win("5h", 0.7), win("7d", 0.1, { scope: { tier: "fable", shared: true } })] },
	];
	const at = async (identity?: any) => {
		const m = await mount({ reports, identity: identity ? () => identity : undefined });
		await m.fire("session_start");
		await settle();
		await m.fire("turn_end");
		return { five: lineWith(m, "5h").match(/(\d+)%/)?.[1], seven: lineWith(m, "7d").match(/(\d+)%/)?.[1] };
	};
	expect(await at()).toEqual({ five: "70", seven: "40" }); // all accounts: tightest per slot, the fable-only 90% is another tier
	expect(await at({ accountId: "A" })).toEqual({ five: "20", seven: "40" });
	expect(await at({ email: "b@x" })).toEqual({ five: "70", seven: "10" }); // shared limits count whatever their tier
	expect(await at({ accountId: "zzz" })).toEqual({ five: "70", seven: "40" }); // unknown account: every account of the provider
	const throwing = await mount({ reports, identity: () => { throw new Error("no identity"); } });
	await throwing.fire("session_start");
	await settle();
	await throwing.fire("turn_end");
	expect(lineWith(throwing, "5h")).toMatch(/70%/);
});

test("window slots match by duration or id; amounts are read from fraction, remaining, used/limit or percent", async () => {
	clock = CLOCK0;
	const H5 = 5 * 3_600_000, D7 = 7 * 86_400_000;
	const mk = (limits: any[]) => [{ provider: "anthropic", limits }];
	const read = async (limits: any[]) => {
		const m = await mount({ reports: mk(limits) });
		await m.fire("session_start");
		await settle();
		await m.fire("turn_end");
		return { five: lineWith(m, "5h").match(/(\d+)%/)?.[1], seven: lineWith(m, "7d").match(/(\d+)%/)?.[1] };
	};
	expect(await read([{ window: { durationMs: H5 }, amount: { usedFraction: 0.1 } }, { window: { durationMs: D7 }, amount: { usedFraction: 0.2 } }])).toEqual({ five: "10", seven: "20" });
	expect(await read([{ window: { id: "5h" }, amount: { remainingFraction: 0.75 } }, { window: { id: "7d" }, amount: { used: 30, limit: 120 } }])).toEqual({ five: "25", seven: "25" });
	expect(await read([{ window: { id: "7d" }, amount: { unit: "percent", used: 42 } }])).toEqual({ five: undefined, seven: "42" });
	expect(await read([
		{ window: { id: "5h" }, amount: { used: 5, limit: 0 } }, // no limit: unreadable
		{ window: { id: "7d" }, amount: { used: 5 } },
		{ window: { id: "1d" }, amount: { usedFraction: 0.9 } }, // not a tracked window
		{ amount: { usedFraction: 0.9 } },
		{ window: { id: "5h" } },
		{ window: { id: "5h" }, amount: "50%" },
		{ window: { id: "5h" }, amount: null },
	])).toEqual({ five: undefined, seven: undefined });
	expect(await read([{ window: { id: "5h" }, amount: { usedFraction: 0.3, remainingFraction: 0.9 } }])).toEqual({ five: "30", seven: undefined }); // usedFraction beats the others
	expect(await read([{ window: { id: "5h" } , amount: { usedFraction: 0.1 } }, { window: { id: "5h" }, amount: { usedFraction: 0.1 } }])).toEqual({ five: "10", seven: undefined });
});

test("reset detail shows time left and the owning provider", async () => {
	clock = CLOCK0;
	const at = async (resetsIn: number | undefined, id: "5h" | "7d") => {
		const m = await mount({ reports: [{ provider: "anthropic", limits: [{ window: { id, resetsAt: resetsIn === undefined ? undefined : CLOCK0 + resetsIn * 1000 }, amount: { usedFraction: 0.5 } }] }] });
		await m.fire("session_start");
		await settle();
		await m.fire("turn_end");
		return lineWith(m, id).split("│")[0].replace(/^.*?%\s+[▅▁]+\s*/, "").trim();
	};
	expect(await at(4 * 3600 + 40 * 60, "5h")).toBe("4h40m anthropic");
	expect(await at(30 * 3600, "5h")).toBe("30h0m anthropic"); // the 5h meter never counts in days
	expect(await at(30 * 3600, "7d")).toBe("1d6h anthropic");
	expect(await at(6 * 86400 + 15 * 3600 + 59 * 60, "7d")).toBe("6d15h anthropic");
	expect(await at(86400 - 1, "7d")).toBe("23h59m anthropic");
	expect(await at(3600, "5h")).toBe("1h0m anthropic");
	expect(await at(59 * 60 + 59, "5h")).toBe("59m anthropic");
	expect(await at(30, "5h")).toBe("0m anthropic");
	expect(await at(0, "5h")).toBe("anthropic"); // already reset: nothing to count down
	expect(await at(-100, "5h")).toBe("anthropic");
	expect(await at(undefined, "5h")).toBe("anthropic");
});

test("duration formatting in the activity row: minutes with zero-padded seconds, then hours, then days", async () => {
	const lastRun = async (seconds: number) => {
		clock = CLOCK0;
		const m = await mount();
		await m.fire("session_start");
		await m.fire("before_agent_start");
		clock = CLOCK0 + seconds * 1000;
		await m.fire("agent_end", {});
		return strip(m.last()[0]).match(/last run (\S+)/)?.[1];
	};
	expect(await lastRun(0)).toBe("0m00s");
	expect(await lastRun(5)).toBe("0m05s");
	expect(await lastRun(59)).toBe("0m59s");
	expect(await lastRun(60)).toBe("1m00s");
	expect(await lastRun(125)).toBe("2m05s");
	expect(await lastRun(3599)).toBe("59m59s");
	expect(await lastRun(3600)).toBe("1h0m");
	expect(await lastRun(3725)).toBe("1h2m");
	expect(await lastRun(86399)).toBe("23h59m");
	expect(await lastRun(86400)).toBe("1d0h");
	expect(await lastRun(90000)).toBe("1d1h");
});

test("a running prompt shows the critter on its lane, elapsed time, a rate after 3s, tools and run cost", async () => {
	clock = CLOCK0;
	const m = await mount({ branch: [asst({ output: 100, cost: { total: 1 } })] });
	await m.fire("session_start");
	expect(strip(m.last()[0])).toContain("ready");
	await m.fire("before_agent_start");
	expect(strip(m.last()[0])).toMatch(/^📁  proj   🐸·{8}  0m00s · thinking…\s+👾/);
	clock = CLOCK0 + 1000;
	await m.fire("turn_end", { toolResults: [] });
	expect(strip(m.last()[0])).toContain("🐸");
	expect(strip(m.last()[0])).toMatch(/✦🐸·{7}  0m01s/); // pos 1: sparkle right behind it, no trail yet
	clock = CLOCK0 + 3000;
	await m.fire("turn_end", { toolResults: [] });
	expect(strip(m.last()[0])).toMatch(/··✦🐸·{5}  0m03s/);
	m.state.branch = [...m.state.branch, asst({ output: 450, cost: { total: 1.5 } })];
	clock = CLOCK0 + 5000;
	await m.fire("turn_end", { toolResults: [{}, {}, {}] });
	const row = strip(m.last()[0]);
	expect(row).toContain("0m05s");
	expect(row).toContain("90 tok/s"); // 450 tokens since the run began, over 5s
	expect(row).toContain("tools 3");
	expect(row).toContain("$1.50");
	expect(row).not.toContain("thinking");
	clock = CLOCK0 + 9000; // lane wraps after 9 cells
	await m.fire("turn_end", { toolResults: [{}] });
	expect(strip(m.last()[0])).toMatch(/📁  proj   🐸·{8}  0m09s/);
	expect(strip(m.last()[0])).toContain("tools 4");
});

test("rate and run cost stay hidden while they are noise: under 3s, no new tokens, under a cent", async () => {
	clock = CLOCK0;
	const m = await mount({ branch: [asst({ output: 100, cost: { total: 1 } })] });
	await m.fire("session_start");
	await m.fire("before_agent_start");
	m.state.branch = [...m.state.branch, asst({ output: 5000, cost: { total: 0.009 } })];
	clock = CLOCK0 + 2999;
	await m.fire("turn_end", {});
	expect(strip(m.last()[0])).toContain("thinking…");
	expect(strip(m.last()[0])).not.toContain("tok/s");
	expect(strip(m.last()[0])).not.toContain("$");
	clock = CLOCK0 + 3000;
	await m.fire("turn_end", {});
	expect(strip(m.last()[0])).toContain("1667 tok/s");
	expect(strip(m.last()[0])).not.toContain("$");
	const flat = await mount();
	await flat.fire("session_start");
	await flat.fire("before_agent_start");
	clock = CLOCK0 + 10_000;
	await flat.fire("turn_end", {});
	expect(strip(flat.last()[0])).toContain("thinking…"); // no tokens produced: a zero rate is not shown
	expect(strip(flat.last()[0])).not.toContain("tools");
});

test("after the run the critter naps with last-run time, tools and run count; runs rotate critters", async () => {
	clock = CLOCK0;
	const m = await mount();
	await m.fire("session_start");
	await m.fire("before_agent_start");
	clock = CLOCK0 + 65_000;
	await m.fire("turn_end", { toolResults: [{}, {}] });
	await m.fire("agent_end", {});
	expect(strip(m.last()[0])).toMatch(/^📁  proj   🐸  napping · last run 1m05s · tools 2 · 1 run\s+👾/);
	await m.fire("turn_end", { toolResults: [{}] }); // idle turns do not add tools
	expect(strip(m.last()[0])).toContain("tools 2");
	clock = CLOCK0 + 70_000;
	await m.fire("before_agent_start");
	expect(strip(m.last()[0])).toContain("🐇");
	expect(strip(m.last()[0])).not.toContain("napping");
	clock = CLOCK0 + 80_000;
	await m.fire("agent_end", {});
	const nap = strip(m.last()[0]);
	expect(nap).toContain("🐇  napping");
	expect(nap).toContain("last run 0m10s");
	expect(nap).toContain("2 runs");
	expect(nap).not.toContain("tools"); // tools reset at each run start
	const order = ["🐸", "🐇", "🐢", "🐝", "🦄", "🐙", "🐌", "🐧", "🐸"];
	const seen: string[] = [];
	const r = await mount();
	await r.fire("session_start");
	for (let i = 0; i < 9; i++) {
		await r.fire("before_agent_start");
		seen.push(Array.from(strip(r.last()[0])).find(c => order.includes(c) && c !== "📁") ?? "?");
		await r.fire("agent_end", {});
	}
	expect(seen).toEqual(order);
});

test("run state: queued prompts fold into the run, continuations resume it, willContinue does not settle it", async () => {
	clock = CLOCK0;
	const m = await mount();
	await m.fire("session_start");
	await m.fire("before_agent_start");
	clock = CLOCK0 + 30_000;
	await m.fire("before_agent_start"); // a second prompt admitted mid-run: same span
	expect(strip(m.last()[0])).toContain("0m30s");
	await m.fire("agent_end", { willContinue: true });
	clock = CLOCK0 + 40_000;
	await m.fire("turn_end", {});
	expect(strip(m.last()[0])).toContain("0m40s"); // still running
	await m.fire("agent_end", { willContinue: false });
	expect(strip(m.last()[0])).toContain("last run 0m40s");
	expect(strip(m.last()[0])).toContain("1 run");
	clock = CLOCK0 + 100_000;
	await m.fire("agent_start"); // retry/compaction loop: resumes the original start, no new run
	expect(strip(m.last()[0])).toContain("1m40s");
	expect(strip(m.last()[0])).not.toContain("napping");
	await m.fire("agent_end", {});
	expect(strip(m.last()[0])).toContain("1 run");
	const mid = await mount(); // extension loaded mid-run: agent_start with no history begins a run
	await mid.fire("session_start");
	await mid.fire("agent_start");
	expect(strip(mid.last()[0])).toContain("thinking…");
	await mid.fire("agent_start");
	await mid.fire("agent_end", {});
	expect(strip(mid.last()[0])).toContain("1 run");
});

test("a new or switched session resets the run history", async () => {
	clock = CLOCK0;
	const m = await mount();
	await m.fire("session_start");
	await m.fire("before_agent_start");
	await m.fire("agent_end", {});
	expect(strip(m.last()[0])).toContain("napping");
	await m.fire("session_switch");
	expect(strip(m.last()[0])).toContain("ready");
	expect(strip(m.last()[0])).not.toContain("napping");
	await m.fire("before_agent_start");
	await m.fire("session_start");
	expect(strip(m.last()[0])).toContain("ready");
	await m.fire("message_end"); // only refreshes the held context: no repaint
	const n = m.widgets.length;
	await m.fire("message_end");
	expect(m.widgets.length).toBe(n);
});

test("showTools and showRunCount config hide those activity segments", async () => {
	clock = CLOCK0;
	const m = await mount({ cfg: { showTools: false, showRunCount: false } });
	await m.fire("session_start");
	await m.fire("before_agent_start");
	await m.fire("turn_end", { toolResults: [{}] });
	expect(strip(m.last()[0])).not.toContain("tools");
	await m.fire("agent_end", {});
	expect(strip(m.last()[0])).toContain("napping");
	expect(strip(m.last()[0])).not.toMatch(/tools|\d runs?/);
});

test("the render timer is registered once at the configured pace, repaints, and is torn down on shutdown", async () => {
	const m = await mount({ cfg: { renderMs: 2500 } });
	await m.fire("session_start");
	await m.fire("session_start"); // a second start must not stack timers
	expect(m.state.intervals.length).toBe(1);
	expect(m.state.intervals[0][1]).toBe(2500);
	const before = m.widgets.length;
	m.state.intervals[0][0]();
	expect(m.widgets.length).toBe(before + 1);
	await m.fire("session_shutdown");
	expect(m.state.cleared).toEqual([{ id: 1 }]);
	expect(m.statuses.at(-1)).toEqual(["zzz-usage-statusline-spacer", undefined]);
	const early = await mount();
	early.state.intervals.length = 0;
	await early.fire("session_start");
	const [tick] = early.state.intervals[0];
	const w = early.widgets.length;
	tick();
	expect(early.widgets.length).toBe(w + 1);
});

test("a ui that throws never breaks the session", async () => {
	const m = await mount();
	m.state.widgetThrows = true;
	await m.fire("session_start");
	await m.fire("before_agent_start");
	await m.fire("agent_end", {});
	expect(m.widgets.length).toBe(0);
	m.ctx.ui.setStatus = () => { throw new Error("status gone"); };
	m.state.widgetThrows = false;
	await m.fire("turn_end", {});
	expect(m.widgets.length).toBe(1);
});

test("first line: project is the last path segment, model falls back name -> id -> unknown, long names are clipped to width", async () => {
	const at = async (o: Parameters<typeof mount>[0]) => {
		const m = await mount(o);
		await m.fire("session_start");
		return strip(m.last()[0]);
	};
	expect(await at({ cwd: "/a/b/repo/" })).toContain("📁  repo");
	expect(await at({ cwd: "/" })).toContain("📁  /");
	expect(await at({ model: { id: "only-id", provider: "p" } })).toContain("👾  only-id");
	expect(await at({ model: undefined, usage: undefined })).toContain("Claude Opus 5.5");
	const noModel = await mount();
	noModel.ctx.model = undefined;
	await noModel.fire("session_start");
	expect(strip(noModel.last()[0])).toContain("👾  unknown");
	const long = await at({ cwd: `/x/${"p".repeat(40)}`, model: { name: "M".repeat(50), id: "x", provider: "p" } });
	expect(long).toContain(`${"p".repeat(23)}…`);
	expect(long).not.toContain("p".repeat(24));
	expect(long).toContain(`${"M".repeat(27)}…`);
	expect(long).not.toContain("M".repeat(28));
	const exact = await at({ cwd: `/x/${"q".repeat(24)}`, model: { name: "N".repeat(28), id: "x", provider: "p" } });
	expect(exact).toContain("q".repeat(24)); // fits exactly: untouched
	expect(exact).toContain("N".repeat(28));
	const wide = await at({ cwd: `/x/${"界".repeat(20)}` }); // double-width glyphs are budgeted by cells, not characters
	expect(wide).toContain(`${"界".repeat(11)}…`);
	expect(wide).not.toContain("界".repeat(12));
});

test("thinking effort label shows the selected mode where the effective level can't convey it", async () => {
	const label = async (branch: any[], thinking: () => string, cfg?: object) => {
		const m = await mount({ branch, thinking, cfg });
		await m.fire("session_start");
		return strip(m.last()[0]).split("👾")[1];
	};
	const entry = (o: object) => ({ type: "thinking_level_change", ...o });
	expect(await label([], () => "high")).toMatch(/· {1,2}high$/);
	expect(await label([entry({ configured: "auto" })], () => "medium")).toMatch(/auto · medium$/);
	expect(await label([entry({ configured: "auto" })], () => undefined as any)).toMatch(/Opus 5\.5\s+·\s+auto$/);
	expect(await label([entry({ configured: "off" })], () => "minimal")).toMatch(/·\s+off$/);
	expect(await label([entry({ configured: "high" })], () => "medium")).toMatch(/·\s+medium$/); // a concrete selector: the effective level is truthful
	expect(await label([entry({ thinkingLevel: "off" })], () => "off")).toMatch(/·\s+off$/); // legacy entries carry the level only
	expect(await label([entry({ thinkingLevel: "high" })], () => "low")).toMatch(/·\s+low$/); // legacy level: display the effective one
	expect(await label([entry({ configured: "off" }), entry({ configured: "auto" })], () => "low")).toMatch(/auto · low$/); // the last entry wins
	expect(await label([entry({ configured: "off" }), entry({})], () => "low")).toMatch(/·\s+low$/); // a later entry with no selector clears it
	expect(await label([entry({ configured: "off" })], () => "high", { showEffort: false })).not.toContain("·");
	expect(await label([], () => { throw new Error("no api"); })).not.toContain("·");
	expect((await label([], () => undefined as any)).trim()).toBe("Claude Opus 5.5");
});

test("first line composition follows line1Mode and line1Pipe", async () => {
	const first = async (cfg: object) => {
		const m = await mount({ cfg });
		await m.fire("session_start");
		return strip(m.last()[0]);
	};
	expect(await first({})).toBe("📁  proj   🌱  ready    👾  Claude Opus 5.5  ·  high");
	expect(await first({ line1Mode: "cwd-activity" })).toBe("📁  proj   🌱  ready");
	expect(await first({ line1Mode: "activity-model" })).toBe("🌱  ready    👾  Claude Opus 5.5  ·  high");
	expect(await first({ line1Mode: "cwd-model" })).toBe("📁  proj    👾  Claude Opus 5.5  ·  high");
	expect(await first({ line1Mode: "bogus" })).toBe("📁  proj   🌱  ready    👾  Claude Opus 5.5  ·  high");
	expect(await first({ lineGap: 6 })).toBe("📁  proj   🌱  ready      👾  Claude Opus 5.5  ·  high");
	expect(await first({ lineGap: 99 })).toBe("📁  proj   🌱  ready" + " ".repeat(8) + "👾  Claude Opus 5.5  ·  high");
	const piped = await first({ line1Pipe: true });
	expect(piped).toBe(`📁  proj   🌱  ready${" ".repeat(45 - 20)}  │  👾  Claude Opus 5.5  ·  high`);
});

test("narrow panes drop activity segments, then the model, rather than overflow; no row exceeds the real width", async () => {
	clock = CLOCK0;
	const { visibleWidth } = await import("@oh-my-pi/pi-tui");
	for (const cols of [30, 45, 60, 62, 80, 100, 160]) {
		const m = await mount({ cols, cwd: `/x/${"d".repeat(30)}`, model: { name: "Model ".repeat(8), id: "m", provider: "anthropic", contextWindow: 1e6 }, usage: { tokens: 700_000, contextWindow: 1_000_000 }, branch: [asst({ input: 100, output: 50, cost: { total: 3 } }, "anthropic"), asst({ input: 100, cost: { total: 1 } }, "openrouter"), asst({ input: 10 }, "third"), asst({ input: 1 }, "fourth")] });
		await m.fire("session_start");
		await m.fire("before_agent_start");
		clock = CLOCK0 + 20_000;
		await m.fire("turn_end", { toolResults: [{}, {}] });
		clock = CLOCK0;
		for (const row of m.last()) expect([cols, visibleWidth(row) <= cols - 1]).toEqual([cols, true]);
		const twoCol = m.text().some(r => r.includes("│"));
		expect([cols, twoCol]).toEqual([cols, cols >= 100]);
	}
	const tight = await mount({ cols: 45, model: { name: "Claude Opus 5.5", id: "m", provider: "anthropic", contextWindow: 1e6 } });
	await tight.fire("session_start");
	expect(strip(tight.last()[0])).not.toContain("Claude"); // the model is the first thing to go
	expect(strip(tight.last()[0])).toContain("proj");
	clock = CLOCK0;
	await tight.fire("before_agent_start");
	clock = CLOCK0 + 125_000;
	await tight.fire("turn_end", { toolResults: [{}] });
	expect(strip(tight.last()[0])).toContain("2m05s");
});

test("without the pipe the activity segments get the width left after cwd and model; trailing ones drop first", async () => {
	clock = CLOCK0;
	const m = await mount({ cols: 78, branch: [asst({ output: 10, cost: { total: 0 } })] });
	await m.fire("session_start");
	await m.fire("before_agent_start");
	m.state.branch = [...m.state.branch, asst({ output: 1000, cost: { total: 2 } })];
	clock = CLOCK0 + 10_000;
	await m.fire("turn_end", { toolResults: [{}] });
	const row = strip(m.last()[0]);
	expect(row).toContain("👾  Claude Opus 5.5"); // model kept
	expect(row).toContain("0m10s");
	expect(row).not.toContain("$2.00"); // cost is the last segment: first to be dropped
	const wide = await mount({ cols: 200, branch: m.state.branch.slice(0, 1) });
	await wide.fire("session_start");
	await wide.fire("before_agent_start");
	wide.state.branch = [...wide.state.branch, asst({ output: 1000, cost: { total: 2 } })];
	clock = CLOCK0 + 10_000;
	await wide.fire("turn_end", { toolResults: [{}] });
	expect(strip(wide.last()[0])).toContain("$2.00");
});

test("row layout: blank spacer, optional pipe on the spacer, and the right column dropped when disabled", async () => {
	const at = async (cfg: object, cols = 140) => {
		const m = await mount({ cfg, cols, branch: [asst({ input: 5, cost: { total: 1 } })] });
		await m.fire("session_start");
		return m;
	};
	const base = await at({});
	expect(base.last()[1]).toBe("​");
	const noBlank = await at({ blankLine: false });
	expect(noBlank.last().length).toBe(base.last().length - 1);
	expect(strip(noBlank.last()[1])).toContain("ctx");
	const pipe = await at({ spacerPipe: true });
	expect(strip(pipe.last()[1])).toBe(`${" ".repeat(45)}  │`);
	const noRight = await at({ showRight: false });
	expect(noRight.text().join("\n")).not.toMatch(/│|session|tok\b/);
	const rows = noRight.text();
	expect(rows.length).toBe(6);
	expect(rows[2]).toMatch(/ctx.*0 \/ 1M$/);
	expect(rows[2]).toBe(rows[2].trimEnd()); // no trailing padding on any row
	for (const r of base.text().slice(2, 5)) expect(r).toBe(r.trimEnd());
	const hidden = await at({ mCtx: false, m5h: false, m7d: false, showRight: false });
	expect(hidden.last().length).toBe(3); // first line, spacer, trailing spacer
	const only7 = await at({ mCtx: false, m5h: false });
	expect(only7.text().filter(r => /\b(ctx|5h|7d)\b/.test(r)).length).toBe(1);
	expect(lineWith(only7, "7d")).toContain("7d");
	expect(lineWith(only7, "7d")).toContain("session"); // right rows still align from the top
});

test("config file: clamps numbers, validates enums and booleans, accepts a { widget } wrapper, ignores junk", async () => {
	const row = async (cfg: unknown, needle = "ctx") => {
		const m = await mount({ cfg, usage: { tokens: 500, contextWindow: 1000 } });
		await m.fire("session_start");
		return { m, row: strip(raw(m.last(), needle)) };
	};
	expect((await row({ glyphGap: 4 })).row).toContain("📚    ctx");
	expect((await row({ glyphGap: 99 })).row).toContain("📚    ctx");
	expect((await row({ glyphGap: 0 })).row).toContain("📚 ctx");
	expect((await row({ glyphGap: 2.6 })).row).toContain("📚   ctx"); // rounds to 3
	expect((await row({ glyphGap: "wide" })).row).toContain("📚  ctx"); // wrong type: default
	expect((await row({ colGap: 3 })).row).toContain("   │   ");
	expect((await row({ colGap: 99 })).row).toContain("    │    ");
	expect((await row({ colGap: -5 })).row).toContain(" │ ");
	expect((await row({ colGap: 1 })).row).not.toContain("  │  ");
	expect((await row({ barCells: 99 })).row.match(/▅|▁/g)!.length).toBe(24);
	expect((await row({ barCells: 1 })).row.match(/▅|▁/g)!.length).toBe(4);
	expect((await row({ barCells: 10 })).row.match(/▅|▁/g)!.length).toBe(10);
	expect((await row({ barStyle: "full" })).row).toMatch(/█{7}░{7}/);
	expect((await row({ barStyle: "seg" })).row).toMatch(/▰{7}▱{7}/);
	expect((await row({ barStyle: "line" })).row).toMatch(/━{7}─{7}/);
	expect((await row({ barStyle: "nope" })).row).toMatch(/▅{7}▁{7}/);
	expect((await row({ widget: { barStyle: "full" }, statusLine: { x: 1 } })).row).toMatch(/█{7}░{7}/);
	expect((await row({ heat: "yes" })).row).toMatch(/▅{7}/);
	expect((await row("not json {")).row).toContain("50% ▅▅▅▅▅▅▅▁");
	expect((await row("[1,2]")).row).toContain("50% ▅▅▅▅▅▅▅▁");
	expect((await row("null")).row).toContain("50% ▅▅▅▅▅▅▅▁");
	expect((await row({ iconStyle: "text" })).row).toMatch(/^c {2}ctx/);
	expect((await row({ iconStyle: "emoji" })).row).toMatch(/^📚/);
	expect((await row({ iconStyle: "other" })).row).toMatch(/^📚/);
});

test("config: text icons switch every glyph and the critter; heat off colors the bar by threshold", async () => {
	clock = CLOCK0;
	const m = await mount({ cfg: { iconStyle: "text", glyphGap: 1 }, reports: [NOW_USAGE(0.3, { limits: [{ window: { id: "5h" }, amount: { usedFraction: 0.3 } }, { window: { id: "7d" }, amount: { usedFraction: 0.3 } }] })], branch: [asst({ input: 1, cost: { total: 1 } })], usage: { tokens: 100, contextWindow: 1000 } });
	await m.fire("session_start");
	await settle();
	await m.fire("turn_end");
	const rows = m.text();
	expect(rows[0]).toMatch(/^d proj {3}~ ready {4}m Claude Opus 5\.5/);
	expect(rows[2]).toMatch(/^c ctx/);
	expect(rows[2]).toContain("│  $ session");
	expect(rows[3]).toMatch(/^5 5h /);
	expect(rows[3]).toContain("│  p anthropic");
	expect(rows[4]).toMatch(/^7 7d /);
	await m.fire("before_agent_start");
	expect(m.text()[0]).toMatch(/^d proj {3}\*·{9} /); // text critter and a lane sized for 1-cell icons
	const heatOff = await mount({ cfg: { heat: false }, usage: { tokens: 700, contextWindow: 1000 } });
	await heatOff.fire("session_start");
	const ctxRow = raw(heatOff.last(), "ctx");
	expect(ctxRow).toContain("\u001b[1;33m▅\u001b[1;33m▅"); // every filled cell takes the threshold color of the whole reading (70%: yellow)
	expect(ctxRow).not.toContain("\u001b[38;2;");
	const heatOn = await mount({ usage: { tokens: 700, contextWindow: 1000 } });
	await heatOn.fire("session_start");
	expect(raw(heatOn.last(), "ctx")).toContain("\u001b[38;2;80;250;123m▅");
});

test("config: provRows, detailW, nameW, cwdWidth and modelWidth clamp to their ranges", async () => {
	const providers = ["pa", "pb", "pc", "pd", "pe", "pf"].map((p, i) => asst({ input: 100 - i }, p));
	const tableRows = async (cfg: object) => {
		const m = await mount({ cfg, branch: providers });
		await m.fire("session_start");
		return m.text().map(r => r.split("│")[1] ?? "").filter(r => r.includes(" tok")).length;
	};
	expect(await tableRows({ provRows: 99 })).toBe(1 + 3 + 1); // max 4 slots: 3 named + the "+N more" row
	expect(await tableRows({ provRows: -3 })).toBe(1);
	expect(await tableRows({ provRows: 2 })).toBe(1 + 1 + 1);
	expect(await tableRows({})).toBe(1 + 2 + 1);
	const detail = async (cfg: object) => {
		const m = await mount({ cfg, usage: { tokens: 123_456_789, contextWindow: 999_000_000 } });
		await m.fire("session_start");
		return strip(raw(m.last(), "ctx")).split("│")[0].trimEnd().replace(/^.*▁|^.*▅/, "").trim();
	};
	expect(await detail({})).toBe("123.4M / 999M");
	expect(await detail({ detailW: 8 })).toBe("123.4M …"); // 8 is the floor
	expect(await detail({ detailW: 1 })).toBe("123.4M …");
	expect(await detail({ detailW: 99 })).toBe("123.4M / 999M");
	const name = async (cfg: object, provider: string) => {
		const m = await mount({ cfg, branch: [asst({ input: 1 }, provider)] });
		await m.fire("session_start");
		return lineWith(m, provider.slice(0, 3)).split("│")[1];
	};
	expect(await name({}, "p".repeat(14))).toContain("p".repeat(14) + " "); // nameW 10 grows to fit, up to 14
	expect(await name({}, "p".repeat(15))).toContain("p".repeat(13) + "…");
	expect(await name({ nameW: 99 }, "p".repeat(20))).toContain("p".repeat(20) + " "); // ceiling 18 grows by 4 to fit
	expect(await name({ nameW: 99 }, "p".repeat(30))).toContain("p".repeat(21) + "…");
	expect(await name({ nameW: 1 }, "ppp")).toMatch(/ppp {3}/); // floor 6
	const cw = async (cfg: object) => {
		const m = await mount({ cfg, cwd: `/x/${"c".repeat(60)}`, model: { name: "m".repeat(60), id: "i", provider: "p" } });
		await m.fire("session_start");
		const f = strip(m.last()[0]);
		return { cwd: f.match(/c+…/)?.[0].length, model: f.match(/m+…/)?.[0].length };
	};
	expect(await cw({ cwdWidth: 1, modelWidth: 1 })).toEqual({ cwd: 8, model: 10 });
	expect(await cw({ cwdWidth: 99, modelWidth: 99 })).toEqual({ cwd: 40, model: 40 });
});


test("config: renderMs and pollS are bounded before the timer is created", async () => {
	const ms = async (cfg: object) => {
		const m = await mount({ cfg });
		await m.fire("session_start");
		return m.state.intervals[0][1];
	};
	expect(await ms({})).toBe(1000);
	expect(await ms({ renderMs: 1 })).toBe(250);
	expect(await ms({ renderMs: 99_999 })).toBe(10_000);
	expect(await ms({ renderMs: 2000.4 })).toBe(2000);
	clock = CLOCK0;
	const poll = async (pollS: number) => {
		clock = CLOCK0;
		const m = await mount({ cfg: { pollS }, reports: [] });
		await m.fire("session_start");
		const tick = m.state.intervals[0][0];
		await settle();
		clock = CLOCK0 + 14_999;
		tick();
		const early = m.state.reportCalls;
		clock = CLOCK0 + 15_000;
		tick();
		const at15 = m.state.reportCalls;
		await settle();
		clock = CLOCK0 + 600_000;
		tick();
		return [early, at15, m.state.reportCalls];
	};
	expect(await poll(1)).toEqual([1, 2, 3]); // floor is 15s
	expect(await poll(9999)).toEqual([1, 1, 2]); // ceiling is 600s: due exactly at 600s
});

test("config edits apply on the next render; removing the file restores the defaults", async () => {
	const m = await mount({ cfg: { iconStyle: "text" } });
	await m.fire("session_start");
	expect(m.text()[0]).toMatch(/^d {2}proj/);
	const file = join(m.home, ".omp", "agent", "usage-statusline.json");
	writeFileSync(file, JSON.stringify({ widget: { barStyle: "full", colGap: 1 } }));
	utimesSync(file, new Date(2030, 0, 1), new Date(2030, 0, 1));
	await m.fire("turn_end");
	expect(m.text()[0]).toMatch(/^📁 +proj/); // iconStyle back to the default: the new file replaced the old one, it did not merge
	expect(lineWith(m, "ctx")).toMatch(/░{14}/);
	expect(lineWith(m, "ctx")).toContain(" │ ");
	rmSync(file);
	await m.fire("turn_end");
	expect(lineWith(m, "ctx")).toMatch(/▁{14}/);
	expect(lineWith(m, "ctx")).toContain("  │  ");
});

test("the project's atlas segment is appended as a row once the async lookup returns", async () => {
	const proj = mkdtempSync(join(tmpdir(), "sl-atlas-"));
	mkdirSync(join(proj, ".atlas", ".run"), { recursive: true });
	writeFileSync(join(proj, ".atlas", ".run", "todos.json"), JSON.stringify({ last_session_id: "s1", items: [{ status: "in_progress", session_id: "s1", origin: "manual", phase: "implement" }] }));
	const m = await mount({ cwd: proj });
	await m.fire("session_start");
	expect(m.text().some(r => r.startsWith("atlas"))).toBe(false); // first frame: nothing cached yet
	for (let i = 0; i < 100 && !m.text().some(r => r.startsWith("atlas")); i++) {
		await Bun.sleep(30);
		await m.fire("turn_end");
	}
	const rows = m.text();
	const at = rows.findIndex(r => r.startsWith("atlas"));
	expect(rows[at]).toContain("implement");
	expect(at).toBe(rows.length - 2); // after the meter rows, before the trailing spacer
	const bare = await mount({ cwd: mkdtempSync(join(tmpdir(), "sl-noatlas-")) });
	await bare.fire("session_start");
	await Bun.sleep(300);
	await bare.fire("turn_end");
	expect(bare.text().some(r => r.startsWith("atlas"))).toBe(false);
});

test("status wrapper: other keys pass through, lens and ponytail merge into one row, installed once", async () => {
	const m = await mount();
	const writes: Array<[string, string | undefined]> = [];
	const ui = m.ctx.ui;
	const orig = ui.setStatus;
	ui.setStatus = (k: string, t: string | undefined) => void writes.push([k, t]);
	void orig;
	await m.fire("session_start");
	await m.fire("turn_end"); // render again on the same ui: must not wrap twice
	writes.length = 0;
	ui.setStatus("other-ext", "hello");
	expect(writes).toEqual([["other-ext", "hello"]]);
	writes.length = 0;
	ui.setStatus("ponytail", "pony 🐴"); // lens unknown: leave ponytail's own row as drawn
	expect(writes).toEqual([["ponytail", "pony 🐴"]]);
	writes.length = 0;
	ui.setStatus("pi-lens-lsp", "LSP Active");
	expect(writes.length).toBe(2); // ponytail's own row is cleared, then one merged lens row
	expect(writes[0]).toEqual(["ponytail", undefined]);
	const NB = " ";
	expect(writes[1][0]).toBe("pi-lens-lsp");
	expect(writes[1][1]).toBe(`LSP${NB}Active`.replace(/ /g, " ") + NB.repeat(45 - 10) + NB.repeat(5) + `pony${NB}🐴`);
	writes.length = 0;
	ui.setStatus("ponytail", undefined); // ponytail went away: the lens row reverts to plain text
	expect(writes.at(-1)).toEqual(["pi-lens-lsp", "LSP Active"]);
	writes.length = 0;
	ui.setStatus("pi-lens-lsp", undefined);
	ui.setStatus("ponytail", "back");
	expect(writes.at(-1)![1]).toBe(NB.repeat(45 + 5) + "back"); // no lens text: the pony column still lines up under the right column
	const lensOnly = await mount();
	const w2: Array<[string, string | undefined]> = [];
	lensOnly.ctx.ui.setStatus = (k: string, t: string | undefined) => void w2.push([k, t]);
	await lensOnly.fire("session_start");
	w2.length = 0;
	lensOnly.ctx.ui.setStatus("pi-lens-lsp", "LSP Active");
	expect(w2).toEqual([["pi-lens-lsp", "LSP Active"]]); // nothing to merge: written as is
});

test("fallow impact joins the lens row when the binary reports, and stays hidden on unexpected output", async () => {
	const bin = mkdtempSync(join(tmpdir(), "sl-fallow-"));
	const argsFile = join(bin, "args.txt");
	const script = (out: string) => `#!/bin/sh\necho "$@" > "${argsFile}"\nprintf '${out}'\n`;
	const run = async (out: string) => {
		writeFileSync(join(bin, "fallow"), script(out));
		chmodSync(join(bin, "fallow"), 0o755);
		rmSync(argsFile, { force: true });
		const realWhich = Bun.which;
		(Bun as any).which = (n: string, o?: any) => (n === "fallow" ? join(bin, "fallow") : realWhich(n, o)); // the binary is looked up once, at module load
		let m: Mount;
		try {
			m = await mount({ cwd: "/tmp/fallow-proj" });
		} finally {
			(Bun as any).which = realWhich;
		}
		const writes: Array<[string, string | undefined]> = [];
		m.ctx.ui.setStatus = (k: string, t: string | undefined) => void writes.push([k, t]);
		await m.fire("session_start");
		for (let i = 0; i < 100 && !existsSync(argsFile); i++) await Bun.sleep(20);
		await Bun.sleep(100);
		writes.length = 0;
		m.ctx.ui.setStatus("pi-lens-lsp", "LSP");
		return { args: readFileSync(argsFile, "utf8").trim(), last: writes.at(-1)![1] };
	};
	const ok = await run("fallow impact: 3 saved\\nsecond line\\n");
	expect(ok.args).toBe("--root /tmp/fallow-proj impact statusline");
	expect(ok.last!.endsWith("fallow impact: 3 saved")).toBe(true);
	expect(ok.last).not.toContain("second");
	const bad = await run("something else\\n");
	expect(bad.last).toBe("LSP");
	const empty = await run("");
	expect(empty.last).toBe("LSP");
});
