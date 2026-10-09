# Squad And Tiers

Load from atlas-orchestrate when the matching trigger fires. Content is authoritative for the skill.

Model/effort tiers and squad

## Model and effort tiers (cost-tiered routing)

**Opus is the orchestrator's tier, not a subagent's.** A subagent works from a spec you already
wrote: the decomposition, the success criteria, and the evidence bar are decided here, before
dispatch. Sonnet is the ceiling for every `atlas:*` companion. If a subagent needs opus to do its
job, the real defect is an underspecified prompt - fix the prompt, not the model.

| Tier | Use for | Set via |
|---|---|---|
| **haiku** | read-only discovery, symbol sweeps, catalog dumps, drift and naming audits, running lint/format, mechanical edits | `atlas:runner` (mechanical edits from exact steps), `atlas:schema-inventory`, `atlas:docs-auditor`, `atlas:naming-glossary-audit`, `Agent(model:"haiku")` |
| **sonnet** | implementation, verification, planning, DB probing, docs curation - every other subagent | default and ceiling for `atlas:*`; drop a role to haiku the moment its job is read-and-report |
| **opus** | you, the orchestrator: hard architecture, cross-cutting judgment, final synthesis | the main thread only |

Effort follows the same logic. `effort` is agent frontmatter (`low` \| `medium` \| `high` \| `xhigh`,
or an integer); it is the only reasoning-depth lever for a subagent (there is no `thinking`
frontmatter key).

| Effort | Use for | Agents |
|---|---|---|
| **low** | executing a clear spec: mapping, implementing, cataloguing, curating, running a gate, running exact steps | `runner`, `explorer`, `planner`, `implementer`, `docs-auditor`, `docs-curator`, `db-prober`, `ui-runtime-tester`, `schema-inventory`, `naming-glossary-audit` |
| **medium** | rendering an independent verdict against evidence you did not hand them | `verifier`, `completeness-critic`, `rls-privilege-audit` |

Raising a subagent's effort is a last resort after the prompt has been tightened and still fails.

**Every agent carries a `color:`** so a dispatch is identifiable at a glance in the
terminal, grouped by role family: cyan = read-only discovery (`explorer`,
`schema-inventory`), blue = planning (`planner`), green = writes code
(`implementer`), purple = writes docs (`docs-curator`), pink = live runtime testing
(`ui-runtime-tester`), yellow/orange = read-only probing and audit (`db-prober`,
`docs-auditor`, `rls-privilege-audit`, `naming-glossary-audit`), red = adversarial
verdict (`verifier`, `completeness-critic`). The palette is Claude Code's eight -
`red blue green yellow purple orange pink cyan` - and it is a closed set: the
frontmatter value is a key into the CLI's own color map, so anything else misses
the map and renders uncolored. `test_atlas_contract.py` fails on a missing or
off-palette value.

## Mechanical tier: `atlas:runner`

`atlas:runner` is the cheap mechanical executor (13 `atlas:*` agents ship in total). It does not design, investigate or decide: it runs numbered steps exactly as written, records each command and its real output, and stops on anything unexpected.

- **Model/effort:** Claude Code `model: haiku`, `effort: low`. On omp the roles are `[@atlas-mechanic, @smol]` with thinking off.
- **Fit:** at most 7 steps on at most 5 named files. Anything larger or needing a judgment call goes to `implementer` (standard tier) or `verifier`/audit agents (judgment tier).
- **Dispatch:** besides the five required spec blocks, a runner dispatch MUST carry a `STEPS:` block (required and capped by `dispatch_tripwire.py`).
- **Report:** like every atlas worker it returns the `REPORT:` container (`STATUS`, `STEPS`, `FILES_CHANGED`, `EVIDENCE`, `DELIVERABLE`, `NEXT`; `STATUS` is DONE, FAILED or BLOCKED). See `references/subagent-kit.md`.
- **Source of truth:** `plugins/atlas/contracts/worker-protocol.json` and `plugins/atlas/agents/runner.md`.




## Your squad

Dispatch constantly. Three complementary sets:

- **Orchestrator companions** (carry this skill's discipline): `atlas:explorer` (read-only mapping), `atlas:implementer` (one bounded change), `atlas:verifier` (adversarial confirmation), `atlas:db-prober` (read-only DB), `atlas:ui-runtime-tester` (live frontend behavior), `atlas:planner` (multi-stage decomposition + stage maps), `atlas:docs-curator` (maintains docs/ SSOT; writes only under `docs/`), `atlas:docs-auditor` (audits docs/ for drift against code), `atlas:completeness-critic` ("what did we miss" gap pass before done).
- **Atlas meta-skills** (broader-scope orchestration companions): `atlas-loop` (loop-library matcher; recurring/iterative work), `atlas-setup` (onboarding, install, connectors, repair), `atlas-audit` (code/security audit swarm; architecture map; atlas self-telemetry from the observability DB), `atlas-ux-test` (UX runtime swarm; app-discovering).
- **Domain specialists already installed** (route here for depth): `backend-architect`, `frontend-developer`, `security-engineer`, `debugger`, `devops-automator`, `code-reviewer`, `test-engineer`, `test-executor`, `secondary-expert-validator`, `codebase-explorer`. Plus built-ins `Explore`/`Plan`/`general-purpose`.

**Fork history-heavy dispatches instead of re-explaining.** `planner`, `completeness-critic`, `docs-curator`, and synthesis dispatches SHOULD use `subagent_type: "fork"` (cheap, inherits this session's history) - `atlas:verifier` and `atlas:explorer` must NEVER fork (they need fresh, uncontaminated context). See `references/subagent-kit.md`.

`references/capability-routing.md` maps task signals -> the right agent + skill + MCP + model.

This skill ships as part of the **atlas plugin**: the `atlas:*` companions live in the plugin's top-level `agents/` directory (`plugins/atlas/agents/`) and are auto-discovered by Claude Code; 17 hook programs / 21 bindings ship (16 under `hooks/`, plus `atlas_doctor.py` physically under `scripts/`) and all auto-load via `hooks/hooks.json` on install (no manual step).


