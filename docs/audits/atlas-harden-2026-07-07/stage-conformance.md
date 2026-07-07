# Stage: Agent Spec Conformance

Scope: `plugins/atlas/agents/` in the tech-tools repo. Two changes: (1) add a named-field "Report back" section to three audit agents that lacked one, and (2) add explicit grounding rules ("I don't know" is valid, cite a source actually read, unproven gaps stay `[unverified]`) to agents missing them.

Files scheduled for deletion (`ux-cartographer`, `ux-persona`, `ux-fuzzer`, `ux-accuracy-oracle`, `ux-reporter`, `api-usage-map`) were confirmed absent from `plugins/atlas/agents/` before starting - verified with a `test -f` check per name, all six reported "absent."

## 1. Report back sections added (named fields, modeled on explorer.md / verifier.md)

### `agents/naming-glossary-audit.md`
Added at `naming-glossary-audit.md:19` (new section, 7 lines): `file_path`, `rename_count`, `ambiguous_count`, `conflicts`, `unverified`. Modeled on the bullet-list shape in `explorer.md:21-25` and `verifier.md:25-28`, with fields specific to a naming audit (rename map size, ambiguous `user_*` objects, code-vs-db conflicts).

### `agents/rls-privilege-audit.md`
Added at `rls-privilege-audit.md:26` (new section, 5 lines): `file_path`, `counts_by_severity`, `tables_rls_off`, `unverified`. Fields mirror the per-table matrix and ranked-findings output the spec already describes in prose (`rls-privilege-audit.md:20-22`).

### `agents/schema-inventory.md`
Added at `schema-inventory.md:24` (new section, 5 lines): `file_path`, `table_count`/`total_columns`, `tables_rls_disabled`, `unverified`. Fields match the "10 to 20 line summary" the spec already asked for (`schema-inventory.md:22`), now with named fields instead of a parenthetical.

## 2. Grounding rules added

Rule set applied everywhere it was missing: "I don't know" is a valid answer and gets recorded under `unverified`/`[unverified]` with the reason; every claim cites a source actually read (`file:line`, a command/query output, or a doc snippet); unproven gaps are marked `[unverified]` and never filled in.

| File | Status before | What was added | Evidence (file:line) |
|---|---|---|---|
| `completeness-critic.md` | No dedicated grounding section; gap-hunting method existed but didn't say "I don't know" is valid or require a source citation | New `## Grounding` section (3 bullets) | `completeness-critic.md:26-29` |
| `db-prober.md` (partial) | Had "what you could not check" in Report back, but no explicit citation-of-query rule or "I don't know" framing | 2 bullets appended to `## Hard rules` | `db-prober.md:17-18` |
| `docs-auditor.md` (partial) | Already required citing evidence per finding; missing an explicit fourth option when current/stale/missing can't be determined | 1 bullet appended to `## Method` | `docs-auditor.md:23` |
| `docs-curator.md` (partial) | Already required `file:line` citation per entry; missing an explicit "don't fill gaps" rule | 1 bullet appended to `## Method` | `docs-curator.md:15` |
| `explorer.md` (partial) | Already required `file:line` in the report; missing explicit "I don't know" framing for unresolved map pieces | 1 bullet appended to `## Method` | `explorer.md:20` |
| `implementer.md` (partial) | Already said "cite what you relied on" for docs; missing a rule for grounding runtime/verification claims | 1 bullet appended to `## Method` | `implementer.md:22` |
| `planner.md` (partial) | Already had `[UNVERIFIED]` stage marking; missing explicit "ground in what you observed" / "I don't know" wording | 1 bullet appended to `## Method` | `planner.md:17` |
| `rls-privilege-audit.md` (partial) | Already said "mark it UNVERIFIED rather than asserting a violation"; missing the explicit "I don't know is valid" framing | 1 sentence added after the violation-flagging paragraph | `rls-privilege-audit.md:22` |
| `schema-inventory.md` (partial) | Already said "record it as UNVERIFIED with the error text"; missing explicit "I don't know" framing and "never filled in" wording | Sentence extended in place | `schema-inventory.md:20` |
| `ui-runtime-tester.md` (partial) | Already reported "what you couldn't reach and why"; missing an explicit grounding/citation step in the Method numbered list | New step 5 appended to `## Method` | `ui-runtime-tester.md:23` |
| `verifier.md` (partial) | Already had a `needs-evidence` verdict; missing explicit "I don't know is valid" framing for that verdict | 1 sentence appended after the verdict list | `verifier.md:25` |

`naming-glossary-audit.md` was not in the grounding-rules list (task scope), so it received only the Report back section; it already had "mark it UNVERIFIED" language in its existing prose (`naming-glossary-audit.md:13`), which was left untouched.

## Diff summary

```
$ git diff --stat -- plugins/atlas/agents/
 plugins/atlas/agents/completeness-critic.md   | 5 +++++
 plugins/atlas/agents/db-prober.md             | 2 ++
 plugins/atlas/agents/docs-auditor.md          | 1 +
 plugins/atlas/agents/docs-curator.md          | 1 +
 plugins/atlas/agents/explorer.md              | 1 +
 plugins/atlas/agents/implementer.md           | 1 +
 plugins/atlas/agents/naming-glossary-audit.md | 7 +++++++
 plugins/atlas/agents/planner.md               | 1 +
 plugins/atlas/agents/rls-privilege-audit.md   | 8 ++++++++
 plugins/atlas/agents/schema-inventory.md      | 8 +++++++-
 plugins/atlas/agents/ui-runtime-tester.md     | 1 +
 plugins/atlas/agents/verifier.md              | 2 ++
 12 files changed, 37 insertions(+), 1 deletion(-)
```

12 files touched: 11 files from the grounding-rules list (all present as `.md` in the repo) plus `naming-glossary-audit.md` from the Report back list. No files were rewritten; every change is an added section or added bullet(s), matching each file's existing structure and tone. No YAML frontmatter, tool lists, or existing prose were altered.

## Not verified / out of scope

- Did not run the agents to confirm the new sections change actual runtime output - that would require invoking the atlas-engine skill against a live task, which was out of scope for a spec-conformance edit. `[unverified]`
- Did not check the installed plugin cache copies (`~/.claude/plugins/cache/tech-tools/atlas/2.4.0`, `2.5.0`, `2.6.0`) - the task pointed at the repo source, and cache copies are presumably refreshed from a build/publish step outside this change's scope.
