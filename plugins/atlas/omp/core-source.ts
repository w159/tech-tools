/**
 * The Atlas core model for the omp harness: reads <root>/.atlas/.run with node fs and feeds the shared pure
 * coreModel() (mod/data/core.ts) the same CoreInput that mod/register.ts buildCore builds. Twin: buildCore.
 * Every file read is cached by `${size}:${mtimeMs}` from one stat; entries not read in a build are evicted.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as nodePath from "node:path";
import { type CoreModel, type ReportNote, type Tally, coreModel } from "../mod/data/core";
import type { TodoItem } from "../mod/contract";
import { pluginRoot } from "./plugin-path";

export interface CoreSourceDeps {
	readText?: (path: string) => string; // throws when missing
	statOf?: (path: string) => { size: number; mtimeMs: number }; // throws when missing
	listDir?: (dir: string) => string[]; // throws when missing
	pluginRoot?: () => string;
}
export interface CoreReadOpts {
	sessionId?: string;
	openGates?: number;
	header?: Tally; // omp has no reply-header count yet
}
export interface CoreSource {
	build(root: string, opts?: CoreReadOpts): CoreModel;
}

/** Board `report` notes (ts in epoch seconds) from one .jsonl text. */
function reportsOf(text: string): ReportNote[] {
	return text.split("\n").flatMap((line): ReportNote[] => {
		try {
			const n = JSON.parse(line) as { kind?: unknown; owner?: unknown; text?: unknown; ts?: unknown };
			return n.kind === "report" && typeof n.owner === "string" && typeof n.text === "string"
				? [{ owner: n.owner, text: n.text, at: (typeof n.ts === "number" ? n.ts : 0) * 1000 }]
				: [];
		} catch {
			return [];
		}
	});
}

export function createCoreSource(deps: CoreSourceDeps = {}): CoreSource {
	const readText = deps.readText ?? ((p: string) => readFileSync(p, "utf8"));
	const statOf = deps.statOf ?? ((p: string) => statSync(p));
	const listDir = deps.listDir ?? ((d: string) => readdirSync(d));
	const rootOfPlugin = deps.pluginRoot ?? pluginRoot;
	const cache = new Map<string, { key: string; text: string }>();
	let touched = new Set<string>(); // paths read by the build in progress; the rest are evicted after it

	const names = (dir: string, keep: (n: string) => boolean): string[] => {
		try {
			return listDir(dir).filter(keep).sort();
		} catch {
			return [];
		}
	};
	/** Text re-read only when its size or mtime moved; "" when missing or unreadable. */
	const cached = (path: string): string => {
		let key: string;
		try {
			const st = statOf(path);
			key = `${st.size}:${st.mtimeMs}`;
		} catch {
			return "";
		}
		touched.add(path);
		const hit = cache.get(path);
		if (hit?.key === key) return hit.text;
		try {
			const text = readText(path);
			cache.set(path, { key, text });
			return text;
		} catch {
			return "";
		}
	};
	/** This session's non-archived board rows, scoped like channel-view sessionTodos. */
	const todosOf = (base: string, sessionId?: string): TodoItem[] => {
		try {
			const items = (JSON.parse(cached(`${base}/todos.json`)).items ?? []) as (TodoItem & { origin?: string })[];
			return items.filter((i) => !i.archived && i.origin !== "advisor" && (!sessionId || i.session_id === sessionId));
		} catch {
			return [];
		}
	};

	return {
		build(root, opts = {}) {
			const base = `${root.replace(/\/+$/, "")}/.atlas/.run`;
			touched = new Set();
			const teams = names(`${base}/teams`, (n) => n.endsWith(".json")).map((name) => ({ name, text: cached(`${base}/teams/${name}`) }));
			const logs: Record<string, string> = {};
			for (const n of names(`${base}/logs`, (n) => n.endsWith(".log") && n !== "atlas_mux.log")) logs[n.replace(/\.log$/, "")] = cached(`${base}/logs/${n}`);
			const reports = names(`${base}/board`, (n) => n.endsWith(".jsonl")).flatMap((n) => reportsOf(cached(`${base}/board/${n}`)));
			const findings = cached(`${base}/findings.json`);
			const matrix = cached(nodePath.join(rootOfPlugin(), "contracts", "scope-matrix.json"));
			const todos = todosOf(base, opts.sessionId);
			for (const path of cache.keys()) if (!touched.has(path)) cache.delete(path);
			return coreModel({
				findings,
				teams,
				matrix,
				logs,
				reports,
				todos,
				header: opts.header ?? { ok: 0, total: 0 },
				openGates: opts.openGates ?? 0,
			});
		},
	};
}
