# Skill provenance

Lineage notes moved out of SKILL.md bodies so skills read as instructions, not history.
Reference files under each skill may still carry their own source notes.

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
