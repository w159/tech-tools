// Board-root and lead-channel-name resolution, pure over an in-memory FsLike.
import { expect, test } from 'claude-code/testing';
import type { FsLike } from '../contract';
import { boardRoot, leadChannelName } from './root';

/** FsLike whose exists() reads a set of absolute paths; every other method is empty. */
function memFs(paths: string[]): FsLike {
	const known = new Set(paths);
	return {
		read: async () => undefined,
		stat: async () => undefined,
		list: async () => [],
		exists: async (path: string) => known.has(path),
	};
}

test('boardRoot honours ATLAS_PROJECT_ROOT only when it holds .atlas', async () => {
	const env = { ATLAS_PROJECT_ROOT: '/override' };
	expect(await boardRoot(memFs(['/override/.atlas']), '/plain/cwd', env)).toBe('/override');
	// Set but empty of .atlas: the ancestor walk of cwd takes over.
	expect(await boardRoot(memFs(['/plain/.atlas']), '/plain/cwd', env)).toBe('/plain');
});

test('boardRoot walks ancestors to the nearest .atlas', async () => {
	expect(await boardRoot(memFs(['/repo/.atlas']), '/repo/sub/leaf', {})).toBe('/repo');
	// The nearest ancestor wins over a shallower one.
	expect(await boardRoot(memFs(['/.atlas', '/repo/.atlas']), '/repo/sub', {})).toBe('/repo');
	// A cwd that itself holds .atlas wins.
	expect(await boardRoot(memFs(['/repo/.atlas']), '/repo', {})).toBe('/repo');
});

test('boardRoot stops at the filesystem root and after 12 levels', async () => {
	// Nothing anywhere, cwd is the filesystem root itself.
	expect(await boardRoot(memFs([]), '/', {})).toBe(null);
	// Nothing anywhere, cwd on disk: root guard, well inside the 12-probe cap.
	expect(await boardRoot(memFs([]), '/work/thing', {})).toBe(null);
	// .atlas beyond the 12-probe window stays unfound: probes cover depths cwd..cwd-11,
	// so a 15-deep cwd with .atlas at depth 2 never reaches it.
	const deep = ['', ...Array.from({ length: 15 }, (_, i) => `/d${i + 1}`)].join('');
	expect(await boardRoot(memFs(['/d2/.atlas']), deep, {})).toBe(null);
	// The 12th and final probe still counts: cwd 11 deep, .atlas at the filesystem root.
	const eleven = ['', ...Array.from({ length: 11 }, (_, i) => `/e${i + 1}`)].join('');
	expect(await boardRoot(memFs(['/.atlas']), eleven, {})).toBe('/');
});

test('leadChannelName leads with the sid6 name, then the folder@branch fallback', () => {
	expect(leadChannelName('01a122b9-cccc', 'tech-tools', 'main')).toEqual(['lead-01a122', 'tech-tools@main']);
	// Short session ids are used whole, no padding.
	expect(leadChannelName('ab', 'repo', 'feat')).toEqual(['lead-ab', 'repo@feat']);
});