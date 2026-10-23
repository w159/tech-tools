# Microsoft 365 Claude Plugin

A Claude Code plugin for Microsoft 365 administration - users, mailboxes, Teams, licensing, and security posture. Built for MSP technicians who need to query and manage M365 tenants alongside their PSA and RMM tools.

## What This Plugin Does

| Area | What You Can Do |
|------|----------------|
| **Users** | Look up accounts, check status, MFA enrollment, group membership |
| **Mailboxes** | Search email, set out-of-office, manage shared mailboxes |
| **Teams** | List teams/channels, manage membership, find meetings |
| **Licensing** | Audit seat utilization, find unused licenses, assign/remove |
| **Security** | MFA audit, risky sign-ins, inbox rule review, compromise response |
| **Workflows** | Guided offboarding (revoke -> disable -> mailbox -> data transfer) |

## Setup

### 1. Create an Entra App Registration

1. Go to [portal.azure.com](https://portal.azure.com) -> Entra ID -> App registrations -> New
2. Name: `MSP Claude Plugin` (or similar)
3. Supported account types: **Accounts in any organizational directory** (multi-tenant) - or single-tenant if managing one customer
4. Redirect URI: `http://localhost` (for device code / interactive auth)

### 2. Grant API Permissions (Delegated)

In your app registration -> API permissions -> Add:

| Permission | Type | Why |
|-----------|------|-----|
| `User.Read.All` | Delegated | List and search users |
| `User.ReadWrite.All` | Delegated | Disable accounts, set properties |
| `UserAuthenticationMethod.Read.All` | Delegated | MFA status audit |
| `Mail.Read` | Delegated | Search and read mailboxes |
| `MailboxSettings.ReadWrite` | Delegated | Set out-of-office |
| `Team.ReadBasic.All` | Delegated | List teams |
| `TeamMember.ReadWrite.All` | Delegated | Manage team membership |
| `AuditLog.Read.All` | Delegated | Sign-in logs, MFA reports |
| `Directory.ReadWrite.All` | Delegated | Session revocation, license management |

Grant admin consent for all permissions.

### 3. Create a Client Secret

App registration -> Certificates & secrets -> New client secret. Copy the value.

### 4. Configure Environment

Copy `.env.example` to `.env` and fill in:

```bash
MICROSOFT_CLIENT_ID=your-app-client-id
MICROSOFT_CLIENT_SECRET=your-client-secret
MICROSOFT_TENANT_ID=your-tenant-id  # or "common" for multi-tenant
```

### 5. Add to Claude Code

This department's `.mcp.json` is a pointer file, not a server launch config. It
records that the `cipp` connector is provided by the armada plugin itself: the
server entry ships in `plugins/armada/.mcp.json`, and its credentials come from
the `userConfig` keys in `plugins/armada/.claude-plugin/plugin.json`. Do not
copy the pointer file into a project. Installing the armada plugin and
supplying the CIPP credentials is enough; setup details are in
`skills/armada/references/connector-provisioning.md`.

## Commands

| Command | Description |
|---------|-------------|
| `/get-user <name or email>` | Full user profile - status, licenses, MFA |
| `/check-mfa-status` | Tenant-wide MFA enrollment audit |
| `/list-licenses` | License inventory and optimization |
| `/offboard-user <user>` | Guided offboarding workflow |

## Skills

These skills are automatically loaded and inform Claude's responses:

- **Users** - Account management, creation, MFA, groups
- **Mailboxes** - Exchange Online, search, auto-replies, shared mailboxes
- **Teams** - Teams/channel management, meetings, membership
- **Licensing** - SKUs, seat counts, assignment patterns
- **Security** - MFA, sign-in risk, conditional access, compromise response
- **API Patterns** - Graph OData syntax, pagination, throttling, batch requests

## MSP Use Cases

### "Is this user's account compromised?"

```
check sign-in logs for alice@contoso.com and look for suspicious activity
```

Claude will pull recent sign-ins, check for unfamiliar IP/country, review inbox rules for external forwarding, and summarize risk indicators.

### "We're offboarding someone, handle the M365 side"

```
/offboard-user jane.smith@contoso.com --mailbox-action shared
```

Revokes sessions, disables account, sets out-of-office, converts mailbox to shared, removes from Teams, frees license - with a summary of manual steps needed.

### "Which M365 licenses can we reclaim this month?"

```
/list-licenses --view unused
```

Shows disabled users still consuming seats plus inactive users, with estimated monthly savings.

### "Does everyone in this tenant have MFA?"

```
/check-mfa-status --filter not-enrolled
```

Lists all users with no MFA enrolled, prioritized by recent activity (highest risk first).

## Permissions Notes

- Admin consent is required for most operations - the app registration must be consented by a Global Administrator in the target tenant
- For multi-tenant MSP use, each customer must consent your Entra app (or use delegated admin / GDAP relationships)
- Read-only audit tasks (`User.Read.All`, `AuditLog.Read.All`) have lower consent friction than write operations
