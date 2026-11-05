// mission-panel behavior beyond the golden fixtures: elapsed clock, role/name abbreviation, lane meters, overflow,
// ticker, idle wave, row budgeting against the board, coreLine and the throttled gates cache.
import { expect, test } from "bun:test";
import type { Cell } from "../mod/core-row";
import { age, coreLine, createGatesCache, type PanelModel, type PanelWorker, renderPanel, roleOf } from "./mission-panel";
import { RED, TEAL, TXT, bg, chip, seg } from "./panel-paint";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const worker = (name: string, extra: Partial<PanelWorker> = {}): PanelWorker => ({ name, secs: 30, role: "implementer", tool: { tool: "edit", target: "a.ts", active: true }, ...extra });
const model = (over: Partial<PanelModel> = {}): PanelModel => ({
	width: 140, maxLines: 12, phase: "implement", spin: "◆", laneSpin: "⠋", tick: 0, done: 0, total: 0,
	workers: [worker("implementer-0001")], notes: [], gates: [], channel: "demo@master/lead-1", ...over,
});
const rows = (m: PanelModel) => renderPanel(m).map(strip);
const title = (m: PanelModel) => rows(m)[0]!;

test("title clock: mm:ss below an hour, age() form from exactly one hour", () => {
	expect(title(model({ elapsedSecs: 59 }))).toContain("◷ 00:59 ");
	expect(title(model({ elapsedSecs: 3599 }))).toContain("◷ 59:59 ");
	expect(title(model({ elapsedSecs: 3600 }))).toContain("◷ 1h00m ");
	expect(title(model({ elapsedSecs: 90_000 }))).toContain("◷ 1d01h ");
	expect(title(model({}))).toContain("◷ 00:00 ");
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

test("a lane's role column drops leading hyphen words to fit (completeness-critic -> critic)", () => {
	const r = rows(model({ workers: [worker("completeness-critic-f08e", { role: "completeness-critic" })] }));
	const lane = r.find((x) => x.includes("critic"))!;
	expect(lane).toContain(" critic ");
	expect(lane).not.toContain("completeness");
});

test("a worker name keeps role and id when it must be shortened (never just the id)", () => {
	const lane = rows(model({ width: 100, workers: [worker("completeness-critic-f08e", { role: "x" })] })).find((x) => x.includes("f08e"))!;
	expect(lane).toContain("critic-f08e");
});

test("a lane without a role field derives it from the name; an unhyphenated name reads as task", () => {
	const lane = (name: string) => rows(model({ workers: [worker(name, { role: undefined })] })).find((x) => x.includes("edit"))!;
	expect(lane("explorer-9")).toContain(" explorer ");
	expect(lane("solo")).toContain(" task ");
});

test("lane bar: fills with elapsed time and is an empty track from 120 s on", () => {
	const lane = (secs: number) => {
		const m = model({ workers: [worker("implementer-0001", { secs })] });
		return rows(m).find((x) => x.includes("edit"))!.replace(age(secs).padStart(6), "");
	};
	expect(lane(120)).toBe(lane(0));
	expect(lane(500)).toBe(lane(0));
	expect(lane(119)).not.toBe(lane(0));
	expect(lane(60)).not.toBe(lane(0));
});

test("more than five workers: five lanes and a '+N more' row with the exact overflow", () => {
	const ws = Array.from({ length: 8 }, (_, i) => worker(`implementer-000${i}`));
	const r = rows(model({ workers: ws, maxLines: 14 }));
	expect(r.filter((x) => x.includes("implementer-")).length).toBe(5);
	expect(r.find((x) => x.includes("more"))).toContain("+3 more");
	expect(title(model({ workers: ws }))).toContain("8 live");
});

test("ticker: newest notes with bold nicks, hh:mm stamp only for a real clock value", () => {
	const m = model({ notes: [{ from: "lead-1", to: "implementer-0001", text: "ship it", ts: 1_700_000_000 }, { from: "implementer-0001", to: "lead-1", text: "ok" }] });
	const raw = renderPanel(m).find((x) => strip(x).includes("→"))!;
	expect(strip(raw)).toContain("lead-1 → implementer-0001: ship it");
	expect(strip(raw)).toMatch(/\d\d:\d\d lead-1/);
	expect(strip(raw)).toContain("implementer-0001 → lead-1: ok");
	expect(strip(raw)).not.toMatch(/\d\d:\d\d implementer-0001 →/);
	expect(raw).toMatch(/\x1b\[1m\x1b\[38;2;[0-9;]+m\x1b\[48;2;[0-9;]+mlead-1/);
	expect(raw).toMatch(/\x1b\[1m\x1b\[38;2;[0-9;]+m\x1b\[48;2;[0-9;]+mimplementer-0001/);
});

test("idle panel: summary line, a steady (unshimmered) done pill, and the failed count", () => {
	const idle = (failed: number) => model({ idle: { workers: 3, secs: 70, failed }, maxLines: 6 });
	const ok = rows(idle(0));
	expect(ok[0]).toContain("idle  ·  last wave: 3 workers · 1m10s · ✔ ok");
	expect(rows(idle(2))[0]).toContain("✖ 2 failed");
	expect(rows(model({ idle: { workers: 1, failed: 0 } }))[0]).toContain("last wave: 1 workers · ✔ ok");
	const rail = renderPanel(idle(0))[1]!;
	expect(rail).toContain(bg(TEAL)); // idle: exactly the phase colour, no shimmer blend
	expect(strip(rail)).toContain("◆ DONE");
});

test("idle panel puts the board under the title and rail, within maxLines minus those two rows", () => {
	const todos = Array.from({ length: 6 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
	const m = model({ idle: { workers: 1, failed: 0 }, todos, todosExpanded: true, maxLines: 5 });
	const r = rows(m);
	expect(r[0]).toContain("idle");
	expect(r[1]).toContain("DONE");
	expect(r.length).toBe(2 + 3); // two header rows + the board's 3-row budget (2 items + "+4 more")
	expect(r[r.length - 1]).toContain("+4 more");
});

test("live panel keeps two rows for lanes when the expanded board is long", () => {
	const todos = Array.from({ length: 9 }, (_, i) => ({ content: `item ${i}`, status: "pending" }));
	const m = model({ workers: [worker("implementer-0001"), worker("implementer-0002")], todos, todosExpanded: true, maxLines: 9 });
	const r = rows(m);
	expect(r.length).toBeLessThanOrEqual(9);
	expect(r.filter((x) => x.includes("implementer-000")).length).toBe(2);
	expect(r.filter((x) => /item \d/.test(x)).length).toBe(3); // mid=6, board capped to mid-2=4 rows: 3 items + "+N more"
	expect(r.find((x) => x.includes("more"))).toBeDefined();
});

test("coreLine joins chips and plain cells in their hue", () => {
	const cells: Cell[] = [{ t: "CONTRACT", hue: "violet", chip: true }, { t: " 3/4", hue: "text" }, { t: "x", hue: "red" }];
	const out = coreLine(cells);
	expect(typeof out).toBe("string");
	expect(strip(out)).toBe(" CONTRACT  3/4x");
	expect(out).toBe(chip("CONTRACT", [203, 166, 247]) + seg(" 3/4", TXT) + seg("x", RED));
	expect(coreLine([])).toBe("");
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
