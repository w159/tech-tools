/**
 * Worker output-token budget for omp subagent sessions.
 *
 * Worker sessions requested 131072 output tokens and OpenRouter answered HTTP 402
 * ("can only afford 29951"). Atlas workers return bounded reports, so every
 * provider request issued from a subagent session has its output-token field
 * lowered to ATLAS_WORKER_MAX_TOKENS (default 32000).
 *
 * The payload is the provider-shaped body object each pi-ai transport hands to
 * `onPayload` (the same object omp then serializes), so the field depends on the
 * transport:
 *   - anthropic-messages ........ `max_tokens`
 *   - openai-completions ........ `max_tokens` | `max_completion_tokens` (per model compat)
 *   - openai-responses .......... `max_output_tokens`
 *   - ollama-chat ............... `options.num_predict`
 * Only an existing numeric field above the cap is lowered; nothing is ever raised,
 * added, or created. Unknown payloads pass through untouched. Fail open.
 */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export const ATLAS_WORKER_MAX_TOKENS_DEFAULT = 32000;

export interface WorkerBudgetDeps {
	env?: Record<string, string | undefined>;
}

const TOP_LEVEL_FIELDS = ["max_tokens", "max_completion_tokens", "max_output_tokens"] as const;

/** Positive integer from ATLAS_WORKER_MAX_TOKENS; anything else falls back to the default. */
function workerCap(env: Record<string, string | undefined>): number {
	const raw = env.ATLAS_WORKER_MAX_TOKENS?.trim() ?? "";
	if (!/^\d+$/.test(raw)) return ATLAS_WORKER_MAX_TOKENS_DEFAULT;
	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : ATLAS_WORKER_MAX_TOKENS_DEFAULT;
}

/** Canonical plain-object guard for this extension package (no runtime dependency on omp internals). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const exceeds = (value: unknown, cap: number): value is number =>
	typeof value === "number" && Number.isFinite(value) && value > cap;

/** Lower every over-cap output-token field in place; true when anything changed. */
function clampPayload(payload: Record<string, unknown>, cap: number): boolean {
	let changed = false;
	const thinking = payload.thinking;
	const budget = isRecord(thinking) ? thinking.budget_tokens : undefined;
	for (const field of TOP_LEVEL_FIELDS) {
		if (!exceeds(payload[field], cap)) continue;
		// Anthropic requires max_tokens > thinking.budget_tokens: lowering under the
		// budget would trade a 402 for a guaranteed 400, so that request is left alone.
		if (field === "max_tokens" && typeof budget === "number" && budget >= cap) continue;
		payload[field] = cap;
		changed = true;
	}
	const options = payload.options;
	if (isRecord(options) && exceeds(options.num_predict, cap)) {
		options.num_predict = cap;
		changed = true;
	}
	return changed;
}

export function registerWorkerBudget(pi: Pick<ExtensionAPI, "on">, deps: WorkerBudgetDeps = {}): void {
	pi.on("before_provider_request", (event, ctx) => {
		try {
			if (ctx.agent.kind !== "sub" || !isRecord(event.payload)) return undefined;
			const cap = workerCap(deps.env ?? process.env);
			// Per omp://extensions.md the replacement is the payload itself, not `{ payload }`.
			return clampPayload(event.payload, cap) ? event.payload : undefined;
		} catch {
			return undefined; // fail open
		}
	});
}
