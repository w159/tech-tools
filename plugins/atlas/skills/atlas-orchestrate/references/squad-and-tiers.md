# Squad And Tiers

Load from atlas-orchestrate when the matching trigger fires. Content is authoritative for the skill.

Model/effort tiers and squad

## Model and effort tiers (cost-tiered routing)

**Opus is the orchestrator's tier.** A subagent works from a spec you already wrote, so it runs on
the cheapest tier that can do the job. The tier table is `agents/<role>.md` frontmatter
(`model`, `effort`, `tier_allow`, `effort_allow`), mirrored per seat in `contracts/scope-matrix.json`.
**Never guess a model: copy the model the resolver emits** (`atlas_resolve.py <class> <effort>`, one
`model` per seat) into the Agent call. Opus is allowed only for roles whose `tier_allow` lists it and
only where the matrix cell says so; the lead stays opus.

| Tier | Use for | Roles (default model) |
|---|---|---|
| **haiku** | scan, list, read, count, run a fixed command, catalog dumps, drift and naming audits, read-and-map | `runner`, `schema-inventory`, `naming-glossary-audit`, `docs-auditor`, `explorer` |
| **sonnet** | judgment: implementation, verification, planning, DB probing, docs curation, tests | `db-prober`, `ui-runtime-tester`, `docs-curator`, `implementer`, `test-engineer`, `verifier`, `completeness-critic`, `rls-privilege-audit`, `planner` |
| **opus** | you, the orchestrator; a subagent only where `tier_allow` lists it (`implementer`, `verifier`, `completeness-critic`, `rls-privilege-audit`, `planner`) and the matrix says so | the main thread, or a matrix cell |

Effort is agent frontmatter (`low` \| `medium` \| `high`); the matrix seat effort must equal it. The
design's "none" (thinking off) is `low` in Claude Code and `off` on omp (omp maps none/low to `off`,
medium/high to `low`).

| Effort | Use for | Agents |
|---|---|---|
| **low** | executing a clear spec: mapping, cataloguing, curating, running exact steps | `runner`, `explorer`, `docs-auditor`, `docs-curator`, `db-prober`, `ui-runtime-tester`, `schema-inventory`, `naming-glossary-audit` |
| **medium** | writing code or rendering an independent verdict against evidence you did not hand them | `implementer`, `test-engineer`, `verifier`, `completeness-critic`, `rls-privilege-audit` |
| **high** | whole-codebase or cross-harness design | `planner` |

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

- **Model/effort:** Claude Code `model: haiku`, `effort: low` (`tier_allow: [haiku, sonnet]`). On omp the roles are `[@atlas-mechanic, @smol]` with thinking off.
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

This skill ships as part of the **atlas plugin**: the `atlas:*` companions live in the plugin's top-level `agents/` directory (`plugins/atlas/agents/`) and are auto-discovered by Claude Code; 17 hook programs / 22 bindings ship (16 under `hooks/`, plus `atlas_doctor.py` physically under `scripts/`) and all auto-load via `hooks/hooks.json` on install (no manual step).



## Deterministic team shape (scope matrix)

`contracts/scope-matrix.json` maps `(task_class, effort)` to team (role, count, effort, tools profile), isolation and max_parallel. `scripts/atlas_resolve.py <class> <effort> [--paths a,b]` and `omp/resolve.ts` read it identically. Every `atlas:*` dispatch prompt carries `SCOPE: <class>/<effort>`; the tripwire denies one without it and one whose role is outside the resolved team (roles the matrix never names, e.g. `runner`, need only the line). `ATLAS_SCOPE_GATE=off` downgrades both to advisories. `atlas_mux.py spawn-team` sizes a tmux team from the same matrix.

Tier source of truth: role effort in the matrix equals `agents/<role>.md` frontmatter. The seat `model` must be in the role's `tier_allow`; `test_atlas_contract.py` (`TierTableContract`) fails on drift between frontmatter, matrix and this doc. `rls-privilege-audit` is in the `db-audit` class, not plain `audit`.
