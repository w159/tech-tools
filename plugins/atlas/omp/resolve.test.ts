import { describe, expect, test } from "bun:test";
import * as nodePath from "node:path";
import { resolve } from "./resolve";

const PY = nodePath.resolve(import.meta.dir, "..", "scripts", "atlas_resolve.py");
// Key-order-insensitive compare: Python emits sort_keys, so canonicalize both sides.
const canon = (v: unknown): unknown =>
	Array.isArray(v)
		? v.map(canon)
		: v && typeof v === "object"
			? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)]))
			: v;

const ROWS = [
	["implement", "low"],
	["implement", "high"],
	["fix", "medium"],
	["verify", "high"],
	["audit", "high"],
	["docs", "medium"],
	["db", "low"],
	["ui-test", "high"],
] as const;

describe("resolve parity with atlas_resolve.py", () => {
	for (const [c, e] of ROWS) {
		test(`${c}/${e}`, () => {
			const py = Bun.spawnSync(["python3", PY, c, e, "--paths", "b/x.ts,./a/y.ts,a//y.ts"]);
			expect(py.exitCode).toBe(0);
			const ts = resolve(c, e, ["b/x.ts", "./a/y.ts", "a//y.ts"]);
			expect(canon(ts)).toEqual(canon(JSON.parse(py.stdout.toString())));
			expect((ts as { file_scope: string[] }).file_scope).toEqual(["a/y.ts", "b/x.ts"]);
		});
	}
	test("unknown class and effort throw", () => {
		expect(() => resolve("nope", "low")).toThrow();
		expect(() => resolve("fix", "extreme")).toThrow();
		expect(() => resolve("constructor", "low")).toThrow();
	});
});
