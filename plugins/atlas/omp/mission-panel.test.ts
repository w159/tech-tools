// mission-panel behavior beyond the golden fixtures: the band facts, role and name columns, worker states and sort
// order, overflow, the message row, the idle panel, row budgeting against the board, the one-row narrow form, ANSI
// tones and the throttled gates cache. Layout rules live in mod/mission-layout.ts; the goldens pin the shared text.
import { expect, test } from "bun:test";
import { age, createGatesCache, type PanelModel, type PanelWorker, renderPanel, roleOf } from "./mission-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const worker = (name: string, extra: Partial<PanelWorker> = {}): PanelWorker => ({ name, secs: 30, role: "implementer", tool: { tool: "edit", target: "a.ts", active: true }, ...extra });
const model = (over: Partial<PanelModel> = {}): PanelModel => ({
	width: 140, maxLines: 12, phase: "implement", spin: "◆", laneSpin: "⠋", tick: 0, done: 0, total: 0,
	workers: [worker("implementer-0001")], notes: [], gates: [], channel: "demo@master/lead-1", ui: { theme: "mocha", ascii: false, color: "truecolor" }, ...over,
});
const rows = (m: PanelModel) => renderPanel(m).map(strip);
const head = (m: PanelModel) => rows(m)[0]!;
const laneOf = (m: PanelModel, name: string) => rows(m).find((x) => x.includes(name))!;

test("band: the todo gauge reads `N of M`, ctx shows only when known, no board means no todo part", () => {
	expect(head(model({ done: 2, total: 5 }))).toContain("todo ████░░░░░░ 2 of 5");
	expect(head(model({ done: 0, total: 0 }))).not.toContain("todo");
	expect(head(model({ ctx: 0.5 }))).toContain("ctx ████░░░░ 50%");
	expect(head(model({}))).not.toContain("ctx");
});

test("band names the capsule, the phase and the worker count; no project, scope or clock", () => {
	const h = head(model({ team: "fix/low", elapsedSecs: 59, workers: Array.from({ length: 8 }, (_, i) => worker(`implementer-000${i}`)) }));
	expect(h).toContain("◖ ◆ ATLAS ◗  implement · phase 4/6");
	expect(h).toContain("◐ 8 running");
	expect(h).not.toMatch(/demo@master|fix\/low|00:59/);
});

test("age formats every unit boundary", () => {
	expect([0, 59, 60, 3599, 3600, 86_399, 86_400].map(age)).toEqual(["0s", "59s", "1m00s", "59m59s", "1h00m", "23h59m", "1d00h"]);
});

test("roleOf: role before the last hyphen word, the whole name when only a hyphen-led word, task when no hyphen", () => {
	expect(roleOf("implementer-0001")).toBe("implementer");
	expect(roleOf("completeness-critic-f08e")).toBe("completeness-critic");
	expect(roleOf("-lonely")).toBe("-lonely");
	expect(roleOf("plain")).toBe("task");
});

test("role column joins at 100 columns; a worker without a role derives it from the name, an unhyphenated name reads as task", () => {
	const lane = (name: string, width = 140) => laneOf(model({ width, workers: [worker(name, { role: undefined })] }), "edit");
	expect(lane("explorer-9")).toMatch(/explorer-9 +explorer +edit {2}a\.ts/);
	expect(lane("solo")).toMatch(/solo +task +edit/);
	expect(lane("explorer-9", 99)).not.toContain("explorer ");
	expect(lane("explorer-9", 100)).toContain("explorer ");
});

test("long names and roles are cut with an ellipsis to their columns, never run into the next one", () => {
	const lane = laneOf(model({ workers: [worker("completeness-critic-f08e", { role: "completeness-critic" })] }), "edit");
	expect(lane).toMatch(/◐ completeness-cri\.\.\. completen\.\.\. edit {2}a\.ts +30s $/);
});

test("every row is exactly the width at 20..200 columns", () => {
	const ws = [worker("implementer-0001"), worker("w-2", { state: "failed" }), worker("x-3", { state: "waiting" })];
	for (const width of [20, 40, 79, 80, 99, 100, 140, 200]) {
		const m = model({ width, workers: ws, notes: [{ from: "a", to: "b", text: "hello" }], gates: [{ id: "tripwire", title: "t", lines: [{ ok: false, label: "x" }] }] as never });
		for (const r of rows(m)) expect([width, [...r].length]).toEqual([width, width]);
	}
});

test("worker states: running spins with tool and target, thinking dims the last tool, starting is a hollow diamond", () => {
	const r = rows(model({ workers: [
		worker("run-1"),
		worker("think-1", { tool: { tool: "edit", target: "x.ts", active: false } }),
		worker("start-1", { tool: undefined }),
	] }));
	expect(r.find((x) => x.includes("run-1"))).toMatch(/◐ run-1 +implementer {2}edit {2}a\.ts/);
	expect(r.find((x) => x.includes("think-1"))).toMatch(/◐ think-1 +implementer {2}thinking {3}last edit x\.ts/);
	expect(r.find((x) => x.includes("start-1"))).toMatch(/◇ start-1 +implementer {2}starting/);
});

test("failed and waiting workers sort first and never spin; a finished worker sorts last, green", () => {
	const ws = [worker("done-1", { state: "done" }), worker("run-1"), worker("wait-1", { state: "waiting" }), worker("fail-1", { state: "failed" })];
	const out = renderPanel(model({ workers: ws }));
	const plain = out.map(strip);
	const at = (n: string) => plain.findIndex((x) => x.includes(n));
	expect([at("fail-1"), at("wait-1"), at("run-1"), at("done-1")]).toEqual([...[at("fail-1"), at("wait-1"), at("run-1"), at("done-1")]].sort((a, b) => a - b));
	expect(plain[at("fail-1")]).toMatch(/■ fail-1 .* failed/);
	expect(plain[at("wait-1")]).toMatch(/◉ wait-1 .* waiting/);
	expect(plain[at("done-1")]).toMatch(/● done-1 .* finished/);
	expect(out[at("fail-1")]).toContain("38;2;243;139;168"); // bad
	expect(out[at("wait-1")]).toContain("38;2;148;226;213"); // info
	expect(out[at("done-1")]).toContain("38;2;166;227;161"); // ok
	const later = renderPanel(model({ workers: ws, tick: 3 })).map(strip);
	expect(later.find((x) => x.includes("fail-1"))).toContain("■ fail-1");
	expect(later.find((x) => x.includes("wait-1"))).toContain("◉ wait-1");
});

test("a tight budget folds workers past the budget into `+N more`, naming any that need attention", () => {
	const ws = [...Array.from({ length: 6 }, (_, i) => worker(`implementer-000${i}`)), worker("w-9", { state: "waiting" })];
	const r = rows(model({ workers: ws, maxLines: 5 }));
	expect(r.length).toBeLessThanOrEqual(5);
	expect(r.filter((x) => x.includes("implementer-")).length + r.filter((x) => x.includes("w-9")).length).toBe(3);
	expect(r.find((x) => x.includes("more"))).toMatch(/\+4 more *$/);
	const attention = rows(model({ workers: [worker("a-1"), worker("b-1"), worker("c-1"), worker("d-1", { state: "waiting" }), worker("e-1", { state: "waiting" })], maxLines: 3 }));
	expect(attention.find((x) => x.includes("more"))).toContain("· 1 waiting");
	expect(attention.some((x) => x.includes("d-1"))).toBe(true); // the waiting one is kept first
});

test("message row: the newest note only, `from to to   text   hh:mm` with the clock only for a real value; bold sender", () => {
	const notes = [{ from: "lead", to: "implementer-0001", text: "ship it", ts: 1_700_000_000 }, { from: "implementer-0001", to: "lead", text: "ok" }];
	const raw = renderPanel(model({ notes })).find((x) => strip(x).includes(" to "))!;
	expect(strip(raw)).toMatch(/^ implementer-0001 to lead-1 {3}ok +$/); // the lead is named from the channel, no clock
	expect(rows(model({ notes })).filter((x) => x.includes(" to "))).toHaveLength(1);
	expect(raw).toMatch(/\x1b\[1;38;2;[0-9;]+;48;2;[0-9;]+mimplementer-0001/);
	const stamped = rows(model({ notes: [{ from: "a", to: "b", text: "hi", ts: 1_700_000_000 }] })).find((x) => x.includes(" to "))!;
	expect(stamped).toMatch(/a to b {3}hi +\d\d:\d\d $/);
});

test("the message row drops before the footer when rows run short", () => {
	const m = (maxLines: number) => rows(model({ maxLines, notes: [{ from: "a", to: "b", text: "hi" }], gates: [{ id: "routing", title: "r", lines: [{ ok: true, label: "y" }] }] as never }));
	expect(m(8).some((x) => x.includes("a to b"))).toBe(true);
	expect(m(3).some((x) => x.includes("a to b"))).toBe(false);
	expect(m(3).some((x) => x.includes("checks"))).toBe(true);
	expect(m(2).some((x) => x.includes("checks"))).toBe(false);
});

test("footer: checks only, no key hints or buttons on omp", () => {
	const r = rows(model({ gates: [{ id: "tripwire", title: "t", lines: [{ ok: false, label: "x" }] }, { id: "routing", title: "r", lines: [{ ok: true, label: "y" }] }] as never, notes: [{ from: "a", to: "b", text: "hi" }] }));
	expect(r.at(-1)).toBe(" checks  ■ tripwire  ● routing".padEnd(140));
	expect(r.join("\n")).not.toMatch(/r: route|ctrl\+x/);
});

test("idle panel: the band reads done, the last run follows, a failed count is bold text", () => {
	const idle = (failed: number) => model({ idle: { workers: 3, secs: 70, failed }, workers: [], phase: "done", done: 6, total: 6, maxLines: 6 });
	const ok = rows(idle(0));
	expect(ok[0]).toContain("done · phase 6/6");
	expect(ok[0]).toContain("6 of 6");
	expect(ok[1]).toMatch(/^ last run {2}3 workers · 1m10s · all ok +$/);
	expect(rows(idle(2))[1]).toContain("2 failed");
	expect(renderPanel(idle(2))[1]).toMatch(/\x1b\[1;38;2;205;214;244;48;2;24;24;37m2 failed/);
	expect(rows(model({ idle: { workers: 1, failed: 0 }, workers: [] }))[1]).toContain("last run  1 worker · all ok");
	expect(renderPanel(idle(0))[1]).not.toMatch(/[◐◓◑◒]/); // idle panels do not move
});

test("idle panel puts the board under the band and the last run, within maxLines minus those two rows", () => {
	const todos = Array.from({ length: 6 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
	const m = model({ idle: { workers: 1, failed: 0 }, workers: [], todos, todosExpanded: true, maxLines: 5 });
	const r = rows(m);
	expect(r[0]).toContain("ATLAS");
	expect(r[1]).toContain("last run");
	expect(r.length).toBe(2 + 3); // two head rows + the board's 3-row budget (header, 1 item, "+5 more")
	expect(r[2]).toMatch(/^ITEM +STATE +OWNER +DETAIL/);
	expect(r[r.length - 1]).toContain("+5 more");
});

test("live panel keeps the workers when the expanded board is long", () => {
	const todos = Array.from({ length: 9 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
	const m = model({ workers: [worker("implementer-0001"), worker("implementer-0002")], todos, todosExpanded: true, maxLines: 8 });
	const r = rows(m);
	expect(r.length).toBeLessThanOrEqual(8);
	expect(r.filter((x) => x.includes("implementer-000")).length).toBe(2);
	expect(r.filter((x) => /item \d/.test(x)).length).toBe(2); // the board slot holds the header, 2 items and the `+N more` row
	expect(r.find((x) => x.includes("more"))).toBeDefined();
});

test("below 80 columns the panel is the band alone: `◖ ◆ ATLAS ◗ ph 4/6 · todo 1/4 · ◐1`", () => {
	const gates = [{ id: "tripwire", title: "t", lines: [{ ok: false, label: "x" }] }] as never;
	const r = rows(model({ width: 79, done: 1, total: 4, gates }));
	expect(r).toHaveLength(1);
	expect(r[0]!.trim()).toBe("◖ ◆ ATLAS ◗ ph 4/6 · todo 1/4 · ◐1");
	expect(rows(model({ width: 80 })).length).toBeGreaterThan(1);
});

test("blocked: `▲ blocked · needs you` with the warn glyph instead of the phase", () => {
	const m = model({ blocked: true, team: "fix/low", workers: [] });
	expect(head(m)).toContain("▲ blocked · needs you");
	expect(renderPanel(m)[0]).toContain("38;2;249;226;175");
});

test("tones are the Catppuccin hexes: panel #181825, capsule fill and caps accent #cba6f7, ink #11111b", () => {
	const out = renderPanel(model());
	expect(out[0]).toContain("48;2;24;24;37"); // panel
	expect(out[0]).toContain("38;2;203;166;247"); // accent caps
	expect(out[0]).toMatch(/1;38;2;17;17;27;48;2;203;166;247m ◆ ATLAS /); // ink on the accent fill
});

test("latte, NO_COLOR and 256 colours reach the ANSI: latte panel, no colour codes, indexed colours", () => {
	const latte = renderPanel(model({ ui: { theme: "latte", ascii: false, color: "truecolor" } }));
	expect(latte[0]).toContain("48;2;230;233;239"); // latte panel
	const none = renderPanel(model({ ui: { theme: "mocha", ascii: false, color: "none" } }));
	expect(none.join("")).not.toMatch(/38;|48;/);
	expect(strip(none[0]!)).toContain("◖ ◆ ATLAS ◗");
	const c256 = renderPanel(model({ ui: { theme: "mocha", ascii: false, color: "256" } }));
	expect(c256[0]).toMatch(/38;5;\d+/);
	expect(c256[0]).not.toContain("38;2;");
});

test("gates cache: throttles to one run per ttl, stays single-flight, and runs again after the ttl", async () => {
	let t = 1_000;
	const calls: string[][] = [];
	let release!: (s: string) => void;
	const cache = createGatesCache((argv) => (calls.push(argv), new Promise<string>((r) => (release = r))), () => t, "/s/atlas_gates.py", 10_000);
	expect(cache.read()).toBeNull();
	cache.refresh("S1", "/root");
	cache.refresh("S1", "/root"); // busy
	expect(calls).toEqual([["python3", "/s/atlas_gates.py", "--session", "S1", "--root", "/root", "--json"]]);
	release(JSON.stringify({ groups: [{ id: "completion", title: "Gates", lines: [{ id: "a", label: "a", ok: false }] }] }));
	await Bun.sleep(5);
	expect(cache.read()?.[0]?.lines[0]?.ok).toBe(false);
	t += 9_999;
	cache.refresh("S1", "/root"); // inside ttl
	expect(calls.length).toBe(1);
	t += 1;
	cache.refresh("S1", "/root"); // exactly ttl: runs again (idle again after the first completed)
	expect(calls.length).toBe(2);
	release(JSON.stringify({ groups: [] }));
	await Bun.sleep(5);
	expect(cache.read()).toEqual([]);
	t += 10_000;
	cache.refresh("S1", "/root"); // not stuck busy after a second completion
	expect(calls.length).toBe(3);
});

test("gates cache: a failed run becomes an error group and the failure still throttles", async () => {
	let t = 0;
	let n = 0;
	const cache = createGatesCache(async () => { n++; throw new Error("gates exit 2"); }, () => t, "/s/g.py");
	cache.refresh("S", "/r");
	await Bun.sleep(5);
	expect(cache.read()).toEqual([{ id: "completion", title: "Gates", lines: [], error: "gates exit 2" }]);
	t = 9_999;
	cache.refresh("S", "/r");
	expect(n).toBe(1);
	t = 10_000;
	cache.refresh("S", "/r");
	expect(n).toBe(2);
});

test("message row skips presence events: a newer join or leave never replaces the last message", () => {
	const notes = [
		{ from: "impl-1", to: "lead", text: "need a decision on the ttl", ts: 1_700_000_000, kind: "say" },
		{ from: "explorer-a843", to: "all", text: "joined", ts: 1_700_000_010, kind: "join" },
		{ from: "explorer-a843", to: "all", text: "left", ts: 1_700_000_020, kind: "leave" },
	];
	const out = rows(model({ notes })).join("\n");
	expect(out).toContain("impl-1 to lead");
	expect(out).not.toMatch(/to all +(joined|left)/);
});
