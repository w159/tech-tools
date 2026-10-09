import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { createShellEditTracker, newShellEdits, snapshotDirty } from "./delegation";
import { runCaptureSync } from "./proc";

const made: string[] = [];
afterEach(() => {
	for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function write(root: string, rel: string, body: string): void {
	const abs = nodePath.join(root, rel);
	fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, body);
}

/** Run argv via the temp-file transport (bun's piped child stdio breaks under a relative-path filter); throws on non-zero exit. */
function run(argv: string[], cwd?: string): void {
	const { code } = runCaptureSync(argv, { cwd });
	if (code !== 0) throw new Error(`${argv.join(" ")} failed (exit ${code})`);
}

/** A REAL git repo with one committed code file and one committed doc. */
function repo(): string {
	const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-deleg-")));
	made.push(root);
	const git = (...args: string[]) => run(["git", ...args], root);
	git("init", "-q");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
	write(root, "src/calc.py", "def add(a, b):\n    return a - b\n");
	write(root, "docs/guide.md", "# guide\n");
	git("add", "-A");
	git("commit", "-q", "-m", "init");
	return root;
}

test("pre-dirty file left untouched is not counted as a shell edit", () => {
	const root = repo();
	write(root, "src/calc.py", "def add(a, b):\n    return a + b  # dirty before the session\n");
	write(root, "src/new.py", "x = 1\n");
	const before = snapshotDirty(root);
	expect(Object.keys(before ?? {}).sort()).toEqual(["src/calc.py", "src/new.py"]);
	expect(newShellEdits(before, snapshotDirty(root))).toEqual([]);
});

test("a file shell-edited after the snapshot is counted, whether clean, dirty or new", () => {
	const root = repo();
	write(root, "src/dirty.py", "a = 1\n");
	const before = snapshotDirty(root);
	run(["sed", "-i.bak", "s/a - b/a + b/", nodePath.join(root, "src/calc.py")]);
	fs.rmSync(nodePath.join(root, "src/calc.py.bak"));
	write(root, "src/dirty.py", "a = 2\n");
	write(root, "src/brand_new.py", "b = 1\n");
	expect(newShellEdits(before, snapshotDirty(root))).toEqual(["src/brand_new.py", "src/calc.py", "src/dirty.py"]);
});

test("deleting a clean tracked file after the snapshot is counted", () => {
	const root = repo();
	write(root, "src/old.py", "z = 1\n");
	run(["git", "add", "-A"], root);
	run(["git", "commit", "-q", "-m", "more"], root);
	const before = snapshotDirty(root);
	fs.rmSync(nodePath.join(root, "src/old.py"));
	expect(newShellEdits(before, snapshotDirty(root))).toEqual(["src/old.py"]);
});

test("docs/, .atlas/ and *.md paths are never counted; .mdx is code", () => {
	const root = repo();
	const before = snapshotDirty(root);
	write(root, "docs/guide.md", "# changed\n");
	write(root, "docs/notes.txt", "n\n");
	write(root, ".atlas/.run/x.json", "{}\n");
	write(root, "README.md", "r\n");
	write(root, "sub/.atlas/state.json", "{}\n");
	write(root, "notes.mdx", "m\n");
	expect(Object.keys(snapshotDirty(root) ?? {})).toEqual(["notes.mdx"]);
	expect(newShellEdits(before, snapshotDirty(root))).toEqual(["notes.mdx"]);
});

test("not a git repo -> undefined, and no edits are ever derived (fail open)", () => {
	const dir = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-nogit-")));
	made.push(dir);
	write(dir, "src/a.py", "a\n");
	expect(snapshotDirty(dir)).toBeUndefined();
	expect(snapshotDirty(nodePath.join(dir, "missing"))).toBeUndefined();
	expect(newShellEdits(undefined, { "src/a.py": "h" })).toEqual([]);
	expect(newShellEdits({ "src/a.py": "h" }, undefined)).toEqual([]);
});

test("tracker: first capture wins, stop diffs against it, reset re-arms", () => {
	const root = repo();
	const tracker = createShellEditTracker();
	tracker.capture(root);
	write(root, "src/late.py", "1\n");
	tracker.capture(root); // must NOT replace the first snapshot
	expect(tracker.stop(root)).toEqual(["src/late.py"]);
	tracker.reset();
	expect(tracker.stop(root)).toEqual([]); // no baseline -> fail open
	tracker.capture(root);
	expect(tracker.stop(root)).toEqual([]);
});

test("tracker fails open: no root, non-git root, never captured", () => {
	const dir = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-nogit-")));
	made.push(dir);
	const tracker = createShellEditTracker();
	expect(tracker.stop(undefined)).toEqual([]);
	tracker.capture(undefined);
	tracker.capture(dir);
	write(dir, "src/a.py", "a\n");
	expect(tracker.stop(dir)).toEqual([]);
});

test("agent tool-state dirs (.serena, .lean-ctx, ...) are never counted; src/app.py still is", () => {
	const root = repo();
	const before = snapshotDirty(root);
	write(root, ".serena/project.yml", "name: x\n");
	write(root, ".serena/.gitignore", "/cache\n");
	write(root, "src/app.py", "x = 1\n");
	expect(Object.keys(snapshotDirty(root) ?? {})).toEqual(["src/app.py"]);
	expect(newShellEdits(before, snapshotDirty(root))).toEqual(["src/app.py"]);
});
