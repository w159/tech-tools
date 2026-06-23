# Evidence: atlas hook contract -- smoke tests and verifier verdict

Date: 2026-06-22
Verifier agent: atlas:verifier
Verdict: CONFIRMED

---

## What was verified

1. No wired atlas hook emits `permissionDecision`.
2. No wired atlas hook exits with code 2 (approval-blocking exit).
3. `bash_advisor.py` fires an `additionalContext` advisory (not a block) on catastrophic
   commands, and is silent on non-catastrophic commands.
4. The `completion_gate.py` Stop-event block is a one-time fail-open reminder, not an
   approval change.

---

## hooks.json wiring at time of verification

File: `plugins/atlas/hooks/hooks.json`

Wired hooks (confirmed present, confirmed no exit-2 / permissionDecision in any):

| Event | Script |
|---|---|
| SessionStart | session_boot.py |
| UserPromptSubmit | prompt_optimizer.py |
| PreToolUse (Bash) | bash_advisor.py |
| PostToolUse (Edit, Write, MultiEdit) | format_after_edit.py |
| Stop | completion_gate.py, nudge.py |
| SubagentStop | nudge.py |

NOT wired in hooks.json (confirmed):

- `validate-readonly-query.sh` -- uses exit 2 as a per-subagent read-only DB-audit guard.
  It is invoked explicitly by the DB-audit agent prompt, not by the global hooks.json wiring.
  Its exit-2 path does not violate the contract because it is not a hooks.json entry.

---

## Smoke test 1 -- non-catastrophic command (sudo rm file)

Command handed to PreToolUse bash_advisor hook:

  sudo rm file

Observed output: empty stdout, exit 0.

Interpretation: `sudo` is not in the catastrophic-command list in the rewritten
`bash_advisor.py`. No advisory emitted. Hook is silent. Approval policy unaffected.

---

## Smoke test 2 -- catastrophic command (rm -rf /)

Command handed to PreToolUse bash_advisor hook:

  rm -rf /

Observed output (additionalContext only, no permissionDecision, exit 0):

  [atlas advisor] This command matches a catastrophic, near-irreversible pattern
  (rm -rf /). Confirm intent before proceeding. No action taken by this hook.

Exit code: 0
permissionDecision emitted: NO
Tool call blocked: NO

Interpretation: advisory-only path behaves as specified. The agent receives the advisory
alongside the tool result context and makes its own decision. The hook does not block.

---

## Manifest agent-count verification

Claim in plugin.json and marketplace.json: "18-agent subagent squad"

Verification method: `ls plugins/atlas/agents/ | wc -l` = 18

Result: CONFIRMED. Count on disk matches both manifest entries.

---

## Stale "orchestrate" token check

Grep scope: `plugins/atlas/hooks/`, `plugins/atlas/scripts/`, `plugins/atlas/commands/.claude-plugin/`

Result: zero residual `[orchestrate` or `orchestrate multi-agent` strings.
(Intentional trigger word "atlas-engine" and vendored docs/ trees excluded per spec.)

---

## JSON validity

`plugin.json` and `marketplace.json` atlas entry: valid JSON confirmed.

---

## Summary

All five contract clauses verified:

- No permissionDecision emitted by any wired hook: PASS
- No exit 2 in any wired hook: PASS
- bash_advisor silent on non-catastrophic input: PASS
- bash_advisor emits additionalContext (not block) on catastrophic input: PASS
- Agent count on disk matches manifest claim (18): PASS
