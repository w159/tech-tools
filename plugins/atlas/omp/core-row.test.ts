// Parity: the omp panel's core row and /atlas-core print the same text as the Claude mod for the shared core fixture.
// Goldens: contracts/core-golden.ts. Twin: mod/core-row.test.ts.
import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { coreGolden } from "../contracts/core-golden";
import { coreFixture, coreMatrix } from "../contracts/core-fixture";
import { coreReport } from "../mod/core-row";
import { coreModel } from "../mod/data/core";
import { registerAtlasCoreCommand } from "./core-command";
import { createCoreSource } from "./core-source";
import { type PanelModel, renderPanel } from "./mission-panel";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const fixtureModel = () => coreModel({ ...coreFixture, matrix: coreMatrix, todos: [], header: { ok: 3, total: 4 }, openGates: 3 });

const panel = (width: number, core: PanelModel["core"], workers = 2): PanelModel => ({
	width,
	maxLines: 10,
	phase: "implement",
	spin: "◆",
	laneSpin: "⠋",
	tick: 0,
	done: 0,
	total: 0,
	workers: Array.from({ length: workers }, (_, i) => ({ name: `implementer-000${i}`, secs: 30, role: "implementer", tool: { tool: "edit", target: "a.ts", active: true } })),
	notes: [],
	gates: [],
	channel: "demo@master/lead-1",
	core,
});
const coreRow = (rows: string[]) => rows.map(strip).find((r) => r.includes("CONTRACT"));

for (const cols of [160, 120] as const) {
	test(`panel core row equals coreGolden[${cols}] after ANSI strip`, () => {
		const rows = renderPanel(panel(cols, fixtureModel()));
		expect(coreRow(rows)?.trimEnd()).toBe(coreGolden[cols]);
		expect(rows.length).toBeLessThanOrEqual(10);
	});
}

test("the core row sits right under the phase rail and keeps every worker lane", () => {
	const rows = renderPanel(panel(160, fixtureModel(), 5)).map(strip);
	expect(rows[2]).toContain("CONTRACT");
	expect(rows.filter((r) => r.includes("implementer-")).length).toBe(5);
});

test("chips draw as filled labels in the mocha hex of their hue", () => {
	const row = renderPanel(panel(160, fixtureModel())).find((r) => r.includes("CONTRACT"))!;
	expect(row).toContain("\x1b[48;2;203;166;247m"); // violet #cba6f7 behind CONTRACT
	expect(row).toContain("\x1b[48;2;250;179;135m"); // peach #fab387 behind VERDICT
});

test("no core row without core data", () => {
	const same = renderPanel(panel(160, undefined));
	expect(coreRow(same)).toBeUndefined();
	expect(renderPanel(panel(160, null))).toEqual(same);
	expect(renderPanel(panel(160, coreModel({ ...coreFixture, findings: "", teams: [], logs: {}, reports: [], matrix: "", todos: [], header: { ok: 0, total: 0 }, openGates: 0 })))).toEqual(same);
});

test("no core row when the width is under room", () => {
	expect(coreRow(renderPanel(panel(40, fixtureModel())))).toBeUndefined();
});

const registered = () => {
	const notes: Array<{ message: string; level?: string }> = [];
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	return {
		notes,
		register: (deps: Parameters<typeof registerAtlasCoreCommand>[1]) =>
			registerAtlasCoreCommand({ registerCommand: (name: string, def: { handler: typeof handler }) => { expect(name).toBe("atlas-core"); handler = def.handler; } } as unknown as Pick<ExtensionAPI, "registerCommand">, deps),
		run: () => handler!("", { cwd: "/proj", ui: { notify: (message: string, level?: string) => notes.push({ message, level }) } }),
	};
};

test("/atlas-core prints coreReport of a fresh read", async () => {
	const h = registered();
	h.register({ source: { build: () => fixtureModel() }, openGates: async () => 3, rootOf: (c) => c });
	await h.run();
	expect(h.notes).toEqual([{ message: coreReport(fixtureModel()), level: "info" }]);
});

test("/atlas-core with nothing recorded prints the one-line empty report", async () => {
	const h = registered();
	h.register({ source: createCoreSource({ readText: () => { throw new Error("x"); }, statOf: () => { throw new Error("x"); }, listDir: () => { throw new Error("x"); }, pluginRoot: () => "/p" }), openGates: async () => 0, rootOf: (c) => c });
	await h.run();
	expect(h.notes[0]!.message).toBe(coreReport(null));
});

test("an unchanged log is read once; a grown one is read again", () => {
	const files: Record<string, string> = {
		"/r/.atlas/.run/logs/implementer-0001.log": '{"type":"result","total_cost_usd":1}\n',
		"/r/.atlas/.run/logs/atlas_mux.log": "skip me",
		"/r/.atlas/.run/board/a.jsonl": '{"kind":"report","owner":"implementer-0001","text":"STATUS: DONE","ts":5}\n',
	};
	const reads: string[] = [];
	const src = createCoreSource({
		readText: (p) => { if (!(p in files)) throw new Error("ENOENT"); reads.push(p); return files[p]!; },
		statOf: (p) => { if (!(p in files)) throw new Error("ENOENT"); return { size: files[p]!.length, mtimeMs: 1 }; },
		listDir: (d) => Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1)),
		pluginRoot: () => "/p",
	});
	const first = src.build("/r");
	src.build("/r");
	src.build("/r");
	const count = (p: string) => reads.filter((x) => x === p).length;
	expect(count("/r/.atlas/.run/logs/implementer-0001.log")).toBe(1);
	expect(count("/r/.atlas/.run/board/a.jsonl")).toBe(1);
	expect(reads.some((p) => p.endsWith("atlas_mux.log"))).toBe(false);
	expect(first.offload.workers.map((w) => w.name)).toEqual(["implementer-0001"]);
	expect(first.claims[0]?.at).toBe(5000); // board ts is epoch seconds
	files["/r/.atlas/.run/logs/implementer-0001.log"] += '{"type":"agent_end"}\n';
	src.build("/r");
	expect(count("/r/.atlas/.run/logs/implementer-0001.log")).toBe(2);
});

/** A fake run dir: text + mtime per path, with read/stat bookkeeping. */
const fakeRun = (files: Record<string, { text: string; mtimeMs: number }>) => {
	const reads: string[] = [];
	const src = createCoreSource({
		readText: (p) => { if (!(p in files)) throw new Error("ENOENT"); reads.push(p); return files[p]!.text; },
		statOf: (p) => { if (!(p in files)) throw new Error("ENOENT"); return { size: files[p]!.text.length, mtimeMs: files[p]!.mtimeMs }; },
		listDir: (d) => Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1)),
		pluginRoot: () => "/p",
	});
	return { src, count: (p: string) => reads.filter((x) => x === p).length };
};
const F = "/r/.atlas/.run/findings.json";
const LOG = "/r/.atlas/.run/logs/implementer-0001.log";

test("findings.json, todos.json and the scope matrix are read once across 3 builds", () => {
	const T = "/r/.atlas/.run/todos.json";
	const run = fakeRun({ [T]: { text: '{"items":[]}', mtimeMs: 1 }, [F]: { text: "{}", mtimeMs: 1 }, "/p/contracts/scope-matrix.json": { text: "{}", mtimeMs: 1 } });
	run.src.build("/r");
	run.src.build("/r");
	run.src.build("/r");
	expect(run.count(F)).toBe(1);
	expect(run.count(T)).toBe(1);
	expect(run.count("/p/contracts/scope-matrix.json")).toBe(1);
});

test("a same-size rewrite with a new mtime is re-read", () => {
	const files = { [F]: { text: '{"a":1}', mtimeMs: 1 } };
	const run = fakeRun(files);
	run.src.build("/r");
	files[F] = { text: '{"a":2}', mtimeMs: 2 };
	run.src.build("/r");
	expect(run.count(F)).toBe(2);
});

test("a removed log is evicted and re-read when it returns", () => {
	const files: Record<string, { text: string; mtimeMs: number }> = { [LOG]: { text: '{"type":"agent_end"}\n', mtimeMs: 1 } };
	const run = fakeRun(files);
	run.src.build("/r");
	run.src.build("/r");
	expect(run.count(LOG)).toBe(1);
	const saved = files[LOG]!;
	delete files[LOG];
	run.src.build("/r");
	files[LOG] = saved;
	run.src.build("/r");
	expect(run.count(LOG)).toBe(2);
});
