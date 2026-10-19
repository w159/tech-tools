/**
 * `/atlas-tui` slash command: runs the Atlas Command Center curses TUI in the
 * user's own terminal by pausing omp's renderer for the duration — the same
 * handoff omp's external editor uses (stop the TUI, await the child, restart).
 * Headless/RPC sessions have no terminal to hand over, so they only get the
 * `--launch` pointer. Slash args pass through allowlisted to the script
 * (`--all`, `--view X`, `--seat X`, `--colony X`); anything else, a non-zero
 * exit, or a spawn failure is reported as a warning, never thrown.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { pluginScript } from "./plugin-path";

/** Resolved at call time so an `omp plugin upgrade atlas` mid-session is picked up (plugin-path). */
export const tuiScript = (): string => pluginScript("atlas_tui.py");

/** The outcome of one TUI run: exit code, or the spawn error itself. */
export type TuiSpawnResult = { exitCode: number | null; error?: Error };

/** Injectable spawner so tests can fake the child without a real terminal. */
export type TuiSpawner = (bin: string, args: string[], opts: { cwd: string }) => Promise<TuiSpawnResult>;

/** Default spawner: the child inherits the terminal while omp's renderer is stopped. */
export const defaultTuiSpawner: TuiSpawner = async (bin, args, opts) => {
	try {
		const child = Bun.spawn([bin, ...args], { cwd: opts.cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
		await child.exited;
		return { exitCode: child.exitCode };
	} catch (error) {
		return { exitCode: null, error: error instanceof Error ? error : new Error(String(error)) };
	}
};

/** Flags with no value the script accepts from the slash command. */
const BARE_FLAGS: Record<string, true> = { "--all": true };
/** Flags consuming one value the script accepts from the slash command. */
const VALUE_FLAGS: Record<string, true> = { "--view": true, "--seat": true, "--colony": true };
/** Shown in the rejection message so users can self-correct. */
const ALLOWED = "--all, --view <x>, --seat <x>, --colony <x>";

/** Split and validate slash-command args against the script's flag surface; `--project` is ours, never parsed. */
export function allowlistTuiArgs(args: string | undefined): { ok: true; argv: string[] } | { ok: false; reason: string } {
	const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
	const argv: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (BARE_FLAGS[token]) {
			argv.push(token);
		} else if (VALUE_FLAGS[token]) {
			const value = tokens[++i];
			if (value === undefined) return { ok: false, reason: `${token} needs a value (allowed: ${ALLOWED})` };
			argv.push(token, value);
		} else {
			return { ok: false, reason: `unsupported argument ${token} (allowed: ${ALLOWED})` };
		}
	}
	return { ok: true, argv };
}

/**
 * Register `/atlas-tui`. `deps.spawn` is injectable for tests; the real one
 * runs `python3 atlas_tui.py --project <cwd> [args...]` with the terminal
 * inherited while omp's UI is stopped, restarting the UI once it exits.
 */
export function registerAtlasTuiCommand(pi: Pick<ExtensionAPI, "registerCommand">, deps: { spawn?: TuiSpawner } = {}): void {
	const spawnTui = deps.spawn ?? defaultTuiSpawner;
	pi.registerCommand("atlas-tui", {
		description: "Open the Atlas Command Center TUI in this terminal",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(`No interactive terminal here — run \`python3 ${tuiScript()} --launch\` from a real terminal instead.`, "info");
				return;
			}
			const parsed = allowlistTuiArgs(args);
			if (!parsed.ok) {
				ctx.ui.notify(`/atlas-tui: ${parsed.reason}`, "warning");
				return;
			}
			try {
				const notice = await ctx.ui.custom<string | undefined>((tui, _theme, _kb, done) => {
					tui.stop();
					// Same terminal handoff as omp's external editor: the child owns the
					// screen; omp's renderer restarts the moment it exits.
					void spawnTui("python3", [tuiScript(), "--project", ctx.cwd, ...parsed.argv], { cwd: ctx.cwd }).then(
						result => {
							tui.start();
							tui.requestRender(true);
							if (result.error) done(`atlas_tui could not start: ${result.error.message}`);
							else if (result.exitCode !== 0) done(`atlas_tui exited with code ${result.exitCode}`);
							else done(undefined);
						},
						error => {
							tui.start();
							tui.requestRender(true);
							done(`atlas_tui failed: ${error instanceof Error ? error.message : String(error)}`);
						},
					);
					return { render: () => [] };
				});
				if (notice) ctx.ui.notify(`/atlas-tui: ${notice}`, "warning");
			} catch {
				// fail open: the custom UI rejected (abort/no-op host); the handler must not throw
			}
		},
	});
}
