# Learning Frontmatter Schema

Adopted verbatim from CE `ce-compound`'s `references/schema.yaml` + `references/yaml-schema.md` (w159/compound-engineering-plugin), with two atlas adaptations: the target tree is atlas's EXISTING `docs/lessons/<category>/` (never CE's `docs/solutions/`), and new filenames use atlas's date-first convention `<YYYY-MM-DD>-<slug>.md` (enforced by `${CLAUDE_PLUGIN_ROOT}/scripts/lint_docs_names.py`), never CE's undated slug-only name.

## Shared required fields (both tracks)

| Field | Type | Rules |
|---|---|---|
| `title` | string | Clear problem title; must match the H1 |
| `date` | string | `YYYY-MM-DD` |
| `category` | string | The `docs/lessons/` subdirectory (see corpus-first below) |
| `module` | string | Module or area affected |
| `problem_type` | enum | Determines the track (below) |
| `component` | string | Open vocabulary, corpus-first (below) |
| `severity` | enum | `critical` \| `high` \| `medium` \| `low` |

## problem_type enum -> track

- **Bug track:** `build_error`, `test_failure`, `runtime_error`, `performance_issue`, `database_issue`, `security_issue`, `ui_bug`, `integration_issue`, `logic_error`
- **Knowledge track:** `best_practice`, `documentation_gap`, `workflow_issue`, `developer_experience`, `architecture_pattern`, `design_pattern`, `tooling_decision`, `convention`

Prefer the narrowest applicable value; `best_practice` is the knowledge-track fallback.

## Track-specific fields

Bug track REQUIRED:

| Field | Type | Rules |
|---|---|---|
| `symptoms` | array[string] | 1-5 observable symptoms |
| `root_cause` | string | Open vocabulary, corpus-first, matched by the CAUSE itself. Suggested fallbacks (lowercase, underscore-separated): `wrong_api`, `data_integrity`, `concurrency`, `async_timing`, `memory_leak`, `config_error`, `logic_error`, `test_isolation`, `missing_validation`, `missing_permission`, `missing_workflow_step`, `inadequate_documentation`, `missing_tooling`, `incomplete_setup` |
| `resolution_type` | enum | `code_fix` \| `migration` \| `config_change` \| `test_fix` \| `dependency_update` \| `environment_setup` \| `workflow_improvement` \| `documentation_update` \| `tooling_addition` \| `seed_data_update` |

Knowledge track: no additional required fields. Optional: `applies_when` (array, max 5), plus optional `symptoms`/`root_cause`/`resolution_type` when a specific cause exists.

## Optional fields (both tracks)

`related_components` (array), `tags` (array, max 8, lowercase hyphen-separated), `framework_version` (bug track only, e.g. `"node 22.4.0"`), and on updates: `last_updated: YYYY-MM-DD` (inserted/bumped by the overlap rule in `references/overlap.md`).

## Corpus-first vocabulary

Do not coin vocabulary the corpus already uses:

- **category:** reuse an existing `docs/lessons/` subdirectory name covering the area (most-used spelling when existing dirs disagree). Only when the corpus is empty or uncovered, fall back to the schema mapping: `runtime_error` -> `runtime-errors`, `architecture_pattern` -> `architecture-patterns`, `workflow_issue` -> `workflow-issues`, `best_practice` -> `best-practices`, etc. docs-curator creates the subdirectory on demand per the docs-ssot.
- **component:** matched by AREA - the value existing corpus frontmatter uses for that area, most-used spelling; the suggested fallbacks only when no doc covers the area.
- **root_cause:** matched by CAUSE, not by module - same corpus-first rule.

## Filename (new lessons only)

`docs/lessons/<category>/<YYYY-MM-DD>-<slug>.md`

- `<date>` = today (the canonical creation date).
- `<slug>` = sanitized problem slug: lowercase; replace every character outside `a-z 0-9 . _ -` (removing the Windows-reserved set `< > : " / \ | ? *`, spaces, control chars) with a single `-`; collapse repeats; trim leading/trailing `-` and `.`; never empty or Windows-reserved (`con`, `nul`, ...).
- Updates never rename: a high-overlap update keeps the existing file's name, however it was spelled.

## YAML safety

Array-of-string frontmatter items (`symptoms`, `applies_when`, `tags`, `related_components`, or any future array field) MUST be wrapped in double quotes when the value starts with a YAML reserved indicator (`` ` ``, `[`, `*`, `&`, `!`, `|`, `>`, `%`, `@`, `?`) or contains the substring `: ` - otherwise strict YAML parsers reject the file.

## Validation checklist (run before dispatch)

- Track determined from `problem_type`; all shared required fields present.
- Bug track: `symptoms` (1-5), `root_cause`, `resolution_type` present. Knowledge track: nothing beyond shared fields is required.
- Enum fields (`problem_type`, `severity`, `resolution_type`) match allowed values exactly.
- `date` matches `YYYY-MM-DD`; `framework_version` only on bug track; `tags` lowercase hyphen-separated; array lengths respected.
- `title` matches the H1.

Backward compatibility (ported from CE): bug-track fields found on existing knowledge-track docs are harmless legacy - do not strip them unless rewriting the doc for other reasons.