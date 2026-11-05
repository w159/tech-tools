// createCoreSource: report ts fallback, unreadable-file tolerance, session-scoped todos and the build defaults.
import { expect, test } from "bun:test";
import { createCoreSource } from "./core-source";

const RUN = "/r/.atlas/.run";
type Files = Record<string, string>;
const fake = (files: Files, over: { readFails?: Set<string> } = {}) =>
	createCoreSource({
		readText: (p) => { if (!(p in files) || over.readFails?.has(p)) throw new Error("ENOENT"); return files[p]!; },
		statOf: (p) => { if (!(p in files)) throw new Error("ENOENT"); return { size: files[p]!.length, mtimeMs: 1 }; },
		listDir: (d) => Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1)),
		pluginRoot: () => "/p",
	});
const todo = (id: string, extra: object = {}) => ({ id, content: id, status: "completed", ...extra });
const todosFile = (items: object[]) => ({ [`${RUN}/todos.json`]: JSON.stringify({ items }) });

test("a report without a numeric ts is stamped at 0; a numeric ts is epoch seconds; non-report and malformed lines are skipped", () => {
	const lines = [
		'{"kind":"report","owner":"implementer-0001","text":"STATUS: DONE"}',
		'{"kind":"report","owner":"implementer-0002","text":"STATUS: DONE","ts":"7"}',
		'{"kind":"report","owner":"implementer-0003","text":"STATUS: DONE","ts":2}',
		'{"kind":"note","owner":"implementer-0004","text":"STATUS: DONE","ts":9}',
		'{"kind":"report","owner":4,"text":"STATUS: DONE","ts":9}',
		"not json",
	].join("\n");
	const model = fake({ [`${RUN}/board/a.jsonl`]: lines }).build("/r");
	const at = Object.fromEntries(model.claims.map((c) => [c.owner, c.at]));
	expect(at).toEqual({ "implementer-0001": 0, "implementer-0002": 0, "implementer-0003": 2000 });
});

test("a file whose stat works but whose read throws reads as empty text, and the build still succeeds", () => {
	const log = `${RUN}/logs/implementer-0001.log`;
	const files = { [log]: '{"type":"agent_end"}\n', [`${RUN}/findings.json`]: '{"x":1}', ...todosFile([todo("a")]) };
	const broken = fake(files, { readFails: new Set([log, `${RUN}/findings.json`, `${RUN}/todos.json`]) }).build("/r");
	const none = fake({}).build("/r");
	// the log still names a worker (listed), but with no text it matches a build over nothing recorded for the rest
	expect(broken.verdicts).toEqual(none.verdicts);
	expect(broken.contract.evidence).toEqual({ ok: 0, total: 0 });
	expect(broken.offload.workers.map((w) => w.name)).toEqual(["implementer-0001"]);
	expect(broken.offload.workers[0]).toEqual(fake({ [log]: "" }).build("/r").offload.workers[0]!);
});

test("a path whose stat fails is never read", () => {
	const reads: string[] = [];
	const src = createCoreSource({
		readText: (p) => { reads.push(p); return ""; },
		statOf: () => { throw new Error("ENOENT"); },
		listDir: () => ["a.json"],
		pluginRoot: () => "/p",
	});
	expect(() => src.build("/r")).not.toThrow();
	expect(reads).toEqual([]);
});

test("todos: archived, advisor-origin and other-session rows are dropped; the rest count (no session id keeps every live row)", () => {
	const items = [
		todo("keep-mine", { session_id: "S1" }),
		todo("keep-manual", { session_id: "S1", origin: "manual" }),
		todo("archived", { session_id: "S1", archived: true }),
		todo("advisor", { session_id: "S1", origin: "advisor" }),
		todo("other", { session_id: "S2" }),
		{ ...todo("open", { session_id: "S1" }), status: "pending" },
	];
	const files = todosFile(items);
	expect(fake(files).build("/r", { sessionId: "S1" }).contract.evidence.total).toBe(2);
	expect(fake(files).build("/r", { sessionId: "S2" }).contract.evidence.total).toBe(1);
	expect(fake(files).build("/r", { sessionId: "none" }).contract.evidence.total).toBe(0);
	// no session scoping: both sessions' non-archived, non-advisor completed rows
	expect(fake(files).build("/r").contract.evidence.total).toBe(3);
	expect(fake(files).build("/r", { sessionId: "" }).contract.evidence.total).toBe(3);
});

test("todos: a missing items array or malformed todos.json reads as no todos", () => {
	expect(fake({ [`${RUN}/todos.json`]: "{}" }).build("/r").contract.evidence.total).toBe(0);
	expect(fake({ [`${RUN}/todos.json`]: "][" }).build("/r").contract.evidence.total).toBe(0);
});

test("build passes header and openGates through, defaulting to a 0/0 tally and 0 gates", () => {
	const src = fake({});
	expect(src.build("/r").contract).toMatchObject({ header: { ok: 0, total: 0 }, openGates: 0 });
	expect(src.build("/r", { header: { ok: 3, total: 4 }, openGates: 5 }).contract).toMatchObject({ header: { ok: 3, total: 4 }, openGates: 5 });
	expect(src.build("/r", { openGates: 0 }).contract.openGates).toBe(0);
});

test("a trailing slash on the root does not change where .atlas/.run is read", () => {
	const files = todosFile([todo("a")]);
	expect(fake(files).build("/r///").contract.evidence.total).toBe(1);
});

test("a file that is listed but vanishes before its stat (race) reads as empty text instead of failing the build", () => {
	const listed = ["board/a.jsonl", "logs/implementer-0001.log", "teams/t.json"];
	const src = createCoreSource({
		readText: () => { throw new Error("ENOENT"); },
		statOf: () => { throw new Error("ENOENT"); },
		listDir: (d) => listed.filter((p) => p.startsWith(`${d.split("/").pop()}/`)).map((p) => p.split("/")[1]!),
		pluginRoot: () => "/p",
	});
	const model = src.build("/r");
	expect(model.claims).toEqual([]);
	expect(model.offload.workers.map((w) => w.name)).toEqual(["implementer-0001"]);
	expect(model.offload.workers[0]).toEqual(fake({ [`${RUN}/logs/implementer-0001.log`]: "" }).build("/r").offload.workers[0]!);
});
