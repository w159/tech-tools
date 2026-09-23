---
name: atlas-worktree
description: Atlas's portable git-worktree primitive — create a detached or branched linked worktree for isolated experimental/parallel work, discover and reuse an active one from the run ledger instead of creating duplicates, and tear it down with dirty-state protection. Use when preparing worktree isolation for parallel implementer waves, spikes, or bakeoffs, or when closing worktrees out at wave end.
when_to_use: worktree isolation for parallel waves, spikes, or bakeoffs; discovering or reusing an active worktree; closing out worktrees at run end
allowed-tools: Read, Glob, Grep, Bash, Write
---

# atlas-worktree — atlas's portable worktree primitive

**This skill is atlas's own self-contained, host-portable worktree-isolation mechanism.** Atlas
cannot assume any external or harness-specific worktree skill is available on every host it runs
on, so every worktree mechanic atlas needs lives here. It is referenced by name from the
implementation-units reference of `atlas-orchestrate` (parallel implementer waves) and from the
other skills that need an isolated tree this session (`atlas-simplify`, `atlas-review`'s
`apply:local` path, `atlas-prototype`, `atlas-bakeoff` spikes). Callers invoke this skill by name;
they do not reimplement worktree commands, naming, or cleanup inline.

Mechanics and safety rules port from Compound Engineering's `ce-worktree`: isolation detection,
one-branch-one-worktree, naming discipline, non-fatal fetch, and refuse-on-failure. CE's
"prefer the harness's native worktree tool and stop" does not port — atlas replaces it with the
`.atlas/.run/worktrees.json` ledger, which is what lets sibling skills discover and reuse a tree
instead of creating duplicates the harness cannot see.

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Ledger: `.atlas/.run/worktrees.json`

Every worktree this skill creates is recorded in `.atlas/.run/worktrees.json` (ephemeral run state
per the docs SSOT; `.atlas/.run/` is gitignored). The ledger is the discovery surface for
atlas-orchestrate and every sibling skill — read it before creating anything.

```json
{
  "worktrees": [
    {
      "id": "S2-U1",
      "path": ".worktrees/s2-u1-auth-retry",
      "branch": "atlas/s2-u1-auth-retry",
      "head_sha": "abc1234",
      "base_branch": "main",
      "base_sha": "def5678",
      "created": "2026-09-23",
      "purpose": "implementer wave unit S2-U1",
      "status": "active"
    }
  ]
}
```

- `branch` is `null` for a detached (spike) worktree; `head_sha` records where it points.
- Only the orchestrator (or the single skill instance that owns the wave) writes the ledger;
  dispatched workers never write it. Concurrent waves on one tree serialize through their owner.
- Status: `active` → `merged` or `removed` on teardown. On teardown the entry is dropped or the
  status updated in the same step — the ledger never lists a tree that no longer exists.

## CREATE — isolate work in a new linked worktree

**Done when:** a linked worktree exists at a reported path with a reported branch (or detached
SHA) and base commit, its ledger entry is written, and the caller knows where to work — or a
blocker has been reported instead.

1. **Detect existing isolation first.** Compare the resolved absolute git dir against the
   resolved absolute common git dir (git mixes absolute and relative forms, so a raw string
   compare yields a false "already isolated"):

   ```bash
   git rev-parse --absolute-git-dir
   (cd "$(git rev-parse --git-common-dir)" && pwd -P)
   ```

   Equal → normal checkout; continue. Different → a linked worktree or a submodule; distinguish
   with `git rev-parse --show-superproject-working-tree`. Non-empty → submodule, treat as a normal
   checkout. Empty → **already isolated**: report the current path (`git rev-parse --show-toplevel`)
   and branch and work in place — a worktree-from-worktree lands in the wrong tree and is invisible
   to whatever made the current one. Register that existing (e.g. harness-made) worktree in the
   ledger below with its observed path, branch, and HEAD so sibling skills discover and reuse it
   instead of creating a duplicate. In isolate-an-existing-ref mode, check that ref out in place
   rather than nesting.

2. **Discover before creating.** Read `.atlas/.run/worktrees.json`, then reconcile it against
   `git worktree list --porcelain`: prune entries whose path no longer exists or that git no longer
   reports (this is the stale-worktree detection; run `git worktree prune` afterward only if
   metadata is left over). If an `active` entry already matches the requested ref or purpose —
   same base SHA and a compatible purpose — **reuse it**: report its path and branch and stop. Two
   worktrees for one job is a defect this step exists to prevent.

3. **One branch, one worktree.** A branch can be checked out in only one worktree at a time. If
   the named ref is already checked out anywhere (most commonly the primary checkout's current
   branch), do **not** create a second worktree: report that it is checked out at `<path>` and let
   the caller act (work there in place; or, only if a clean separate tree is essential and the
   caller confirms, create a *detached* worktree at the same commit).

4. **Run from the repo root:** `cd "$(git rev-parse --show-toplevel)"`. Without this, `.worktrees/<slug>`
   and the `.gitignore` edit land in a subdirectory.

5. **Name it meaningfully.** Branch `atlas/<slug>`, path `.worktrees/<slug>`, where `<slug>` comes
   from the work description or unit id (`s2-u1-auth-retry`, `spike-cache-layout`) using the
   filesystem-safe slug rules from the docs SSOT. Never an opaque auto-generated name — the slug
   is what a human reading `git worktree list` uses to recognize the tree.

6. **Ensure `.worktrees/` is gitignored before creating anything:**
   `git check-ignore -q .worktrees/` — **with the trailing slash**, so an existing directory-only
   rule is honored even before the directory exists. Not ignored → add a `.worktrees/` line to
   `.gitignore`.

7. **Resolve and track the base.** Base branch: the caller's named base, else origin's default
   branch, else `main`. `git fetch origin <base>` is **non-fatal** — no `origin` remote, a
   differently-named remote, or a local-only base is not an abort; continue with the local ref.
   Record the resolved base commit (`git rev-parse <base>`) as `base_sha`.

8. **Create, per mode:**
   - **New work (implementer unit, wave worker):** `git worktree add -b atlas/<slug> .worktrees/<slug> <base>`.
     Branch mode because its commits are merged back (implementation-units §3 commit ownership).
   - **Existing branch or tag:** `git worktree add .worktrees/<slug> <target-ref>` — subject to the
     one-branch rule in step 3.
   - **Detached spike / bakeoff experiment:** `git worktree add --detach .worktrees/<slug> <ref>`.
     Detached because its commits are disposable output to be diffed and reported, not merged. If
     the caller later wants to keep a spike's work, create a branch at its HEAD
     (`git branch atlas/<slug> HEAD` from inside the tree) before teardown.

9. **Write the ledger entry** (step-9 fields above), then report path, branch or detached SHA,
   and `base_sha`. A wave worker's dispatch prompt carries the intended `base_sha`, and the worker
   verifies its checkout's HEAD matches it before editing (implementation-units §3) — a
   harness-managed copy may have been cut from a different base.

**If `git worktree add` fails with a sandbox or permission error**, the requested isolation does
not exist. Do **not** proceed in the current checkout — the caller chose isolation specifically to
avoid it. Report the failure and ask, offering options such as "work in the current checkout" vs
"stop and resolve the permission issue" (`AskUserQuestion` where available, numbered options in
chat otherwise). Never skip the confirmation, and do not retry alternative paths automatically.

## TEARDOWN — close worktrees out at wave end

Closing worktrees is part of done, not cleanup garnish (completion-gate condition (j)). For each
tree, in dependency order:

1. **Inspect the actual tree, not the report:** `git -C <path> status --porcelain` and
   `git -C <path> log --oneline <base_sha>..HEAD`.
2. **Dirty-state protection:** **refuse to remove a worktree with uncommitted changes without
   explicit confirmation.** Present what is dirty and offer: commit it inside the worktree
   (unit-scoped staging only — never `git add .`), stash it, or explicitly discard with the
   caller's confirmation. Never silently discard, and never reach for `git worktree remove
   --force` to bypass this step — `--force` on a dirty tree requires the caller's explicit yes at
   the point of risk, per change.
3. **Land the work.** Branched tree: merge its branch into the local branch
   (`git merge --no-ff atlas/<slug>`), revalidating remaining wave results against the advancing
   tree (implementation-units §3 integration steps). Detached spike: diff against `base_sha` and
   report findings; removal discards any commits, which requires the confirmation in step 2 if
   commits exist.
4. **Remove:** `git worktree remove <path>` (no `--force` unless step 2's explicit confirmation
   was given for a dirty tree). Update the ledger: mark the entry `removed` or drop it.
5. **Never push.** Offering the push is the completion gate's and user's decision, never this
   skill's.

A run that opened worktrees is not finished until every one is merged (or reported as a spike
diff) and removed, and the ledger agrees with `git worktree list --porcelain`.
