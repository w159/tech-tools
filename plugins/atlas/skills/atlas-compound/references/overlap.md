# Overlap Check

Ported from CE `ce-compound` (`references/research.md` + `references/assembly.md` in w159/compound-engineering-plugin): a qualifying existing learning that became inaccurate or incomplete is UPDATED, never duplicated.

## Search roots

Check BOTH atlas learning trees - they are one logical corpus in two trees:

1. `docs/lessons/**` - the project wiki's lessons tree (this skill's primary write target, via docs-curator).
2. `.atlas/findings/**` - the curator-distilled durable findings ledger.

(Full mode may additionally probe claude-mem for a recent session that hit the same problem - see `references/eligibility.md`.)

## Finding candidates (grep-first, do not read everything)

- Extract work-context keywords from the lesson being captured: module names, error strings, technical terms, component names.
- Search candidate frontmatter fields first: `title`, `tags`, `module`, `problem_type`, `applies_when`, and bug fields (`symptoms`, `root_cause`) where relevant.
- Fewer than three candidates? Broaden to full-content search across both trees. More than 25 candidates? Narrow again to the strongest frontmatter hits.
- Read only the first ~30 lines (frontmatter + opening) of each candidate; fully read only strong/moderate matches.

## Five overlap dimensions

Score each candidate 0-5 across:

1. **Problem statement** - is it about the same failure/need?
2. **Root cause** - same underlying technical cause?
3. **Solution approach** - same class of fix?
4. **Referenced files** - does it cite the same files/modules?
5. **Prevention rules** - does it prescribe the same guardrail/practice?

## Verdicts

| Score | Action |
|---|---|
| **High (4-5)** | UPDATE the existing file in place. Keep its filename and path exactly (even if it predates some convention - never normalize unrelated legacy shape). Bump/insert `last_updated: YYYY-MM-DD` in frontmatter. Merge the new detail into the existing sections the learning genuinely improves; leave accurate sections untouched. Add the new symptom/cause to `symptoms`/`root_cause` if distinct. |
| **Moderate (2-3)** | CREATE a new lesson normally. In your report, note that a targeted consolidation of the new file with the moderate-overlap file is worth a future `atlas:docs-curator` pass (do not consolidate inline - one learning per invocation). |
| **Low/none (0-1)** | CREATE normally. |

On a high-overlap update, the target path is the EXISTING file (even if its name is legacy undated or otherwise non-conforming - preserve it; the date-first convention applies to newly created files only). The docs-curator dispatch in `SKILL.md` Phase 6 carries the update instructions verbatim.

## Do not duplicate `.atlas/findings/` vs `docs/lessons/`

The two trees serve different retrieval loops: `.atlas/findings/` is the "avoid re-introducing this bug" ledger read before non-trivial work; `docs/lessons/` is the project wiki's gotchas-and-patterns corpus. If a high-overlap match exists in `.atlas/findings/` but the new lesson adds wiki-worthy guidance (prevention practice, when-to-apply), update the findings entry AND let the new knowledge-track lesson stand in `docs/lessons/` - citing each other in `Related Issues`/`Related`. Never let one tree silently shadow the other; both must stay truthful.