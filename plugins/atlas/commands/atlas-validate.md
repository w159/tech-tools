---
description: 'Audit a Claude Code plugin for structural correctness, manifest validity, and content quality; reports findings with file:line evidence and a pass/fail per check without auto-applying destructive fixes.'
argument-hint: "[plugin name or path (default: plugin in current working directory)]"
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-engine/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-engine/references/operating-contract.md` and apply it before proceeding.

# /atlas-validate

Validate the plugin described in `$ARGUMENTS` (a plugin name or a path to a plugin directory). If the argument is missing or ambiguous, resolve the plugin from the current working directory. If neither resolves unambiguously, ask once, then proceed.

## 1. Resolve the target

- Accept a plugin name (e.g. `atlas`) or a path (relative or absolute) as `$ARGUMENTS`.
- If `$ARGUMENTS` is empty, treat the current working directory as the plugin root.
- Confirm the resolved path before running any checks. If the path does not exist, report the error immediately and stop.
- Note the plugin root for all subsequent checks; use `${CLAUDE_PLUGIN_ROOT}` only for Atlas-internal references, not as the target path.

## 2. Structural and manifest checks (plugin-dev:plugin-validator)

Dispatch `plugin-dev:plugin-validator` over the resolved plugin root. Instruct it to check and return findings on:

- `plugin.json` presence and valid JSON.
- Required fields: `name`, `description`, `version` (semantic version present and well-formed), and any fields the Claude Code plugin spec requires.
- `name` field value matches the plugin directory name (lowercase, hyphen-separated).
- `agents`, `commands`, and `skills` arrays: every listed path resolves to a real file or directory on disk. Flag any path that does not exist as a broken reference.
- No stale cross-references: if a command or skill file references another asset by path, confirm that asset exists.
- `keywords` array (if present): all entries are lowercase hyphenated strings.
- `README.md` present at the plugin root.

Collect every finding as: check name, result (PASS / FAIL / WARN), and the specific `file:line` or path evidence.

## 3. Skill quality checks (plugin-dev:skill-reviewer)

For each skill listed under `skills` in the plugin manifest (and any skill found under a `skills/` subdirectory), dispatch `plugin-dev:skill-reviewer`. Instruct it to check each skill's `SKILL.md` for:

- Frontmatter present and parseable.
- `name` field: lowercase, hyphenated, matches the folder name, 64-character maximum.
- `description` field: present, wrapped in single quotes, between 10 and 1024 characters.
- Bundled asset files referenced in the SKILL.md actually exist in the skill folder.
- No single asset file exceeds 5 MB.

Collect findings in the same format: check name, result, `file:line` evidence.

## 4. Content quality checks

Perform these directly (no subagent required):

- **ASCII-only**: scan all `.md`, `.json`, and `.sh` files in the plugin for non-ASCII characters (em dash U+2014, en dash U+2013, curly quotes U+2018/U+2019/U+201C/U+201D, ellipsis U+2026). Report any hit as FAIL with `file:line:column` and the offending character codepoint.
- **Version present**: confirm a version string matching semver (e.g. `1.0.0`) appears in `plugin.json`. FAIL if absent or malformed.
- **Frontmatter on command files**: every `.md` file under a `commands/` directory must have YAML frontmatter with a non-empty `description` field. FAIL any file missing either.
- **Frontmatter on agent files**: every `.md` file under an `agents/` directory must have YAML frontmatter with non-empty `description` and `name` fields. FAIL any file missing either.

## 5. Report findings

Present a consolidated report organized by check category. For each check:

- Check name
- Result: PASS, FAIL, or WARN
- Evidence: the exact `file:line` (or path) that supports the result

Then print a summary:

```
Checks run:   <total>
Passed:       <n>
Warnings:     <n>
Failed:       <n>
Overall:      PASS / FAIL
```

The overall result is PASS only when zero checks are FAIL. WARNs do not block a PASS verdict.

## 6. Proposed fixes (no auto-apply)

For every FAIL, propose the specific minimal fix: the field to add, the character to replace, the path to create, or the value to correct. Do not write, move, or delete any file automatically. Present each fix as a discrete, copy-pasteable action.

## VERIFY (evidence required)

Do not state the plugin is valid without showing the actual check output. The report section above IS the verification evidence. Every PASS must cite the file or field it read. Claims of correctness without a traced source are not acceptable.

## REPORT

After completing all checks, confirm:

- The resolved plugin path that was audited.
- The subagents dispatched (plugin-dev:plugin-validator, plugin-dev:skill-reviewer) and what they covered.
- The consolidated findings table.
- The summary counts and overall verdict.
- Any check that could not be completed (e.g. a referenced asset was inaccessible) and why, so the user knows the audit boundary.

If a required input is missing or ambiguous, ask once for it, then proceed.
