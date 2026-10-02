import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// --- recall gate: first non-claude-mem, non-todo main call is blocked once ---

type GateCase = { name: string; ompName?: string; input: Record<string, unknown> };
const GATE = contract.recallGateCases as { satisfy: GateCase[]; block: GateCase[]; exempt: GateCase[] };
const OMP_ROUTE = "xd://mcp__claude_mem_mcp_search_search";
const GATE_REASON = contract.recallGate
	.replace("{route}", `write JSON args to ${OMP_ROUTE}`)
	.replace("{example}", contract.recallGateExample);


test("recall gate blocks the first non-claude-mem call once, with the contract reason", () => {
	expect(GATE.block.length).toBeGreaterThan(0);
	expect(GATE_REASON).toContain(OMP_ROUTE);
	expect(GATE_REASON).not.toMatch(/\{(route|example)\}/);
	for (const c of GATE.block) {
		const h = harness();
		h.start(["base"]);
		expect(h.call(c.ompName ?? c.name, c.input)).toEqual({ block: true, reason: GATE_REASON });
		expect(h.call(c.ompName ?? c.name, c.input)).toBeUndefined(); // once
		expect(h.bash("git status")).toBeUndefined();
	}
});

test("recall gate: a claude-mem call satisfies it and nothing is blocked afterwards", () => {
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
	expect(h.bash("git commit -m x")?.additionalContext).toBe(COMMIT_NUDGE); // gate consumed, nudge still armed
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

