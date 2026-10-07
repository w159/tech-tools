import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import extension from "./index";
import { registerWorkerReport, reviseTaskInput } from "./worker-report";

// Fault rows (a broken contract is reported, not swallowed) must never land in the real ~/.atlas.
process.env.ATLAS_HOME = mkdtempSync(join(tmpdir(), "worker-report-test-home-"));

const SCHEMA = { type: "object", required: ["status"], properties: { status: { type: "string" } } };

type Handler = (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => { input?: Record<string, unknown> } | undefined;

function handlerFor(deps: Parameters<typeof registerWorkerReport>[1]): Handler {
	let handler: Handler | undefined;
	registerWorkerReport({ on: (_name: string, h: unknown) => { handler = h as Handler; } } as unknown as Pick<ExtensionAPI, "on">, deps);
	if (!handler) throw new Error("no handler registered");
	return handler;
}

test("batch: only the atlas agent item gains outputSchema and strict mode", () => {
	const input = { context: "c", tasks: [{ agent: "implementer", task: "a" }, { agent: "task", task: "b" }] };
	const revised = reviseTaskInput(input, SCHEMA);
	const tasks = revised?.tasks as Record<string, unknown>[];
	expect(tasks[0].outputSchema).toEqual(SCHEMA);
	expect(tasks[0].schemaMode).toBe("strict");
	expect(tasks[1].outputSchema).toBeUndefined();
	expect(tasks[1].schemaMode).toBeUndefined();
});

test("flat shape: an explorer dispatch gains the schema", () => {
	const revised = reviseTaskInput({ agent: "explorer", task: "x" }, SCHEMA);
	expect(revised?.outputSchema).toEqual(SCHEMA);
	expect(revised?.schemaMode).toBe("strict");
});

test("a lead-supplied object schema is merged with the report fields; schemaMode and own extras are kept", () => {
	const own = { type: "object", required: ["note"], properties: { note: { type: "string" } } };
	const revised = reviseTaskInput({ agent: "implementer", task: "x", outputSchema: own, schemaMode: "permissive" }, SCHEMA);
	const merged = revised?.outputSchema as { required: string[]; properties: Record<string, unknown> };
	expect(merged.required).toEqual(["note", "status"]);
	expect(Object.keys(merged.properties).sort()).toEqual(["note", "status"]);
	expect(revised?.schemaMode).toBe("permissive");
	expect(own.required).toEqual(["note"]); // the input is not mutated
	// A schema that already carries every report field is left alone.
	expect(reviseTaskInput({ agent: "implementer", task: "x", outputSchema: SCHEMA }, SCHEMA)).toBeUndefined();
});

test("a missing schemaMode defaults to strict and an existing one is not overwritten", () => {
	const revised = reviseTaskInput({ agent: "implementer", task: "x", schemaMode: "permissive" }, SCHEMA);
	expect(revised?.outputSchema).toEqual(SCHEMA);
	expect(revised?.schemaMode).toBe("permissive");
});

function withFaultHome<T>(run: (faultFile: string) => T): T {
	const home = mkdtempSync(join(tmpdir(), "worker-report-home-"));
	const old = process.env.ATLAS_HOME;
	process.env.ATLAS_HOME = home;
	try {
		return run(join(home, "hook-faults.jsonl"));
	} finally {
		if (old === undefined) delete process.env.ATLAS_HOME; else process.env.ATLAS_HOME = old;
		rmSync(home, { recursive: true, force: true });
	}
}

test("a corrupt or schema-less contract leaves a fault row instead of failing open silently", () => {
	withFaultHome(faultFile => {
		const dir = mkdtempSync(join(tmpdir(), "worker-report-"));
		try {
			const corrupt = join(dir, "corrupt.json");
			writeFileSync(corrupt, "{not json");
			const input = { agent: "implementer", task: "x" };
			expect(handlerFor({ env: {}, contractPath: corrupt })({ toolName: "task", input }, {})).toBeUndefined();
			const missing = join(dir, "missing.json");
			expect(handlerFor({ env: {}, contractPath: missing })({ toolName: "task", input }, {})).toBeUndefined();
			const rows = readFileSync(faultFile, "utf8").trim().split("\n").map(line => JSON.parse(line));
			expect(rows.length).toBe(2);
			expect(rows.every(row => JSON.stringify(row).includes("worker-report"))).toBe(true);
			expect(JSON.stringify(rows[0])).toContain("SchemaLoad");
			// The same broken path is reported once, not once per dispatch.
			handlerFor({ env: {}, contractPath: corrupt })({ toolName: "task", input }, {});
			expect(readFileSync(faultFile, "utf8").trim().split("\n").length).toBe(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

test("the original input is not mutated and the schema is copied", () => {
	const input = { tasks: [{ agent: "verifier", task: "x" }] };
	const snapshot = structuredClone(input);
	const revised = reviseTaskInput(input, SCHEMA);
	expect(input).toEqual(snapshot);
	expect((revised?.tasks as Record<string, unknown>[])[0].outputSchema).not.toBe(SCHEMA);
});

test("ATLAS_WORKER_SCHEMA=off returns undefined", () => {
	const handler = handlerFor({ env: { ATLAS_WORKER_SCHEMA: "off" } });
	expect(handler({ toolName: "task", input: { agent: "implementer", task: "x" } }, {})).toBeUndefined();
});

test("an unreadable contract path returns undefined", () => {
	const handler = handlerFor({ env: {}, contractPath: join(tmpdir(), "atlas-no-such-contract.json") });
	expect(handler({ toolName: "task", input: { agent: "implementer", task: "x" } }, {})).toBeUndefined();
});

test("a contract without report.jsonSchema returns undefined", () => {
	const dir = mkdtempSync(join(tmpdir(), "worker-report-"));
	try {
		const path = join(dir, "worker-protocol.json");
		writeFileSync(path, JSON.stringify({ report: {} }));
		expect(handlerFor({ env: {}, contractPath: path })({ toolName: "task", input: { agent: "implementer", task: "x" } }, {})).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("only the task tool is revised", () => {
	const handler = handlerFor({ env: {} });
	expect(handler({ toolName: "grep", input: { agent: "implementer" } }, {})).toBeUndefined();
	const out = handler({ toolName: "task", input: { agent: "implementer", task: "x" } }, {});
	expect(out?.input?.schemaMode).toBe("strict");
});

test("the default export wires the worker report handler into the tool_call chain", () => {
	const chain: Handler[] = [];
	const api = {
		on: (name: string, handler: Handler) => { if (name === "tool_call") chain.push(handler); },
		getActiveTools: () => [],
	};
	extension(api as unknown as ExtensionAPI);
	// A private dir: a bare tmpdir() cwd makes the channel code write `.atlas/` into the OS temp root,
	// where every later project-root walk from a temp dir finds it as a marker.
	const proj = mkdtempSync(join(tmpdir(), "wr-proj-"));
	try {
		const ctx = { cwd: proj, agent: { kind: "main", id: "Main" } };
		const revised = chain
			.map(handler => handler({ toolName: "task", input: { tasks: [{ agent: "implementer", task: "x" }, { agent: "task", task: "y" }] } }, ctx))
			.find(out => out?.input);
		const tasks = revised?.input?.tasks as Record<string, unknown>[];
		expect(tasks[0].schemaMode).toBe("strict");
		expect(tasks[0].outputSchema).toBeDefined();
		expect(tasks[1].outputSchema).toBeUndefined();
	} finally {
		rmSync(proj, { recursive: true, force: true });
	}
});
