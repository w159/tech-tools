/**
 * Shell-written code and the delegation mandate — twin of the Claude Code
 * SessionStart snapshot (hooks/session_boot.py `write_dirty_snapshot`) and the
 * Stop gate's shell check (hooks/completion_gate.py `_shell_dirty_edits`).
 *
 * The omp stop gate counts `edit`/`write` tool calls, so a lead that fixes code
 * with `bash sed -i` is invisible to it. Closing that: snapshot the non-docs
 * paths git reports dirty/untracked (path -> content hash) when the session
 * starts, snapshot again at stop, and count paths that are new or whose content
 * changed as non-docs edits. A file that was already dirty and is left alone
 * hashes the same both times, so inherited dirt never counts.
 *
 * Exemptions come from contracts/native-tools.json via ./contracts (same source
 * as index.ts `isNonDocsPath` and the Python hooks). Everything fails open:
 * not a git repo, git missing, contract unreadable, no baseline → no edits.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { loadNativeTools } from "./contracts";
import { runCaptureSync } from "./proc";

/** Hash recorded for a path git reports dirty but that no longer exists. */
const DELETED = "deleted";

/**
 * Repo-relative path exempt from the mandate: docs dirs, *.md, and dirs agent
 * tooling writes by itself (`toolStateDirs`, e.g. serena's .serena/project.yml
 * at session start). Unreadable contract → exempt. Only the shell-dirt snapshot
 * uses this: an explicit edit/write of such a path (index.ts isNonDocsPath) is
 * still a model edit.
 */
function exempt(rel: string): boolean {
	const contract = loadNativeTools();
	if (!contract) return true;
	if (contract.exemptExtensions.some(ext => rel.endsWith(ext))) return true;
	return rel.split("/").some(seg => contract.exemptDirs.includes(seg) || contract.toolStateDirs.includes(seg));
}

function hashOf(abs: string): string {
	try {
		return createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
	} catch {
		return DELETED;
	}
}

/**
 * Non-docs paths `git status` reports dirty or untracked under `root`, mapped to
 * a content hash. Synchronous. undefined when `root` is not a git work tree
 * (or git is unavailable) — callers then derive no edits.
 */
export function snapshotDirty(root: string): Record<string, string> | undefined {
	try {
		const { code, stdout: out } = runCaptureSync(["git", "status", "--porcelain", "-z", "--untracked-files=all"], {
			cwd: root,
			timeoutMs: 10_000,
		});
		// A non-zero exit (not a git work tree, git missing) or a timeout kill is "unknown", as the old throw was.
		if (code !== 0) return undefined;
		const snapshot: Record<string, string> = {};
		for (const field of out.split("\0")) {
			// "XY path"; the bare original-path field that follows a rename has no XY prefix.
			if (field.length < 4 || field[2] !== " ") continue;
			const rel = field.slice(3);
			if (exempt(rel)) continue;
			snapshot[rel] = hashOf(nodePath.join(root, rel));
		}
		return snapshot;
	} catch {
		return undefined;
	}
}

/** Paths in `after` that are absent from `before` or whose content changed. Either side unknown → []. */
export function newShellEdits(
	before: Record<string, string> | undefined,
	after: Record<string, string> | undefined,
): string[] {
	if (!before || !after) return [];
	return Object.keys(after)
		.filter(p => before[p] !== after[p])
		.sort();
}

export interface ShellEditTracker {
	/** Snapshot `root`; the first successful capture is the baseline, later calls are no-ops. */
	capture(root: string | undefined): void;
	/** Non-docs paths created or changed since the baseline; [] when there is none. */
	stop(root: string | undefined): string[];
	/** Forget the baseline (new session). */
	reset(): void;
}

export function createShellEditTracker(): ShellEditTracker {
	let baseline: Record<string, string> | undefined;
	return {
		capture(root) {
			if (baseline !== undefined || root === undefined) return;
			baseline = snapshotDirty(root);
		},
		stop(root) {
			if (baseline === undefined || root === undefined) return [];
			return newShellEdits(baseline, snapshotDirty(root));
		},
		reset() {
			baseline = undefined;
		},
	};
}
