---
name: atlas-gitignore
description: 'Generate a zero-trust, deny-by-default .gitignore for a named stack: allowlist intended paths, re-exclude secrets last. Use when starting or hardening a repo.'
when_to_use: starting or hardening a repo with a zero-trust, deny-by-default .gitignore
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
paths: [".gitignore"]
argument-hint:
- languages/frameworks/package managers/build tools/OS/editors
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Generate a zero-trust .gitignore for this stack: $ARGUMENTS

Seed the file from `templates/gitignore.seed` (the deny-all-then-allowlist
skeleton) and add the project-specific allowlist entries in section 3.
After writing, validate the structure:
`bash "${CLAUDE_SKILL_DIR}/scripts/validate_gitignore.sh" .gitignore`
exits 0 if valid, 1 with a reason if not.

Read the arguments as the stack to cover: languages, frameworks, package managers, build tools, OS, and editors. If the stack list is missing something you need to decide a rule, ask once, then proceed.

Output the .gitignore file only. No prose outside the file.

The file must:
- Open with a comment block stating the philosophy: deny everything by default, then allowlist intentionally. Each un-ignored path is there on purpose.
- Start with `*` to ignore all, then re-include the directories and files that should be tracked using `!` rules. Walk down each tracked tree explicitly: every `!path/` is paired with a `!path/**`. A bare `!path/` without `!path/**` does not work, since git will not recurse into an ignored parent.
- Carry an inline comment on each allow or deny rule explaining why it exists.
- Cover the named stack's build output, dependency directories, caches, OS cruft, and editor files.
- Re-exclude secrets and env files AFTER the allowlist so a later broad include cannot leak them. Re-include only the safe templates (for example `!.env.example`).
- Account for cloud or synced-drive artifacts generically (for example `*.nosync*` patterns) only if the stack mentions a synced or cloud-backed drive.
- If the project keeps a `docs/` tree, atlas maintains it as the documentation SSOT, so allowlist the SSOT subtree explicitly: `!docs/` plus `!docs/*.md` and the durable subfolders (architecture/, features/, specs/, lessons/, wiki/, plans/, reference_files/), each a paired `!dir/` + `!dir/**`. NEVER use a blanket `!docs/**`: vendored doc-site clones under docs/ carry their own nested .git and must stay ignored, so also re-exclude `docs/**/.git/` as belt-and-suspenders. `.atlas/` (never `.atlas/docs/`) holds atlas's own internal state: allowlist `!.atlas/evidence/` + `!.atlas/evidence/**` and `!docs/audits/` + `!docs/audits/**`, then re-exclude the ephemeral `.atlas/.run/` after the allowlist (except `!.atlas/.run/findings.json`, the durable verification ledger).

Do not invent ignore rules for tools that are not in the named stack.

VERIFY before reporting:
- Confirm the deny-all `*` precedes every `!` allow rule.
- Confirm every `!path/` has a paired `!path/**`.
- Confirm secret and env rules sit AFTER the allowlist, so `git check-ignore -v .env` would report the file as ignored.
- Confirm no existing tracked file the user intends to keep would now be ignored: spot-check the allowlist against the named stack's source layout.
- If `docs/` is tracked, confirm `git check-ignore docs/CHANGELOG.md` reports it NOT ignored while a vendored clone like `docs/<tool>/` stays ignored.

REPORT:
- The path to the .gitignore written.
- The exact commands to confirm current state with expected output:
  - `git check-ignore -v .env` -> expected: matched by the secret re-exclusion rule.
  - `git status` -> expected: intended source files still tracked, nothing unexpected staged.

If a required input is missing or ambiguous, ask once for it, then proceed.
