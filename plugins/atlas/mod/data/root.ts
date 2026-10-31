// Board-root and lead-channel-name resolution for the Atlas mod data plane.
// Pure logic: no $, no Node APIs; all IO goes through the injected FsLike
// (mods have no node:path, so join/parent are computed inline). Plan: §2.
import type { FsLike } from '../contract';

const parentOf = (dir: string): string => {
	const stripped = dir.replace(/\/+$/, '');
	const cut = stripped.lastIndexOf('/');
	return cut <= 0 ? '/' : stripped.slice(0, cut);
};
const joinPath = (dir: string, name: string): string => (dir.endsWith('/') ? dir + name : dir + '/' + name);

/** Linked worktree (`.git` is a file) -> main repo root, as scripts/atlas_paths.py worktree_main_root; null when unreadable. */
async function worktreeMainRoot(fs: FsLike, dir: string): Promise<string | null> {
	const line = ((await fs.read(joinPath(dir, '.git'))) ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('gitdir:'));
	if (!line) return null;
	let gitDir = line.slice('gitdir:'.length).trim();
	if (!gitDir.startsWith('/')) gitDir = joinPath(dir, gitDir);
	const common = ((await fs.read(joinPath(gitDir, 'commondir'))) ?? '').trim();
	if (!common) return null;
	const commonDir = common.startsWith('/') ? common : joinPath(gitDir, common);
	const parts: string[] = [];
	for (const seg of commonDir.split('/')) {
		if (seg === '..') parts.pop();
		else if (seg !== '' && seg !== '.') parts.push(seg);
	}
	return parentOf('/' + parts.join('/'));
}

/**
 * Root of the Atlas data tree, the same rule the hooks write under
 * (scripts/atlas_paths.py project_root, atlas_paths.py:82-112): ATLAS_PROJECT_ROOT when set and
 * holding `.atlas`; else the nearest ancestor of cwd holding `.git` (a linked worktree maps to the
 * main repo), whether or not `.atlas` exists yet, so a repo whose `.atlas/` appears mid-session is
 * not captured by an ancestor's stray `.atlas`; else, with no git, the nearest ancestor holding
 * `.atlas`. At most 12 levels probed per pass. null when nothing matches.
 */
export async function boardRoot(
	fs: FsLike,
	cwd: string,
	env: { ATLAS_PROJECT_ROOT?: string },
): Promise<string | null> {
	const override = env?.ATLAS_PROJECT_ROOT ?? '';
	if (override && (await fs.exists(joinPath(override, '.atlas')))) return override;
	for (const marker of ['.git', '.atlas']) {
		let dir = cwd;
		for (let i = 0; i < 12; i++) {
			if (await fs.exists(joinPath(dir, marker))) {
				if (marker === '.git') return (await worktreeMainRoot(fs, dir)) ?? dir;
				return dir;
			}
			const parent = parentOf(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return null;
}

/**
 * Candidate channel names for the lead's IRC channel, in resolution order:
 * `lead-<first 6 of session id>` (the lead_name rule in scripts/atlas_todo.py:1359,
 * pinned by hooks/session_boot.py:815-837), then `<folder>@<branch>` fallback
 * when the lead channel is not in channels.json.
 */
export function leadChannelName(sessionId: string, folder: string, branch: string): string[] {
	return [`lead-${sessionId.slice(0, 6)}`, `${folder}@${branch}`];
}