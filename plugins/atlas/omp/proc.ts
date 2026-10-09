/**
 * Child-process capture transport for the atlas omp plugin.
 *
 * Temp files, not pipes: on this host bun's child stdio is broken under a
 * relative-path `bun test` filter (a child given ANY stdio fd, pipe or file,
 * exits 1 with empty output), while a child spawned with stdio "ignore" whose
 * own shell does `<in >out` redirection runs fine in both modes. argv travels
 * as separate `sh` arguments behind `"$@"` — never interpolated into the
 * command string — and the child leads its own process group so a timeout
 * kills the whole command tree.
 */
import { type SpawnSyncOptions, spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

export interface CaptureOpts {
	/** Text written to the child's stdin file; absent → empty file (EOF). */
	input?: string;
	/** Child working directory; default: inherit. */
	cwd?: string;
	/** Kill the process group after this long; absent → no timeout. */
	timeoutMs?: number;
	/** Extra/overriding environment variables, merged over process.env. */
	env?: Record<string, string | undefined>;
}

export interface CaptureResult {
	/** Exit code; null on signal death or spawn failure. */
	code: number | null;
	/** Child stdout as UTF-8, verbatim. */
	stdout: string;
}

const ENV_STDIN = "ATLAS_PROC_STDIN";
const ENV_STDOUT = "ATLAS_PROC_STDOUT";
const SCRIPT = `("$@") <"$${ENV_STDIN}" >"$${ENV_STDOUT}" 2>/dev/null`;

interface Dir {
	dir: string;
	stdoutFile: string;
	env: Record<string, string | undefined>;
}

/** mkdtemp + stdin file + merged env; caller removes `dir` in finally. */
function prepare(opts: CaptureOpts): Dir {
	const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-proc-"));
	const stdinFile = nodePath.join(dir, "in");
	try {
		fs.writeFileSync(stdinFile, opts.input ?? "");
	} catch (error) {
		fs.rmSync(dir, { recursive: true, force: true });
		throw error;
	}
	return {
		dir,
		stdoutFile: nodePath.join(dir, "out"),
		env: {
			...process.env,
			...opts.env,
			[ENV_STDIN]: stdinFile,
			[ENV_STDOUT]: nodePath.join(dir, "out"),
		},
	};
}

function readOut(file: string): string {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return "";
	}
}

/**
 * Async capture: run `argv` through `/bin/sh -c` with the temp-file transport.
 * Process-group kill on `timeoutMs` (SIGTERM now, SIGKILL 1 s later); the
 * promise resolves at the timeout even if the child is still dying, with
 * whatever stdout was flushed. Never throws for child behavior — exit code or
 * 127 (missing command), or null on signal/spawn failure.
 */
export function runCapture(argv: string[], opts: CaptureOpts = {}): Promise<CaptureResult> {
	const dir = prepare(opts);
	try {
		const child = spawn("/bin/sh", ["-c", SCRIPT, "sh", ...argv], {
			detached: true,
			stdio: "ignore",
			cwd: opts.cwd,
			env: dir.env,
		});
		return new Promise<CaptureResult>(resolve => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (result: CaptureResult) => {
				clearTimeout(timer);
				fs.rmSync(dir.dir, { recursive: true, force: true });
				resolve(result);
			};
			const killGroup = (signal: NodeJS.Signals) => {
				try {
					if (child.pid !== undefined) process.kill(-child.pid, signal);
				} catch {
					child.kill(signal);
				}
			};
			child.on("error", () => finish({ code: null, stdout: "" }));
			child.on("close", code => finish({ code, stdout: readOut(dir.stdoutFile) }));
			if (opts.timeoutMs !== undefined) {
				timer = setTimeout(() => {
					killGroup("SIGTERM");
					setTimeout(() => killGroup("SIGKILL"), 1_000).unref();
					finish({ code: null, stdout: readOut(dir.stdoutFile) });
				}, opts.timeoutMs);
			}
		});
	} catch (error) {
		fs.rmSync(dir.dir, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Sync capture: same transport via spawnSync. On `timeoutMs` the direct child
 * is SIGKILLed and any surviving process group members are swept afterwards.
 */
export function runCaptureSync(argv: string[], opts: CaptureOpts = {}): CaptureResult {
	const dir = prepare(opts);
	try {
		// `detached` is honoured by node/bun spawnSync but missing from its option typings.
		const result = spawnSync("/bin/sh", ["-c", SCRIPT, "sh", ...argv], <SpawnSyncOptions>{
			detached: true,
			stdio: "ignore",
			cwd: opts.cwd,
			env: dir.env,
			...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs, killSignal: "SIGKILL" as const } : {}),
		});
		if (opts.timeoutMs !== undefined && result.signal !== null) {
			// The timeout kill may have hit only the direct child; sweep the group.
			try {
				if (result.pid !== undefined) process.kill(-result.pid, "SIGKILL");
			} catch {
				/* group already gone */
			}
		}
		const stdout = readOut(dir.stdoutFile);
		fs.rmSync(dir.dir, { recursive: true, force: true });
		return { code: result.status ?? null, stdout };
	} catch (error) {
		fs.rmSync(dir.dir, { recursive: true, force: true });
		throw error;
	}
}