# Dynamics connector: Entra delegated permissions

Reproduces the Entra fix that lets the `gwh-dynamics-connector` Azure Container App (FastMCP + its own OAuth 2.1 authorization server) obtain a per-user Dataverse token. Script: `scripts/assert-dynamics-connector-entra-perms.sh`.

## Symptom

Sign-in through the connector failed because the org-scoped Dynamics consent request (`https://henssler.crm.dynamics.com/user_impersonation`) had no matching resource declared on the app registration, so Entra refused to issue the delegated token. Root cause recorded in the session evidence (`agent-penny/.atlas/.run/findings.json`, entry `dynamics-connector-oauth`): "the Entra app 96c7a2a1 declared no requiredResourceAccess, so Entra could never issue the requested token (api://96c7a2a1/access_as_user + https://henssler.crm.dynamics.com/user_impersonation + offline_access)". The evidence file records no specific error code, so none is cited here. After the fix the same evidence shows `/token` 200, MCP `initialize` 200, `tools/list` 97 tools.

The connector's own scope (`access_as_user`) was already correct and is not part of the problem.

## Ids

| Thing | Value |
|---|---|
| Connector app id | `96c7a2a1-7598-48cc-bab6-85dd4c1a4370` (app object `7aa42161-64c8-43e2-823b-c5a6def7f6ac`, SP `65a96742-5cf0-463b-8256-8e44ae104580`) |
| Power Platform client id | `a53421ea-1768-40a3-b0ac-62e469d386c4` (app object `e7b7cb26-e70a-4492-b8ed-8c71478d25a9`, SP `f80379c4-e276-4417-985b-66c5a173c446`) |
| Correct resource (first-party Dataverse) | `00000007-0000-0000-c000-000000000000` (SP oid `98c1f8f5-c96d-4466-a25d-c553ace78650`) |
| Scope `user_impersonation` | `78ce3f0f-a1ce-49c2-8cde-64b5c0896db4` |
| WRONG resource, never use | `71234da4-b92f-429d-b8ec-6e62652e50d7` |

## Why 71234da4 is wrong

`71234da4-...` is Microsoft Customer Engagement Portal (Power Pages); its scope is labelled "Allow Access to Dynamics 365 Portal Service". Entra cannot issue the org-scoped Dynamics scope against it. The Dataverse delegated scope must live on the first-party Dataverse app `00000007-...`. Grants previously created against `074694c5-4a32-48ab-b501-4755b8faa00f` were stray and were deleted.

## Required end state (both client apps)

1. `requiredResourceAccess` contains resource `00000007-...` with `78ce3f0f-...` of type `Scope`.
2. An `oauth2PermissionGrant` on SP `98c1f8f5-...` with `consentType=AllPrincipals` and scope `user_impersonation` (tenant-wide admin consent).
3. No grant against the wrong resource `71234da4` (or its stray SP).

## Fast path: script

```bash
scripts/assert-dynamics-connector-entra-perms.sh            # = --check, read-only
scripts/assert-dynamics-connector-entra-perms.sh --apply    # adds scope + consent
```

`--check` exit codes: 0 all pass, 1 a check failed, 2 environment problem (az missing, not signed in, Graph token revoked: run `az login` as a tenant admin and retry). `--apply` prints each command before running it, acts only on what is missing, and is safe to re-run. It never deletes grants; for a wrong-resource grant it prints the delete command. Requires an account able to grant tenant-wide admin consent (Cloud Application Administrator or higher).

## Manual commands

Flags verified with `az ad app permission add -h` / `az ad app permission grant -h`.

```bash
for APP in 96c7a2a1-7598-48cc-bab6-85dd4c1a4370 a53421ea-1768-40a3-b0ac-62e469d386c4; do
  az ad app permission add --id "$APP" \
    --api 00000007-0000-0000-c000-000000000000 \
    --api-permissions 78ce3f0f-a1ce-49c2-8cde-64b5c0896db4=Scope
  az ad app permission grant --id "$APP" \
    --api 00000007-0000-0000-c000-000000000000 \
    --scope user_impersonation --consent-type AllPrincipals
done
```

`az ad app permission grant` needs a service principal for the client app (`az ad sp create --id <appId>` if missing).

## Verification

```bash
scripts/assert-dynamics-connector-entra-perms.sh   # expect 8 PASS rows, exit 0
az ad app permission list-grants --id 96c7a2a1-7598-48cc-bab6-85dd4c1a4370 -o table
```

End to end: follow the `reproduction` curls in the findings entry (`/.well-known/oauth-authorization-server`, `/register`), then complete the browser sign-in; `/token` should return 200 and MCP `tools/list` should return the tools.

## Rollback

```bash
APP=<client app id>
az ad app permission delete --id "$APP" --api 00000007-0000-0000-c000-000000000000 \
  --api-permissions 78ce3f0f-a1ce-49c2-8cde-64b5c0896db4
GID=$(az ad app permission list-grants --id "$APP" \
  --query "[?resourceId=='98c1f8f5-c96d-4466-a25d-c553ace78650'].id" -o tsv)
az rest --method delete --url "https://graph.microsoft.com/v1.0/oauth2PermissionGrants/$GID"
```

Rolling back breaks per-user Dynamics sign-in through the connector until re-applied.

## Durability

The fix lives on the Entra app objects, so it survives a container redeploy of `gwh-dynamics-connector`. It is lost only if someone recreates the app registrations; then run `--apply`.

## Troubleshooting

**`Continuous access evaluation resulted in challenge with result: InteractionRequired and code: TokenIssuedBeforeRevocationTimestamp`**

The cached Entra session was revoked (a sign-in elsewhere, or a permissions change on an app registration). Fix: run `az login` (device code) as da-jmorgan@henssler.com.

In this state `scripts/assert-dynamics-connector-entra-perms.sh` exits 2 by design. That is **not** a permission problem; no checks ran. After signing in, re-run:

```bash
scripts/assert-dynamics-connector-entra-perms.sh
```
