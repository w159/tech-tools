#!/usr/bin/env bash
# Assert (and, with --apply, repair) the Entra delegated permissions the two
# Dynamics MCP connector app registrations need. Runbook:
# docs/runbooks/dynamics-connector-entra-permissions.md
#
# Usage: scripts/assert-dynamics-connector-entra-perms.sh [--check | --apply]
#   --check  (default) read-only; per-app PASS/FAIL table.
#            exit 0 all pass, 1 a check failed, 2 environment problem.
#   --apply  add the missing scope to requiredResourceAccess and grant
#            AllPrincipals admin consent. Prints each command first; re-runnable
#            (only acts on what is missing). Never deletes a wrong-resource
#            grant: it prints the delete command instead (see runbook rollback).
set -euo pipefail

CONNECTOR_APP=96c7a2a1-7598-48cc-bab6-85dd4c1a4370   # gwh-dynamics-connector
POWERPLATFORM_APP=a53421ea-1768-40a3-b0ac-62e469d386c4
DATAVERSE_APP=00000007-0000-0000-c000-000000000000   # first-party Dataverse
SCOPE_ID=78ce3f0f-a1ce-49c2-8cde-64b5c0896db4        # user_impersonation
SCOPE_NAME=user_impersonation
WRONG_APP=71234da4-b92f-429d-b8ec-6e62652e50d7       # Power Pages: never use

mode=check
case "${1:-}" in
  ""|--check) mode=check ;;
  --apply) mode=apply ;;
  *) echo "usage: $0 [--check | --apply]" >&2; exit 2 ;;
esac

command -v az >/dev/null 2>&1 || { echo "ERROR: az CLI not found" >&2; exit 2; }
az account get-access-token --resource-type ms-graph -o none 2>/dev/null \
  || { echo "ERROR: not signed in to Graph (run: az login)" >&2; exit 2; }
# A cached token can still be revoked (CAE); this call proves Graph works.
if ! dv_sp=$(az ad sp show --id "$DATAVERSE_APP" --query id -o tsv 2>&1); then
  echo "ERROR: Graph read failed (re-run: az login): $dv_sp" >&2; exit 2
fi
wrong_sp=$(az ad sp list --filter "appId eq '$WRONG_APP'" --query '[0].id' -o tsv 2>/dev/null || true)

fail=0
rows=()

record() { # app check ok detail
  local res=PASS
  [ "$2" = ok ] || { res=FAIL; fail=1; }
  rows+=("$(printf '%-36s %-34s %-5s %s' "$1" "$3" "$res" "${4:-}")")
}

run() { echo "+ $*"; "$@"; }

# az read that maps any failure to the documented exit 2 (set -e would leak az's status 3).
# Runs in a $(...) subshell, so the subshell's exit 2 becomes the assignment's status.
azq() { local out; out=$("$@" 2>&1) || { echo "ERROR: az read failed ($*): $out" >&2; exit 2; }; printf '%s' "$out"; }

for app in "$CONNECTOR_APP" "$POWERPLATFORM_APP"; do
  rra=$(azq az ad app show --id "$app" --query "length(requiredResourceAccess[?resourceAppId=='$DATAVERSE_APP'])" -o tsv)
  has_scope=$(azq az ad app show --id "$app" --query "length(requiredResourceAccess[?resourceAppId=='$DATAVERSE_APP'].resourceAccess[] | [?id=='$SCOPE_ID' && type=='Scope'])" -o tsv)
  all_p=$(azq az ad app permission list-grants --id "$app" --query "length([?resourceId=='$dv_sp' && consentType=='AllPrincipals' && contains(scope, '$SCOPE_NAME')])" -o tsv)
  if [ -n "$wrong_sp" ]; then
    wrong=$(azq az ad app permission list-grants --id "$app" --query "length([?resourceId=='$wrong_sp'])" -o tsv)
  else
    wrong=0
  fi

  [ "$rra" -ge 1 ] && s=ok || s=bad
  record "$app" "$s" "requiredResourceAccess Dataverse" "resource $DATAVERSE_APP"
  [ "$has_scope" -ge 1 ] && s=ok || s=bad
  record "$app" "$s" "scope $SCOPE_NAME declared" "$SCOPE_ID"
  [ "$all_p" -ge 1 ] && s=ok || s=bad
  record "$app" "$s" "AllPrincipals consent on Dataverse" "resource SP $dv_sp"
  [ "$wrong" -eq 0 ] && s=ok || s=bad
  record "$app" "$s" "no grant on wrong resource" "$WRONG_APP"

  if [ "$mode" = apply ]; then
    if [ "$has_scope" -lt 1 ]; then
      echo "Will add scope $SCOPE_ID ($SCOPE_NAME) on $DATAVERSE_APP to app $app"
      run az ad app permission add --id "$app" --api "$DATAVERSE_APP" --api-permissions "$SCOPE_ID=Scope"
    fi
    if [ "$all_p" -lt 1 ]; then
      echo "Will grant AllPrincipals consent for $SCOPE_NAME on $DATAVERSE_APP to app $app"
      run az ad app permission grant --id "$app" --api "$DATAVERSE_APP" --scope "$SCOPE_NAME" --consent-type AllPrincipals
    fi
    if [ "$wrong" -ne 0 ]; then
      echo "NOT auto-removed: grant(s) on wrong resource $WRONG_APP for $app. Delete with:"
      az ad app permission list-grants --id "$app" --query "[?resourceId=='$wrong_sp'].id" -o tsv |
        while read -r gid; do echo "  az rest --method delete --url https://graph.microsoft.com/v1.0/oauth2PermissionGrants/$gid"; done
    fi
  fi
done

printf '%-36s %-34s %-5s %s\n' APP CHECK RESULT DETAIL
printf '%s\n' "${rows[@]}"

if [ "$mode" = apply ]; then
  echo "Apply finished. Re-run with --check to verify."
  exit 0
fi
exit "$fail"
