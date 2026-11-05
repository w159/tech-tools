/**
 * pluginScript stale-install fallback: live path wins; a deleted live install falls back to
 * the newest sibling cache dir (numeric semver, so 1.10 > 1.2) that ships the script; with no
 * sibling the original path is returned unchanged so callers report it missing.
 */
import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import { pluginRoot, pluginRootFallback, pluginScript, pluginScriptFallback } from "./plugin-path";

const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-plugin-path-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
// A fresh cache per test: installs made by one test must not be siblings of another's (order-independent, also under --randomize).
let tmp = root;
beforeEach(() => {
	tmp = fs.mkdtempSync(nodePath.join(root, "t-"));
});

/** Fake versioned cache layout: `<tmp>/cache/<prefix><version>/scripts/atlas_todo.py`. */
function install(version: string, withScript: boolean): string {
	const dir = nodePath.join(tmp, "cache", `tech-tools___atlas___${version}`);
	fs.mkdirSync(nodePath.join(dir, "scripts"), { recursive: true });
	if (withScript) fs.writeFileSync(nodePath.join(dir, "scripts", "atlas_todo.py"), "#!/usr/bin/env python3\n");
	return dir;
}

test("pluginScript resolves the live script next to this module", () => {
	const live = pluginScript("atlas_todo.py");
	expect(fs.existsSync(live)).toBe(true);
	expect(live.endsWith(nodePath.join("scripts", "atlas_todo.py"))).toBe(true);
});

test("fallback keeps the original path when it is not versioned", () => {
	const here = nodePath.join(tmp, "plain", "scripts", "atlas_todo.py");
	expect(pluginScriptFallback(here)).toBe(here);
});

test("fallback returns the original path when nothing anywhere ships the script", () => {
	install("0.9.0", false);
	const dead = nodePath.join(install("1.0.0", false), "scripts", "atlas_todo.py");
	expect(pluginScriptFallback(dead)).toBe(dead);
});

test("fallback picks the newest sibling by numeric semver", () => {
	install("1.2.0", true);
	install("1.10.0", true); // numeric compare: 1.10 > 1.2 even though "1.10" < "1.2" lexicographically
	install("1.9.0", false); // ships nothing: skipped
	const dead = nodePath.join(install("0.9.0", false), "scripts", "atlas_todo.py");
	expect(pluginRootFallback(dead)).toBe(dead);
	expect(pluginScriptFallback(dead)).toBe(nodePath.join(tmp, "cache", "tech-tools___atlas___1.10.0", "scripts", "atlas_todo.py"));
});

test("pluginRootFallback: a dead versioned install resolves to the newest sibling DIR that exists", () => {
	const dead = install("12.5.6", false);
	fs.rmSync(dead, { recursive: true, force: true }); // the upgrade deleted it
	const neu = install("12.5.10", true);
	expect(pluginRootFallback(dead)).toBe(neu);
	expect(pluginRootFallback(neu)).toBe(neu); // a live root wins
	expect(pluginScript(nodePath.join("scripts", "atlas_todo.py").split(nodePath.sep).pop() as string)).toBeTruthy();
	expect(fs.existsSync(nodePath.join(pluginRoot(), "scripts", "atlas_todo.py"))).toBe(true);
});

// ---- ordering and error-path pins (mutation hardening) ----

const scriptIn = (version: string) => nodePath.join(tmp, "cache", `tech-tools___atlas___${version}`, "scripts", "atlas_todo.py");
const deadScript = (version = "0.1") => nodePath.join(tmp, "cache", `tech-tools___atlas___${version}`, "scripts", "atlas_todo.py");

test("version compare reads each segment as base 10 (a trailing letter does not change the value)", () => {
	// radix 10: "9a" -> 9 < 10, so 1.10 is newest. A radix-11 parse reads "9a" as 109 and flips the winner.
	install("1.9a", true);
	install("1.10", true);
	expect(pluginScriptFallback(deadScript())).toBe(scriptIn("1.10"));
});

test("base 10 holds on the incumbent side too: a lettered older install never outranks a newer plain one, whichever is listed first", () => {
	// The directory listing order is the filesystem's, so pin it: the lettered install is listed first and is the incumbent.
	// A radix-11 parse reads "8a" as 98 and would keep it.
	install("1.8a", true);
	install("1.9", true);
	const cache = nodePath.join(tmp, "cache");
	const real = fs.readdirSync;
	const spy = spyOn(fs, "readdirSync").mockImplementation(((dir: fs.PathLike, ...rest: unknown[]) => {
		const names = (real as (...a: unknown[]) => string[])(dir, ...rest);
		return String(dir) === cache ? [...names].sort() : names;
	}) as never);
	try {
		expect(fs.readdirSync(cache)[0]).toBe("tech-tools___atlas___1.8a");
		expect(pluginScriptFallback(deadScript())).toBe(scriptIn("1.9"));
		expect(pluginRootFallback(nodePath.join(cache, "tech-tools___atlas___0.1"))).toBe(nodePath.join(cache, "tech-tools___atlas___1.9"));
	} finally {
		spy.mockRestore();
	}
});

test("a non-numeric segment counts as 0, so it ranks below a real patch number", () => {
	// "1.beta" = (1,0); "1.0.1" = (1,0,1): 1.0.1 must win. A non-numeric segment counted as 1 would flip it.
	install("1.beta", true);
	install("1.0.1", true);
	expect(pluginScriptFallback(deadScript())).toBe(scriptIn("1.0.1"));
});

test("a longer version beats its shorter prefix (missing segments are 0)", () => {
	install("3.2", true);
	install("3.2.1", true);
	install("3.1.9.9", true);
	expect(pluginScriptFallback(deadScript())).toBe(scriptIn("3.2.1"));
	expect(pluginRootFallback(nodePath.join(tmp, "cache", "tech-tools___atlas___0.2"))).toBe(nodePath.join(tmp, "cache", "tech-tools___atlas___3.2.1"));
});

test("a lone 0.0.0 install still resolves (version 0 is not 'nothing found')", () => {
	const only = install("0.0.0", true);
	expect(pluginScriptFallback(deadScript("0.1"))).toBe(scriptIn("0.0.0"));
	expect(pluginRootFallback(nodePath.join(tmp, "cache", "tech-tools___atlas___gone"))).toBe(only);
});

test("the newest install wins whatever order the directory lists them in", () => {
	// Several layouts with the newest first or in the middle, so an "always take the last listed" bug cannot pass on any listing order.
	for (const names of [["9.0.0", "2.0.0", "1.0.0"], ["1.0.0", "9.0.0", "2.0.0"], ["1.10.0", "1.9.0", "1.2.0", "1.3.0"], ["20.0", "3.0", "1.0", "2.0"]]) {
		tmp = fs.mkdtempSync(nodePath.join(root, "o-"));
		for (const v of names) install(v, true);
		const newest = names.reduce((a, b) => (a.localeCompare(b, undefined, { numeric: true }) >= 0 ? a : b));
		expect(pluginScriptFallback(deadScript("0.0.1"))).toBe(scriptIn(newest));
		expect(pluginRootFallback(nodePath.join(tmp, "cache", "tech-tools___atlas___0.0.1"))).toBe(nodePath.join(tmp, "cache", `tech-tools___atlas___${newest}`));
	}
});

test("an unreadable or missing cache directory returns the input unchanged, never throws", () => {
	const deadRoot = nodePath.join(tmp, "no-such-cache", "tech-tools___atlas___1.0.0");
	expect(pluginRootFallback(deadRoot)).toBe(deadRoot);
	const script = nodePath.join(deadRoot, "scripts", "atlas_todo.py");
	expect(pluginScriptFallback(script)).toBe(script);
});

test("pluginRootFallback ignores sibling files that are not directories", () => {
	const cache = nodePath.join(tmp, "cache");
	fs.mkdirSync(cache, { recursive: true });
	fs.writeFileSync(nodePath.join(cache, "tech-tools___atlas___99.0.0"), "not a dir");
	const real = install("1.0.0", true);
	expect(pluginRootFallback(nodePath.join(cache, "tech-tools___atlas___0.1.0"))).toBe(real);
});
