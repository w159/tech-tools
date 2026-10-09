import { expect, test } from "bun:test";
import * as fs from "node:fs";
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
