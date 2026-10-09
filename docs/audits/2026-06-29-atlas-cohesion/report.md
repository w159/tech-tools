# Atlas cohesion audit, 2026-06-29

Consolidated from four parallel read-only audits (graphify scoping, hooks/setup, skill
cohesion, session forensics). Every claim carries file:line or a DB count. This is the
evidence base for the Atlas remediation program. No fixes applied yet.

## Verdict

The instinct ("close, but feels far from cohesive") is correct, and the data explains why.
The suite is not just missing connective tissue. Three compounding failures:

1. The hooks that are supposed to enforce discipline **misfire on ordinary sessions** and
   erode trust (this very session was nagged and is at risk of a blocked Stop).
2. The measurement plane that would tell you Atlas is working is **dark** — dispatch,
   parallel-wave, recall, and verifier metrics read zero/null because the feeding hooks
   were never wired.
3. The skills, commands, and agents are **almost never invoked** — so even correct tools
   produce no value and no signal.

The graph-hub the user asked for is necessary but not sufficient. Fixing the loop without
fixing hooks + instrumentation would ship a cockpit no one trusts and you cannot measure.

## Workstreams

### WS1 — Hook misfires (degrading every session now)

- `dispatch_tripwire.py` nags after 4 inline ops, and on the first edit to any non-`docs/`
  path, with **no notion of whether the session is orchestrating**. The run it keys off is
  started unconditionally for every session (`hooks/session_boot.py:46-47`), so a design
  chat or a quick edit trips it. Gates are only `ATLAS_TRIPWIRE`, an active run (always
  true post-boot), and tool-in-set (`hooks/dispatch_tripwire.py:33,58-63,68-80`).
- `completion_gate.py` **hard-blocks Stop** (`{"decision":"block"}`, `:234`) in any repo
  with a `docs/` dir up to 7 levels up (`:40-54,198-200`) unless `docs/evidence/`,
  a `verified` entry in `docs/.run/findings.json`, and a non-empty `docs/CHANGELOG.md` all
  exist. tech-tools has `docs/`, so a pure audit/Q&A turn gets its first Stop blocked.
- `nudge.py` fires on every SubagentStop (throttled 900s), not context-aware; writes its
  marker into the source tree (`plugins/atlas/.claude/.atlas_nudge`, and a stray copy under
  `scripts/.claude/`). `hooks/__pycache__/` and `scripts/.ruff_cache/` also litter the tree.
- Hook inventory described four inconsistent ways: `plugin.json:4` "8", architect skill
  "seven" (`atlas-architect/SKILL.md:35-38`), `commands/atlas.md:38-39` lists a
  non-existent "read-only SQL guard", and the canonical `hooks-automation.md` documents
  only 4 of 8.

Fix direction: gate both the tripwire and the completion gate on an explicit atlas-run
marker (engine actually started), not on session-boot or mere `docs/` presence. Reconcile
the inventory to the real 8. Keep runtime state out of the source tree.

### WS2 — Instrumentation wiring (sextant measures nothing useful)

- `log_dispatch` is **never wired** to the Agent/Task PostToolUse path, so `dispatches = 0`
  across all 20 trend runs (live-confirmed: the 4 subagents dispatched in this very session
  were almost certainly not recorded). Atlas-engine's whole premise is uninstrumented.
- `recall_hits`/`recall_misses` NULL in 20/20 runs; `verifier_coverage` populated in 1/20.
  The columns exist; nothing writes them.
- `derive_run_metrics` not reliably wired despite the sextant SKILL claiming the ingest hook
  now auto-calls it (doc-vs-reality drift). `finalize_run` called without `wall_clock_s`.
- Session ingest **misclassifies builtins** (`read`, `bash`, `write`) as `kind='skill'`
  with `is_error=1`, polluting the skill-usage and error stats sextant reports on.
- Only `Stop` finalizes the observability run; `SessionEnd` ingests but does not finalize.

Fix direction: wire `log_dispatch` on Agent/Task PostToolUse; write recall/verifier signals;
fix the ingest tool-kind classifier; add SessionEnd finalize.

### WS3 — graphify scoping (the reported bug, reframed)

- The real cause is **whole-monorepo scoping**, not `node_modules`/`.venv`. The engine
  already prunes those (`detect.py:538-558`) and respects `.gitignore`
  (`detect.py:646-651`). Empirically `detect()` on this repo root still returns 15,661
  files / 21.1M words. That trips graphify's `>200 files OR >2M words` gate
  (`skills/graphify/SKILL.md:108-110`), which **stops and waits for the user to pick a
  subfolder** — in a zero-arg automated `atlas-survey` run there is no answer, so it stalls.
  That surfaces as graphify "refusing to run."
- `atlas-survey` invokes graphify zero-arg on the project root (`atlas-survey/SKILL.md:10,
  12,89`), ignoring atlas's own rule that graphify must be run **per codebase root**
  (`atlas-engine/references/scaffolding.md:46`).
- The graphify SKILL hides the engine's real scoping: `--exclude`/`extra_excludes`
  (`detect.py:865`), `.graphifyignore` with `.gitignore` fallback (`detect.py:646-651`),
  and the `_SKIP_DIRS` set. `SKILL.md:85-91` calls `detect(Path('INPUT_PATH'))` without
  forwarding excludes; the Usage block never lists `--exclude`, so passing it does nothing.

Fix direction: scope graphify per codebase root in atlas-survey; expose + forward the
engine's existing excludes in the SKILL; make the size gate auto-scope or hard-fail for
non-interactive callers instead of waiting. The diagnosis to carry forward: scope, not
vendored-dir ignores.

### WS4 — Cohesion loop / the knowledge-graph hub (the original ask)

- `cartographer-<date>/handoffs/<system>.md` and `survey-<date>/handoffs/<finding-id>.md`
  are **producer-only dead-ends**; a repo-wide grep finds no reader
  (`atlas-cartographer/SKILL.md:62-64`, `atlas-survey/SKILL.md:75-81`). They target
  `/atlas-engine`, which **is not even a slash command** (`commands/` has no
  `atlas-engine.md`). The user must copy-paste.
- graphify's interactive HTML/JSON (`graphify-out/`) is **discarded after targeting**; only
  `graph-summary.md` survives (`atlas-survey/SKILL.md:65`). The branded navigable graph the
  user admired is latent but never shipped.
- **No launcher** takes `(audit-run-dir, node/finding-id)` and dispatches the engine. The
  closest, `commands/atlas-handoff.md`, is the opposite direction (a session-resume
  checkpoint) and shares the "handoff" name, a confusion source.

Design (chosen with user): Approach A — overlay findings/handoffs onto the existing
graphify graph by `file:line`, write a manifest pinning actionable markers to nodes, and add
a `/atlas-launch <node-id>` companion skill that reads the manifest + `handoffs/` and
dispatches `atlas-engine`. Depends on WS3 making the graph real per-root.

### WS5 — Adoption / footprint (cross-cutting, investigate not build)

- 7 of 8 skills, 16 of 16 `/atlas*` commands, and 14 of 18 agents have **zero recorded
  invocations** in 12,729 sessions. Only sextant, verifier, explorer see use.
- Memory trio lopsided: context-mode carries the layer (925 calls, 96.1% cache hit);
  claude-mem near-unused and unreliable (9 calls, 44% error); ponytail absent.

Open question, not a build task: why are the entry points never reached — discoverability,
the commands not mapping to felt needs, or breakage on invocation? Worth one investigation
before pruning or doubling down.

## Recommended sequencing

1. **WS1 hooks** — actively harming every session, cheap bug fixes, restores trust.
2. **WS2 instrumentation** — without it you cannot tell whether any later fix worked;
   sextant is the feedback loop for the whole program.
3. **WS3 graphify** — unblocks survey and is the prerequisite for the hub's graph layer.
4. **WS4 hub** — the cohesion payoff, builds on a real per-root graph.
5. **WS5** — investigate adoption alongside, decide prune-vs-promote with data.
