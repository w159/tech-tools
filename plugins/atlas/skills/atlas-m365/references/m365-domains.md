# M365 Domains

The domain map for Microsoft 365 administration. Use this to locate
the right surface (Graph, portal, Intune, EXO PowerShell, Teams
PowerShell) and the least-privileged permission scope before issuing
any call. Every fact here is sourced from Microsoft Learn; do not
rely on memory for Graph paths, property names, or cmdlet signatures.
Re-verify against the cited doc before any change that overwrites
existing config.

## Domain inventory

| Domain | Primary surface | Key cmdlets / endpoints |
|---|---|---|
| Users and identities | Graph /users, Microsoft Graph PowerShell | Get-MgUser, New-MgUser, Update-MgUser |
| Mailboxes | Exchange Online PowerShell, Graph /users/{id}/mailbox | Set-Mailbox, Get-Mailbox |
| Teams | Microsoft Teams PowerShell module | New-Team, Get-Team, Get/Set-CsTeamsMeetingPolicy |
| OneDrive / SharePoint | Graph /sites, /drives; Sites.Selected | Get-PnPTenantSite, Graph drives API |
| Licensing | Graph user: assignLicense, Set-MgUserLicense | Set-MgUserLicense, Get-MgSubscribedSku |
| Intune device config | Graph deviceManagement, Intune portal | DeviceConfiguration policies, assignments |
| Security posture | Entra portal, Graph, Security defaults | Conditional Access, MFA, sign-in logs |
| Multi-tenant (CIPP) | CIPP (community tool) over Graph | Tenant switch, standards, offboarding |

## Users and identities

- Access users by `/users/{id}` or `/users/{userPrincipalName}`, or
  `/me` for the signed-in user. [Working with users in Microsoft
  Graph](https://learn.microsoft.com/graph/api/resources/users)
- Microsoft Graph PowerShell: `Connect-MgGraph -Scopes ...` then
  `Get-MgUser`, `New-MgUser`, `Update-MgUser`.
- Least-privileged roles for user admin: User Administrator, not
  Global Administrator. Global Admin is for emergency scenarios only.

## Mailboxes

- `Set-Mailbox` modifies one mailbox at a time. Bulk via
  `Get-Mailbox | Set-Mailbox` pipeline. Cmdlet reference:
  [Set-Mailbox](https://learn.microsoft.com/powershell/module/exchangepowershell/set-mailbox).
  Requires Mail Recipients role; some parameters need Mailbox Import
  Export or higher.
- Application-only mailbox access is tenant-wide by default. To scope
  an app to specific mailboxes, use an Exchange Application Access
  Policy via Exchange Online PowerShell:
  [Restrict mailbox access](https://learn.microsoft.com/graph/auth-limit-mailbox-access).
  There is no full GUI for this today.
- Application RBAC (Exchange service principal with recipient scope)
  is the modern scoping path:
  [Application RBAC in Exchange](https://learn.microsoft.com/exchange/permissions-exo/application-rbac).

## Teams

- Teams are backed by Microsoft 365 Groups. `GroupId` in Teams
  cmdlets equals `Identity` from `Get-UnifiedGroup`.
- Teams cmdlets: `New-Team`, `Get-Team`, `Set-Team`, `Add-TeamUser`,
  `Remove-TeamUser`, `New-TeamChannel`.
- Policies follow the Get/New/Set/Remove/Grant-Cs<PolicyName> pattern
  (for example, `Get-CsTeamsMeetingPolicy`, `Grant-CsTeamsMeetingPolicy`).
  Configurations follow Get/Set-Cs<ConfigurationName> (for example,
  `Set-CsTeamsClientConfiguration`). See [Manage Teams with
  PowerShell](https://learn.microsoft.com/microsoftteams/teams-powershell-managing-teams).
- Module: [Microsoft Teams PowerShell
  Overview](https://learn.microsoft.com/microsoftteams/teams-powershell-overview).
- Roles: [Use Microsoft Teams administrator
  roles](https://learn.microsoft.com/microsoftteams/using-admin-roles).
  Least-privileged: Teams Administrator, not Global Admin.

## OneDrive / SharePoint

- Graph: `/sites/{id}/drives` for drive libraries, `/drives/{id}`
  for a specific drive.
- Use `Sites.Selected` (application) to scope app access to one site
  instead of `Sites.ReadWrite.All`. Grant the site-level role (Read,
  Write, Full Control) via the SharePoint admin center API access
  blade or Graph. See
  [permissions reference](https://learn.microsoft.com/graph/permissions-reference#sitesselected).

## Licensing

- License assignment requires `User.ReadWrite.All` or
  `LicenseAssignment.ReadWrite.All`, plus `Organization.Read.All` to
  read available SKUs. See [user: assignLicense
  API](https://learn.microsoft.com/graph/api/user-assignlicense).
- Least-privileged Entra roles: Directory Writers, License
  Administrator, User Administrator. (From the assignLicense API
  page.)
- `UsageLocation` must be set (ISO 3166-1 alpha-2) on the user
  before license assignment, or the assignment fails. Set it via
  `Update-MgUser -UserId <upn> -UsageLocation US`.
- Assign via Microsoft Graph PowerShell:
  `$sku = Get-MgSubscribedSku -All | Where SkuPartNumber -eq 'SPE_E5';
  Set-MgUserLicense -UserId <upn> -AddLicenses @{SkuId = $sku.SkuId}
  -RemoveLicenses @()`.
  Reference: [Assign licenses with
  PowerShell](https://learn.microsoft.com/microsoft-365/enterprise/assign-licenses-to-user-accounts-with-microsoft-365-powershell).
- Remove: `Set-MgUserLicense -UserId <upn> -RemoveLicenses @($sku.SkuId)
  -AddLicenses @{}`.
- Group-based licensing is the preferred path for org-wide
  assignment; direct assignment is for exceptions.

## Intune device configuration

- Graph namespace: `microsoft.graph`, under `deviceManagement`.
  Reference: [Device configuration in Microsoft
  Intune](https://learn.microsoft.com/graph/api/resources/intune-device-cfg-conceptual).
- Intune must be licensed by the customer; Graph API does not bypass
  licensing.
- Application permissions for policy write:
  `DeviceManagementConfiguration.ReadWrite.All` plus
  `Group.Read.All` for assignments. Delegated scenarios are not
  supported for the Tenant Configuration Management resources.
- Least-privileged Entra role: Intune Administrator.
- Policy assignment targets: `groupAssignmentTarget`,
  `allLicensedUsersAssignmentTarget`, `allDevicesAssignmentTarget`,
  `exclusionGroupAssignmentTarget`,
  `configurationManagerCollectionAssignmentTarget`.

## Security posture

- Entra ID: Conditional Access, Security Defaults, MFA registration,
  sign-in logs, risk events.
- Least-privileged roles: Security Administrator, Security Reader
  (read), Conditional Access Administrator (policy write).
- Prefer Security Defaults for SMB tenants without a CA license.
- For regulated environments, frame posture work against the
  applicable standard (NIST 800-53, CIS, ISO 27001) and cite the
  control.

## Multi-tenant via CIPP

- CIPP (Community Integrations PowerShell Platform) is a community
  tool, not a Microsoft product. It wraps Graph and partner-center
  APIs to manage multiple tenants from one interface.
- Use CIPP for: tenant standards, offboarding workflows, bulk
  license reporting, conditional access standards deployment across
  tenants.
- CIPP does not replace least-privilege discipline. Each tenant's
  service account still needs the minimum role for the task.

## Permission scope discipline

- For every Graph call, state the exact permission scope it needs
  and whether it is delegated or application. Prefer least privilege:
  name the single scope or directory role required, not a broad
  admin role.
- Application access is tenant-wide by default. Scope it with
  Application Access Policy (mailboxes) or Sites.Selected
  (SharePoint) when the app should not see every resource.
- Re-verify the scope against the
  [permissions reference](https://learn.microsoft.com/graph/permissions-reference)
  before issuing the call. Scopes change between Graph versions.

## Platform limitations to call out up front

State these in the report before the caller discovers them late:

- Dynamic distribution groups have no Entra backing object; they
  live only in Exchange.
- Some Exchange settings are read-only via Graph and require EXO
  PowerShell.
- Application Access Policy has no full GUI; PowerShell or Graph
  is required.
- Intune Tenant Configuration Management resources do not support
  delegated permissions; application only.
- Teams private channels have a separate permission surface from
  their parent team.

## Documentation sources

Re-verify every call against these before issuing it:

- Microsoft Graph permissions reference:
  https://learn.microsoft.com/graph/permissions-reference
- Working with users in Microsoft Graph:
  https://learn.microsoft.com/graph/api/resources/users
- Set-Mailbox (Exchange Online):
  https://learn.microsoft.com/powershell/module/exchangepowershell/set-mailbox
- Restrict mailbox access (Application Access Policy):
  https://learn.microsoft.com/graph/auth-limit-mailbox-access
- Application RBAC in Exchange Online:
  https://learn.microsoft.com/exchange/permissions-exo/application-rbac
- Microsoft Teams PowerShell Overview:
  https://learn.microsoft.com/microsoftteams/teams-powershell-overview
- Manage Teams with Microsoft Teams PowerShell:
  https://learn.microsoft.com/microsoftteams/teams-powershell-managing-teams
- Use Microsoft Teams administrator roles:
  https://learn.microsoft.com/microsoftteams/using-admin-roles
- Device configuration in Microsoft Intune:
  https://learn.microsoft.com/graph/api/resources/intune-device-cfg-conceptual
- Assign Microsoft 365 licenses with PowerShell:
  https://learn.microsoft.com/microsoft-365/enterprise/assign-licenses-to-user-accounts-with-microsoft-365-powershell
- user: assignLicense API:
  https://learn.microsoft.com/graph/api/user-assignlicense