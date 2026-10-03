import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import contract from "../contracts/native-tools.json";
import { explorationDenyReason, isExplorationShell, kindOfOmpTool, loadNativeTools } from "./contracts";
import { isNonDocsPath, resolveLeanReplacement } from "./index";

test("shared delegation-exemption cases (also asserted by test_completion_gate.py)", () => {
	for (const p of contract.delegationExemptCases.exempt) expect(isNonDocsPath(p)).toBe(false);
	for (const p of contract.delegationExemptCases.code) expect(isNonDocsPath(p)).toBe(true);
});

test("omp tool names map to contract kinds and modes", () => {
	const c = loadNativeTools();
	expect(kindOfOmpTool("grep", c)).toBe("search");
	expect(kindOfOmpTool("bash", c)).toBe("shell");
	expect(kindOfOmpTool("edit", c)).toBeUndefined();
	expect(c?.kinds.search.mode).toBe("deny");
	expect(c?.kinds.read.mode).toBe("nudge");
});

test("replacements resolve from the contract, servers matched across omp's - to _ sanitizing", () => {
	const active = ["write", "mcp__lean_ctx_ctx_search", "mcp__context_mode_ctx_execute"];
	expect(resolveLeanReplacement("search", active)).toEqual({ via: "device", device: "xd://mcp__lean_ctx_ctx_search" });
	expect(resolveLeanReplacement("shell", active)).toEqual({ via: "device", device: "xd://mcp__context_mode_ctx_execute" });
	expect(resolveLeanReplacement("glob", active)).toBeUndefined();
});

test("malformed or missing contract loads as undefined (consumers allow)", () => {
	const dir = mkdtempSync(join(tmpdir(), "atlas-contract-"));
	try {
		expect(loadNativeTools(join(dir, "absent.json"))).toBeUndefined();
		const bad = join(dir, "bad.json");
		writeFileSync(bad, JSON.stringify({ delegationExempt: { dirs: ["docs"], extensions: [".md"] }, kinds: { search: { omp: "grep", mode: "block", replacements: [] } } }));
		expect(loadNativeTools(bad)).toBeUndefined();
		const renamed = join(dir, "renamed.json");
		const copy = structuredClone(contract);
		copy.kinds.search.replacements[0].tool = "ctx_find";
		writeFileSync(renamed, JSON.stringify(copy));
		expect(loadNativeTools(renamed)?.kinds.search.replacements[0].tool).toBe("ctx_find");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("shared exploration-shell cases (also asserted by test_dispatch_tripwire.py)", () => {
	const c = loadNativeTools();
	expect(c?.explorationShell?.cases.deny.length).toBeGreaterThanOrEqual(12);
	expect(c?.explorationShell?.cases.allow.length).toBeGreaterThanOrEqual(12);
	for (const cmd of contract.explorationShell.cases.deny) expect([cmd, isExplorationShell(cmd, c)]).toEqual([cmd, true]);
	for (const cmd of contract.explorationShell.cases.allow) expect([cmd, isExplorationShell(cmd, c)]).toEqual([cmd, false]);
});

test("exploration verdict fails open without the contract section", () => {
	expect(isExplorationShell("cat README.md", undefined)).toBe(false);
	expect(isExplorationShell("", loadNativeTools())).toBe(false);
	expect(isExplorationShell("cd /tmp", loadNativeTools())).toBe(false);
	const dir = mkdtempSync(join(tmpdir(), "atlas-contract-"));
	try {
		const p = join(dir, "no-exploration.json");
		const copy: Record<string, unknown> = structuredClone(contract);
		delete copy.explorationShell;
		writeFileSync(p, JSON.stringify(copy));
		const loaded = loadNativeTools(p);
		expect(loaded?.kinds.shell.omp).toBe("bash"); // rest of the contract still loads
		expect(isExplorationShell("cat README.md", loaded)).toBe(false);
		const bad = join(dir, "bad-exploration.json");
		writeFileSync(bad, JSON.stringify({ ...copy, explorationShell: { commands: "cat", cases: {} } }));
		expect(isExplorationShell("cat README.md", loadNativeTools(bad))).toBe(false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("exploration deny names the ctx_* equivalent and the reachable route", () => {
	const tool = { via: "tool", name: "ctx_shell" } as const;
	const device = { via: "device", device: "xd://mcp__lean_ctx_ctx_shell" } as const;
	const pick = (cmd: string) => explorationDenyReason(cmd, tool)?.match(/ctx_(read|search|tree|glob|shell)/)?.[0];
	for (const cmd of ["cat a", "head -5 a", "tail -3 a"]) expect(pick(cmd)).toBe("ctx_read");
	for (const cmd of ["grep -rn x .", "rg x", "ag x"]) expect(pick(cmd)).toBe("ctx_search");
	for (const cmd of ["ls -la", "tree -L 2"]) expect(pick(cmd)).toBe("ctx_tree");
	for (const cmd of ["find . -name '*.ts'", "fd x"]) expect(pick(cmd)).toBe("ctx_glob");
	for (const cmd of ["wc -l a", "stat a", "file a", "less a", "sed -n 1p a", "awk '{print}' a", "cat a | grep b | wc -l"])
		expect(pick(cmd)).toBe("ctx_shell");
	expect(pick("cd src && cat a")).toBe("ctx_read"); // leading cd is transparent
	expect(explorationDenyReason("cat a", tool)).toContain("call ctx_shell directly");
	expect(explorationDenyReason("cat a", device)).toContain("xd://mcp__lean_ctx_ctx_shell");
	expect(explorationDenyReason("npm test", tool)).toBeUndefined();
});

test("toolStateDirs loads from ompToolStateDirs and defaults to [] when the key is missing", () => {
	const c = loadNativeTools();
	expect(c?.toolStateDirs).toEqual(contract.ompToolStateDirs);
	expect(c?.toolStateDirs).toContain(".serena");
	const dir = mkdtempSync(join(tmpdir(), "atlas-contract-"));
	try {
		const p = join(dir, "no-tool-state.json");
		const copy: Record<string, unknown> = structuredClone(contract);
		delete copy.ompToolStateDirs;
		writeFileSync(p, JSON.stringify(copy));
		const loaded = loadNativeTools(p);
		expect(loaded?.kinds.shell.omp).toBe("bash"); // older contract files still load
		expect(loaded?.toolStateDirs).toEqual([]);
		const bad = join(dir, "bad-tool-state.json");
		writeFileSync(bad, JSON.stringify({ ...copy, ompToolStateDirs: "nope" }));
		expect(loadNativeTools(bad)?.toolStateDirs).toEqual([]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
