import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { RECALL_MARKER, claudeMemRoute, loadMandates, matchGitCommit, registerMandates } from "./mandates";
import contract from "../contracts/mandates.json";

const COMMIT_NUDGE = contract.commitNudge;

type Ctx = { agent: { kind: "main" | "sub" } };
type Result = { systemPrompt?: string[]; additionalContext?: string; block?: boolean; reason?: string } | undefined;
type Handler = (event: { systemPrompt?: string[]; toolName?: string; input?: Record<string, unknown> }, ctx: Ctx) => Result;

const MEM_TOOLS = ["read", "write", "bash", "mcp__claude_mem_mcp_search_search"];
const SKILLS_PROMPT = ["base", "<skills>\n- ponytail-review: Use for over-engineering reviews\n</skills>"];

interface Harness {
	start(systemPrompt: string[], kind?: "main" | "sub"): Result;
	bash(command: string, kind?: "main" | "sub"): Result;
	call(toolName: string, input: Record<string, unknown>, kind?: "main" | "sub"): Result;
	reset(): Result;
}

function harness(active: () => string[] | undefined = () => MEM_TOOLS, env: Record<string, string | undefined> = {}): Harness {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerMandates(api as unknown as Pick<ExtensionAPI, "on">, { activeTools: active, env });
	return {
		start: (systemPrompt: string[], kind: "main" | "sub" = "main") => handlers.before_agent_start({ systemPrompt }, { agent: { kind } }),
		bash: (command: string, kind: "main" | "sub" = "main") => handlers.tool_call({ toolName: "bash", input: { command } }, { agent: { kind } }),
		call: (toolName: string, input: Record<string, unknown>, kind: "main" | "sub" = "main") => handlers.tool_call({ toolName, input }, { agent: { kind } }),
		reset: () => handlers.session_start({}, { agent: { kind: "main" } }),
	};
}

test("git commit parse contract: shared cases from contracts/mandates.json", () => {
	for (const cmd of contract.gitCommitCases.match) expect(matchGitCommit(cmd)).toBe(true);
	for (const cmd of contract.gitCommitCases.noMatch) expect(matchGitCommit(cmd)).toBe(false);
});

test("unreadable contract fails open", () => {
	expect(loadMandates("/nonexistent/mandates.json")).toBeUndefined();
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerMandates(api as unknown as Pick<ExtensionAPI, "on">, { activeTools: () => MEM_TOOLS, env: {}, mandatesPath: "/nonexistent" });
	expect(handlers.before_agent_start({ systemPrompt: SKILLS_PROMPT }, { agent: { kind: "main" } })).toBeUndefined();
	expect(handlers.tool_call({ toolName: "bash", input: { command: "git commit" } }, { agent: { kind: "main" } })).toBeUndefined();
});

test("recall line is appended once, naming the reachable claude-mem route", () => {
	const h = harness();
	const result = h.start(["base"]);
	const line = result?.systemPrompt?.[1] ?? "";
	expect(line).toContain(RECALL_MARKER);
	expect(line).toContain("xd://mcp__claude_mem_mcp_search_search");
	expect(h.start(result?.systemPrompt ?? [])).toBeUndefined();
});

test("the recall line is frozen once rendered: a different route later does not change the prompt bytes", () => {
	let tools: string[] | undefined = MEM_TOOLS;
	const h = harness(() => tools);
	const first = h.start(["base"])?.systemPrompt ?? [];
	tools = ["read", "write", "mcp__plugin_claude_mem_mcp_search_search"]; // another claude-mem route mounts later
	const second = h.start(["base"])?.systemPrompt ?? [];
	expect(first.length).toBe(2);
	expect(second).toEqual(first); // same bytes: the cached prefix survives the next agent loop
});

test("an absent recall line is never frozen: it appears as soon as claude-mem becomes callable", () => {
	let tools: string[] | undefined = ["read", "bash"];
	const h = harness(() => tools);
	expect(h.start(["base"])).toBeUndefined();
	tools = MEM_TOOLS;
	expect(h.start(["base"])?.systemPrompt?.length).toBe(2);
});

test("session_start drops the frozen recall line", () => {
	let tools: string[] | undefined = MEM_TOOLS;
	const h = harness(() => tools);
	const first = h.start(["base"])?.systemPrompt?.[1];
	tools = ["read", "write", "mcp__plugin_claude_mem_mcp_search_search"];
	h.reset();
	const after = h.start(["base"])?.systemPrompt?.[1];
	expect(after).toBeDefined();
	expect(after).not.toBe(first);
});

test("recall stays silent when claude-mem is not callable, in subagents, or when killed", () => {
	expect(claudeMemRoute(["read", "write", "mcp__lean_ctx_ctx_search"])).toBeUndefined();
	expect(claudeMemRoute(["read", "mcp__claude_mem_mcp_search_search"])).toBeUndefined(); // no write: device unreachable
	expect(harness(() => ["read", "write"]).start(["base"])).toBeUndefined();
	expect(harness(() => undefined).start(["base"])).toBeUndefined();
	expect(harness(() => { throw new Error("boom"); }).start(["base"])).toBeUndefined();
	expect(harness().start(["base"], "sub")).toBeUndefined();
	expect(harness(undefined, { ATLAS_MANDATES: "off" }).start(["base"])).toBeUndefined();
	expect(harness(undefined, { ATLAS_MANDATES: "Off" }).start(["base"])).toBeDefined(); // exact "off", as in Python
});

test("ponytail commit nudge fires once per session when the skill is listed", () => {
	const h = harness();
	h.start(SKILLS_PROMPT);
	h.call("mcp__claude_mem_mcp_search_search", {}); // the recall gate is not under test here
	expect(h.bash("git status")).toBeUndefined();
	expect(h.bash("git commit -m wip")?.additionalContext).toBe(COMMIT_NUDGE);
	expect(h.bash("git commit --amend")).toBeUndefined();
	h.reset();
	h.start(SKILLS_PROMPT);
	h.call("mcp__claude_mem_mcp_search_search", {});
	expect(h.bash("git commit -m again")?.additionalContext).toBe(COMMIT_NUDGE);
});

test("ponytail nudge is unarmed without the skill, in subagents, and when killed", () => {
	const plain = harness();
	plain.start(["base"]);
	plain.call("mcp__claude_mem_mcp_search_search", {}); // the recall gate is not under test here
	expect(plain.bash("git commit -m x")).toBeUndefined();
	const sub = harness();
	sub.start(SKILLS_PROMPT);
	expect(sub.bash("git commit -m x", "sub")).toBeUndefined();
	const killed = harness(undefined, { ATLAS_MANDATES: "off" });
	killed.start(SKILLS_PROMPT);
	expect(killed.bash("git commit -m x")).toBeUndefined();
});

// --- recall gate: every non-claude-mem, non-todo main call is blocked until a real claude-mem call ---

type GateCase = { name: string; ompName?: string; input: Record<string, unknown> };
const GATE = contract.recallGateCases as { satisfy: GateCase[]; block: GateCase[]; exempt: GateCase[] };
const OMP_ROUTE = "xd://mcp__claude_mem_mcp_search_search";
const GATE_REASON = contract.recallGate
	.replace("{route}", `write JSON args to ${OMP_ROUTE}`)
	.replace("{example}", contract.recallGateExample);


test("recall gate blocks every non-claude-mem call until a real recall, with the contract reason", () => {
	expect(GATE.block.length).toBeGreaterThan(0);
	expect(GATE_REASON).toContain(OMP_ROUTE);
	expect(GATE_REASON).not.toMatch(/\{(route|example)\}/);
	for (const c of GATE.block) {
		const h = harness();
		h.start(["base"]);
		expect(h.call(c.ompName ?? c.name, c.input)).toEqual({ block: true, reason: GATE_REASON });
		// ignoring the denial does not satisfy the gate: the next call is denied again
		expect(h.call(c.ompName ?? c.name, c.input)).toEqual({ block: true, reason: GATE_REASON });
		expect(h.bash("git status")).toEqual({ block: true, reason: GATE_REASON });
	}
});

test("recall gate: only a real claude-mem call satisfies it, then nothing is blocked", () => {
	const h = harness();
	h.start(["base"]);
	expect(h.bash("git status")?.block).toBe(true);
	expect(h.bash("git status")?.block).toBe(true);
	expect(h.call("mcp__claude_mem_mcp_search_search", { query: "x" })).toBeUndefined();
	expect(h.bash("git status")).toBeUndefined();
	expect(h.call("edit", { path: "a.ts" })).toBeUndefined();
});

test("recall gate: each shared satisfy case unblocks the session", () => {
	expect(GATE.satisfy.length).toBeGreaterThan(0);
	for (const c of GATE.satisfy) {
		const h = harness();
		h.start(["base"]);
		expect(h.call(c.ompName ?? c.name, c.input)).toBeUndefined();
		expect(h.bash("git status")).toBeUndefined();
	}
});

test("recall gate: todo is exempt and leaves the gate armed", () => {
	expect(GATE.exempt.length).toBeGreaterThan(0);
	for (const c of GATE.exempt) {
		const h = harness();
		h.start(["base"]);
		expect(h.call(c.ompName ?? c.name, c.input)).toBeUndefined();
		expect(h.call(c.ompName ?? c.name, c.input)).toBeUndefined();
		expect(h.bash("git status")).toEqual({ block: true, reason: GATE_REASON });
	}
});

test("recall gate re-arms on session_start and wins over the commit nudge on a first git commit", () => {
	const h = harness();
	h.start(SKILLS_PROMPT);
	expect(h.bash("git commit -m x")).toEqual({ block: true, reason: GATE_REASON });
	expect(h.bash("git commit -m x")).toEqual({ block: true, reason: GATE_REASON }); // still denied: nothing satisfied it
	h.call("mcp__claude_mem_mcp_search_search", { query: "x" });
	expect(h.bash("git commit -m x")?.additionalContext).toBe(COMMIT_NUDGE); // satisfied, nudge still armed
	h.reset();
	h.start(SKILLS_PROMPT);
	expect(h.bash("git status")?.block).toBe(true);
});

test("recall gate is unarmed without a reachable route, in subagents, when killed, and on internal errors", () => {
	const cases: Array<[string, Harness, "main" | "sub"]> = [
		["no claude-mem tool", harness(() => ["read", "write", "bash"]), "main"],
		["device without write", harness(() => ["read", "mcp__claude_mem_mcp_search_search"]), "main"],
		["activeTools undefined", harness(() => undefined), "main"],
		["activeTools throws", harness(() => { throw new Error("boom"); }), "main"],
		["subagent", harness(), "sub"],
		["kill switch", harness(undefined, { ATLAS_MANDATES: "off" }), "main"],
	];
	for (const [label, h, kind] of cases) {
		h.start(["base"]);
		expect(h.bash("git status", kind), label).toBeUndefined();
	}
	expect(harness(undefined, { ATLAS_MANDATES: "Off" }).bash("git status")?.block).toBe(true); // exact "off", as in Python
});

test("recall gate fails open on a contract without the recallGate fields", () => {
	const dir = mkdtempSync(join(tmpdir(), "atlas-mandates-"));
	try {
		const path = join(dir, "mandates.json");
		writeFileSync(path, JSON.stringify({ commitNudge: "n", recall: "r" }));
		expect(loadMandates(path)).toBeUndefined();
		const handlers: Record<string, Handler> = {};
		const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
		registerMandates(api as unknown as Pick<ExtensionAPI, "on">, { activeTools: () => MEM_TOOLS, env: {}, mandatesPath: path });
		expect(handlers.tool_call({ toolName: "bash", input: { command: "ls" } }, { agent: { kind: "main" } })).toBeUndefined();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});


// --- recall gate persistence: a resumed session id stays satisfied; a new id must recall ---

const PY_SANITIZE = (id: string) => id.replace(/[^A-Za-z0-9_.-]/g, "_"); // hooks/recall_gate.py `_marker`

function persistentHarness(gateMarkerDir: string) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerMandates(api as unknown as Pick<ExtensionAPI, "on">, { activeTools: () => MEM_TOOLS, env: {}, gateMarkerDir });
	const ctx = (sessionId?: string) => ({ agent: { kind: "main" as const }, ...(sessionId === undefined ? {} : { sessionManager: { getSessionId: () => sessionId } }) });
	return {
		call: (toolName: string, input: Record<string, unknown>, sessionId?: string) => handlers.tool_call({ toolName, input }, ctx(sessionId)),
		resume: (event: "session_start" | "session_switch", sessionId?: string) => handlers[event]({}, ctx(sessionId)),
	};
}

function withMarkerDir(run: (dir: string) => void): void {
	const dir = mkdtempSync(join(tmpdir(), "atlas-recall-marker-"));
	try {
		run(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("recall gate persistence: same session id stays satisfied across session_start and session_switch", () => {
	for (const event of ["session_start", "session_switch"] as const) {
		withMarkerDir(dir => {
			const h = persistentHarness(dir);
			expect(h.call("read", { path: "a.ts" }, "sess-A")?.block).toBe(true);
			expect(h.call("mcp__claude_mem_mcp_search_search", { query: "x" }, "sess-A")).toBeUndefined();
			h.resume(event, "sess-A"); // resume: in-memory flag resets, the marker for the same id remains
			expect(h.call("read", { path: "a.ts" }, "sess-A")).toBeUndefined();
			expect(h.call("bash", { command: "ls" }, "sess-A")).toBeUndefined();
		});
	}
});

test("recall gate persistence: a different session id has no marker and is still blocked", () => {
	for (const event of ["session_start", "session_switch"] as const) {
		withMarkerDir(dir => {
			const h = persistentHarness(dir);
			h.call("mcp__claude_mem_mcp_search_search", { query: "x" }, "sess-A");
			h.resume(event, "sess-B");
			expect(h.call("read", { path: "a.ts" }, "sess-B")).toEqual({ block: true, reason: GATE_REASON });
			h.call("mcp__claude_mem_mcp_search_search", { query: "y" }, "sess-B"); // B recalls on its own
			h.resume(event, "sess-B");
			expect(h.call("read", { path: "a.ts" }, "sess-B")).toBeUndefined();
		});
	}
});

test("recall gate persistence: without a session id nothing is persisted and the gate behaves as before", () => {
	withMarkerDir(dir => {
		const h = persistentHarness(dir);
		expect(h.call("read", { path: "a.ts" })).toEqual({ block: true, reason: GATE_REASON });
		expect(h.call("mcp__claude_mem_mcp_search_search", { query: "x" })).toBeUndefined();
		expect(h.call("read", { path: "a.ts" })).toBeUndefined(); // in-memory satisfaction still works
		expect(readdirSync(dir)).toEqual([]); // no id, no marker
		h.resume("session_start");
		expect(h.call("read", { path: "a.ts" })).toEqual({ block: true, reason: GATE_REASON }); // reset re-arms
		expect(h.call("read", { path: "a.ts" }, "   ")).toEqual({ block: true, reason: GATE_REASON }); // blank id is no id
	});
});

test("recall gate persistence: honors a marker written by hand with the Python filename scheme", () => {
	withMarkerDir(dir => {
		const id = "sess/ID with:odd chars-1.2_3";
		writeFileSync(join(dir, `recall-${PY_SANITIZE(id)}`), "");
		expect(PY_SANITIZE(id)).toBe("sess_ID_with_odd_chars-1.2_3");
		const h = persistentHarness(dir);
		expect(h.call("read", { path: "a.ts" }, id)).toBeUndefined(); // satisfied by the Python-side marker
		// a fresh process (own in-memory flag) for a different id: no marker, so denied
		expect(persistentHarness(dir).call("read", { path: "a.ts" }, "sess/ID with:odd chars-1.2_4")).toEqual({ block: true, reason: GATE_REASON });
	});
});

test("recall gate persistence: the recall writes the marker the Python twin reads, and re-recalling is idempotent", () => {
	withMarkerDir(dir => {
		const id = "sess/ID:1";
		const h = persistentHarness(dir);
		h.call("mcp__claude_mem_mcp_search_search", { query: "x" }, id);
		h.resume("session_start", id);
		h.call("mcp__claude_mem_mcp_search_search", { query: "x" }, id); // EEXIST is ignored
		expect(readdirSync(dir)).toEqual([`recall-${PY_SANITIZE(id)}`]);
	});
});

test("recall gate persistence: an unusable marker dir fails open to the in-memory gate", () => {
	withMarkerDir(dir => {
		const blocker = join(dir, "file");
		writeFileSync(blocker, "");
		const h = persistentHarness(join(blocker, "sub")); // mkdir under a regular file throws
		expect(h.call("read", { path: "a.ts" }, "sess-A")?.block).toBe(true);
		expect(h.call("mcp__claude_mem_mcp_search_search", { query: "x" }, "sess-A")).toBeUndefined();
		expect(h.call("read", { path: "a.ts" }, "sess-A")).toBeUndefined();
		h.resume("session_start", "sess-A");
		expect(h.call("read", { path: "a.ts" }, "sess-A")?.block).toBe(true); // nothing persisted
	});
});
