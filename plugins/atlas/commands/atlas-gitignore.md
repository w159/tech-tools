---
description: Generate a zero-trust deny-by-default .gitignore for a named stack, allowlisting only intended paths and re-excluding secrets last; use when starting a repo or hardening one against leaked credentials.
argument-hint: [languages/frameworks/package managers/build tools/OS/editors]
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-engine/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-engine/references/operating-contract.md` and apply it before proceeding.

Generate a zero-trust .gitignore for this stack: $ARGUMENTS

Read the arguments as the stack to cover: languages, frameworks, package managers, build tools, OS, and editors. If the stack list is missing something you need to decide a rule, ask once, then proceed.

Output the .gitignore file only. No prose outside the file.

The file must:
- Open with a comment block stating the philosophy: deny everything by default, then allowlist intentionally. Each un-ignored path is there on purpose.
- Start with `*` to ignore all, then re-include the directories and files that should be tracked using `!` rules. Walk down each tracked tree explicitly: every `!path/` is paired with a `!path/**`. A bare `!path/` without `!path/**` does not work, since git will not recurse into an ignored parent.
- Carry an inline comment on each allow or deny rule explaining why it exists.
- Cover the named stack's build output, dependency directories, caches, OS cruft, and editor files.
- Re-exclude secrets and env files AFTER the allowlist so a later broad include cannot leak them. Re-include only the safe templates (for example `!.env.example`).
- Account for cloud or synced-drive artifacts generically (for example `*.nosync*` patterns) only if the stack mentions a synced or cloud-backed drive.

Do not invent ignore rules for tools that are not in the named stack.

VERIFY before reporting:
- Confirm the deny-all `*` precedes every `!` allow rule.
- Confirm every `!path/` has a paired `!path/**`.
- Confirm secret and env rules sit AFTER the allowlist, so `git check-ignore -v .env` would report the file as ignored.
- Confirm no existing tracked file the user intends to keep would now be ignored: spot-check the allowlist against the named stack's source layout.

REPORT:
- The path to the .gitignore written.
- The exact commands to confirm current state with expected output:
  - `git check-ignore -v .env` -> expected: matched by the secret re-exclusion rule.
  - `git status` -> expected: intended source files still tracked, nothing unexpected staged.

If a required input is missing or ambiguous, ask once for it, then proceed.
