import { expect, test } from "bun:test";
import { explorationDenyReason } from "./contracts";

// Distinct tool identifiers: ctx_* names plus the route's own tool name. The device
// URI embeds a tool name by construction, so it is stripped before counting.
const identifiers = (text: string, routeTool?: string) => {
	const body = text.replace(/xd:\/\/[^\s)]+/g, "");
	const found = new Set(body.match(/\bctx_[a-z]+/g) ?? []);
	if (routeTool && body.includes(routeTool)) found.add(routeTool);
	return found;
};

test("exploration deny text names at most one tool identifier per route", () => {
	const cmds = [
		"cat a",
		"head -5 a",
		"grep -rn x .",
		"ls",
		"tree -L 2",
		"find . -name x",
		"fd x",
		"wc -l a",
		"cd src && cat a",
		"cat a | grep b | wc -l",
	];
	const routes = [
		{ via: "tool", name: "ctx_shell" },
		{ via: "tool", name: "ctx_search" },
		{ via: "tool", name: "ctx_execute" },
		{ via: "tool", name: "run_tool" },
		{ via: "command", command: "mcp__lean_ctx_ctx_shell" },
		{ via: "device", device: "xd://mcp__lean_ctx_ctx_shell" },
	] as const;
	for (const r of routes)
		for (const c of cmds) {
			const text = explorationDenyReason(c, r)!;
			expect(text).toBeDefined();
			expect(identifiers(text, r.via === "tool" ? r.name : undefined).size).toBeLessThanOrEqual(1);
		}
});
