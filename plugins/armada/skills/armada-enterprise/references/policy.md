# Change who can use which connector

Policy model (schema version 1, source `mcp_servers/mcp-gateway/src/policy.ts`):

- `subjects`: list of `{role, when: {claim, equals}}`. A caller holds a role when the claim (string or list) contains the exact value. With the Entra setup, the claim is `roles` and the value is the app role created from `answers.yaml`.
- `grants`: list of `{role, connectors, effects, deny_tools?}`. `connectors` holds catalog ids, `"*"`, or `"gateway"` (the gateway's own audit tools). `effects` is a non-empty subset of `read`, `write`, `destructive`. `deny_tools` is a list of tool name globs where `*` matches any run of characters; a hit on any applicable grant beats every allow.
- Top-level keys are only `version`, `subjects`, `grants`. Anything else is a startup error. Every grant role needs a subjects rule.
- Default deny. A tool with no annotations counts as `destructive`.

Connector ids: `mcp_servers/mcp-gateway/catalog/catalog.json`. Example: `${CLAUDE_PLUGIN_ROOT}/enterprise/templates/policy.example.yaml`.

Two things change access, and they live in different places:

| Change | Where |
|---|---|
| Which connectors and effects a role gets, deny carve-outs | `grants` in `policy.yaml` (this procedure) |
| Which people hold a role | Entra group membership, through the app role assignment (`setup.md`, change group mapping) |

To add or remove a role, or change its groups, edit `answers.yaml` and rerun `plan` and `provision` as in `setup.md`. The plan regenerates `policy.yaml`.

## Steps

1. Get the live policy. Local copy: the `policy.yaml` from setup. Deployed copy: `az keyvault secret show --vault-name <vault> --name policy-yaml --query value -o tsv`. Reading it is allowed; it holds no credentials. Save it as `policy.current.yaml` and edit a copy, `policy.next.yaml`.
2. Apply the requested change to `policy.next.yaml`. Prefer the narrowest change: a `deny_tools` carve-out or a smaller `effects` list over a new broad grant. Never use `connectors: ["*"]` with `destructive` unless the admin asked for exactly that; say so when they do.
3. Validate with the gateway's parser, not by eye. Write a throwaway script outside the repo that calls `parsePolicy(text, catalogIds)` from the gateway source on `policy.next.yaml` and prints any `PolicyError`. A failure blocks rollout.
4. Print the who-can-call-what matrix.
   - Gateway connected as an MCP server: call `gateway_access_report`. It returns, per role and connector, the tools allowed and denied with the deciding rule (`grant:<role>`, `deny_tools:<role>:<glob>`, `no_grant`, `effect_not_granted:<effect>`). It reports the policy the running gateway loaded, not `policy.next.yaml`.
   - Otherwise a local dry run: run `accessMatrix` from `policy.ts` against `policy.next.yaml` with the connectors' tool annotations, and print role by connector with counts of allowed and denied tools. If tool lists are unavailable, print the grants as written and mark the matrix "grant level only".
5. Show the change: `diff -u policy.current.yaml policy.next.yaml`, then the matrix rows that changed.
6. Ask: "Roll out this policy? Reply yes." Wait. Without a clear yes, stop and leave the files for the admin.
7. On yes, store the new version (the old one stays as the rollback): `az keyvault secret set --vault-name <vault> --name policy-yaml --file policy.next.yaml --encoding utf-8 >/dev/null`. Restart the gateway so it reloads (policy is read at startup): `az containerapp revision restart -g <rg> -n <prefix>-gateway --revision <name>`. Confirm the logs show no `PolicyError` and `gateway_access_report` matches the matrix shown.
8. Rollback: set the secret again from `policy.current.yaml` and restart.

Never edit the deployed policy without steps 3 to 6. Never put credentials in `policy.yaml`.
