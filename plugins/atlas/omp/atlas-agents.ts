import { readFileSync } from "node:fs";
import * as nodePath from "node:path";

/**
 * Single source of truth for the atlas omp colony worker map.
 *
 * Imported by `gen-agents.ts` (which bakes per-agent `thinkingLevel`/`model`
 * frontmatter into the generated omp-native agent files under `agents/`) and
 * by `index.ts` (which detects atlas-bound task dispatches for the naming
 * notice). Tier map (atlas colony):
 *
 * - off:    explorer, docs-auditor, docs-curator, schema-inventory, naming-glossary-audit, runner
 * - low:    planner, db-prober, ui-runtime-tester
 * - medium: implementer, verifier, completeness-critic, rls-privilege-audit
 *
 * Mechanical tier (Claude `model: haiku`: runner, docs-auditor, schema-inventory, naming-glossary-audit) uses
 * `@atlas-mechanic` with `@smol` as the guaranteed fallback.
 *
 * Roles: judgment agents (verifier, completeness-critic, rls-privilege-audit) run on the `@atlas-verifier` role
 * alias, haiku-pinned agents on `@atlas-mechanic`, the rest on `@atlas-worker`. Role values resolve through `modelRoles.<role>` in the
 * omp config; in omp 18.6.1 an unresolved custom role alias stays a literal
 * token that matches no model while `@smol` still expands, and if nothing
 * resolves `createAgentSession` falls back to the parent's active model. The
 * fallback aliases are still kept so the cheap tier is chosen rather than the
 * parent (see SMOL_FALLBACK_ROLE and ATLAS_DEFAULT_FALLBACK_ROLE).
 */
export const ATLAS_WORKER_ROLE = "@atlas-worker";
export const ATLAS_VERIFIER_ROLE = "@atlas-verifier";
export const ATLAS_MECHANIC_ROLE = "@atlas-mechanic";

export const ATLAS_THINKING_LEVELS: Record<string, "off" | "low" | "medium"> = {
	explorer: "off",
	"docs-auditor": "off",
	"docs-curator": "off",
	"schema-inventory": "off",
	"naming-glossary-audit": "off",
	runner: "off",
	implementer: "medium", // writes code: low effort was the only code-writing agent below medium
	planner: "low",
	"db-prober": "low",
	"ui-runtime-tester": "low",
	verifier: "medium",
	"completeness-critic": "medium",
	"rls-privilege-audit": "medium",
};

/** Agents whose omp tier is the judgment tier (`@atlas-verifier`); every other non-haiku agent is a worker. */
const VERIFIER_AGENTS: Record<string, true> = { verifier: true, "completeness-critic": true, "rls-privilege-audit": true };

/** Role alias for one atlas agent. Claude pins `model: haiku` for the cheap mechanical tier; omp realises it as `@atlas-mechanic`, not only for `runner`. */
export function roleFor(
	agentName: string,
): typeof ATLAS_WORKER_ROLE | typeof ATLAS_VERIFIER_ROLE | typeof ATLAS_MECHANIC_ROLE {
	if (agentName === "runner" || frontmatterModelFor(agentName) === "haiku") return ATLAS_MECHANIC_ROLE;
	return Object.hasOwn(VERIFIER_AGENTS, agentName) ? ATLAS_VERIFIER_ROLE : ATLAS_WORKER_ROLE;
}

/**
 * Cheap fallback role used when `modelRoles.atlas-worker` / `atlas-verifier`
 * are not configured. `@smol` is omp's built-in cheap role, so it resolves
 * even with no user configuration. In omp 18.6.1 an unresolved custom role
 * alias stays a literal token and `@smol` still expands; if nothing resolves,
 * `createAgentSession` falls back to the parent's active model. These ordered
 * lists keep the cheap tier chosen rather than the parent: the role alias
 * first, then a guaranteed-resolvable fallback.
 */

/**
 * Fallback for the `@atlas-worker` tier. `@smol` is omp's built-in cheap
 * role, so it resolves even with no user configuration.
 */
export const SMOL_FALLBACK_ROLE = "@smol";

/**
 * Fallback for the `@atlas-verifier` tier. `@default` is omp's built-in
 * default role (config/model-resolver.ts DEFAULT_MODEL_ROLE): it resolves to
 * `modelRoles.default` — the session's main model — when that is configured,
 * and expands to nothing when it is not. `@smol` follows as the last resort:
 * a cheap verifier beats a verifier that fails to spawn.
 */
export const ATLAS_DEFAULT_FALLBACK_ROLE = "@default";

/** Prioritized `model` list for one atlas agent (frontmatter accepts arrays). */
export function modelPatternsFor(agentName: string): string[] {
	const role = roleFor(agentName);
	if (role === ATLAS_MECHANIC_ROLE) return [ATLAS_MECHANIC_ROLE, SMOL_FALLBACK_ROLE];
	return role === ATLAS_VERIFIER_ROLE
		? [role, ATLAS_DEFAULT_FALLBACK_ROLE, SMOL_FALLBACK_ROLE]
		: [role, SMOL_FALLBACK_ROLE];
}

/**
 * The `model:` value pinned in the Claude-format definition `agents/<name>.md` (e.g. `sonnet`), the representation
 * dispatch_tripwire.py's `_frontmatter_model` reads. "" when the file is unreadable or pins nothing, so callers
 * fail open. Read per call: the files are tiny and the gate runs once per spawn.
 */
export function frontmatterModelFor(agentName: string): string {
	try {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(agentName)) return "";
		const text = readFileSync(nodePath.resolve(import.meta.dir, "..", "agents", `${agentName}.md`), "utf8");
		const lines = text.split(/\r?\n/);
		if (lines[0]?.trim() !== "---") return "";
		for (const line of lines.slice(1)) {
			const stripped = line.trim();
			if (stripped === "---") break;
			if (stripped.startsWith("model:")) return stripped.slice("model:".length).trim().replace(/^['"]|['"]$/g, "");
		}
		return "";
	} catch {
		return "";
	}
}

/**
 * True when `selector` is the parent's live model `live` (both `provider/id`, any case), optionally carrying ONE
 * `:<thinking-level>` suffix on either side. omp injects the parent's selector, with or without its level, when a
 * dispatch passes no `model`; that is the inherited default, never a per-call override. Twin of
 * dispatch_tripwire.py `_inherited_selector`.
 */
export function isInheritedSelector(selector: string, live: string): boolean {
	const a = selector.trim().toLowerCase();
	const b = live.trim().toLowerCase();
	if (a === "" || b === "") return false;
	if (a === b) return true;
	const withLevel = (longer: string, base: string): boolean => {
		if (!longer.startsWith(`${base}:`)) return false;
		const level = longer.slice(base.length + 1);
		return level !== "" && !level.includes(":") && !level.includes("/");
	};
	return withLevel(a, b) || withLevel(b, a);
}

/** Every atlas agent name the omp extension recognizes in task dispatches. */
export const ATLAS_AGENT_NAMES: readonly string[] = Object.keys(ATLAS_THINKING_LEVELS);

/** Static membership lookup for task-dispatch targets (see ts-set-map rule). */
export const ATLAS_AGENT_TARGETABLE: Record<string, true> = Object.fromEntries(
	ATLAS_AGENT_NAMES.map(name => [name, true as const]),
);