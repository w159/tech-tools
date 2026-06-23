---
id: security-finding-verify
name: Security finding verify
category: security
cadence: fan-out
inputs:
  - findings: the scanner output to triage (SAST/DAST/dependency-audit results)
  - context_source: the code/config each finding points at, for proving exploitability
  - verdict_bar: what evidence makes a finding true-positive vs false-positive
  - severity_scale: how confirmed findings are ranked (CVSS, or blocker/major/minor)
---

# security-finding-verify

Take a batch of scanner findings and prove each one true-positive or false-positive with evidence, in parallel. Fan-out cadence because findings are independent: one subagent per finding re-opens the cited code, checks whether the vulnerable path is actually reachable and exploitable, and returns a grounded verdict. A scanner hit is a hypothesis, not a fact.

## Steps

1. **Normalize.** Parse `findings` into a list of (rule, location, claimed severity). Route large scanner output through `context-mode`.
2. **Fan out (one message).** Dispatch one subagent per finding (~4-6 in flight). Each re-opens the cited location in `context_source`, traces reachability, and checks exploitability against `verdict_bar`. No fixes.
3. **Collect verdicts.** Each returns true-positive (with the reachable path and an exploit sketch), false-positive (with why the path is unreachable or already mitigated), or needs-human (genuinely ambiguous).
4. **Rank the true-positives.** Order confirmed findings by `severity_scale`. Note any that chain into a worse combined risk.
5. **Suppress the false-positives properly.** Record each with its refutation so the scanner suppression is justified and auditable, not silenced blindly. Re-run the wave on any new findings.

## Stop condition

Every finding in the batch has a true-positive / false-positive / needs-human verdict with evidence, and confirmed ones are ranked.

## Workflow shape (fan-out)

```
Wave - per finding (single message, parallel):
  Agent(atlas:verifier | security-engineer): re-open <finding.location> in <context_source>.
    Trace whether the vulnerable path is reachable and exploitable per <verdict_bar>. Return
    true-positive (reachable path + exploit sketch) | false-positive (why unreachable/mitigated)
    | needs-human. Find and prove; do not patch.

After wave:
  Rank true-positives by <severity_scale>; note chained risks. Record false-positives with
  refutation for auditable suppression. Re-run wave on any new findings.
```

This loop only triages. Any fix that lands is a separate gated change with its own independent verify.
