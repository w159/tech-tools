---
name: armada-enterprise
description: 'Enterprise mode for armada: deploy the MCP gateway for an organization in Azure, map Entra directory groups to connector roles, review audit logs, and add the org connector to Claude. Use when an admin wants to set up the gateway, change who can use which connector, check who called what, or connect Claude or Claude Code to the gateway. Azure first; Google Cloud is not yet supported. Interactive, and creates nothing until the admin says yes.'
when_to_use: deploying the enterprise MCP gateway, mapping directory groups to roles, reviewing gateway audit logs, or adding the org connector to Claude
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: '[setup|policy|audit|connect]'
---

# armada-enterprise

Enterprise mode runs the vendor connectors that armada ships behind one organization-wide gateway (`mcp_servers/mcp-gateway`). Users sign in with Microsoft and MFA, the gateway checks every tool call against a role policy, and every call is written to an audit log.

Azure first. The Google Cloud template under `${CLAUDE_PLUGIN_ROOT}/enterprise/infra/gcp` is kept but not yet supported; say so and stop if the admin asks for it.

## Pick the procedure

Ask the admin which of the four they need unless the argument or their message says. One question.

| Need | Procedure |
|---|---|
| Deploy the gateway, create the Entra app and roles, assign groups | `${CLAUDE_PLUGIN_ROOT}/skills/armada-enterprise/references/setup.md` |
| Change who can use which connector, check the effective access | `${CLAUDE_PLUGIN_ROOT}/skills/armada-enterprise/references/policy.md` |
| Review who called what, denials, errors, unused grants | `${CLAUDE_PLUGIN_ROOT}/skills/armada-enterprise/references/audit.md` |
| Add the gateway to Claude (web, desktop, Claude Code) | `${CLAUDE_PLUGIN_ROOT}/skills/armada-enterprise/references/connect.md` |

Read the one reference, then follow it.

Shared files: infra `${CLAUDE_PLUGIN_ROOT}/enterprise/infra/azure/main.bicep`, saved queries `${CLAUDE_PLUGIN_ROOT}/enterprise/queries/azure`, example policy `${CLAUDE_PLUGIN_ROOT}/enterprise/templates/policy.example.yaml`, connector ids `mcp_servers/mcp-gateway/catalog/catalog.json`.

## Posture: read-only until the admin says yes

- Reading files, `npm run build`, `discover`, `plan`, `provision` without `--apply`, `bicep build`, `az deployment group what-if`, and log queries run without asking.
- Never run anything that creates, changes or deletes cloud or directory state until the admin has seen the plan and answered with an explicit yes in their own words: `provision --apply`, `az deployment group create`, `az acr build`, `az keyvault secret set`, `az containerapp` restarts. A yes covers the plan shown. If the plan changes, show it again and ask again.
- Before asking for a yes, list every billable resource and say that the gateway costs money, including while idle, because one replica always runs.
- Never change `policy.yaml` on disk or in a running gateway without showing the diff first and getting a yes.
- Ask one question at a time. Do not batch questions.

## Secrets

- Never ask the admin to paste a secret into the chat. Never print, echo, log or write a secret value into the repository.
- Secret values go straight to Key Vault through a hidden prompt or a temporary file that is deleted right after.
- Never put a `.env` file in an image build context.
- Use generic names (`contoso.example`) in anything written into the repository. Tenant ids, hosts and group ids belong in the admin's working directory only, not in tracked files.

## Evidence

Report what a command printed, not what you expect. If a tool is missing or a command fails, say so and stop at that step.

## Not in scope

Changing gateway source under `mcp_servers/`, and dispatching other agents. If the task needs either, say so in your report.
