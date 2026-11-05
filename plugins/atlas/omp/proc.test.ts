import { afterEach, beforeEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import * as os from "node:os";
import { runCapture, runCaptureSync } from "./proc";

const UPPER = "import sys; sys.stdout.write(sys.stdin.read().upper())";

test("runs a real git and captures stdout (sync and async)", async () => {
	const sync = runCaptureSync(["git", "--version"]);
	expect(sync.code).toBe(0);
	expect(sync.stdout).toStartWith("git version");
	expect(await runCapture(["git", "--version"])).toEqual(sync);
});

test("feeds input to the child's stdin", async () => {
	const argv = ["python3", "-c", UPPER];
	expect(runCaptureSync(argv, { input: "hello proc" })).toEqual({ code: 0, stdout: "HELLO PROC" });
	expect(await runCapture(argv, { input: "hello proc" })).toEqual({ code: 0, stdout: "HELLO PROC" });
});

test("propagates the exit code and keeps stdout of a failing command", async () => {
	const argv = ["sh", "-c", "echo partial; exit 3"];
	expect(runCaptureSync(argv)).toEqual({ code: 3, stdout: "partial\n" });
	expect(await runCapture(argv)).toEqual({ code: 3, stdout: "partial\n" });
	expect(runCaptureSync(["definitely-not-a-command-xyz"]).code).toBe(127);
});

test("passes argv verbatim, with cwd and env applied", () => {
	const tricky = "a b $HOME 'q' \"d\" ;&|";
	expect(runCaptureSync(["printf", "%s", tricky]).stdout).toBe(tricky);
	expect(runCaptureSync(["sh", "-c", "pwd"], { cwd: os.tmpdir() }).stdout.trim()).toBe(fs.realpathSync(os.tmpdir()));
	expect(runCaptureSync(["sh", "-c", 'printf "$ATLAS_PROC_TEST"'], { env: { ATLAS_PROC_TEST: "ok" } }).stdout).toBe("ok");
});

test("timeout kills the command and returns promptly with code null", async () => {
	const started = Date.now();
	expect(await runCapture(["sleep", "5"], { timeoutMs: 300 })).toEqual({ code: null, stdout: "" });
	expect(Date.now() - started).toBeLessThan(2_500);

	const syncStarted = Date.now();
	expect(runCaptureSync(["sleep", "5"], { timeoutMs: 300 })).toEqual({ code: null, stdout: "" });
	expect(Date.now() - syncStarted).toBeLessThan(2_500);
});

// --- cleanup, process-group kill and failure paths (private TMPDIR so leftovers are countable) ---
let priv: string;
let savedTmp: string | undefined;
beforeEach(() => {
	savedTmp = process.env.TMPDIR;
	priv = fs.mkdtempSync(nodePath.join(os.tmpdir(), "proc-priv-"));
	process.env.TMPDIR = priv;
});
afterEach(() => {
	if (savedTmp === undefined) delete process.env.TMPDIR;
	else process.env.TMPDIR = savedTmp;
	fs.rmSync(priv, { recursive: true, force: true });
});
const leftovers = () => fs.readdirSync(priv).filter(n => n.startsWith("atlas-proc-"));
/** Running, not merely a zombie awaiting a reaper (orphans re-parent to init, which may never reap in a container). */
const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
	} catch {
		return false;
	}
	try {
		return !/^\d+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch {
		return true;
	}
};
const waitDead = async (pid: number, ms: number) => {
	for (const end = Date.now() + ms; Date.now() < end && alive(pid); ) await Bun.sleep(25);
	return !alive(pid);
};
const cleanup = (pid: number) => {
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		/* already gone */
	}
};

test("the private TMPDIR is honoured: a run uses and removes its temp dir (sync, async, spawn failure)", async () => {
	expect(os.tmpdir()).toBe(priv);
	runCaptureSync(["true"]);
	await runCapture(["true"]);
	await runCapture(["true"], { timeoutMs: 2_000 });
	runCaptureSync(["true"], { cwd: "/nonexistent-proc-cwd" });
	await runCapture(["true"], { cwd: "/nonexistent-proc-cwd" });
	expect(leftovers()).toEqual([]);
});

test("a child that cannot start yields code null and empty (not undefined) stdout", async () => {
	expect(runCaptureSync(["true"], { cwd: "/nonexistent-proc-cwd" })).toEqual({ code: null, stdout: "" });
	expect(await runCapture(["true"], { cwd: "/nonexistent-proc-cwd" })).toEqual({ code: null, stdout: "" });
});

test("a stdin that cannot be written throws and removes the temp dir", () => {
	expect(() => runCaptureSync(["true"], { input: 5 as unknown as string })).toThrow();
	expect(() => runCapture(["true"], { input: 5 as unknown as string })).toThrow();
	expect(leftovers()).toEqual([]);
});

test("a spawn that throws synchronously removes the temp dir (sync and async)", () => {
	expect(() => runCaptureSync(["a\0b"])).toThrow();
	expect(() => runCapture(["a\0b"])).toThrow();
	expect(leftovers()).toEqual([]);
});

test("async timeout kills the whole process group, not just the shell", async () => {
	const res = await runCapture(["sh", "-c", "sleep 30 & echo $!; wait"], { timeoutMs: 800 });
	const pid = Number.parseInt(res.stdout, 10);
	expect(pid).toBeGreaterThan(1);
	try {
		expect(res.code).toBeNull();
		// SIGTERM, then SIGKILL 1 s later: a runner whose children inherit an ignored SIGTERM only dies at the SIGKILL.
		expect(await waitDead(pid, 3_500)).toBe(true);
	} finally {
		cleanup(pid);
	}
});

test("async timeout escalates to SIGKILL for a group member that ignores SIGTERM", async () => {
	const res = await runCapture(["sh", "-c", 'trap "" TERM; sleep 30 & echo $!; wait'], { timeoutMs: 800 });
	const pid = Number.parseInt(res.stdout, 10);
	expect(pid).toBeGreaterThan(1);
	try {
		expect(await waitDead(pid, 3_500)).toBe(true);
	} finally {
		cleanup(pid);
	}
});

test("sync timeout sweeps the process group the killed shell leaves behind", async () => {
	const res = runCaptureSync(["sh", "-c", "sleep 30 & echo $!; sleep 30"], { timeoutMs: 800 });
	const pid = Number.parseInt(res.stdout, 10);
	expect(pid).toBeGreaterThan(1);
	try {
		expect(res.code).toBeNull();
		expect(await waitDead(pid, 1_500)).toBe(true);
	} finally {
		cleanup(pid);
	}
});

test("sync without a timeout does not sweep a surviving background child", async () => {
	const res = runCaptureSync(["sh", "-c", "sleep 30 & echo $!"]);
	const pid = Number.parseInt(res.stdout, 10);
	try {
		expect(res.code).toBe(0);
		expect(alive(pid)).toBe(true);
	} finally {
		cleanup(pid);
	}
});
