import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import extension from "./index";
import { registerWorkerReport, reviseTaskInput } from "./worker-report";

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

test("an existing outputSchema is kept and an existing schemaMode is not overwritten", () => {
	const own = { type: "object" };
	expect(reviseTaskInput({ agent: "implementer", task: "x", outputSchema: own }, SCHEMA)).toBeUndefined();
	const revised = reviseTaskInput({ agent: "implementer", task: "x", schemaMode: "permissive" }, SCHEMA);
	expect(revised?.outputSchema).toEqual(SCHEMA);
	expect(revised?.schemaMode).toBe("permissive");
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
	const ctx = { cwd: tmpdir(), agent: { kind: "main", id: "Main" } };
	const revised = chain
		.map(handler => handler({ toolName: "task", input: { tasks: [{ agent: "implementer", task: "x" }, { agent: "task", task: "y" }] } }, ctx))
		.find(out => out?.input);
	const tasks = revised?.input?.tasks as Record<string, unknown>[];
	expect(tasks[0].schemaMode).toBe("strict");
	expect(tasks[0].outputSchema).toBeDefined();
	expect(tasks[1].outputSchema).toBeUndefined();
});
