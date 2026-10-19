/**
 * pluginScript stale-install fallback: live path wins; a deleted live install falls back to
 * the newest sibling cache dir (numeric semver, so 1.10 > 1.2) that ships the script; with no
 * sibling the original path is returned unchanged so callers report it missing.
 */
import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import { pluginScript, pluginScriptFallback } from "./plugin-path";

const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "atlas-plugin-path-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

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
	expect(pluginScriptFallback(dead)).toBe(nodePath.join(tmp, "cache", "tech-tools___atlas___1.10.0", "scripts", "atlas_todo.py"));
});
