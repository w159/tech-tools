---
name: atlas-commit
description: Create one well-scoped local git commit from a set of changed files (explicit list or the current diff) with a conventional-style message grounded in the real diff. Stages exactly the intended files, commits locally only, never pushes.
when_to_use: commit changed files locally with a grounded message
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<file list, or omit for the current diff>'
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Create a well-crafted LOCAL commit from the given changed files (explicit `$ARGUMENTS` list, or the current diff if no files were named). No push, no PR — anything beyond a local commit is `atlas-ship`'s job; state that when reporting if the user seems to want more.

**Done when:** the intended changes are committed with an explicit file list and a message that states the outcome, and `git status` is clean of those changes. **Stop when:** the tree is clean — nothing to commit.

## Context

Gather context with each command as its **own** shell tool call (program + args only). Do not join with `;`, `&&`, `||`, pipes, `$(...)`, or redirects — that syntax fails under Windows PowerShell. A non-zero exit is a normal state to interpret, not a failure to suppress.

| Command | Purpose | Non-zero / empty means |
| --- | --- | --- |
| `git status` | Working-tree state | Not a git repo — stop |
| `git diff HEAD` | Uncommitted changes | Unborn repo / no commits yet |
| `git branch --show-current` | Current branch | Empty = detached HEAD |
| `git log --oneline -10` | Recent message style | Unborn repo — no history |

Treat this as a snapshot. Re-read the branch and the staged set immediately before committing if anything may have changed.

## Workflow

1. **Nothing to commit** — if `git status` shows no staged, modified, or untracked files, report that and stop. Do not use `git diff HEAD` alone as the cleanliness check (it misses untracked files).

2. **Ground the message** — read the actual diff of the files being committed (`git diff HEAD -- <files>`), never a generic summary. The subject must be derivable from what changed. Do not invent content the diff does not support.

3. **Convention** — match project commit conventions already in context; else match the recent log pattern; else conventional commits (`type(scope): description`). When conventional commits apply and both `fix` and `feat` fit, default to `fix:` (remedying broken or missing behavior); reserve `feat:` for new capabilities. User override wins.

4. **Scope** — one logical change per commit. If the changed files clearly split into distinct concerns, make separate commits (file level only, 2–3 max, no `git add -p`). If ambiguous, one commit.

5. **Message** — subject is imperative and names the outcome (what is now possible or fixed), not the file list. Body only when motivation or trade-offs are not obvious from the subject. When a plan Implementation Unit ID is already in hand for this commit (conversation, caller, or the files belong to one unit), append it in parentheses — `(U3)` means unit 3. Do not hunt for a plan. Omit when the commit spans units, the unit is unclear, or no plan is in hand.

   - Bad: `Update checkout.rb` / `Add tests and fix stuff`
   - Good: `Fix double-submit on checkout`
   - Good: `Add per-subscription mute (U3)`

6. **Stage and commit** — stage **named files only**; NEVER `git add -A` or `git add .` unless the user explicitly asked to commit everything. Honor any `exclude:<paths>` in the invocation: those files stay uncommitted no matter what else changed; say in the report that they were left out.

   Write the full message — subject line, blank line, optional body — to a file outside the repo with your file-write tool, then stage and commit as two calls per commit group:

```bash
git add file1 file2 file3
```

```bash
git commit -F <message-file> -- file1 file2 file3
```

   No shell parses the message with `-F`: `$`, quotes, backticks, or a multi-line body pass through literally under any shell. Git's normal whitespace cleanup (trailing spaces trimmed, blank-line runs collapsed) still applies, which is fine. The trailing path list on `git commit` is required: a bare `git commit` takes the whole index, so anything already staged before this run — an `exclude:` path, or work the user staged and did not name — would ride into the commit. Naming the paths commits exactly the group and leaves other index entries alone.

7. **Confirm** — `git status`; report hash(es) and subject(s). Remind: this skill never pushes; run `atlas-ship` for anything beyond a local commit.

## Boundary

atlas-commit owns: staging named files, message authorship, and the local commit itself.

Out of scope: pushing, PRs, merging, remote branches (`atlas-ship`), and branch strategy beyond committing — if detached HEAD or on the default branch, stop and surface that to the user rather than silently creating a branch or committing to `main`.
