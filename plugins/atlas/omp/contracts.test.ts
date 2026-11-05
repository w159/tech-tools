import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import contract from "../contracts/native-tools.json";
import { resolveTarget, explorationDenyReason, explorationTool, isExplorationShell, kindOfOmpTool, loadNativeTools } from "./contracts";
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

// Twin of test_dispatch_tripwire.ReadOnlyInvestigationTest.HARDENING_CASES (exploration column).
// A mutation hidden inside an exploration-looking command must never be exploration.
const HARDENING_CASES: [command: string, exploration: boolean][] = [
	// read-only positives that stay exploration (git is never an exploration command)
	["ls", true], ["cat a", true], ["rg x", true], ["grep -rn x .", true], ["find . -name x", true],
	["ls 2>/dev/null", true], ["cat a|head -5", true], ["grep -o x f", true], ["ls -o", true],
	["find . -O3 -name x", true], ["tree -L 2", true], ["sed -n 1p a", true], ["sed -n '1,50p' NOTES.md", true],
	["sed -n '/error/p' f", true], ["awk '{print $1}' f", true], ["awk '{print}' a", true],
	["git status", false], ["git log --oneline", false], ["cd x && git status", false],
	["git status && git diff", false], ["git status & git log", false],
	// git flags that write a file or spawn a program
	["git log --output=f", false], ["git diff --output=p", false], ["git show --output=f HEAD", false],
	["git log --output f", false], ["git grep -Ocmd x", false], ["git grep --open-files-in-pager=less x", false],
	["git diff --ext-diff", false], ["git log --textconv", false],
	// command / process substitution anywhere
	["git status $(rm x)", false], ["ls $(rm x)", false], ["cat `rm x`", false], ["cat <(rm x)", false],
	["cat a >(tee out)", false],
	// output redirection (only /dev/null and fd dups are harmless) and tee
	["ls > f", false], ["ls >> f", false], ["ls 2>err.log", false], ["ls > /dev/nullx", false],
	["git status > out.txt", false], ["git status | tee f", false], ["ls | tee f", false],
	// background separator splits like `;`
	["git status & rm z", false], ["ls & rm z", false],
	// find write / exec predicates
	["find . -delete", false], ["find . -exec rm {} ;", false], ["find . -execdir rm {} ;", false],
	["find . -fprint f", false], ["find . -fprint0 f", false], ["find . -fprintf f %p", false],
	["find . -fls f", false], ["find . -ok rm {} ;", false], ["find . -okdir rm {} ;", false],
	// per-tool escape flags
	["rg --pre cmd x", false], ["rg --pre=cmd x", false], ["tree -o f", false],
	// awk programs that run commands, write, or pipe
	["awk 'BEGIN{system(\"rm x\")}' f", false], ["awk '{print > \"o\"}' f", false],
	["awk '{print | \"sh\"}' f", false], ["awk '{\"date\" | getline d}' f", false],
	["awk -f prog.awk f", false], ["awk -i inplace '{print}' f", false],
	// sed: in-place or a w/W/e command
	["sed -i s/a/b/ f", false], ["sed -n '2w f' a", false], ["sed -n 'w f' a", false], ["sed -n 'W f' a", false],
	["sed -n '4e id' a", false], ["sed -n 's/a/b/w f' a", false], ["sed 's/a/b/' f", false],
];

test("exploration classifier fails closed on mutations hidden in read-looking commands", () => {
	const c = loadNativeTools();
	for (const [cmd, exploration] of HARDENING_CASES) expect([cmd, isExplorationShell(cmd, c)]).toEqual([cmd, exploration]);
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

test("resolveTarget expands ~ and $HOME instead of joining them onto cwd", () => {
	const home = require("node:os").homedir();
	expect(resolveTarget("/repo", "~/.omp/agent/mcp.json")).toBe(join(home, ".omp/agent/mcp.json"));
	expect(resolveTarget("/repo", "~")).toBe(home);
	expect(resolveTarget("/repo", "$HOME/x.json")).toBe(join(home, "x.json"));
	expect(resolveTarget("/repo", "${HOME}/x.json")).toBe(join(home, "x.json"));
	expect(resolveTarget("/repo", "src/a.ts")).toBe("/repo/src/a.ts");
	expect(resolveTarget("/repo", "~other/a.ts")).toBe("/repo/~other/a.ts");
});

test("sed in-place and no-space w commands are writes; plain -n scripts stay exploration", () => {
	const c = loadNativeTools();
	const cases: Array<[string, boolean]> = [
		["sed -ni s/a/b/ f", false], ["sed -n --in-place s/a/b/ f", false], ["sed -n --in-place=.bak s/a/b/ f", false],
		["sed -n --in s/a/b/ f", false], ["sed -nEi s/a/b/ f", false], ["sed -n -i.bak s/a/b/ f", false],
		["sed -n 'wout.txt' f", false], ["sed -n \"wout.txt\" f", false], ["sed -n '1p;wout.txt' f", false],
		["sed -n 's/a/b/wout.txt' f", false], ["sed -n '1,3{p;wout.txt}' f", false], ["sed -n '1p; wout.txt' f", false],
		["sed -n '/a/p' f", true], ["sed -n 1p www.txt", true], ["sed -n '/show/p' f", true],
		["sed -n 1,5p /tmp/work.txt", true],
	];
	for (const [cmd, exploration] of cases) expect([cmd, isExplorationShell(cmd, c)]).toEqual([cmd, exploration]);
});

/** Load a variant of the shared contract written to a fresh temp file (distinct path per call, so the loader cache never answers). */
function loadVariant(edit: (c: any) => unknown): ReturnType<typeof loadNativeTools> {
	const dir = mkdtempSync(join(tmpdir(), "atlas-contract-"));
	try {
		const p = join(dir, "variant.json");
		const copy = structuredClone(contract) as any;
		const out = edit(copy);
		writeFileSync(p, typeof out === "string" ? out : JSON.stringify(out === undefined ? copy : out));
		return loadNativeTools(p);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("a structurally invalid contract loads as undefined; each malformed piece is rejected on its own", () => {
	expect(loadVariant(() => "null")).toBeUndefined();
	expect(loadVariant(() => "42")).toBeUndefined();
	expect(loadVariant(() => "not json")).toBeUndefined();
	expect(loadVariant(c => { delete c.delegationExempt; })).toBeUndefined();
	expect(loadVariant(c => { delete c.kinds; })).toBeUndefined();
	expect(loadVariant(c => { c.delegationExempt = null; })).toBeUndefined();
	expect(loadVariant(c => { c.delegationExempt = "docs"; })).toBeUndefined();
	expect(loadVariant(c => { c.delegationExempt.dirs = "docs"; })).toBeUndefined();
	expect(loadVariant(c => { c.delegationExempt.dirs = [1]; })).toBeUndefined();
	expect(loadVariant(c => { delete c.delegationExempt.dirs; })).toBeUndefined();
	expect(loadVariant(c => { c.delegationExempt.extensions = ".md"; })).toBeUndefined();
	expect(loadVariant(c => { delete c.delegationExempt.extensions; })).toBeUndefined();
	expect(loadVariant(c => { c.kinds = null; })).toBeUndefined();
	expect(loadVariant(c => { c.kinds = "search"; })).toBeUndefined();
	expect(loadVariant(c => { c.kinds = []; })).toBeUndefined();
	// the untouched variant is the control: same file shape loads fine
	const ok = loadVariant(() => undefined);
	expect(ok?.exemptDirs).toEqual(contract.delegationExempt.dirs);
	expect(ok?.exemptExtensions).toEqual(contract.delegationExempt.extensions);
});

test("every kind must be present and well-formed, else the whole contract is rejected", () => {
	for (const kind of ["search", "glob", "read", "shell"] as const) {
		expect(loadVariant(c => { delete c.kinds[kind]; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind] = null; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind] = "grep"; })).toBeUndefined();
		expect(loadVariant(c => { delete c.kinds[kind].omp; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].omp = 5; })).toBeUndefined();
		expect(loadVariant(c => { delete c.kinds[kind].mode; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].mode = "block"; })).toBeUndefined();
		expect(loadVariant(c => { delete c.kinds[kind].replacements; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = {}; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = "x"; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = [null]; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = ["ctx"]; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = [{ servers: [] }]; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = [{ tool: "t" }]; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = [{ tool: 3, servers: [] }]; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = [{ tool: "t", servers: "s" }]; })).toBeUndefined();
		expect(loadVariant(c => { c.kinds[kind].replacements = [{ tool: "t", servers: [1] }]; })).toBeUndefined();
	}
	// valid edge: nudge mode and an empty replacement list are accepted as-is
	const ok = loadVariant(c => { c.kinds.read.mode = "nudge"; c.kinds.read.replacements = []; });
	expect(ok?.kinds.read.mode).toBe("nudge");
	expect(ok?.kinds.read.replacements).toEqual([]);
});

test("server names compile to patterns that match omp's sanitized tool ids", () => {
	const c = loadVariant(cc => { cc.kinds.search.replacements = [{ tool: "ctx_search", servers: ["lean-ctx", "my.server"] }]; });
	const [lean, dotted] = c!.kinds.search.replacements[0].servers;
	for (const id of ["mcp__lean-ctx__ctx_search", "mcp__lean_ctx__ctx_search", "mcp__leanctx__x", "MCP__LEAN_CTX__X"]) expect(lean.test(id)).toBe(true);
	expect(lean.test("mcp__other__ctx_search")).toBe(false);
	expect(dotted.test("my.server")).toBe(true);
	expect(dotted.test("myXserver")).toBe(false); // the dot is literal, not a wildcard
});

test("a malformed explorationShell section is dropped while the rest of the contract loads", () => {
	const dropped = (v: unknown) => {
		const c = loadVariant(cc => { cc.explorationShell = v; });
		expect(c?.kinds.shell.omp).toBe("bash");
		expect(c?.explorationShell).toBeUndefined();
		expect(isExplorationShell("cat a", c)).toBe(false);
	};
	for (const v of [null, "cat", 5, { commands: ["cat"] }, { commands: ["cat"], cases: null }, { commands: ["cat"], cases: "x" },
		{ commands: "cat", cases: { deny: [], allow: [] } }, { commands: [1], cases: { deny: [], allow: [] } },
		{ commands: ["cat"], cases: { deny: [], allow: "x" } }, { commands: ["cat"], cases: { allow: [] } },
		{ commands: ["cat"], cases: { deny: [1], allow: [] } }]) dropped(v);
	const ok = loadVariant(cc => { cc.explorationShell = { commands: ["cat"], cases: { deny: ["cat a"], allow: ["ls"] } }; });
	expect(ok?.explorationShell).toEqual({ commands: ["cat"], cases: { deny: ["cat a"], allow: ["ls"] } });
	expect(isExplorationShell("cat a", ok)).toBe(true);
	expect(isExplorationShell("ls", ok)).toBe(false); // only the contract's own command list counts
});

test("classifiers use the shared contract when none is passed, and fail open when passed undefined", () => {
	expect(isExplorationShell("cat README.md")).toBe(true);
	expect(isExplorationShell("git status")).toBe(false);
	expect(explorationTool("grep -rn x .")).toBe("ctx_search");
	expect(explorationDenyReason("ls", { via: "tool", name: "ctx_tree" })).toContain("ctx_tree");
	expect(isExplorationShell("cat README.md", undefined)).toBe(false);
	expect(explorationTool("cat README.md", undefined)).toBeUndefined();
	expect(explorationDenyReason("cat README.md", { via: "tool", name: "ctx_read" }, undefined)).toBeUndefined();
});

test("explorationTool maps a command to one ctx_* tool, and a mixed pipeline to ctx_shell", () => {
	const c = loadNativeTools();
	const table: Array<[string, string | undefined]> = [
		["cat a", "ctx_read"], ["head -n 3 a", "ctx_read"], ["tail a", "ctx_read"], ["cat a; head b", "ctx_read"],
		["grep x a", "ctx_search"], ["rg x", "ctx_search"], ["ag x", "ctx_search"],
		["ls", "ctx_tree"], ["tree", "ctx_tree"], ["ls && tree", "ctx_tree"],
		["find . -name x", "ctx_glob"], ["fd x", "ctx_glob"],
		["cat a | grep b", "ctx_shell"], ["ls; find .", "ctx_shell"], ["wc -l a", "ctx_shell"], ["sed -n 1p a", "ctx_shell"], ["awk '{print}' a", "ctx_shell"],
		["/usr/bin/cat a", "ctx_read"], ["cd src && ls", "ctx_tree"], ["cd a && cd b && cat x", "ctx_read"],
		["npm test", undefined], ["cat a > b", undefined], ["", undefined], ["cat $(x)", undefined], ["cd src", undefined],
	];
	for (const [cmd, tool] of table) expect([cmd, explorationTool(cmd, c)]).toEqual([cmd, tool]);
	expect(explorationTool("cat a", undefined)).toBeUndefined();
	expect(explorationTool(123 as unknown as string, c)).toBeUndefined();
});

test("the deny reason is a full sentence naming tool and route, and absent for non-exploration commands", () => {
	const reason = explorationDenyReason("grep x .", { via: "device", device: "xd://dev" });
	expect(reason).toBe("Atlas enforcement: this bash command only reads files, so use lean-ctx ctx_search instead (write JSON to xd://dev). Bash stays allowed for tests, git, builds and writes.");
	expect(explorationDenyReason("grep x .", { via: "tool", name: "ctx_search" })).toContain("(call ctx_search directly)");
	expect(explorationDenyReason("git status", { via: "tool", name: "ctx_search" })).toBeUndefined();
	expect(explorationDenyReason("grep x > f", { via: "tool", name: "ctx_search" })).toBeUndefined();
});

test("sed option and quoting edge cases: option terminators, long read flags and empty scripts stay reads", () => {
	const c = loadNativeTools();
	const cases: Array<[string, boolean]> = [
		["sed -n -- 1p f", true], ["sed -n --silent 1p f", true], ["sed -n --quiet 1p f", true], ["sed -n --expression=1p f", true],
		["sed -n --in-pl s/a/b/ f", false], ["sed -n --in-place s/a/b/ f", false],
		["sed -n '' www.txt", true], ["sed -n '' wout.txt", true], ["sed -n '1,3 p' wout.txt", true], ["sed -n \"1,3 p\" wout.txt", true],
		["sed -n '1,3 wout.txt' f", false], ["sed -n \"1,3 wout.txt\" f", false],
		["sed -n", true],
	];
	for (const [cmd, exploration] of cases) expect([cmd, isExplorationShell(cmd, c)]).toEqual([cmd, exploration]);
});
