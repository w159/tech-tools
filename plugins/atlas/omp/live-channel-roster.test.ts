// Live defect (claude 2.1.322, round2/after/live-150): the channel tab read `#channel` and `0 people` although channels.json
// held a main channel named after the repo folder with the lead as its member. The scratch repo had no readable branch, so
// the script keyed the main channel by the bare folder name, and the live session id is not the lead's (the lead name came from
// ATLAS_LEAD_NAME), so neither mod candidate (`lead-<session6>`, `<folder>@<branch>`) matched. The registry here is written by
// the real scripts/atlas_todo.py in a temp dir and read through the path register.ts takes (SnapshotBuilder.init/build).
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotBuilder } from "../mod/snapshot";
import type { FsLike } from "../mod/contract";

const SCRIPTS = join(import.meta.dir, "..", "scripts");

const realFs: FsLike = {
	read: async (p) => { try { return readFileSync(p, "utf8"); } catch { return undefined; } },
	stat: async (p) => { try { const s = require("node:fs").statSync(p); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return undefined; } },
	exists: async (p) => require("node:fs").existsSync(p),
	list: async (p) => { try { return require("node:fs").readdirSync(p); } catch { return []; } },
};

/** A repo dir named `folder`, git-initialised or not, with the lead channel opened by the real script (lead `lead-104043`, three subagents). */
function scenario(folder: string, git: boolean): { root: string; cleanup: () => void } {
	const base = mkdtempSync(join(tmpdir(), "live-channel-"));
	const root = join(realpathSync(base), folder);
	mkdirSync(join(root, ".atlas", ".run"), { recursive: true });
	if (git) spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
	const py = [
		"import sys; sys.path.insert(0, sys.argv[1]); import atlas_todo",
		"atlas_todo.open_lead_channel(sys.argv[2], 'lead-104043', ['alpha-explorer', 'beta-explorer', 'gamma-explorer'])",
	].join("\n");
	const run = spawnSync("python3", ["-c", py, SCRIPTS, root], { cwd: root, encoding: "utf8", env: { ...process.env, ATLAS_LEAD_NAME: "", ATLAS_WORKER_NAME: "", ATLAS_CHANNEL: "" } });
	if (run.status !== 0) throw new Error(`atlas_todo.open_lead_channel failed: ${run.stderr}`);
	return { root, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

async function snapshotOf(root: string, sessionId: string, folder: string, branch: string) {
	const b = new SnapshotBuilder(realFs, join(import.meta.dir, ".."));
	await b.init(root, {}, sessionId, folder, branch);
	return b.build({ headerPhase: null, taskAgents: [], usage: { contextPct: null }, now: Date.now() });
}

test("branchless repo: the main channel keyed by the bare folder name is the roster (name, 1 member) when the session id is not the lead's", async () => {
	const { root, cleanup } = scenario("lc-folder", false);
	try {
		const reg = JSON.parse(readFileSync(join(root, ".atlas", ".run", "channels.json"), "utf8"));
		expect(Object.keys(reg.channels)).toEqual(["lc-folder", "lc-folder/lead-104043"]); // the shape the real script wrote
		const snap = await snapshotOf(root, "ffffff-live-session", "lc-folder", "main");
		expect(snap.channel).toBe("lc-folder");
		expect(snap.members.map((m) => m.name)).toEqual(["lead-104043"]);
	} finally { cleanup(); }
});

test("repo with a branch: `<folder>@<branch>` still resolves the main channel, and the lead's own session id still picks its subchannel", async () => {
	const { root, cleanup } = scenario("lc-git", true);
	try {
		const main = await snapshotOf(root, "ffffff-live-session", "lc-git", "main");
		expect(main.channel).toBe("lc-git@main");
		expect(main.members.map((m) => m.name)).toEqual(["lead-104043"]);
		const own = await snapshotOf(root, "104043-session", "lc-git", "main");
		expect(own.channel).toBe("lc-git@main/lead-104043");
		expect(own.members).toHaveLength(4);
	} finally { cleanup(); }
});
