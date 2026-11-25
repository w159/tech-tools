/**
 * Script resolution that survives a stale install: an omp session started before
 * `omp plugin upgrade atlas` keeps `import.meta.dir` pointing at the deleted versioned cache
 * dir (`~/.omp/plugins/cache/plugins/tech-tools___atlas___<old>/`), so module-level script
 * paths go dark and hooks silently never run. Resolve lazily at call time; when the live copy
 * is gone, fall back to the newest sibling install that still ships the script.
 */
import * as fs from "node:fs";
import * as nodePath from "node:path";

const VERSIONED = /^(.*___atlas___)[^/]+$/;

/** Newest by numeric semver: dot-separated segments compared element-wise, missing = 0. */
function newerVersion(a: string, b: string): boolean {
	const pa = a.split(".").map(s => Number.parseInt(s, 10) || 0);
	const pb = b.split(".").map(s => Number.parseInt(s, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0) return d > 0;
	}
	return false;
}

/**
 * `<candidate>` when the file exists there; otherwise the same file in the newest sibling
 * install (same `___atlas___` prefix) that ships it; otherwise the candidate unchanged so
 * callers report it missing. Never throws.
 */
export function pluginScriptFallback(here: string): string {
	if (fs.existsSync(here)) return here;
	const pluginDir = nodePath.dirname(nodePath.dirname(here)); // <plugin>/scripts/<name> -> <plugin>
	const m = nodePath.basename(pluginDir).match(VERSIONED);
	if (!m) return here;
	const parent = nodePath.dirname(pluginDir);
	let entries: string[] = [];
	try {
		entries = fs.readdirSync(parent);
	} catch {
		return here;
	}
	let best: string | undefined;
	let bestVersion = "";
	for (const entry of entries) {
		if (!entry.startsWith(m[1])) continue;
		const candidate = nodePath.join(parent, entry, "scripts", nodePath.basename(here));
		if (!fs.existsSync(candidate)) continue;
		const version = entry.slice(m[1].length);
		if (!best || newerVersion(version, bestVersion)) {
			best = candidate;
			bestVersion = version;
		}
	}
	return best ?? here;
}

/** `<plugin>/scripts/<name>` from this module's location, with the stale-install fallback above. */
export function pluginScript(name: string): string {
	return pluginScriptFallback(nodePath.resolve(import.meta.dir, "..", "scripts", name));
}

/**
 * Same stale-install walk, for the plugin ROOT itself (hooks.json, contracts, and the
 * `${CLAUDE_PLUGIN_ROOT}` handed to hooks.json commands): the live directory wins, else the
 * newest sibling versioned install, else the input so callers report it missing. Never throws.
 */
export function pluginRootFallback(here: string): string {
	if (fs.existsSync(here)) return here;
	const m = nodePath.basename(here).match(VERSIONED);
	if (!m) return here;
	let best: string | undefined;
	let bestVersion = "";
	try {
		for (const entry of fs.readdirSync(nodePath.dirname(here))) {
			if (!entry.startsWith(m[1])) continue;
			const candidate = nodePath.join(nodePath.dirname(here), entry);
			try {
				if (!fs.statSync(candidate).isDirectory()) continue;
			} catch {
				continue;
			}
			const version = entry.slice(m[1].length);
			if (!best || newerVersion(version, bestVersion)) {
				best = candidate;
				bestVersion = version;
			}
		}
	} catch {
		return here;
	}
	return best ?? here;
}

/** This module's plugin root, with the stale-install fallback above. Resolved per call so a mid-session `omp plugin upgrade atlas` is picked up. */
export function pluginRoot(): string {
	return pluginRootFallback(nodePath.resolve(import.meta.dir, ".."));
}

/** The version `installed_plugins.json` (three levels above a versioned install dir) lists for atlas: this marketplace's entry, else any atlas entry. */
function installedAtlasVersion(pluginDir: string, marketplace: string): unknown {
	const registry = nodePath.join(nodePath.dirname(nodePath.dirname(nodePath.dirname(pluginDir))), "installed_plugins.json");
	const plugins = JSON.parse(fs.readFileSync(registry, "utf8"))?.plugins ?? {};
	const entries = plugins[`atlas@${marketplace}`] ?? Object.entries(plugins).find(([k]) => k.startsWith("atlas@"))?.[1];
	return Array.isArray(entries) ? entries[0]?.version : undefined;
}

/**
 * One line when this session's in-memory modules (loaded from `<plugins>/cache/plugins/<mkt>___atlas___<ver>/`)
 * are older than the version omp's `installed_plugins.json` now points at (omp auto-upgrades marketplace
 * plugins seconds after start; the TypeScript in memory stays old until restart). Undefined when the versions
 * match, the load dir is not a versioned install, or the registry is unreadable. Never throws.
 */
export function staleSessionNotice(pluginDir: string = nodePath.resolve(import.meta.dir, "..")): string | undefined {
	try {
		const m = nodePath.basename(pluginDir).match(VERSIONED);
		if (!m) return undefined;
		const loaded = nodePath.basename(pluginDir).slice(m[1].length);
		const current = installedAtlasVersion(pluginDir, m[1].slice(0, -"___atlas___".length));
		if (typeof current !== "string" || !current || current === loaded) return undefined;
		return `atlas: this omp session runs atlas ${loaded} but ${current} is installed; restart omp to pick up ${current}.`;
	} catch {
		return undefined;
	}
}
