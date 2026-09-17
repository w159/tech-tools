# Atlas Harden 2026-07-07 - Final Report

Audit hub: `docs/audits/atlas-harden-2026-07-07/` (this directory).
Repo: `/Users/jerry/MEGA/Projects/Agentic/tech-tools`. HEAD unchanged throughout at
`4cf8fcc` (2026-07-07 05:28:58 -0400) - confirmed via `git log -1 --format='%H %ci'`
run at report time. **No commits were made by this audit or its remediation stages.**

Note on path resolution: the orchestrating workflow's task strings referenced an
`undefined` directory in several places. There is no literal `undefined` path on disk
(`orient-result.json`, `orientation.md`). Every stage resolved `undefined` to either
this audit directory (for its own report files) or to the repo root
`/Users/jerry/MEGA/Projects/Agentic/tech-tools` (for source edits) and recorded that
resolution inline in its own report file - see `stage-marketplace.md:1-10`,
`stage-removals.md:4-7`, `stage-gitignore.md:1-5`.

---

## 1. Red baseline (pre-remediation)

Captured before any fix was applied. Full JSON: `red-conformance.json`.

- **Dangling references:** 0.
- **Report-back section missing** in 4 agent specs: `agents/api-usage-map.md`,
  `agents/naming-glossary-audit.md`, `agents/rls-privilege-audit.md`,
  `agents/schema-inventory.md`.
- **Hallucination-control language missing** across 16 locations (grounding /
  "I don't know is valid" / citation-required framing absent or incomplete).
- **Hooks:** fail-open behavior and orchestration-marker gating were confirmed
  working even in the red state (this was a verification pass, not a defect) - see
  `hooks_behavioral_summary` in `red-conformance.json`.
- **Marketplace:** `known_marketplaces.json` tracked the stale
  `henssler-financial/tech-tools` fork instead of canonical `w159/tech-tools`
  (`stage-marketplace.md:19`, doctor FAIL lines for `marketplace-source` and
  `clone-remote`).
- **.gitignore:** 3 of 4 required patterns already covered; `**/.in_use/` had no
  re-exclusion after the `!plugins/**` allowlist (`stage-gitignore.md:19-21`).
- **Roster drift:** `plugins/atlas/README.md` claimed 18 subagents against an actual
  count that included 6 agents (5 `ux-*` plus `api-usage-map`) approved for removal
  (`decisions.md:6-9`, `stage-routing.md:24-26`).

---

## 2. Per-stage actions, verdicts, attempts

| Stage | Action | Verdict | Attempts | Evidence |
|---|---|---|---|---|
| **removals** | `git rm` 6 agent specs (5 `ux-*` + `api-usage-map`, guarded per decisions.md item 2); struck all references in README.md, output-styles/atlas-orchestrator.md, atlas-engine/SKILL.md, ux-test-swarm.md (collapsed to pointer), atlas-expedition/references/personas.md; removed empty `plugins/atlas/references/`; deleted untracked caches (`.pytest_cache`, `.ruff_cache`, `scripts/.claude`); attempted revert of `.kimi-plugin/marketplace.json` / `plugins/README.md` (no-op - see deviation, section 4) | **confirmed** | 2 | `stage-removals.md:1-178`; independent re-verification findings in the stage-verdicts input (grep sweep, `git diff` against HEAD, `ls`/`wc -l` counts, `git log -1`) |
| **agent-conformance** | Added named-field Report-back sections to `naming-glossary-audit.md`, `rls-privilege-audit.md`, `schema-inventory.md`; added explicit "I don't know is valid" / citation-required grounding language to all 12 remaining agent specs | **confirmed** | 1 | `stage-conformance.md:1-57`; verifier grep sweep across all 12 files for report-back headings and grounding phrases, `git diff --stat` scoped to exactly `plugins/atlas/agents/`, 37 insertions / 1 deletion across 12 files |
| **routing** | Added 3 new Step 2 rows to `capability-routing.md` (atlas-architect, atlas-engine self-entry, atlas-stacks); annotated 12 built-in/global agent-type mentions with a `*` footnote; confirmed no dangling rows referenced the 6 deleted agents (0 pre-existing hits) | not independently re-verified by a separate stage-verdict pass in this session (no adversarial verifier ran against this stage's output beyond the green-gate G1/G3 checks) | 1 | `stage-routing.md:1-27`; folded into green-gate G1 (102 citations resolve) and G3 (14 commands map correctly) |
| **marketplace** | Ran `atlas_doctor.py --fix`; it rewrote `known_marketplaces.json`'s source URL and reset the marketplace clone's git remote/HEAD to `w159/tech-tools` | **verified HEALTHY**, exit 0 | 1 (automated fixer resolved both failing checks; no manual step needed) | `stage-marketplace.md:37-105`; independent `git -C <clone> remote -v` and `known_marketplaces.json` read confirm both the file and the actual git remote match `w159/tech-tools` |
| **gitignore** | Added a 6-line block re-excluding `**/.in_use/` and `**/.in_use/**` (plus already-redundant restatements of pytest/ruff-cache patterns) in Section 5 of `.gitignore` | verified via `git check-ignore -v` on real materialized directories and `git ls-files` (0 tracked hits for all 4 patterns) | 1 | `stage-gitignore.md:44-119` |

Overall session-level cross-check ("GREEN GATE," 10 gates) ran after all stages:
**verdict = verified, DoD met**, with 2 minor workspace items and 1 documentation
deviation flagged for reconciliation before any commit (see section 3).

---

## 3. Green-gate results (10 gates)

Source: green-gate DoD cross-check supplied to this closing pass.

| Gate | Result | Note |
|---|---|---|
| G1 - references resolve | PASS | 102 citation tokens across skills/ and commands/ all resolve; 0 dangling |
| G2 - agent roster clean | PASS with deviation | All 12 live `atlas:<agent>` refs resolve; `debugger*` correctly annotated as built-in (`capability-routing.md:43`). Plugin proper and CHANGELOG are clean of forbidden names, but `docs/AGENTS.md:4,71,88,89` still mention the 6 removed names as **removal-record prose**, outside the gate's two named exempt zones (`docs/audits/` and CHANGELOG). This is intentional per the docs-curator maintenance model (a removal must be recorded somewhere), not an oversight - flagged below as residue for owner sign-off, not fixed here since I was told not to rewrite AGENTS.md prose I did not author this session. |
| G3 - commands map to engine | PASS | 14 commands resolve via operating-contract + named-skill invocations |
| G4 - hooks.json valid | PASS | Parses; 9 referenced scripts exist and `py_compile` clean; shell guard passes `bash -n` |
| G5 - no live vendor secrets | PASS | Atlas plugin declares 0 MCP connectors; the only scan hit is a synthetic redaction-test fixture (`test_session_ingest.py:89-90`, dummy `sk-abcdef...`/`supersecretvalue` strings used to exercise redaction, not a real credential) |
| G6 - doctor HEALTHY | PASS | Exit 0, `HEALTHY - atlas`, 0 problems (`stage-marketplace.md:76-88`) |
| G7 - agent conformance | PASS | All 12 agents carry Report-back + the 3 hallucination controls (see stage-conformance.md) |
| G8 - standing-consent scope | PASS | Contract language confined to `skills/atlas-engine/` |
| G9 - UX consolidation | PASS | UX routed to atlas-expedition; `ux-test-swarm.md` is a Moved pointer; 0 `ux-*` agent files remain |
| G10 - workspace matches intended change set | PASS with 2 flagged items | See below |

### G10 flagged items (workspace residue, not part of the approved atlas-harden scope)

1. **`.kimi-plugin/import-report.json`** (untracked) - unrelated to the atlas-harden
   change set; appears to be output of a separate Kimi CLI import step. Not created or
   modified by any stage in this audit (`stage-removals.md:172`, `stage-gitignore.md:113`
   both note it as pre-existing/untouched). Left as-is; flagged for the user to decide
   whether to keep, gitignore, or delete.
2. **`.gitignore` `**/.in_use/` addition** - this *was* an approved stage
   (decisions.md item 1: "Write stages 5-13: APPROVED, all of them," and the gitignore
   stage is stage 5-13 scope), so it is in-scope; the green-gate's characterization of
   it as "out of scope" reflects the gate author not having the stage-level decision
   record. I am treating it as in-scope and covered by this audit, not a leftover to
   revert.

---

## 4. Fable-5 residue - stated plainly

Everything below is either `[unverified]` or a known deviation from the literal task
wording. Nothing is glossed over.

1. **`.kimi-plugin/marketplace.json` local-path scheme could not be reverted as
   instructed.** Decision `decisions.md:11` called for rejecting and reverting the
   uncommitted local-relative-path scheme. By the time the removals stage ran, that
   scheme had already been **committed** in `d1be66b` (`feat(marketplace): update
   plugin sources to use local paths instead of GitHub links`, 2026-07-07 05:25),
   which sits between the session-start snapshot (HEAD `82bfb02`) and the current HEAD
   (`4cf8fcc`). `git checkout -- .kimi-plugin/marketplace.json plugins/README.md` was a
   no-op against a clean working tree (`stage-removals.md:111-144`). Undoing it now
   requires `git reset`/`git revert`, which is a commit-producing operation this audit
   is expressly forbidden from performing. **This needs Jerry's explicit decision**:
   revert the commit, leave it, or handle separately.
2. **Secrets committed in git history at `4cf8fcc` are not addressed.**
   `.kimi-plugin/import-plan.json` was flagged by an upstream verifier as containing a
   Magic API_KEY and Plaid client-id/secret at commit time. Reverting the working-tree
   file (which turned out to already be clean, see finding above) does not touch
   history; `git show 4cf8fcc:.kimi-plugin/import-plan.json` would still show whatever
   was committed. This is real exposure outside both this audit's read/verify role and
   the docs-curator's write scope (docs/ only). **Escalate to Jerry for a
   rotate-and-rewrite decision.**
3. **`docs/AGENTS.md` removal-record mentions of the 6 deleted agent names** (lines 4,
   71, 88, 89) are a deliberate documentation choice by this docs-curator pass (see
   section 5) but are flagged by the green-gate G2 as sitting outside its two named
   exempt zones. Recorded here for the owner to confirm the documentation model is
   acceptable.
4. **Routing stage (`capability-routing.md`) was not independently re-verified by a
   dedicated adversarial pass** the way removals and agent-conformance were; it was
   only checked indirectly via green-gate G1/G3. `[unverified]` at the per-stage level,
   though covered at the whole-repo gate level.
5. **`.kimi-plugin/import-report.json`** - contents not inspected in this closing pass
   beyond confirming it predates and is untouched by the harden stages. `[unverified]`
   whether its presence is expected/benign.

---

## 5. docs-curator actions this pass

- **`docs/CHANGELOG.md`** - added an `Unreleased` entry above the existing `Atlas
  v2.6.0` entry summarizing the removals, routing additions, agent-spec conformance
  work, marketplace repoint, and gitignore hardening, each with `file:line` citations.
  Plugin version was **not** bumped (release decision left to Jerry, per the task).
- **`docs/ROADMAP.md`** - not touched. Read the relevant stage evidence first; none of
  the shipped changes map to an existing ROADMAP line item, and no new follow-up
  surfaced that qualifies as a roadmap-level (as opposed to audit-residue-level) item
  beyond what is already captured in section 4 above.
- **`docs/AGENTS.md`** - left as the implementer/removals-stage author wrote it
  (removal-record prose for the 6 deleted agents, corrected 12-agent count). This
  docs-curator pass did not further edit `docs/AGENTS.md` because the shipped change
  (agent deletion + roster correction) was already reflected there by the removals
  stage, and the instructions here are to update only what the shipped change
  requires - the file already matches the shipped state accurately per the earlier
  verifier pass (`stage-verdicts.removals` finding 1).
- **`docs/audits/atlas-harden-2026-07-07/red-conformance.json`** - written this pass
  (section 1 source).
- **`docs/audits/atlas-harden-2026-07-07/final-report.md`** - this file.
- **Knowledge graph:** searched the repo for `graphify-out/graph.json`. One exists at
  `mcp_servers/auvik-mcp/graphify-out/graph.json`, which belongs to an unrelated MCP
  server and was not touched by any atlas-harden change (all edits were under
  `plugins/atlas/`, `.gitignore`, `docs/AGENTS.md`). No graphify regen was performed
  since the shipped change did not touch that graph's source tree. No atlas-scoped
  graphify output was found under `plugins/atlas/`.

---

## 6. How to re-run this audit

1. Re-run orientation: read `orientation.md` and `orient-result.json` in this
   directory for the original discovery pass.
2. Re-run individual stages via the workflow scripts under the session's scratchpad
   directory (session-specific, not part of this repo) that produced
   `stage-removals.md`, `stage-conformance.md`, `stage-routing.md`,
   `stage-marketplace.md`, `stage-gitignore.md` - each stage file documents its own
   exact commands and is independently reproducible against this repo at HEAD
   `4cf8fcc`.
3. Re-run the health check directly: `python3 plugins/atlas/scripts/atlas_doctor.py`
   from repo root (expect `HEALTHY - atlas`, exit 0, per `stage-marketplace.md:76-88`).
4. Re-run the grep sweep for forbidden names:
   `grep -rn 'ux-cartographer\|ux-persona\|ux-fuzzer\|ux-accuracy-oracle\|ux-reporter\|api-usage-map' plugins/atlas/`
   (expect 0 hits in plugin-proper files; `docs/AGENTS.md` will show removal-record
   prose hits by design, per section 5).
5. This audit directory (`docs/audits/atlas-harden-2026-07-07/`) is the single source
   of truth for what was checked and how; no other location holds this session's
   verification evidence.
