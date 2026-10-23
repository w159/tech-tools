# Skill provenance

Lineage notes moved out of SKILL.md bodies so skills read as instructions, not history.
Source notes for reference files are listed at the end of this file.

- **atlas-autopilot**: atlas-autopilot is the consent-gated equivalent of Compound Engineering's lfg; lfg auto-pushes and auto-opens PRs, atlas-autopilot never does.
- **atlas-brainstorm**: Grounding replaces Compound Engineering's bespoke scout script with atlas:explorer; dialogue rules derive from ce-brainstorm.
- **atlas-compound**: Schema, templates, overlap and grounding rules are adopted from Compound Engineering's ce-compound; CE's per-run review.json/metadata.json state is not ported.
- **atlas-doctor**: REFRESH phase and measurement-first gate fold two compound-engineering skills: ce-compound-refresh (learning-store maintenance) and ce-retune (measurement-first retuning of the skill corpus).
- **atlas-explain**: Merges Compound Engineering's ce-explain and wtf into one skill: both are read-only questions about existing things; CE's split was a naming convention, not a mechanism difference.
- **atlas-optimize**: Ports Compound Engineering's ce-optimize (spec-YAML optimization runtime with four phases, parallel experiment worktrees, judge-scored variants, decide.mjs accept/revert engine); atlas keeps the measurement-first discipline, the clean-tree gate, the parity rule and the report-non-improvement rule, and drops the machinery.
- **atlas-plan**: Ports Compound Engineering's ce-plan; ce-doc-review is replaced by atlas:completeness-critic, and CE's solutions corpus and pack resolver by atlas's lessons store and atlas_packs.py.
- **atlas-proof**: Ports Compound Engineering's ce-proof (publish and annotate markdown through a hosted collaborative editor over a bespoke HTTP/agent API); generalized to native surfaces. Boundaries section derives from CE's credential and delete rules.
- **atlas-simplify**: Ported from Compound Engineering's ce-simplify-code; adapted to atlas dispatch, verification and artifact conventions.
- **atlas-worktree**: Mechanics port from Compound Engineering's ce-worktree; CE's 'prefer the harness's native worktree tool and stop' does not port, atlas uses the .atlas/.run/worktrees.json ledger instead.

## Reference files

- **atlas-compound/references**: grounding.md follows ce-compound's grounding-validation reference and validate-doc-claims.py semantics; overlap.md follows ce-compound's research and assembly references; schema.md (bug-track backward compatibility) and eligibility.md (one lesson per invocation) follow ce-compound.
- **atlas-plan/references**: units.md follows ce-plan's structure reference, hardened against atlas's execution model; plan-sections.md follows ce-plan's plan-sections reference; handoff.md follows ce-plan's final-review and plan-handoff references, with ce-doc-review replaced by atlas:completeness-critic and the ce-work handoff replaced by atlas-orchestrate; intake.md follows ce-plan's intake reference; research.md follows ce-plan's research reference and the learnings-researcher algorithm, retargeted from docs/solutions to docs/lessons and .atlas/findings and from CE's pack resolver to atlas_packs.py; tracer-slices.md is adapted from Matt Pocock's to-tickets skill.
- **atlas-bakeoff/references**: peer-dispatch.md contrasts with Compound Engineering's ce-pov panel, which shells out to external CLIs (codex, cursor, grok-cli) and checks served-model identity receipts; atlas does neither.
- **Other reference-file notes**: atlas-compound templates.md is ce-compound's resolution template with category mapped to docs/lessons and date-first filenames; schema.md adopts ce-compound's schema.yaml and yaml-schema.md under the same mapping; eligibility.md follows ce-compound's SKILL.md and guide; atlas-plan research.md keeps CE's grep-first retrieval shape; atlas-bakeoff keeps CE's rules that a warm verdict never opens a panel, that a failed peer yields a solo verdict plus an availability note, and that the panel receives an immutable repo-state scope; its verdict-protocol.md replaces CE's scout script with atlas:explorer and uses CE's 0/25/50/75/100 confidence anchors and grading scale.
