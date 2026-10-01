import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { RECALL_MARKER, claudeMemRoute, loadMandates, matchGitCommit, registerMandates } from "./mandates";
import contract from "../contracts/mandates.json";

const COMMIT_NUDGE = contract.commitNudge;

type Ctx = { agent: { kind: "main" | "sub" } };
type Result = { systemPrompt?: string[]; additionalContext?: string } | undefined;
type Handler = (event: { systemPrompt?: string[]; toolName?: string; input?: Record<string, unknown> }, ctx: Ctx) => Result;

const MEM_TOOLS = ["read", "write", "bash", "mcp__claude_mem_mcp_search_search"];
const SKILLS_PROMPT = ["base", "<skills>\n- ponytail-review: Use for over-engineering reviews\n</skills>"];

function harness(active: () => string[] | undefined = () => MEM_TOOLS, env: Record<string, string | undefined> = {}) {
	const handlers: Record<string, Handler> = {};
	const api = { on: (name: string, h: Handler) => { handlers[name] = h; } };
	registerMandates(api as unknown as Pick<ExtensionAPI, "on">, { activeTools: active, env });
	return {
		start: (systemPrompt: string[], kind: "main" | "sub" = "main") => handlers.before_agent_start({ systemPrompt }, { agent: { kind } }),
		bash: (command: string, kind: "main" | "sub" = "main") => handlers.tool_call({ toolName: "bash", input: { command } }, { agent: { kind } }),
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
	expect(h.bash("git status")).toBeUndefined();
	expect(h.bash("git commit -m wip")?.additionalContext).toBe(COMMIT_NUDGE);
	expect(h.bash("git commit --amend")).toBeUndefined();
	h.reset();
	h.start(SKILLS_PROMPT);
	expect(h.bash("git commit -m again")?.additionalContext).toBe(COMMIT_NUDGE);
});

test("ponytail nudge is unarmed without the skill, in subagents, and when killed", () => {
	const plain = harness();
	plain.start(["base"]);
	expect(plain.bash("git commit -m x")).toBeUndefined();
	const sub = harness();
	sub.start(SKILLS_PROMPT);
	expect(sub.bash("git commit -m x", "sub")).toBeUndefined();
	const killed = harness(undefined, { ATLAS_MANDATES: "off" });
	killed.start(SKILLS_PROMPT);
	expect(killed.bash("git commit -m x")).toBeUndefined();
});
