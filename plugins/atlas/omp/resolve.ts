/**
 * Deterministic subagent scope resolver. Same data (contracts/scope-matrix.json) and
 * semantics as scripts/atlas_resolve.py: (task_class, effort) -> team shape.
 */
import * as nodePath from "node:path";
import { readFileSync } from "node:fs";

const MATRIX = nodePath.resolve(import.meta.dir, "..", "contracts", "scope-matrix.json");

/** Sorted, de-duplicated, posix-normalized, no leading "./" (matches python normalize_paths). */
function normalizePaths(paths: string[] = []): string[] {
	const set = new Set(paths.map(p => p.trim()).filter(Boolean).map(p => nodePath.posix.normalize(p)));
	return [...set].sort();
}

export function resolve(taskClass: string, effort: string, paths?: string[]): Record<string, unknown> {
	const matrix = JSON.parse(readFileSync(MATRIX, "utf8"));
	const classes = matrix.classes as Record<string, Record<string, object>>;
	taskClass = matrix.class_aliases?.[taskClass.toLowerCase()] ?? taskClass;
	effort = matrix.effort_aliases?.[effort.toLowerCase()] ?? effort;
	if (!Object.hasOwn(classes, taskClass)) throw new Error(`unknown task_class '${taskClass}'`);
	const cell = classes[taskClass][effort];
	if (!cell) throw new Error(`unknown effort '${effort}'`);
	return { task_class: taskClass, effort, ...cell, file_scope: normalizePaths(paths) };
}
