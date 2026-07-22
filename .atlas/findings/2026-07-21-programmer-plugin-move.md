# 2026-07-21: Moved the programmer (Pragmatic Programmer) plugin into the atlas marketplace

**What:** Moved the standalone `pragmatic-programmer` plugin (source:
`~/Downloads/pragmatic-programmer/plugin`) into the `atlas` marketplace as a
new plugin named `programmer`, at `plugins/programmer/`, with skills
namespaced `tpp-*` (The Pragmatic Programmer). The original standalone copy
was left intact (additive copy).

**Why:** Consolidate the auditor into the same marketplace catalog atlas and
armada already ship from, so it installs alongside them without a second
marketplace source.

**Renames applied:**
- Plugin manifest `name`: `pragmatic-programmer` -> `programmer` (added
  `repository`, `homepage`, `license: MIT`).
- Skill dirs + `name:` frontmatter: `pragmatic-audit` -> `tpp-audit`;
  `pragmatic-principles` -> `tpp-principles`.
- Agent file + `name:` frontmatter: `pragmatic-auditor` -> `tpp-auditor`.
- Report default file: `.pragmatic-audit-report.md` -> `.tpp-audit-report.md`
  (SKILL.md + `.gitignore`).
- Hook pointer line: `Pragmatic Programmer relevant:` -> `TPP relevant:`
  (hooks.json, 2 occurrences).
- Internal path cross-refs updated in `agents/tpp-auditor.md`,
  `skills/tpp-audit/SKILL.md`, `skills/tpp-audit/references/dimensions.md`,
  `README.md`, and `LICENSE`.
- `.claude-plugin/marketplace.json`: version `3.0.0` -> `3.1.0`; added
  `programmer` entry (`source: ./plugins/programmer`,
  `category: developer-tools`) after `armada`.

**Root cause of the one verifier catch:** the mover's own grep excluded
`/references/concepts/` paths to cut noise, which accidentally hid a real
stale reference at `LICENSE:3` (`skills/pragmatic-principles/references/concepts/`).
Fixed to `skills/tpp-principles/references/concepts/`.

**Verification:** two independent `atlas:verifier` (fresh) passes. Pass 1
REFUTED on the `LICENSE:3` stale reference, CONFIRMED on the other 8 points.
Pass 2, after the fix, CONFIRMED all 9 points. Static checks: full-tree grep
for `pragmatic-audit|pragmatic-principles|pragmatic-auditor` -> 0 hits;
`plugin.json`/`hooks.json`/`marketplace.json` all parse; marketplace
`plugins=['atlas','armada','programmer']`, version `3.1.0`; 89 concept
reference files preserved. Full evidence:
`.atlas/evidence/2026-07-21-programmer-plugin-move.md`.

**Result:** `programmer` plugin (v0.1.0) ships in the unified catalog:
2 skills (`tpp-audit`, `tpp-principles`), 1 agent (`tpp-auditor`), 1
UserPromptSubmit hook, 89-concept glossary. Independent of atlas's own
orchestration engine.
