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
- `templates/gitignore.seed` already bakes in the full `docs/` + `.atlas/` allowlist mandated by `docs-ssot.md` (the SSOT for atlas project structure - if any other reference disagrees with it, it wins): `!docs/` + `!docs/**` for the project wiki, a paired `!dir/` + `!dir/**` for every committed `.atlas/` subfolder (`evidence/`, `findings/`, `audits/`, `decisions/`, `archive/`, `understand-anything/`, `graphify/`, `self-improvement/`, `memory/`, `nudge/`) plus `!.atlas/CLAUDE.md` and `!.atlas/AGENTS.md`, and the traversal-enabling `!.atlas` entry the parent-exclusion rule requires. `.atlas/` never contains a `docs/` subdirectory. These are fixed, not project-specific - do not remove or reinvent them; only add the named stack's entries into the "project-specific allowlist entries go here" placeholder.
- `.atlas/.run/` is the one ephemeral subtree: the seed re-excludes it after the allowlist (`.atlas/.run/*`, preceded by the traversal-enabling `!.atlas/.run`) and re-includes only the durable ledger, `!.atlas/.run/findings.json`. Git cannot re-include a file whose parent directory stays excluded, so both traversal-enabling entries above are load-bearing, not decorative.

Do not invent ignore rules for tools that are not in the named stack.

VERIFY before reporting:
- Confirm the deny-all `*` precedes every `!` allow rule.
- Confirm every `!path/` has a paired `!path/**`.
- Confirm secret and env rules sit AFTER the allowlist, so `git check-ignore -v .env` would report the file as ignored.
- Confirm no existing tracked file the user intends to keep would now be ignored: spot-check the allowlist against the named stack's source layout.
- Confirm the `docs-ssot.md` allowlist outcomes hold: `git check-ignore -q docs/CHANGELOG.md` and `git check-ignore -q .atlas/evidence/.gitkeep` both exit 1 (NOT ignored); `git check-ignore -q .atlas/.run/STATE.md` exits 0 (ignored); `git check-ignore -q .atlas/.run/findings.json` exits 1 (NOT ignored). Note `git check-ignore -v` alone is not reliable for this: it can print a matched negation pattern while still exiting 0, so check the plain/`-q` exit code, not just the printed pattern.

REPORT:
- The path to the .gitignore written.
- The exact commands to confirm current state with expected output:
  - `git check-ignore -v .env` -> expected: matched by the secret re-exclusion rule.
  - `git status` -> expected: intended source files still tracked, nothing unexpected staged.

If a required input is missing or ambiguous, ask once for it, then proceed.
