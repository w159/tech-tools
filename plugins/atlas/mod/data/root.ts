// Board-root and lead-channel-name resolution for the Atlas mod data plane.
// Pure logic: no $, no Node APIs; all IO goes through the injected FsLike
// (mods have no node:path, so join/parent are computed inline). Plan: §2.
import type { FsLike } from '../contract';

/**
 * Root of the Atlas data tree: ATLAS_PROJECT_ROOT when set and holding `.atlas`,
 * else the nearest ancestor of cwd that holds `.atlas` (the boardRoot rule in
 * omp/channel-view.ts:74-80), probing at most 12 levels. null when nothing does.
 */
export async function boardRoot(
	fs: FsLike,
	cwd: string,
	env: { ATLAS_PROJECT_ROOT?: string },
): Promise<string | null> {
	const override = env?.ATLAS_PROJECT_ROOT ?? '';
	if (override && (await fs.exists(override.endsWith('/') ? override + '.atlas' : override + '/.atlas'))) {
		return override;
	}
	let dir = cwd;
	for (let i = 0; i < 12; i++) {
		if (await fs.exists(dir.endsWith('/') ? dir + '.atlas' : dir + '/.atlas')) return dir;
		// Parent walk: strip trailing slashes, cut before the last '/'; the root is its own parent.
		const stripped = dir.replace(/\/+$/, '');
		const cut = stripped.lastIndexOf('/');
		const parent = cut <= 0 ? '/' : stripped.slice(0, cut);
		if (parent === dir) return null;
		dir = parent;
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