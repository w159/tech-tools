# Self-validation gate — evidence before assertions

The rule: **never claim "fixed / done / it works" without showing the proof.** A claim with
no observed result, command output, or file:line locator is unverified by definition. This
is what the Stop hook (`hooks/validate_gate.py`) enforces as a floor; this file is the full
discipline behind it.

## Before you say it's done

Run this gate on your own output. Each must pass:

1. **Did I run it?** Show the exact command and the ACTUAL output. Not "it should work" —
   the real result. If you cannot run it, say so explicitly and give the exact command +
   expected output for the user to run.
2. **Is there a locator?** Point to `file.ext:line`, a test name, or observed behavior that
   backs the claim. No locator → not verified.
3. **Did I check an error path?** Empty input, bad auth, missing file, the failure case —
   not just the happy path.
4. **Does it respect the invariants?** Cross-check against `.agents/knowledge/invariants.md`.
   If the change touches a load-bearing rule, say how it stays intact (or flag that it doesn't).
5. **Fresh eyes:** "no error" ≠ "correct." Re-read the result as if someone else wrote it.

## Verdict vocabulary (be honest about confidence)

Label claims rather than blur them together:

- **VERIFIED** — evidence observed, claim holds. (Ran it; here's the output.)
- **PLAUSIBLE** — reasonable but not directly observed. Say what's missing.
- **UNVERIFIED** — no evidence yet. State the exact command + expected output to verify.
- **DISPUTED / REJECTED** — contradicting evidence; withdraw or downgrade the claim.

## Anti-rationalization guard

If you catch yourself thinking any of these, stop — it's a rationalization, not a reason:

| Thought | Reality |
|---------|---------|
| "This looks fine, skip the check" | "Looks fine" is not evidence. Run it or cite the locator. |
| "It's a trivial change, no need to test" | Trivial changes break builds too. Run the gate. |
| "I'll say done and fix it if they complain" | Shipping an unverified claim is the failure mode. Verify first. |
| "The tests probably pass" | "Probably" = UNVERIFIED. Run them or label it so. |
| "I described the fix, that's enough" | Describing ≠ verifying. Show the observed result. |

## When the gate blocks you

The Stop hook bounced you because your final message claimed completion with no evidence.
Do ONE of: (1) run it and paste command + output, (2) cite the file:line / test result, or
(3) downgrade the claim — say plainly what is NOT verified and exactly how to verify it.
Then finish. (The gate fires at most once per turn; `CODEBASE_BRAIN_GATE=off` disables it.)
