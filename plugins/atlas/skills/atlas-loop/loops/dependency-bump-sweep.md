---
id: dependency-bump-sweep
name: Dependency bump sweep
category: maintenance
cadence: fan-out
inputs:
  - dependencies: the set to upgrade (a lockfile audit, an outdated list, named packages)
  - per_dep_gate: the build/test command that proves one bump is safe (read from the manifest)
  - target_version_rule: how far to bump each (latest minor, latest major, pinned)
  - isolation: how each bump is built in isolation (a temp copy, a branch, a worktree)
---

# dependency-bump-sweep

Upgrade many dependencies at once, but build and test each one in isolation so a single bad upgrade does not contaminate or mask the others. Fan-out cadence because the bumps are independent: each is its own subagent that bumps, builds, tests, and reports pass or fail. You merge only the green ones.

## Steps

1. **Enumerate.** Resolve `dependencies` and the `target_version_rule` for each into a concrete list of (package, from, to).
2. **Fan out (one message).** Dispatch one subagent per bump (~4-6 in flight). Each works in its own `isolation` copy: apply the bump, run `per_dep_gate`, capture the result. No cross-talk between bumps.
3. **Collect verdicts.** Each subagent returns green (gate passed, safe to merge), red (gate failed, with the error excerpt), or needs-work (passed but with deprecation warnings).
4. **Batch the greens.** Apply the safe bumps together, then run the full gate once more on the combined set to catch interaction effects.
5. **Triage the reds.** Report each failed bump with its error and a remediation hint (pin back, code change needed, blocked by a peer). Repeat the wave on remaining or newly-released deps.

## Stop condition

Every dependency in the set is either merged-green or reported-red with a reason, and the combined green set passes the full gate.

## Workflow shape (fan-out)

```
Wave - per dependency (single message, parallel):
  Agent(atlas:implementer): in an isolated copy (<isolation>), bump <package> from <from> to <to>
    per <target_version_rule>, run <per_dep_gate>, and report green|red|needs-work with the
    command output excerpt. Do not touch other dependencies.

After wave:
  Apply all green bumps together; run <per_dep_gate> once on the combined set.
  Report reds with error + remediation hint. Re-run wave for any remaining deps.
```

Merging the combined set writes - gate before committing or pushing.
