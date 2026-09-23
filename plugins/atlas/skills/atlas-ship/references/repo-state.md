# Repository state: probe table, exit-code meanings, branch resolution

Every probe is its own argv-form shell call (program + args only). Do not join with `;`, `&&`, `||`, pipes, `$(...)`, or redirects - that syntax parses only under POSIX shells and aborts under Windows PowerShell. Read each command's exit status directly; a non-zero exit is a normal state to interpret, not a failure to suppress.

Run them in order - the existing-PR check needs the branch name from `git branch --show-current`.

| Command | Purpose | Non-zero exit / empty output means |
| --- | --- | --- |
| `git rev-parse --show-toplevel` | Repo root | Not a git repository - report and stop |
| `git status` | Working-tree state (staged, modified, untracked) | Fails only outside a repo |
| `git diff HEAD` | Uncommitted changes | Unborn repo with no commits yet |
| `git branch --show-current` | Current branch (`<branch>`) | Empty output = detached HEAD (handled below) |
| `git log --oneline -10` | Recent commit and PR-title style | Unborn repo - no history yet |
| `git remote -v` | Configured remotes | Empty output = no remote (Step 4 gate does not apply; local commit is the end state) |
| `git rev-parse --abbrev-ref origin/HEAD` | Remote default branch | No `origin/HEAD` set - resolve per below |
| `gh pr list --head <branch> --state open --json number,url,title,body,state,isDraft,headRefName,headRepositoryOwner` | Open PR for this branch (only once `<branch>` is non-empty) | Exit 0 with `[]` = no open PR. Non-zero = `gh` missing, unauthenticated, or offline - PR state is **unknown**, not "none"; re-check before creating |

The device path for PR queries is the `xd://github` device (`repo_view`); the `gh` row above is its fallback. Whatever path queries PR state, the exit-code semantics are identical: only an exit-0 `[]` means "no open PR", and a non-zero result is **unknown**.

Substitute `<branch>` with the current branch, name only. Two traps:

- **Empty branch (detached HEAD):** skip the PR check until after branch creation - an empty `--head` drops the filter and lists unrelated PRs.
- **Fork checkout:** do not pass `<owner>:<branch>` - `gh pr list --head` silently returns `[]` for that syntax, which reads as "no PR" and invites a duplicate. Target the base repo: rely on default resolution, or pass `-R <base-owner>/<repo>`.

Everything here is a snapshot before any action - a hint, not ground truth. Re-verify branch, remote, and PR state immediately before each consequential step (the Step 5 push, the PR create), since they can change between gathering and acting.

## Branch resolution

- **Detached HEAD** - create a feature branch from current HEAD before continuing. Derive the name from the change content (`git checkout -b <branch>`), re-read `git branch --show-current`, and use that result for the rest of the run. Do not ask whether to branch - invoking the ship workflow is already confirmation the work should become branch-backed. If the name exists, pick a non-conflicting suffix or ask only if the conflict cannot be resolved safely.
- **On the default branch with work** (uncommitted, unpushed, or no upstream) - create a feature branch automatically; pushing the default directly is not supported. Continue with the same derivation rule. Do not ask whether to branch.
- **On the default branch with no work** - report that there is nothing to ship and stop.
- **Feature branch** - continue.
- **Unborn repo** (no commits at all) - report and stop; there is no tree to verify or commit.

If the PR check returned a non-empty array, do not blindly take index 0: another contributor's fork can share the branch name (`--head` filters by branch, not `<owner>:<branch>`). Select the entry whose `headRepositoryOwner` and `headRefName` match the current head. One match = use it (note the URL and body). Multiple unresolvable matches = ambiguous: stop and show the candidates rather than act on the wrong PR.

## Default base resolution (priority order)

1. `git rev-parse --abbrev-ref origin/HEAD` (strip the `origin/` prefix).
2. `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'`.
3. Try `main`, `master`, `develop` via `git rev-parse --verify origin/<candidate>`.
4. None resolve - ask the user; never guess a base for the PR.

For a fork checkout, target the base with `-R <base-owner>/<repo>` in `gh` calls, and note the `pr_create` `repo` field on the device path.
