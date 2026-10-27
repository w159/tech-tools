/**
 * Deterministic subagent scope resolver. Same data (contracts/scope-matrix.json) and
 * semantics as scripts/atlas_resolve.py: (task_class, effort) -> team shape.
 */
import * as nodePath from "node:path";
import { readFileSync } from "node:fs";
import { pluginRoot } from "./plugin-path";

/** Sorted, de-duplicated, posix-normalized, no leading "./" (matches python normalize_paths). */
function normalizePaths(paths: string[] = []): string[] {
	const set = new Set(paths.map(p => p.trim()).filter(Boolean).map(p => nodePath.posix.normalize(p)));
	return [...set].sort();
}

/** The `model:` pin in agents/<role>.md frontmatter ("" when unreadable); twin of atlas_resolve.py default_model. */
function defaultModel(role: string): string {
	try {
		const head = readFileSync(nodePath.join(pluginRoot(), "agents", `${role}.md`), "utf8").split("\n---")[0];
		return head.split("\n").find(l => l.startsWith("model:"))?.slice(6).trim().replace(/^["']|["']$/g, "") ?? "";
	} catch {
		return "";
	}
}

export function resolve(taskClass: string, effort: string, paths?: string[]): Record<string, unknown> {
	const matrix = JSON.parse(readFileSync(nodePath.join(pluginRoot(), "contracts", "scope-matrix.json"), "utf8"));
	const classes = matrix.classes as Record<string, Record<string, object>>;
	taskClass = matrix.class_aliases?.[taskClass.toLowerCase()] ?? taskClass;
	effort = matrix.effort_aliases?.[effort.toLowerCase()] ?? effort;
	if (!Object.hasOwn(classes, taskClass)) throw new Error(`unknown task_class '${taskClass}'`);
	const cell = classes[taskClass][effort];
	if (!cell) throw new Error(`unknown effort '${effort}'`);
	const team = ((cell as { team: { role: string; model?: string }[] }).team).map(s => ({ ...s, model: s.model || defaultModel(s.role) }));
	return { task_class: taskClass, effort, ...cell, team, file_scope: normalizePaths(paths) };
}
