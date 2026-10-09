// Gate logic runs against recording deps; the one real end-to-end test drives
// defaultAdvisorDeps through python3 atlas_todo.py inside a /tmp project.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultAdvisorDeps, registerAdvisorGate } from "./advisor";

type Note = { note: string; severity?: string; advisor?: string };
type Ctx = { cwd: string; agent: { kind: "main" | "sub" }; sessionManager: { getSessionId(): string } };
type Handler = (event: unknown, ctx: Ctx) => unknown;
type Added = { text: string; sessionId: string; root: string };

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "atlas-advisor-"));
	mkdirSync(join(dir, "docs"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function harness(opts: { open?: string[] | Error; addError?: Error; env?: Record<string, string | undefined> } = {}) {
	const added: Added[] = [];
	const handlers: Record<string, Handler> = {};
	const deps = {
		addBoardItem(text: string, sessionId: string, root: string) {
			if (opts.addError) throw opts.addError;
			added.push({ text, sessionId, root });
		},
		openAdvisorItems(_sessionId: string, _root: string) {
			if (opts.open instanceof Error) throw opts.open;
			return opts.open ?? [];
		},
		env: opts.env ?? {},
	};
	registerAdvisorGate({ on: (name: string, h: Handler) => (handlers[name] = h) } as never, deps);
	const ctx = (kind: "main" | "sub" = "main", cwd = dir): Ctx => ({
		cwd,
		agent: { kind },
		sessionManager: { getSessionId: () => "s-1" },
	});
	const context = (notes: Note[], kind: "main" | "sub" = "main", cwd = dir) =>
		handlers.context(
			{ messages: [{ role: "user", content: "hi" }, { role: "custom", customType: "advisor", display: true, details: { notes } }] },
			ctx(kind, cwd),
		);
	const stop = (kind: "main" | "sub" = "main", cwd = dir) => handlers.session_stop({ signal: new AbortController().signal }, ctx(kind, cwd));
	return { added, context, stop };
}

test("concern and blocker notes become board items for this session; nits are ignored", async () => {
	const h = harness();
	await h.context([
		{ note: "Edit skips the red test", severity: "concern", advisor: "default" },
		{ note: "Stop and re-read the cited lines", severity: "blocker" },
		{ note: "rename this variable", severity: "nit" },
		{ note: "no severity means nit" },
	]);
	expect(h.added).toEqual([
		{ text: "advisor[concern]: Edit skips the red test", sessionId: "s-1", root: dir },
		{ text: "advisor[blocker]: Stop and re-read the cited lines", sessionId: "s-1", root: dir },
	]);
});

test("board item text keeps only the first 200 characters of the note", async () => {
	const h = harness();
	await h.context([{ note: "x".repeat(300), severity: "concern" }]);
	expect(h.added[0].text).toBe(`advisor[concern]: ${"x".repeat(200)}`);
});

test("notes are deduped by text for the session, across events and within one event", async () => {
	const h = harness();
	await h.context([
		{ note: "same text", severity: "concern" },
		{ note: "same text", severity: "blocker" },
	]);
	await h.context([{ note: "same text", severity: "concern" }, { note: "new text", severity: "concern" }]);
	expect(h.added.map(a => a.text)).toEqual(["advisor[concern]: same text", "advisor[concern]: new text"]);
});

test("each registered session keeps its own dedupe memory", async () => {
	const a = harness();
	const b = harness();
	await a.context([{ note: "same", severity: "concern" }]);
	await b.context([{ note: "same", severity: "concern" }]);
	expect(a.added).toHaveLength(1);
	expect(b.added).toHaveLength(1);
});

test("subagent sessions capture nothing and never block", async () => {
	const h = harness({ open: ["t1"] });
	await h.context([{ note: "ignored", severity: "blocker" }], "sub");
	expect(h.added).toEqual([]);
	expect(await h.stop("sub")).toBeUndefined();
});

test("no docs/ ancestor means no board: nothing captured, never blocks", async () => {
	const bare = mkdtempSync(join(tmpdir(), "atlas-advisor-bare-"));
	try {
		const h = harness({ open: ["t1"] });
		await h.context([{ note: "orphan", severity: "blocker" }], "main", bare);
		expect(h.added).toEqual([]);
		expect(await h.stop("main", bare)).toBeUndefined();
	} finally {
		rmSync(bare, { recursive: true, force: true });
	}
});

test("board root is the nearest docs/ ancestor of cwd", async () => {
	const nested = join(dir, "src", "deep");
	mkdirSync(nested, { recursive: true });
	const h = harness();
	await h.context([{ note: "from a subdir", severity: "concern" }], "main", nested);
	expect(h.added[0].root).toBe(dir);
});

test("session_stop blocks listing every open id and the close command; clean board allows", async () => {
	const h = harness({ open: ["t1a2b3c4d", "t5e6f7a8b"] });
	const result = (await h.stop()) as { decision: string; reason: string };
	expect(result.decision).toBe("block");
	expect(result.reason).toContain("t1a2b3c4d");
	expect(result.reason).toContain("t5e6f7a8b");
	expect(result.reason).toContain("atlas_todo.py complete --id <id> --evidence");

	expect(await harness({ open: [] }).stop()).toBeUndefined();
});

test("session_stop blocks at most 3 times per session, then allows", async () => {
	const h = harness({ open: ["t1"] });
	const decisions = [await h.stop(), await h.stop(), await h.stop(), await h.stop(), await h.stop()];
	expect(decisions.map(d => (d as { decision?: string } | undefined)?.decision)).toEqual([
		"block",
		"block",
		"block",
		undefined,
		undefined,
	]);
});

test("a clean stop does not spend the block budget", async () => {
	const open: string[] = [];
	const h = harness({ open });
	await h.stop();
	await h.stop();
	open.push("t1");
	const decisions = [await h.stop(), await h.stop(), await h.stop(), await h.stop()];
	expect(decisions.map(d => (d as { decision?: string } | undefined)?.decision)).toEqual(["block", "block", "block", undefined]);
});

test("ATLAS_ADVISOR_GATE=off disables capture and blocking", async () => {
	const h = harness({ open: ["t1"], env: { ATLAS_ADVISOR_GATE: "off" } });
	await h.context([{ note: "muted", severity: "blocker" }]);
	expect(h.added).toEqual([]);
	expect(await h.stop()).toBeUndefined();
});

test("fails open when a dependency throws", async () => {
	const add = harness({ addError: new Error("python3 missing") });
	expect(await add.context([{ note: "boom", severity: "concern" }])).toBeUndefined();

	const open = harness({ open: new Error("board unreadable") });
	expect(await open.stop()).toBeUndefined();
});

test("malformed messages and notes are skipped without throwing", async () => {
	const h = harness();
	const result = await h.context([null as never, { note: 42 as never, severity: "concern" }, { severity: "blocker" } as never]);
	expect(result).toBeUndefined();
	expect(h.added).toEqual([]);
});

test("defaultAdvisorDeps adds a real board item and lists it open for the session (python3 atlas_todo.py)", () => {
	const deps = defaultAdvisorDeps();
	deps.addBoardItem("advisor[concern]: e2e probe item", "e2e-session", dir);
	deps.addBoardItem("advisor[blocker]: other session item", "other-session", dir);

	const boardFile = join(dir, ".atlas", ".run", "todos.json");
	expect(existsSync(boardFile)).toBe(true);
	const board = JSON.parse(readFileSync(boardFile, "utf8")) as { items: { id: string; content: string; session_id: string }[] };
	const mine = board.items.find(item => item.content === "advisor[concern]: e2e probe item");
	expect(mine?.session_id).toBe("e2e-session");
	expect(mine?.id).toMatch(/^t[0-9a-f]{8}$/);

	expect(deps.openAdvisorItems("e2e-session", dir)).toEqual([mine?.id]);
	expect(deps.openAdvisorItems("nobody", dir)).toEqual([]);
});

test("defaultAdvisorDeps.addBoardItem passes --unique to atlas_todo.py add (real argv)", () => {
	const realPython = Bun.which("python3");
	expect(realPython).toBeTruthy();
	const shimDir = mkdtempSync(join(tmpdir(), "atlas-advisor-shim-"));
	const argvLog = join(shimDir, "argv.log");
	writeFileSync(join(shimDir, "python3"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${argvLog}'\nexec '${realPython}' "$@"\n`, { mode: 0o755 });
	const prevPath = process.env.PATH;
	process.env.PATH = `${shimDir}:${prevPath ?? ""}`;
	try {
		defaultAdvisorDeps().addBoardItem("advisor[concern]: argv probe", "argv-session", dir);
	} finally {
		process.env.PATH = prevPath;
		const logged = existsSync(argvLog) ? readFileSync(argvLog, "utf8") : "";
		rmSync(shimDir, { recursive: true, force: true });
		expect(logged).toContain("atlas_todo.py add --unique advisor[concern]: argv probe --session argv-session --root");
	}
});

test("replaying the same advisor note through real atlas_todo.py add --unique keeps one item, even after it is completed", () => {
	const deps = defaultAdvisorDeps();
	const text = "advisor[blocker]: replayed after restart";
	deps.addBoardItem(text, "replay-session", dir);
	deps.addBoardItem(text, "replay-session", dir);

	const boardFile = join(dir, ".atlas", ".run", "todos.json");
	const read = () => JSON.parse(readFileSync(boardFile, "utf8")) as { items: { id: string; content: string; status: string; session_id: string }[] };
	const matching = () => read().items.filter(item => item.content === text && item.session_id === "replay-session");
	expect(matching()).toHaveLength(1);
	expect(deps.openAdvisorItems("replay-session", dir)).toEqual([matching()[0].id]);

	const todo = join(import.meta.dir, "..", "scripts", "atlas_todo.py");
	const done = Bun.spawnSync(["python3", todo, "complete", "--id", matching()[0].id, "--evidence", "fixed", "--root", dir]);
	expect(done.exitCode).toBe(0);

	deps.addBoardItem(text, "replay-session", dir); // a restart replays the closed note again
	expect(matching()).toHaveLength(1);
	expect(matching()[0].status).toBe("completed");
	expect(deps.openAdvisorItems("replay-session", dir)).toEqual([]);
});
