// usage.ts - local usage counters for the Atlas mod (pane opens, the four commands, failures).
// Counts live in this process and are written as immutable delta files, one per flush,
// <analytics>/mod/<sessionId>-<seq>-<rand>.json holding {"v":2,"counts":{...}} for the counts since this
// process's previous file. The Python analytics client folds each file once and deletes it, so nothing is
// counted twice. Nothing here sends anything; the files hold counts only, never text or paths.
import type { EngineInterface } from 'claude-code';

export const USAGE_KEYS = [
	'mod.open.dock',
	'mod.open.ondemand',
	'mod.open.board',
	'mod.command.atlas-cc',
	'mod.command.atlas-say',
	'mod.command.atlas-core',
	'mod.command.atlas-todo',
	'mod.error.boot',
	'mod.error.rebuild',
	'mod.error.fault',
	'mod.error.other',
] as const;
export type UsageKey = (typeof USAGE_KEYS)[number];

/** At most one write per window: a burst of opens or errors must not become a burst of mv processes. */
const WRITE_MIN_MS = 5000;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Same word sets as OFF_VALUES / ON_VALUES in scripts/atlas_analytics.py.
const OFF_WORDS = new Set(['off', '0', 'false', 'no', 'disabled', 'disable']);
const ON_WORDS = new Set(['on', '1', 'true', 'yes', 'enabled']);

const counts = new Map<string, number>();
let optedOut: boolean | undefined;
let lastWriteMs = -Infinity;
let trailing: { cancel(): void } | null = null;
let dirMade = false;
let seq = 0;
let chain: Promise<unknown> = Promise.resolve();

async function envGet($: EngineInterface, name: string): Promise<string | undefined> {
	// $.env.get takes a literal name (the engine lists the variables a module reads), so callers pass each name spelled out.
	return $.env.get(name).catch(() => undefined);
}

/** $ATLAS_HOME, else $HOME/.atlas (the Python client's home()); '' when neither is known. */
async function atlasHome($: EngineInterface): Promise<string> {
	const home = (await envGet($, 'ATLAS_HOME')) || '';
	if (home) return home.replace(/\/+$/, '');
	const user = (await envGet($, 'HOME')) || '';
	return user ? `${user.replace(/\/+$/, '')}/.atlas` : '';
}

/** A read error or malformed file means "not set". */
async function readJson($: EngineInterface, path: string): Promise<Record<string, unknown>> {
	try {
		const doc: unknown = JSON.parse(await $.fs.read(path));
		return doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Mirrors state() in scripts/atlas_analytics.py. Precedence: DO_NOT_TRACK > ATLAS_ANALYTICS (env, else the
 * "env" key of <home>/settings.json) > consent.json written by `atlas_analytics.py disable` > CI/test run
 * (off unless ATLAS_ANALYTICS=on) > on. Read once per process: a mid-session change is not honored.
 */
async function isOptedOut($: EngineInterface): Promise<boolean> {
	if (optedOut !== undefined) return optedOut;
	const dnt = ((await envGet($, 'DO_NOT_TRACK')) || '').trim().toLowerCase();
	if (dnt !== '' && !['0', 'false', 'no'].includes(dnt)) return (optedOut = true);
	const home = await atlasHome($);
	let knob = await envGet($, 'ATLAS_ANALYTICS');
	if (knob === undefined && home) {
		const stored = ((await readJson($, `${home}/settings.json`)).env as Record<string, unknown> | null | undefined)?.ATLAS_ANALYTICS;
		knob = typeof stored === 'string' ? stored : '';
	}
	const word = (knob ?? '').trim().toLowerCase();
	if (OFF_WORDS.has(word)) return (optedOut = true);
	if (ON_WORDS.has(word)) return (optedOut = false);
	if (home) {
		const enabled = (await readJson($, `${home}/analytics/consent.json`)).enabled;
		if (enabled === false) return (optedOut = true);
		if (enabled === true) return (optedOut = false);
	}
	const ci = await Promise.all([
		envGet($, 'CI'), envGet($, 'GITHUB_ACTIONS'), envGet($, 'GITLAB_CI'), envGet($, 'BUILDKITE'), envGet($, 'CIRCLECI'),
		envGet($, 'TRAVIS'), envGet($, 'JENKINS_URL'), envGet($, 'TF_BUILD'), envGet($, 'PYTEST_CURRENT_TEST'),
	]);
	return (optedOut = ci.some((v) => !!v));
}

/** Writes the counts since the previous file as a new immutable file: temp file + mv so the Python reader never sees half a file. Throws on failure, keeping the counts. */
function flush($: EngineInterface): Promise<void> {
	const run = chain.then(() => writeDelta($));
	chain = run.catch(() => undefined); // overlapping flushes queue, so one count is never written twice
	return run;
}

async function writeDelta($: EngineInterface): Promise<void> {
	const sid = await $.session.id();
	if (typeof sid !== 'string' || !SESSION_ID.test(sid)) return; // the id becomes a file name: anything else could escape the directory
	const home = await atlasHome($);
	if (home === '') return;
	const snapshot = new Map(counts);
	if (snapshot.size === 0) return;
	const dir = `${home}/analytics/mod`;
	if (!dirMade) {
		await $.process.run(['mkdir', '-p', dir]); // fs.write does not create parents
		dirMade = true;
	}
	const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
	const path = `${dir}/${sid}-${seq}-${rand}.json`;
	await $.fs.write(`${path}.tmp`, JSON.stringify({ v: 2, counts: Object.fromEntries(snapshot) }));
	await $.process.run(['mv', '-f', `${path}.tmp`, path]);
	seq += 1;
	for (const [k, n] of snapshot) {
		const left = (counts.get(k) ?? 0) - n;
		if (left > 0) counts.set(k, left);
		else counts.delete(k);
	}
}

/** Count one event and write the file, throttled. Never throws: callers use `void noteUsage(...)`. */
export async function noteUsage($: EngineInterface, key: UsageKey): Promise<void> {
	try {
		if (await isOptedOut($)) return;
		counts.set(key, (counts.get(key) ?? 0) + 1);
		const now = await $.clock.now();
		if (now - lastWriteMs >= WRITE_MIN_MS) {
			lastWriteMs = now;
			await flush($);
			return;
		}
		if (trailing) return; // one trailing write covers every count that lands inside the window
		// clock.after is one-shot, and it keeps this timer out of the mod's repeating-tick bookkeeping (clock.every).
		// A host without clock.after gets an unthrottled write instead of losing the count.
		if (typeof $.clock.after !== 'function') {
			lastWriteMs = now;
			await flush($);
			return;
		}
		trailing = $.clock.after(Math.max(1, lastWriteMs + WRITE_MIN_MS - now), () => {
			trailing = null;
			void (async () => {
				try {
					lastWriteMs = await $.clock.now();
					await flush($);
				} catch {
					// a failed write keeps its counts; the next flush writes them
				}
			})();
		});
	} catch {
		// counting must never break the hook, command or boot it rides on
	}
}

/** Test seam: forget counts, the opt-out cache, the throttle and any pending write. */
export const resetUsageForTest = (): void => {
	counts.clear();
	optedOut = undefined;
	lastWriteMs = -Infinity;
	trailing?.cancel();
	trailing = null;
	dirMade = false;
	seq = 0;
	chain = Promise.resolve();
};
