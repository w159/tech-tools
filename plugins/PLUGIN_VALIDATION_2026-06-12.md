# Plugin Validation Report - 2026-06-12

Scope: every immediate subdirectory of `plugins/` containing `.claude-plugin/plugin.json`.
Helper dirs (`_standards`, `_templates`, `docs`, `prd`, `mcp-servers`, `_REORG*`) excluded.
45 plugins validated.

Do-not-edit plugins (validated, report-only): connectwise-psa, ninjaone-rmm, kaseya-spanning,
paylocity-hr-ops, knowbe4, kaseya-bms, kaseya-vsa, kaseya-datto-bcdr,
kaseya-datto-saas-protection, kaseya-unitrends.

Legend: ok = pass, "-" = none present (not a defect), FIX = fixed this pass.

## Summary table

| Plugin | manifest ok | readme | cmds | skills | agents | issues | fixed |
|---|---|---|---|---|---|---|---|
| auvik | ok | ok | 5 ok | 4 ok | 3 ok | none | - |
| azure-mcp | ok | ok | 2 ok | 3 ok | 1 ok | none | - |
| blumira | ok | ok | 6 ok | 6 ok | 2 ok | broken link ../../CONTRIBUTING.md | - |
| brand-voice | ok | ok | 3 ok | 3 ok | 5 ok | none | - |
| checkpoint-avanan | ok | ok | 5 ok | 5 ok | 2 ok | broken link ../../CONTRIBUTING.md | - |
| cipp | ok | ok | 4 ok | 9 ok | 2 ok | none | - |
| connectwise-automate | ok | ok | 2 ok | 6 ok | 1 ok | broken links ../../CONTRIBUTING.md, ../../LICENSE | - |
| connectwise-psa | ok | ok | 10 ok | 7 ok | 3 ok | broken link ../../CONTRIBUTING.md (do-not-edit) | - |
| cowork-plugin-management | ok | FIX added | - | 2 ok | - | readme was missing | yes |
| customer-support | ok | ok | 5 ok | 5 ok | - | none | - |
| data | ok | ok | 6 ok | 7 ok | - | none | - |
| design | ok | ok | 9 ok | 8 ok | - | none | - |
| engineering | ok | ok | 6 ok | 6 ok | - | none | - |
| enterprise-search | ok | ok | 2 ok | 3 ok | - | none | - |
| finance | ok | ok | 5 ok | 6 ok | - | none | - |
| human-resources | ok | ok | 6 ok | 9 ok | - | none | - |
| immybot | ok | ok | 6 ok | 6 ok | 3 ok | none | - |
| kaseya-autotask | ok | ok | 15 ok | 15 ok | 2 ok | 3 skills missing name; broken link ../../CONTRIBUTING.md | yes (names) |
| kaseya-bms | ok | ok (thin) | 1 ok | 3 ok | - | do-not-edit | - |
| kaseya-datto-bcdr | ok | ok (thin) | 1 ok | 3 ok | - | do-not-edit | - |
| kaseya-datto-rmm | ok | ok | 4 ok | 7 ok | 2 ok | broken links ../../CONTRIBUTING.md, ../../LICENSE | - |
| kaseya-datto-saas-protection | ok | ok (thin) | 1 ok | 3 ok | - | do-not-edit | - |
| kaseya-it-glue | ok | ok | 5 ok | 7 ok | 2 ok | broken link ../../CONTRIBUTING.md | - |
| kaseya-rocketcyber | ok | ok | 2 ok | 5 ok | 2 ok | broken link ../../../CONTRIBUTING.md | - |
| kaseya-spanning | ok | ok (thin) | 2 ok | 5 ok | - | do-not-edit | - |
| kaseya-unitrends | ok | ok (thin) | 1 ok | 3 ok | - | do-not-edit | - |
| kaseya-vsa | ok | ok (thin) | 1 ok | 3 ok | - | do-not-edit | - |
| knowbe4 | ok | ok | 5 ok | 5 ok | 2 ok | broken link ../../CONTRIBUTING.md (do-not-edit) | - |
| m365 | ok | ok | 4 ok | 8 ok | 2 ok | broken Related-Plugins links | yes (links) |
| microsoft-graph | ok | ok | 2 ok | 2 ok | 1 ok | none | - |
| ninjaone-rmm | ok | ok | 4 ok | 5 ok | 2 ok | none (do-not-edit) | - |
| nudge | ok | ok | 1 ok | - | - | none | - |
| operations | ok | ok | 6 ok | 6 ok | - | none | - |
| orchestrate | ok | ok | 1 ok | 1 ok | 5 ok | none | - |
| pandadoc | ok | ok | 5 ok | 5 ok | 2 ok | broken link ../../CONTRIBUTING.md | - |
| pax8 | ok | ok | 4 ok | 6 ok | 2 ok | broken link ../../CONTRIBUTING.md | - |
| paylocity-hr-ops | ok | ok | 2 ok | 4 ok | - | none (do-not-edit) | - |
| pdf-viewer | ok | ok | 4 ok | 1 ok | - | none | - |
| product-management | ok | ok | 1 ok | 8 ok | - | none | - |
| productivity | ok | ok | 2 ok | 2 ok | - | none | - |
| proofpoint | ok | ok | 6 ok | 7 ok | 2 ok | broken link ../../CONTRIBUTING.md | - |
| security-compliance | ok | FIX added | - | 5 ok | - | readme was missing | yes |
| shared-skills | ok | FIX added | 2 ok | 5 ok | - | readme was missing | yes |
| threatlocker | ok | ok | 5 ok | 6 ok | 3 ok | none | - |
| vanta-compliance-ops | ok | FIX added | 2 ok | 4 ok | - | readme was missing | yes |

## Fixes applied

1. plugins/vanta-compliance-ops/README.md - created. House-style README (overview,
   commands, skills, tools, configuration, notes) derived from the manifest and skill
   descriptions.
2. plugins/security-compliance/README.md - created. Cross-vendor (Vanta/KnowBe4/
   ThreatLocker) README describing the 5 bundled skills.
3. plugins/shared-skills/README.md - created. Vendor-agnostic README covering the 2
   commands and 5 skills.
4. plugins/cowork-plugin-management/README.md - created. README covering the 2 plugin-
   authoring skills.
5. plugins/kaseya-autotask/skills/billing/SKILL.md - added missing `name: "Autotask Billing"`
   to frontmatter (description and body unchanged).
6. plugins/kaseya-autotask/skills/picklists/SKILL.md - added missing
   `name: "Autotask Picklists"`.
7. plugins/kaseya-autotask/skills/ticket-notes-attachments/SKILL.md - added missing
   `name: "Autotask Ticket Notes & Attachments"`.
8. plugins/m365/README.md - fixed 2 broken Related-Plugins links (`../autotask/` ->
   `../kaseya-autotask/`, `../itglue/` -> `../kaseya-it-glue/`) and removed the
   `../hudu/` link (no such plugin exists).

## Issues found but NOT fixed (with recommended action)

### Broken repo-root links (pervasive, low risk)

Many plugin READMEs link to `../../CONTRIBUTING.md` and/or `../../LICENSE`, neither of which
exists at the repo root. Affected: blumira, checkpoint-avanan, connectwise-automate,
connectwise-psa (do-not-edit), kaseya-autotask, kaseya-datto-rmm, kaseya-it-glue,
kaseya-rocketcyber (uses `../../../CONTRIBUTING.md`), knowbe4 (do-not-edit), pandadoc, pax8,
proofpoint. connectwise-automate and kaseya-datto-rmm also link a missing `../../LICENSE`.
Recommended action: add a repo-root `CONTRIBUTING.md` and `LICENSE`, or remove these links.
Left unfixed because the correct fix (create root files vs. strip links) is a repo-wide
decision beyond a single plugin, and several occurrences are in do-not-edit plugins. Fixing
them piecemeal would create inconsistency between edited and do-not-edit plugins.

### Skill name vs folder convention (not a defect)

Most skills use a human-readable display `name` (for example `name: "Autotask Tickets"` in
folder `tickets`, `name: "cipp-users"` in folder `users`) that does not match the folder
slug. This is the established house convention and is present in the do-not-edit reference
plugins (connectwise-psa, knowbe4, ninjaone-rmm, kaseya-*). No change made. If a strict
name==folder rule is desired later, it should be applied repo-wide in one pass, including the
do-not-edit plugins, to avoid splitting the convention.

### Thin READMEs in do-not-edit Kaseya scaffolds (report-only)

kaseya-bms, kaseya-datto-bcdr, kaseya-datto-saas-protection, kaseya-unitrends, kaseya-vsa
have short (about 1 KB) READMEs. They are non-trivial - each states scaffolding status,
planned capabilities, and auth - and these plugins are in the do-not-edit list, so no change
was made. Recommended action: expand once the matching MCP servers ship.

### Em dashes / unicode punctuation in existing prose (report-only)

Many existing READMEs and SKILL.md descriptions use em dashes and other non-ASCII
punctuation. This was not normalized because it would require rewriting substantive content
across nearly every plugin (including do-not-edit ones). The new READMEs added this pass use
plain US-keyboard characters only.

## Verification

- plugin.json re-parse: 45 / 45 valid JSON, `name` equals folder name in all 45.
- New READMEs confirmed present: cowork-plugin-management (1027 bytes), security-compliance
  (1785 bytes), shared-skills (1706 bytes), vanta-compliance-ops (2057 bytes).
- 3 edited kaseya-autotask skills now have a `name:` field.
- m365 Related-Plugins links now resolve to existing plugin folders.
- All commands have `description:` frontmatter (0 missing).
- All agents have `name:` and `description:` frontmatter (0 missing).
