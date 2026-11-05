// bun test preload for the mod tests (plugins/atlas/bunfig.toml).
//
// THIS IS A SHIM, NOT THE REAL KIT. The mod's *.test.ts files import `describe`, `expect`, `test` from
// 'claude-code/testing' and `atom`, `read`, `update` from 'claude-code'. Both specifiers are provided by the Claude
// Code host (claude 2.1.x): there is no npm package for them, so a plain `bun test` cannot resolve them. The
// authoritative runner is the host: `claude plugin test plugins/atlas` (see mod/TESTING.md). This shim lets `bun test`
// run the same files in CI and on machines without the host, covering only the surface the tests use:
//   - describe / expect / test delegate to bun:test (the assertions the mod tests use are plain Jest-style matchers).
//   - atom / read / update follow the documented semantics: an atom reads as its initial while nothing is stored,
//     read is one $.state.get, update reads, applies the change and writes with ifVersion, retrying on a miss.
//   - A test whose body takes arguments (`test(name, async ($, on) => ...)`) is handed the host engine and the hook
//     chain by the real kit; nothing here can fake that faithfully, so such tests are registered as skipped under
//     bun and run only under `claude plugin test`. At the time of writing that is mod/register-sidebar.test.ts.
//   - `mock` (clock/env/session of the host engine) is not shimmed: it throws if a skipped-by-design test reached it.
import * as bunTest from "bun:test";
import { plugin } from "bun";

type TestBody = (...args: unknown[]) => unknown;

function hostAwareTest(name: string, a: unknown, b?: unknown) {
	const body = (typeof a === "function" ? a : b) as TestBody;
	if (body.length > 0) return bunTest.test.skip(name, () => {});
	return bunTest.test(name, body as () => unknown);
}

const hostOnly = (what: string) => () => {
	throw new Error(`${what} needs the Claude Code host: run \`claude plugin test plugins/atlas\``);
};
const mock = { clock: hostOnly("mock.clock"), env: hostOnly("mock.env"), session: hostOnly("mock.session") };

type Ref = { plugin: string; key: string; id?: string };
type Atom<T> = { readonly ref: Ref; readonly initial: T; readonly shape?: string };
type StateDollar = {
	state: {
		get(ref: Ref): Promise<{ value: unknown; version: number }>;
		set(ref: Ref, value: unknown, options?: { ifVersion?: number }): Promise<{ isSet: boolean; version: number }>;
	};
};
const isAtom = (s: unknown): s is Atom<unknown> => typeof s === "object" && s !== null && "initial" in s;

const atom = <T>(ref: Ref, initial: T, options?: { shape: string }): Atom<T> =>
	Object.freeze({ ref, initial, ...(options ? { shape: options.shape } : {}) });

async function read<T>($: StateDollar, source: Atom<T> | Ref): Promise<T | undefined> {
	const cell = await $.state.get(isAtom(source) ? source.ref : source);
	return cell.value === undefined && isAtom(source) ? (source.initial as T) : (cell.value as T | undefined);
}

async function update<T>($: StateDollar, target: Atom<T> | Ref, change: (value: T) => T): Promise<T> {
	const ref = isAtom(target) ? target.ref : target;
	for (let attempt = 0; attempt < 16; attempt++) {
		const cell = await $.state.get(ref);
		const current = (cell.value === undefined && isAtom(target) ? target.initial : cell.value) as T;
		const next = change(current);
		if ((await $.state.set(ref, next, { ifVersion: cell.version })).isSet) return next;
	}
	throw new Error("update: gave up after 16 version misses");
}

plugin({
	name: "atlas-test-shim-claude-code",
	setup(build) {
		build.module("claude-code/testing", () => ({
			exports: { describe: bunTest.describe, expect: bunTest.expect, test: hostAwareTest, mock },
			loader: "object",
		}));
		build.module("claude-code", () => ({ exports: { atom, read, update }, loader: "object" }));
	},
});
