---
name: atlas-m365
description: Deliver a production-ready Microsoft 365/Entra/Graph/Intune/Exchange config with verified read-back. Use when you must change tenant state and prove it applied.
when_to_use: you must change tenant state and prove it applied
disable-model-invocation: true
argument-hint: '[outcome wanted] [surface: Graph/portal/Intune/EXO PowerShell] [tenant constraints]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-metis/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-metis/references/operating-contract.md` and apply it before proceeding.

# `atlas-m365`

Deliver the Microsoft 365 / Entra / Graph / Intune / Exchange Online configuration described in `$ARGUMENTS`, with the exact permissions, the implementation steps or API requests, and a read-back that proves the new state.

Inputs to read from `$ARGUMENTS`: the desired outcome (the end state you want); the preferred surface (Graph API, Entra portal, Intune, or Exchange Online PowerShell); any tenant constraints (known architectural limits, passwordless targets, offboarding rules). If a required input is missing or ambiguous, ask once for it, then proceed.

## Documentation first
- Microsoft Learn is the source of truth. Confirm every endpoint, permission scope, role, cmdlet, and policy field against it before using it. Do not guess a Graph path, property name, or cmdlet signature from memory.
- For every Graph call, state the exact permission scope it needs and whether it is delegated or application. Prefer least privilege: name the single scope or directory role required, not a broad admin role.
- Call out any known platform limitation up front (for example, a dynamic distribution group has no Entra backing object, or a setting is read-only via Graph) rather than discovering it late.

## Execute
- For a config change, give the precise portal steps, the exact Intune profile fields, the exact EXO cmdlet with parameters, or the exact Graph request: HTTP method, full URL, and request body.
- Keep the change minimal and reversible. Capture the before-state when the change overwrites existing config.

## VERIFY (evidence required)
- Read the resulting state back through the same surface to confirm it applied: a follow-up GET on the Graph resource, a Get- cmdlet in EXO, or the policy/assignment view in the portal or Intune.
- Show the read-back output (or the exact field values observed) next to the expected values. If they do not match, that is a defect: fix it before reporting done.
- Exercise one failure path where relevant (missing scope, object not found) so the caller knows how the change behaves when inputs are wrong.

## REPORT
- Required permissions/scopes or roles, delegated vs application, and why each is needed.
- The implementation steps or the exact API request(s) issued.
- The verification read-back method and its observed output vs expected.
- Any platform limitation hit and how it was handled.
