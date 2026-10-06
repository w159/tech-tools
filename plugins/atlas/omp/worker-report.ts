/**
 * Every atlas worker dispatched through omp's `task` tool carries the fixed report schema
 * (contracts/worker-protocol.json -> report.jsonSchema) as its `outputSchema`, in strict mode.
 *
 * One `tool_call` handler revises the `task` input (omp applies a handler's `input` at arg-prep
 * time, before scheduling and approval). Only dispatch items whose `agent` is an atlas agent and
 * whose `outputSchema` is undefined are touched; `schemaMode` is set to "strict" only when absent.
 * The original input is never mutated. Kill switch: ATLAS_WORKER_SCHEMA=off, read per call.
 * Every failure fails open: omp's tool_call dispatch is fail-closed, so a throw would strand the lead.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";

import { ATLAS_AGENT_TARGETABLE } from "./atlas-agents";
import { taskItems } from "./hook-bridge";

const DEFAULT_CONTRACT = nodePath.resolve(import.meta.dir, "..", "contracts", "worker-protocol.json");

export interface WorkerReportDeps {
	env?: Record<string, string | undefined>;
	/** contracts/worker-protocol.json path. Default: <plugin root>/contracts/worker-protocol.json. */
	contractPath?: string;
}

const schemaCache = new Map<string, Record<string, unknown>>();

type Json = { report?: { jsonSchema?: unknown } | null } | null;

function isSchemaObject(schema: unknown): schema is Record<string, unknown> {
	return !!schema && typeof schema === "object" && !Array.isArray(schema);
}

function reportSchemaOf(parsed: unknown): Record<string, unknown> | undefined {
	const schema = (parsed as Json)?.report?.jsonSchema; // parsed contract JSON; every hop is optional-chained
	return isSchemaObject(schema) ? schema : undefined;
}

function loadReportSchema(path: string): Record<string, unknown> | undefined {
	const cached = schemaCache.get(path);
	if (cached) return cached;
	let schema: Record<string, unknown> | undefined;
	try {
		schema = reportSchemaOf(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return undefined;
	}
	if (schema) schemaCache.set(path, schema);
	return schema;
}

function needsSchema(item: Record<string, unknown>): boolean {
	const agent = typeof item.agent === "string" ? item.agent.trim() : "";
	return agent !== "" && Object.hasOwn(ATLAS_AGENT_TARGETABLE, agent) && item.outputSchema === undefined;
}

/** A revised copy of a `task` input with the report schema on every atlas dispatch item lacking one; undefined when nothing changes. */
export function reviseTaskInput(input: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> | undefined {
	const revised = structuredClone(input);
	const pending = taskItems(revised).filter(needsSchema);
	for (const item of pending) {
		item.outputSchema = structuredClone(schema);
		if (item.schemaMode === undefined) item.schemaMode = "strict";
	}
	return pending.length > 0 ? revised : undefined;
}

function schemaEnabled(event: { toolName: string }, deps: WorkerReportDeps): boolean {
	return (deps.env ?? process.env).ATLAS_WORKER_SCHEMA !== "off" && event.toolName === "task";
}

function reviseForEvent(event: { toolName: string; input: unknown }, deps: WorkerReportDeps): Record<string, unknown> | undefined {
	if (!schemaEnabled(event, deps)) return undefined;
	const schema = loadReportSchema(deps.contractPath ?? DEFAULT_CONTRACT);
	return schema ? reviseTaskInput(event.input as Record<string, unknown>, schema) : undefined;
}

/** Registers the `task` dispatch handler. Exported for tests; index.ts binds real defaults. */
export function registerWorkerReport(pi: Pick<ExtensionAPI, "on">, deps: WorkerReportDeps = {}): void {
	pi.on("tool_call", event => {
		try {
			const revised = reviseForEvent(event, deps);
			return revised ? { input: revised } : undefined;
		} catch {
			return undefined; // fail open
		}
	});
}
