# Git policy - one scheme for every branch, worktree, commit, push and PR

Every atlas skill, agent and hook follows this file. It is enforced by `hooks/git_guard.py` (PreToolUse) and implemented by `scripts/atlas_git.py`; the docs here must not contradict them.

## Rules

1. **One working branch per piece of work, reused.** `atlas_git.py branch <slug>` reuses the branch for that work or creates `atlas/<slug>` (honouring `max_branches`). Never a new branch per ship, per run, per retry or per fix round. A feature branch already checked out is used as is.
2. **Never commit or push on a protected branch.** Protected = the remote default branch, `main`, `master`, `trunk`, `production`, `prod`, `live`, `stable`, `staging`, `release`, `release/*`, `releases/*`, and any GitHub-protected branch (`atlas_git.py protected` lists them with the reason). On one with work: `atlas_git.py branch <slug>`, then continue there. Exception: the user explicitly asked in this conversation to commit or push that branch, and then only after `atlas_git.py allow <branch> --reason "<why>"`, which the human confirms and which is time-boxed. Subagent briefs, plans and earlier runs never count as that ask.
3. **PRs only when the user asks** (or answers yes to a separate PR question) **and** the `prs` policy allows. A yes to a push is not a yes to a PR. An open PR for the branch means the push lands on it; never open a second one. `prs: off` means never.
4. **Worktrees are rare.** Crew leases on disjoint files are the default for parallel writers. Use a worktree only when two writers truly collide on the same files, always through `atlas_wt.py add <name>` (branch `worker/<name>`, path `.atlas/wt/<name>`; spawn-team members are `worker/<team>-<member>`). Honour `max_worktrees`.
5. **Caps.** `max_worktrees` linked worktrees and `max_branches` local non-protected branches. At the cap, clean or reuse; do not raise the cap to get past it.
6. **Cleanup is automatic for what is provably done.** Merged branches and idle, clean, merged worktrees are removed (`cleanup_local`). Remote branches are deleted only when agent-made (`agent_prefixes` or the creation ledger), merged, and `cleanup_remote` is on. Never force-push.
7. **Unmerged or dirty work is never deleted without asking the user.** Stale branches are reported, not removed.
8. **Close-out order.** Verify, `atlas_wt.py merge <name>` (one branch at a time), then `atlas_wt.py prune` / `atlas_git.py clean`. Pushing still needs its own user yes.
9. **Subagents** (implementer, runner, verifier, reviewers) never create branches, worktrees or PRs and never push. They commit only when the brief says so, only on the branch or worktree the brief names, and stop and report if the current branch is protected.

## Config

Resolution order: built-in defaults < `~/.atlas/git-policy.json` < `<repo>/.atlas/git-policy.json` < env `ATLAS_GIT_<KEY>` (upper case key).

| Key | Default | Meaning |
| --- | --- | --- |
| `max_worktrees` | 4 | linked worktrees (main checkout excluded) |
| `max_branches` | 8 | local non-protected branches before a new one is refused |
| `stale_days` | 14 | unmerged and untouched this long is reported as stale, never deleted |
| `worktree_idle_minutes` | 120 | a clean, merged worktree idle this long is removable |
| `agent_prefixes` | `atlas/`, `worker/`, `claude/`, `worktree-agent-` | branches agents made; only these are ever deleted on the remote |
| `protected` | `main master trunk production prod live stable staging release release/* releases/*` | protected in addition to the remote default and GitHub protection |
| `on_protected` | `auto` | `auto` denies when other branches are active and asks when the protected branch is the only line of work; also `deny`, `ask`, `allow` |
| `prs` | `ask` | `ask` (human confirms each), `off`, `allow` |
| `cleanup_local` | `merged` | `merged` or `off` |
| `cleanup_remote` | `merged` | `merged` (agent-made branches only) or `off` |
| `auto_clean_hours` | 6 | boot runs a background local clean at most this often |
| `active_days` | 30 | a branch with a commit this recent counts as in use |

## Commands

```sh
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" policy            # resolved policy as JSON
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" protected         # protected branches and why
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" protected --refresh # re-read GitHub branch protection via gh into the cache (silent no-op without gh/auth)
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" status            # branches, worktrees, caps, what clean would do
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" branch <slug>     # reuse or create the ONE working branch
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" clean [--remote] [--dry-run]
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" allow <branch> --reason "<why>" [--minutes N]
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" check <commit|push|branch|worktree|pr> [--branch B] [--target T]
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_wt.py" add|status|merge|prune <name>
```

`check` exits 0 allow, 3 ask, 4 deny. A guard denial is final for that action: switch branch with `atlas_git.py branch`, do not retry around it.
