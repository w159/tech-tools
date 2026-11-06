import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import { recordFault, taskItems } from "./fault-log";

describe("taskItems", () => {
	test("tasks[] entries that are plain objects are the dispatch items", () => {
		expect(taskItems({ tasks: [{ id: "a" }, { id: "b" }] })).toEqual([{ id: "a" }, { id: "b" }]);
	});
	test("non-object, null and array entries inside tasks[] are dropped", () => {
		expect(taskItems({ tasks: [{ id: "a" }, null, "x", 3, ["y"], undefined] })).toEqual([{ id: "a" }]);
	});
	test("an empty tasks[] is no work, not the top-level dispatch", () => {
		expect(taskItems({ tasks: [], assignment: "x" })).toEqual([]);
	});
	test("without tasks[] the single top-level dispatch is the one item", () => {
		const input = { assignment: "do it", agent: "task" };
		expect(taskItems(input)).toEqual([input]);
		expect(taskItems({ tasks: "nope", assignment: "x" })).toEqual([{ tasks: "nope", assignment: "x" }]);
	});
	test("anything that is not an object has no items", () => {
		for (const v of [null, undefined, "str", 7, true]) expect(taskItems(v)).toEqual([]);
	});
});

describe("recordFault", () => {
	let home: string;
	let saved: string | undefined;
	let realNow: () => number;
	const file = () => nodePath.join(home, "hook-faults.jsonl");
	const rows = () => fs.readFileSync(file(), "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
	beforeEach(() => {
		saved = process.env.ATLAS_HOME;
		home = fs.mkdtempSync(nodePath.join(os.tmpdir(), "fault-log-"));
		process.env.ATLAS_HOME = home;
		realNow = Date.now;
		Date.now = () => 1_700_000_123_456;
	});
	afterEach(() => {
		Date.now = realNow;
		if (saved === undefined) delete process.env.ATLAS_HOME;
		else process.env.ATLAS_HOME = saved;
		fs.rmSync(home, { recursive: true, force: true });
	});

	test("appends one JSON row in the shape atlas_faults.py writes", () => {
		recordFault("pre_tool", "boom", "TypeError", "/work/x");
		expect(rows()).toEqual([{ ts: 1_700_000_123.456, hook: "pre_tool", error: "boom", type: "TypeError", cwd: "/work/x" }]);
		expect(fs.readFileSync(file(), "utf8").endsWith("\n")).toBe(true);
	});
	test("rows accumulate in order", () => {
		recordFault("a", "1", "E", "/c");
		recordFault("b", "2", "E", "/c");
		expect(rows().map((r) => r.hook)).toEqual(["a", "b"]);
	});
	test("the error text is cut to 500 characters", () => {
		recordFault("h", "x".repeat(900), "E", "/c");
		expect(rows()[0].error).toBe("x".repeat(500));
		recordFault("h", "y".repeat(500), "E", "/c");
		expect(rows()[1].error).toBe("y".repeat(500));
	});
	test("an unknown cwd falls back to the process cwd", () => {
		recordFault("h", "e", "E", undefined);
		expect(rows()[0].cwd).toBe(process.cwd());
	});
	test("creates the ATLAS_HOME directory (and parents) when missing", () => {
		const nested = nodePath.join(home, "deep", "er");
		process.env.ATLAS_HOME = nested;
		recordFault("h", "e", "E", "/c");
		expect(fs.existsSync(nodePath.join(nested, "hook-faults.jsonl"))).toBe(true);
	});
	test("without ATLAS_HOME the file lives under ~/.atlas of the home directory", () => {
		// os.homedir() is not re-read from process.env.HOME inside a running bun, so run the call in a child process
		const fakeHome = fs.mkdtempSync(nodePath.join(os.tmpdir(), "fault-home-"));
		try {
			const env: Record<string, string> = { ...(process.env as Record<string, string>), HOME: fakeHome };
			delete env.ATLAS_HOME;
			const script = `import { recordFault } from ${JSON.stringify(nodePath.resolve(import.meta.dir, "fault-log.ts"))}; recordFault("h", "e", "E", "/c");`;
			const run = Bun.spawnSync([process.execPath, "-e", script], { env, cwd: fakeHome });
			expect(run.exitCode).toBe(0);
			const written = nodePath.join(fakeHome, ".atlas", "hook-faults.jsonl");
			expect(JSON.parse(fs.readFileSync(written, "utf8")).hook).toBe("h");
		} finally {
			fs.rmSync(fakeHome, { recursive: true, force: true });
		}
	});
	test("a file already past 1 MiB is left alone, one exactly at the limit still takes rows", () => {
		fs.writeFileSync(file(), "x".repeat(1 << 20));
		recordFault("h", "e", "E", "/c");
		expect(fs.statSync(file()).size).toBeGreaterThan(1 << 20);
		const big = fs.statSync(file()).size;
		recordFault("h", "again", "E", "/c");
		expect(fs.statSync(file()).size).toBe(big);
	});
	test("a flood stops growing the file: size after the cutoff stays put", () => {
		fs.writeFileSync(file(), "x".repeat((1 << 20) + 1));
		const before = fs.readFileSync(file(), "utf8");
		recordFault("h", "e", "E", "/c");
		expect(fs.readFileSync(file(), "utf8")).toBe(before);
	});
	test("never throws: an unwritable home is swallowed", () => {
		const blocker = nodePath.join(home, "afile");
		fs.writeFileSync(blocker, "");
		process.env.ATLAS_HOME = nodePath.join(blocker, "sub");
		expect(() => recordFault("h", "e", "E", "/c")).not.toThrow();
	});
});
