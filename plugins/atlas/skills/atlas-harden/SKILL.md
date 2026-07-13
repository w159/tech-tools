---
name: atlas-harden
disable-model-invocation: true
description: Write an idempotent endpoint remediation script using a CHECK/SET/VERIFY pattern for RMM/MDM, proving whether it changed state or was already compliant.
when_to_use: write an idempotent endpoint remediation script with CHECK/SET/VERIFY for RMM/MDM that proves compliant or changed
allowed-tools: Read, Glob, Grep, Bash, Edit, MultiEdit
argument-hint: '[objective] [target OS/devices] [deployment context: RMM run-as, one-shot/scheduled, known GPO/MDM interactions]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `references/operating-contract.md` and apply it before proceeding.

# `atlas-harden`

Write the hardening or remediation script described in `$ARGUMENTS` (PowerShell or shell), structured as CHECK then SET then VERIFY, safe to run repeatedly through any RMM or MDM.

Inputs to read from `$ARGUMENTS`: the specific objective (for example, enforce a signing setting, harden null sessions); the target devices (OS versions, device groups); the deployment context (run-as SYSTEM or run-as user, one-shot or scheduled, known GPO or MDM interactions). If a required input is missing or ambiguous, ask once for it, then proceed. The RMM or MDM is a deployment detail, not a dependency; tools such as NinjaOne or Intune are examples only.

## Pick the shape: loop or single pass
- If this is a recurring or iterative job (a sweep that hardens many settings or device groups, a poll-until-compliant cycle, or a multi-round remediation), invoke the `atlas-loop` skill to select and instantiate the best-fit loop from the loop-library, then run that loop. Otherwise write and verify the single script directly. When fanning out across independent settings or targets, dispatch those jobs in ONE message (multiple Agent calls in a single message) so they run concurrently, roughly 4-6 in flight, and ALWAYS close the wave with an independent atlas:verifier in a fresh context before integrating results.

## Documentation first
- Verify every cmdlet, parameter, registry path, and key name against Microsoft Learn (or the OS vendor's docs for non-Windows targets). Do not rely on memory for key names or cmdlet signatures.

## Checklist and structural validation
- Every script must pass `references/hardening-checklist.md`
  (OWASP-aligned) before it is reported done.
- Confirm the CHECK/SET/VERIFY structure is present and ordered:
  `bash "${CLAUDE_SKILL_DIR}/scripts/validate_harden_script.sh" <script>`
  exits 0 if valid, 1 with a reason if not.

## Requirements
- Idempotency: detect current state before changing anything, and report explicitly whether it modified a setting or found the system already compliant.
- Error handling: robust paths for missing keys, access denied, and unexpected current values. Exit with a clear exit code and a logged reason for every outcome.
- Safety: no destructive change without first capturing the before-state in the script's output. Never silently overwrite.
- Documentation: section-divider comments per logical block; comments explain the why (intent), not the what.
- Structure: CHECK then SET then VERIFY. Exit 0 for compliant or successfully remediated; nonzero for failure.

## VERIFY (evidence required)
- State the exact local test command to run the script and the expected output for each case: already-compliant, remediated, and a failure path.
- Run it locally if the environment allows, capture the actual output, and confirm it matches expected. If you cannot run it, say so and give the exact command and expected output.

## REPORT
- Analysis: what the script checks and what it changes.
- Exit-code map: each exit code and what it means.
- Step-by-step success verification on a target machine.
- The exact local test command and its expected output.
