/**
 * Every atlas worker dispatched through omp's `task` tool carries the fixed report schema
 * (contracts/worker-protocol.json -> report.jsonSchema) as its `outputSchema`, in strict mode.
 *
 * One `tool_call` handler revises the `task` input (omp applies a handler's `input` at arg-prep
 * time, before scheduling and approval). Only dispatch items whose `agent` is an atlas agent are touched: an
 * undefined `outputSchema` becomes the report schema; a lead-supplied object schema is merged so it carries every
 * report field too (its own extra fields stay); `schemaMode` is set to "strict" only when absent.
 * The original input is never mutated. Kill switch: ATLAS_WORKER_SCHEMA=off, read per call.
 * Every failure fails open (omp's tool_call dispatch is fail-closed, so a throw would strand the lead) but leaves a
 * hook-faults.jsonl row via recordFault, so a broken contract never disables the guarantee silently.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";

import { ATLAS_AGENT_TARGETABLE } from "./atlas-agents";
import { type ChannelRunner, reviseForChannel } from "./channels";
import { recordFault, taskItems } from "./hook-bridge";

const DEFAULT_CONTRACT = nodePath.resolve(import.meta.dir, "..", "contracts", "worker-protocol.json");

export interface WorkerReportDeps {
	env?: Record<string, string | undefined>;
	/** contracts/worker-protocol.json path. Default: <plugin root>/contracts/worker-protocol.json. */
	contractPath?: string;
	/** Test seam for the atlas_todo.py channel-open call (omp/channels.ts). */
	channelRun?: ChannelRunner;
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

/** Contract paths already reported broken: one fault row per path, not one per dispatch. */
const faulted = new Set<string>();

function loadReportSchema(path: string): Record<string, unknown> | undefined {
	const cached = schemaCache.get(path);
	if (cached) return cached;
	let schema: Record<string, unknown> | undefined;
	let reason = "contract has no report.jsonSchema object";
	try {
		schema = reportSchemaOf(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		reason = String(error);
	}
	if (schema) schemaCache.set(path, schema);
	else if (!faulted.has(path)) {
		faulted.add(path);
		recordFault("worker-report", `report schema not injected: ${reason} (${path})`, "SchemaLoad", undefined);
	}
	return schema;
}

/**
 * The lead's own object schema plus every report field (report definitions win a name clash, own extras and own
 * `required` entries stay). Undefined when it already carries them all or is not an object schema.
 */
function withReportFields(own: unknown, report: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!isSchemaObject(own)) return undefined;
	const ownProps = isSchemaObject(own.properties) ? own.properties : {};
	const reportProps = isSchemaObject(report.properties) ? report.properties : {};
	const ownRequired = Array.isArray(own.required) ? (own.required as string[]) : [];
	const reportRequired = Array.isArray(report.required) ? (report.required as string[]) : [];
	const complete =
		reportRequired.every(key => ownRequired.includes(key)) &&
		Object.keys(reportProps).every(key => JSON.stringify(ownProps[key]) === JSON.stringify(reportProps[key]));
	if (complete) return undefined;
	return { ...own, type: "object", properties: { ...ownProps, ...reportProps }, required: [...new Set([...ownRequired, ...reportRequired])] };
}

/** A revised copy of a `task` input with the report schema on every atlas dispatch item; undefined when nothing changes. */
export function reviseTaskInput(input: Record<string, unknown>, schema: Record<string, unknown>): Record<string, unknown> | undefined {
	const revised = structuredClone(input);
	let changed = false;
	for (const item of taskItems(revised)) {
		const agent = typeof item.agent === "string" ? item.agent.trim() : "";
		if (agent === "" || !Object.hasOwn(ATLAS_AGENT_TARGETABLE, agent)) continue;
		let next: Record<string, unknown> | undefined;
		if (item.outputSchema === undefined) next = structuredClone(schema);
		else {
			next = withReportFields(item.outputSchema, schema);
			if (!next && !isSchemaObject(item.outputSchema)) {
				recordFault("worker-report", `custom outputSchema for ${agent} is not an object schema: report fields not merged`, "SchemaMerge", undefined);
			}
		}
		if (!next) continue;
		item.outputSchema = next;
		if (item.schemaMode === undefined) item.schemaMode = "strict";
		changed = true;
	}
	return changed ? revised : undefined;
}

function schemaEnabled(event: { toolName: string }, deps: WorkerReportDeps): boolean {
	return (deps.env ?? process.env).ATLAS_WORKER_SCHEMA !== "off" && event.toolName === "task";
}

function reviseForEvent(event: { toolName: string; input: unknown }, deps: WorkerReportDeps): Record<string, unknown> | undefined {
	if (!schemaEnabled(event, deps)) return undefined;
	const schema = loadReportSchema(deps.contractPath ?? DEFAULT_CONTRACT);
	return schema ? reviseTaskInput(event.input as Record<string, unknown>, schema) : undefined;
}

type TaskCtx = { cwd?: string; agent?: { kind?: string }; sessionManager?: { getSessionId?: () => unknown } };

/**
 * Registers the `task` dispatch handler (report schema, then the lead's CHANNEL block: omp applies only the last
 * revision, so one handler does both). Exported for tests; index.ts binds real defaults.
 */
export function registerWorkerReport(pi: Pick<ExtensionAPI, "on">, deps: WorkerReportDeps = {}): void {
	pi.on("tool_call", (event, ctx) => {
		let current = event.input as Record<string, unknown> | undefined;
		let revised: Record<string, unknown> | undefined;
		try {
			revised = reviseForEvent(event, deps);
			if (revised) current = revised;
		} catch (error) {
			recordFault("worker-report", String(error), "SchemaInject", undefined);
		}
		try {
			const c = ctx as TaskCtx | undefined;
			if (event.toolName === "task" && current && c?.cwd && c.agent?.kind !== "sub") {
				const sid = c.sessionManager?.getSessionId?.();
				const chan = reviseForChannel(current, { cwd: c.cwd, sessionId: typeof sid === "string" ? sid : undefined, env: deps.env, run: deps.channelRun });
				if (chan) revised = chan;
			}
		} catch (error) {
			recordFault("channels", String(error), "ChannelInject", undefined);
		}
		return revised ? { input: revised } : undefined; // fail open
	});
}
