# 2026-07-21: Removed atlas-m365 and atlas-vendor-assessment skills

**What:** Deleted `plugins/atlas/skills/atlas-m365/` and `plugins/atlas/skills/atlas-vendor-assessment/` including their SKILL.md and references.

**Why:** Both were auto-trigger skills the user never used. atlas-m365 overlapped with armada's own M365 coverage. atlas-vendor-assessment was a niche security-evaluation skill with no callers.

**Files updated:**
- `plugins/atlas/README.md` — reduced from 16 to 14 task skills, 22 to 20 total
- `plugins/atlas/.claude-plugin/plugin.json` — description updated (22→20 skills, 16→14 task)
- `plugins/atlas/skills/atlas/SKILL.md` — removed from skill listing
- `plugins/atlas/skills/atlas-setup/SKILL.md` — removed from task skill lists, 22→20 count
- `plugins/atlas/skills/atlas-setup/references/manual-vs-auto-map.md` — removed rows, renumbered, updated counts
- `plugins/atlas/skills/atlas-setup/references/skill-routing.md` — removed from menu
- `plugins/atlas/skills/atlas-setup/templates/reference_files/README.md` — removed reference
- `README.md` — removed from skill table

**Total skill count: 20 (2 manual + 18 auto)**
