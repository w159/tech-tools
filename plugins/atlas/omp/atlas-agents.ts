/**
 * Single source of truth for the atlas omp colony worker map.
 *
 * Imported by `gen-agents.ts` (which bakes per-agent `thinkingLevel`/`model`
 * frontmatter into the generated omp-native agent files under `agents/`) and
 * by `index.ts` (which detects atlas-bound task dispatches for the naming
 * notice). User-approved map (atlas 8.4.0 colony):
 *
 * - off:    explorer, docs-auditor, docs-curator, schema-inventory, naming-glossary-audit
 * - low:    implementer, planner, db-prober, ui-runtime-tester
 * - medium: verifier, completeness-critic, rls-privilege-audit
 *
 * Roles: off/low agents run on the `@atlas-worker` role alias, medium agents
 * on `@atlas-verifier`. Role values resolve through `modelRoles.<role>` in the
 * omp config; an unconfigured custom role resolves to zero model patterns and
 * the subagent fails with "No model selected", so every tier carries a
 * guaranteed-resolvable fallback alias (see SMOL_FALLBACK_ROLE and
 * ATLAS_DEFAULT_FALLBACK_ROLE).
 */
export const ATLAS_WORKER_ROLE = "@atlas-worker";
export const ATLAS_VERIFIER_ROLE = "@atlas-verifier";

export const ATLAS_THINKING_LEVELS: Record<string, "off" | "low" | "medium"> = {
 explorer: "off",
 "docs-auditor": "off",
 "docs-curator": "off",
 "schema-inventory": "off",
 "naming-glossary-audit": "off",
 implementer: "low",
 planner: "low",
 "db-prober": "low",
 "ui-runtime-tester": "low",
 verifier: "medium",
 "completeness-critic": "medium",
 "rls-privilege-audit": "medium",
};

/** Role alias for one atlas agent, derived from its thinking tier. */
export function roleFor(agentName: string): typeof ATLAS_WORKER_ROLE | typeof ATLAS_VERIFIER_ROLE {
 return ATLAS_THINKING_LEVELS[agentName] === "medium" ? ATLAS_VERIFIER_ROLE : ATLAS_WORKER_ROLE;
}

/**
 * Cheap fallback role used when `modelRoles.atlas-worker` / `atlas-verifier`
 * are not configured. `@smol` is omp's built-in cheap role, so it resolves
 * even with no user configuration. Empirically (omp 18.4.9), an unconfigured
 * custom role makes the spawned subagent fail with "No model selected" —
 * there is NO automatic fall back to the parent model — hence these ordered
 * lists: the role alias first, then a guaranteed-resolvable fallback.
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
 return ATLAS_THINKING_LEVELS[agentName] === "medium"
  ? [roleFor(agentName), ATLAS_DEFAULT_FALLBACK_ROLE, SMOL_FALLBACK_ROLE]
  : [roleFor(agentName), SMOL_FALLBACK_ROLE];
}

/** Every atlas agent name the omp extension recognizes in task dispatches. */
export const ATLAS_AGENT_NAMES: readonly string[] = Object.keys(ATLAS_THINKING_LEVELS);

/** Static membership lookup for task-dispatch targets (see ts-set-map rule). */
export const ATLAS_AGENT_TARGETABLE: Record<string, true> = Object.fromEntries(
 ATLAS_AGENT_NAMES.map(name => [name, true as const]),
);