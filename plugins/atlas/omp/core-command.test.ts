// /atlas-core wiring: board-root discovery, the gate count transport and the dependency overrides.
// Hermetic: gate counts come from a stubbed spawnText; no real atlas_gates.py, daemon or ~/.atlas.
import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { coreReport } from "../mod/core-row";
import { coreModel } from "../mod/data/core";
import type { CoreSource } from "./core-source";
import * as realPanel from "./mission-panel";

// gateCount spawns python3 through mission-panel's spawnText; swap just that export (everything else stays real) so the
// gate transport is observable without running atlas_gates.py. Default is the real spawner, so other test files are unaffected.
let spawnImpl: ((argv: string[]) => Promise<string>) | undefined;
// (snapshot first: the namespace object is live and points at the mock once it is installed)
const real = { ...realPanel };
mock.module("./mission-panel", () => ({ ...real, spawnText: (argv: string[]) => (spawnImpl ?? real.spawnText)(argv) }));
const { registerAtlasCoreCommand } = await import("./core-command");

let tmp: string;
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
	if (!(k in saved)) saved[k] = process.env[k];
	if (v === undefined) delete process.env[k];
	else process.env[k] = v;
};
beforeEach(() => {
	tmp = realpathSync(mkdtempSync(join(tmpdir(), "core-cmd-")));
});
afterEach(() => {
	spawnImpl = undefined;
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	rmSync(tmp, { recursive: true, force: true });
});

const run = async (cwd: string, deps: Parameters<typeof registerAtlasCoreCommand>[1]) => {
	const notes: Array<{ message: string; level?: string }> = [];
	let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
	registerAtlasCoreCommand({ registerCommand: (_n: string, def: { handler: typeof handler }) => { handler = def.handler; } } as unknown as Pick<ExtensionAPI, "registerCommand">, deps);
	await handler!("", { cwd, ui: { notify: (message: string, level?: string) => notes.push({ message, level }) } });
	return notes;
};
/** A source that records what build() was asked for. */
const spySource = () => {
	const calls: Array<{ root: string; openGates: number | undefined }> = [];
	const source: CoreSource = { build: (root, opts) => (calls.push({ root, openGates: opts?.openGates }), coreModel({ findings: "", teams: [], logs: {}, reports: [], matrix: "", todos: [], header: { ok: 0, total: 0 }, openGates: opts?.openGates ?? 0 })) };
	return { calls, source };
};
const TWO_OPEN = JSON.stringify({ groups: [{ id: "completion", title: "Gates", lines: [{ id: "a", label: "a", ok: false }, { id: "b", label: "b", ok: false }, { id: "c", label: "c", ok: true }] }] });

test("board root is the nearest ancestor holding docs/, else cwd itself", async () => {
	const proj = join(tmp, "proj");
	mkdirSync(join(proj, "docs"), { recursive: true });
	mkdirSync(join(proj, "src", "deep"), { recursive: true });
	mkdirSync(join(tmp, "bare", "x"), { recursive: true });
	const a = spySource();
	await run(join(proj, "src", "deep"), { source: a.source, openGates: async () => 0 });
	expect(a.calls[0]!.root).toBe(proj);
	await run(proj, { source: a.source, openGates: async () => 0 });
	expect(a.calls[1]!.root).toBe(proj);
	const b = spySource();
	await run(join(tmp, "bare", "x"), { source: b.source, openGates: async () => 0 });
	expect(b.calls[0]!.root).toBe(join(tmp, "bare", "x"));
	const c = spySource();
	await run("/nonexistent-core-cmd/zz", { source: c.source, openGates: async () => 0 });
	expect(c.calls[0]!.root).toBe("/nonexistent-core-cmd/zz");
});

test("default gate count: unarmed project reads 0 without spawning", async () => {
	setEnv("ATLAS_GATES", "off");
	const argvs: string[][] = [];
	spawnImpl = async (argv) => (argvs.push(argv), TWO_OPEN);
	const s = spySource();
	await run(tmp, { source: s.source, rootOf: (c) => c });
	expect(s.calls[0]!.openGates).toBe(0);
	expect(argvs).toEqual([]);
});

test("default gate count: armed project counts the open gates reported, via atlas_gates.py for that root", async () => {
	setEnv("ATLAS_GATES", "always");
	const argvs: string[][] = [];
	spawnImpl = async (argv) => (argvs.push(argv), TWO_OPEN);
	const s = spySource();
	await run(tmp, { source: s.source, rootOf: (c) => c });
	expect(s.calls[0]!.openGates).toBe(2);
	expect(argvs).toHaveLength(1);
	expect([argvs[0]![0], argvs[0]![1]!.endsWith("/atlas_gates.py"), ...argvs[0]!.slice(2)]).toEqual(["python3", true, "--session", "-", "--root", tmp, "--json"]);
});

test("default gate count: a rejected or unparseable gates run reads 0, and the report still prints at info", async () => {
	setEnv("ATLAS_GATES", "always");
	for (const impl of [async () => { throw new Error("gates exit 1"); }, async () => "not json"]) {
		spawnImpl = impl;
		const s = spySource();
		const notes = await run(tmp, { source: s.source, rootOf: (c) => c });
		expect(s.calls[0]!.openGates).toBe(0);
		expect(notes[0]!.level).toBe("info");
	}
});

test("injected openGates and rootOf are used as given (cwd is passed through)", async () => {
	const s = spySource();
	const seen: string[] = [];
	await run("/some/cwd", { source: s.source, rootOf: (c) => `${c}/root`, openGates: async (root, cwd) => (seen.push(root, cwd), 7) });
	expect(seen).toEqual(["/some/cwd/root", "/some/cwd"]);
	expect(s.calls[0]).toEqual({ root: "/some/cwd/root", openGates: 7 });
});

test("with no deps it builds a real source over <root>/.atlas/.run and reports the empty core", async () => {
	setEnv("ATLAS_GATES", "off");
	mkdirSync(join(tmp, "docs"), { recursive: true });
	const notes = await run(tmp, {});
	expect(notes).toEqual([{ message: coreReport(null), level: "info" }]);
});

test("a build failure surfaces as a warning with the error text", async () => {
	const notes = await run(tmp, { source: { build: () => { throw new Error("boom"); } }, openGates: async () => 0, rootOf: (c) => c });
	expect(notes).toEqual([{ message: "/atlas-core: boom", level: "warning" }]);
	const notes2 = await run(tmp, { source: { build: () => { throw "plain"; } }, openGates: async () => 0, rootOf: (c) => c });
	expect(notes2[0]).toEqual({ message: "/atlas-core: plain", level: "warning" });
});
