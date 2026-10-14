import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { laneTool, registerLaneToolRecorder } from "./channel-view";
import { shellTarget, unwrapShell } from "./cmd-unwrap";

// Same literal cases as UnwrapTests in plugins/atlas/scripts/test_atlas_panefeed.py: both sides must unwrap identically.
const LIVE_CMD =
	"S=/Users/jerry/MEGA/Projects/Agentic/osprey/assets/plugins/cache/tech-tools/atlas/12.2.0/scripts/atlas_todo.py; " +
	'A="--root /Users/jerry/MEGA/Projects/Agentic/tech-tools --channel tech-tools@main/lead-a47cc5 --owner explorer-9eb2"; ' +
	"python3 $S note $A --to lead-a47cc5 'start: sleep x2 then peer-sync'; sleep 5; sleep 5; " +
	"python3 $S note $A --to explorer-4fdc peer-sync";
const LOOP_CMD = 'S=/x/scripts/atlas_todo.py\nfor p in a b; do python3 "$S" note --root /r --to $p \'hi there\' 2>&1 | head -3; done';
const CASES: [string, string, [string, string][]][] = [
	[LIVE_CMD, "python3 atlas_todo.py note --to lead-a47cc5", [["lead-a47cc5", "start: sleep x2 then peer-sync"], ["explorer-4fdc", "peer-sync"]]],
	["/opt/homebrew/bin/lean-ctx -c 'S=/a/b; cd /tmp/x && git status --short'", "git status --short", []],
	["cd /tmp/x", "cd x", []],
	["cd /tmp && python3 /a/atlas_todo.py note --to b hi", "python3 atlas_todo.py note --to b", [["b", "hi"]]],
	["/opt/homebrew/bin/lean-ctx -c 'sleep 3'", "sleep 3", []],
	[LOOP_CMD, "python3 atlas_todo.py note --to a,b", [["a", "hi there"], ["b", "hi there"]]],
	["python3 /x/atlas_todo.py note --help", "python3 atlas_todo.py note --help", []],
];

test("unwrapShell matches atlas_panefeed.unwrap_shell on the shared fixtures", () => {
	for (const [cmd, first, notes] of CASES) expect(unwrapShell(cmd)).toEqual([first, notes]);
});

test("a lane shows a peer note as its peers and drops shell noise", () => {
	expect(shellTarget(LIVE_CMD)).toBe("note → lead-a47cc5,explorer-4fdc");
	expect(shellTarget("/opt/homebrew/bin/lean-ctx -c 'S=/a/b; cd /tmp/x && git status --short'")).toBe("git status --short");
	expect(shellTarget("echo 'unterminated")).toBe("echo 'unterminated");
	expect(shellTarget('grep "a \\"b\\" c" /x/y/f.py')).toBe(`grep 'a "b" c' f.py`);
});

test("recorded omp bash lane target is unwrapped, not `S=/Users/...` or `/opt/homebrew/bin/lean-ctx -c`", () => {
	const root = mkdtempSync(join(tmpdir(), "cmd-unwrap-"));
	mkdirSync(join(root, ".atlas", ".run"), { recursive: true });
	type H = (e: unknown, c: unknown) => unknown;
	const on: Record<string, H> = {};
	registerLaneToolRecorder({ on: (ev: string, h: H) => void (on[ev] = h) } as never, { ATLAS_WORKER_NAME: "audit-1" });
	const ctx = { cwd: root, agent: { kind: "main", id: "Main", name: "main" } };
	on.tool_call?.({ toolName: "bash", toolCallId: "c1", input: { command: "/opt/homebrew/bin/lean-ctx -c 'S=/Users/jerry/x; cd /Users/jerry/repo && bun test plugins/atlas/omp'" } }, ctx);
	expect(laneTool(root, "audit-1")).toEqual({ tool: "bash", target: "bun test plugins/atlas/omp", active: true });
	on.tool_call?.({ toolName: "bash", toolCallId: "c2", input: { command: LIVE_CMD } }, ctx);
	expect(laneTool(root, "audit-1")?.target).toBe("note → lead-a47cc5,explorer-4fdc");
});
