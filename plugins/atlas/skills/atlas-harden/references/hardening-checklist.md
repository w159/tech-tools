# Hardening Checklist (OWASP-aligned)

The review surface for an endpoint remediation script. Every script
`atlas-harden` produces must pass this checklist before it is reported
as done. The checklist is OWASP-aligned: it maps each control to the
relevant OWASP category so a reviewer can trace the "why."

## A - Idempotency (script is safe to run repeatedly)

- [ ] **CHECK first.** The script reads current state before any write.
- [ ] **SET only if needed.** The script skips the write when already
      compliant and reports that explicitly.
- [ ] **VERIFY after.** The script re-reads state after the SET step and
      confirms it matches the desired value.
- [ ] **Exit codes are meaningful.** 0 = compliant or remediated;
      nonzero = failure with a logged reason for each code.

Maps to: OWASP A06:2021 - Vulnerable and Outdated Components (a
repeatable hardening script keeps the endpoint at the current baseline
without drift).

## B - Safety (no destructive change without a capture)

- [ ] **Before-state captured.** The script prints the current value
      before overwriting it.
- [ ] **No silent overwrite.** Every write is logged with the old and
      new values.
- [ ] **Rollback path documented.** The REPORT section states how to
      revert if the change causes a regression.

Maps to: OWASP A07:2021 - Identification and Authentication Failures
(hardening must not lock out a legitimate admin path).

## C - Error handling (robust on every path)

- [ ] **Missing key / missing file.** The script handles the absent case
      (creates it, or reports and exits) without an unhandled exception.
- [ ] **Access denied.** The script detects permission failure and
      reports the required privilege, not a stack trace.
- [ ] **Unexpected current value.** The script does not assume the
      before-state; it branches on what it actually finds.

Maps to: OWASP A05:2021 - Security Misconfiguration (a hardening script
that crashes on an unexpected state leaves the endpoint half-hardened).

## D - Documentation (the script explains itself)

- [ ] **Section dividers.** CHECK, SET, and VERIFY blocks each have a
      comment header.
- [ ] **Comments explain why.** The intent of each block is stated, not
      the mechanics of the cmdlet.
- [ ] **Exit-code map in REPORT.** Every nonzero exit code is listed
      with its meaning.

Maps to: OWASP A06:2021 - repeatable hardening is only repeatable if the
next operator can read it.

## E - Deployment (RMM/MDM safe)

- [ ] **Run-as documented.** The REPORT states whether the script runs
      as SYSTEM or as the user, and why.
- [ ] **One-shot vs scheduled.** The REPORT states which, and the
      script is idempotent for the scheduled case.
- [ ] **GPO/MDM interaction noted.** If a group policy or MDM also
      manages this setting, the REPORT flags the potential conflict.

Maps to: OWASP A05:2021 - a hardening setting that a GPO reverts on the
next refresh is not actually hardened.

## F - Verification evidence

- [ ] **Local test command stated.** The REPORT gives the exact command
      to run the script locally.
- [ ] **Expected output per case.** Already-compliant, remediated, and a
      failure path each have a stated expected output.
- [ ] **Run if possible.** If the environment allows, the script is run
      and the actual output is captured. If not, the REPORT says so and
      gives the command for the reviewer to run.

Maps to: OWASP A06:2021 - a hardening script that has never been run is
a hypothesis, not a control.