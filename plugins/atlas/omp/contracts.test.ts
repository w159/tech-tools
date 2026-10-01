import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import contract from "../contracts/native-tools.json";
import { kindOfOmpTool, loadNativeTools } from "./contracts";
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
