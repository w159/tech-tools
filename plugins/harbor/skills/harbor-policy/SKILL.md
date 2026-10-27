---
name: harbor-policy
description: 'Edits grants in the gateway policy.yaml, validates it, prints the who-can-call-what matrix, shows the diff, and rolls the change out only on the admin''s yes. Uses the gateway_access_report tool when the gateway is connected, otherwise a local dry run. Use when changing who can use which connector or effect class.'
when_to_use: adding or removing access for a role, reviewing current access, or checking a policy change before rollout
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: '[describe the access change]'
---

# harbor-policy

Policy model (schema version 1, source: `mcp_servers/mcp-gateway/src/policy.ts`):

- `subjects`: list of `{role, when: {claim, equals}}`. A caller holds a role
  when the claim (string or list) contains the exact value.
- `grants`: list of `{role, connectors, effects, deny_tools?}`. `connectors`
  holds catalog ids, `"*"`, or `"gateway"` (the gateway's own audit tools).
  `effects` is a non-empty subset of `read`, `write`, `destructive`.
  `deny_tools` is a list of tool name globs where `*` matches any run of
  characters; a hit on any applicable grant beats every allow.
- Top-level keys are only `version`, `subjects`, `grants`. Anything else is a
  startup error. Every grant role needs a subjects rule.
- Default deny. A tool with no annotations counts as `destructive`.

Connector ids: `mcp_servers/mcp-gateway/catalog/catalog.json`.

## Steps

1. Locate the live policy. Local copy: the `policy.yaml` kept by harbor-setup.
   Deployed copy: Azure `az keyvault secret show --vault-name <vault> --name policy-yaml --query value -o tsv`;
   Google Cloud `gcloud secrets versions access latest --secret <prefix>-policy-yaml`.
   Reading the deployed policy is allowed; it holds no credentials. Save it to
   `policy.current.yaml` and edit a copy, `policy.next.yaml`.
2. Apply the requested change to `policy.next.yaml`. Prefer the narrowest
   change: a new `deny_tools` carve-out or a smaller `effects` list over a new
   broad grant. Never use `connectors: ["*"]` with `destructive` unless the
   admin asked for exactly that; say so when they do.
3. Validate with the gateway's parser, not by eye. Write a throwaway script
   outside the repo (or a temporary test file you delete) that calls
   `parsePolicy(text, catalogIds)` from the gateway source on
   `policy.next.yaml` and prints any `PolicyError`. A failure blocks rollout.
4. Print the who-can-call-what matrix.
   - Gateway connected as an MCP server: call `gateway_access_report`. It
     returns, per role and connector, the tools allowed and the tools denied
     with the deciding rule (`grant:<role>`, `deny_tools:<role>:<glob>`,
     `no_grant`, `effect_not_granted:<effect>`). Note it reports the policy
     the running gateway loaded, not `policy.next.yaml`.
   - Otherwise a local dry run: load the tool lists from the connectors' own
     `tools/list` annotations where available, run `accessMatrix` from
     `policy.ts` against `policy.next.yaml`, and print role x connector with
     counts of allowed and denied tools plus the denied list. If tool lists are
     not available locally, print the grants as written (role, connectors,
     effects, deny_tools) and mark the matrix "grant level only".
5. Show the change: `diff -u policy.current.yaml policy.next.yaml`, then the
   matrix rows that changed.
6. Ask: "Roll out this policy? Reply yes." Wait. Without a clear yes, stop and
   leave the files for the admin.
7. On yes, roll out:
   - Store the new version in the vault (a new secret version; the old one
     stays and is the rollback):
     Azure `az keyvault secret set --vault-name <vault> --name policy-yaml --file policy.next.yaml --encoding utf-8 >/dev/null`;
     Google Cloud `gcloud secrets versions add <prefix>-policy-yaml --data-file=policy.next.yaml`.
   - Restart the gateway so it reloads the file (see "Updating policy later" in
     harbor-setup). Policy is read at startup.
   - Confirm: the gateway starts (logs show no `PolicyError`) and
     `gateway_access_report` now matches the matrix shown.
8. Rollback: add the previous version again from `policy.current.yaml` and
   restart.

Never edit the deployed policy without steps 3 to 6. Never include credentials
in `policy.yaml`.
