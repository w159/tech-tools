# Vendor Mappings for Incident Correlation

This file provides vendor-specific field mappings and normalization tables used by the incident correlation skill. Separating mappings from the workflow keeps the skill maintainable as new vendor stacks are added.

## Priority Normalization

Map vendor-specific priority values to a canonical scale:

| Canonical | Autotask | HaloPSA | ConnectWise Manage | Syncro | Atera | SuperOps |
|-----------|----------|---------|-------------------|--------|-------|----------|
| Critical | 4 (CRITICAL) | 1 (Critical) | Priority 1 | 1 (Critical) | 4 (Critical) | Critical |
| High | 3 (HIGH) | 2 (High) | Priority 2 | 2 (High) | 3 (High) | High |
| Medium | 2 (MEDIUM) | 3 (Medium) | Priority 3 | 3 (Normal) | 2 (Medium) | Medium |
| Low | 1 (LOW) | 4 (Low) | Priority 4 | 4 (Low) | 1 (Low) | Low |

**Key gotcha:** Autotask uses 4=Critical (higher number = higher priority), while HaloPSA uses 1=Critical (lower number = higher priority). Always normalize before comparing.

## Status Normalization

| Canonical | Autotask | HaloPSA | ConnectWise Manage | Syncro | Atera |
|-----------|----------|---------|-------------------|--------|-------|
| New | 1 (NEW) | New | New | New | Open |
| In Progress | 2 (IN_PROGRESS) | In Progress | In Progress | In Progress | Pending |
| Waiting | 6 (WAITING_CUSTOMER) | Awaiting Reply | Waiting | Customer Reply | Pending |
| Escalated | 14 (ESCALATED) | Escalated | Escalated | Escalated | - |
| Complete | 5 (COMPLETE) | Closed | Closed | Resolved | Resolved |

## Company/Organization Field Mapping

How each vendor identifies companies/organizations:

| Concept | Autotask | Datto RMM | IT Glue | Liongard |
|---------|----------|-----------|---------|----------|
| Company entity | Company | Site | Organization | Environment |
| Company ID field | `companyID` | `siteUid` | `organization-id` | `ID` (Environment) |
| Company name field | `companyName` | `siteName` | `name` | `Name` |
| Lookup method | `autotask_search_companies` | Site list via API | `GET /organizations` | `GET /api/v1/environments` |

## Device/Asset Field Mapping

| Concept | Autotask | Datto RMM | IT Glue | Liongard |
|---------|----------|-----------|---------|----------|
| Device entity | Configuration Item | Device | Configuration | System |
| Device ID field | `id` | `deviceUid` | `id` | `ID` |
| Hostname field | `referenceTitle` | `hostname` | `hostname` | `SystemName` |
| Status field | `isActive` | `status` (online/offline) | `configuration-status-id` | via inspection status |
| IP address field | - | `intIpAddress` / `extIpAddress` | via interfaces | via system details |
| Serial number field | `serialNumber` | via audit | `serial-number` | via inspection data |
| Device type field | `configurationItemType` | `deviceType` | `configuration-type-id` | `InspectorName` |

## Contact Field Mapping

| Concept | Autotask | IT Glue |
|---------|----------|---------|
| Contact entity | Contact | Contact |
| Contact ID field | `id` | `id` |
| Name fields | `firstName`, `lastName` | `first-name`, `last-name` |
| Email field | `emailAddress` | `contact-emails` |
| Phone field | `phone` | `contact-phones` |
| Company link | `companyID` | `organization-id` |

## MCP Tool Mapping Per Workflow Step

Which MCP tools to call at each step of the correlation workflow:

### Step 1: Get Ticket (PSA)

| Vendor Stack | MCP Tool |
|-------------|----------|
| Kaseya (Autotask) | `autotask_get_ticket_details` or `autotask_search_tickets` |
| ConnectWise | ConnectWise Manage API |
| HaloPSA | HaloPSA API |
| Syncro | Syncro API |

### Step 2: Identify Company

| Vendor Stack | MCP Tool |
|-------------|----------|
| Kaseya (Autotask) | `autotask_search_companies` |
| ConnectWise | ConnectWise Manage companies API |
| HaloPSA | HaloPSA clients API |
| Syncro | Syncro customers API |

### Step 3: Find Device

| Vendor Stack | MCP Tool |
|-------------|----------|
| Kaseya (Autotask) | `autotask_search_configuration_items` |
| Kaseya (Datto RMM) | Datto RMM device API (filter by `siteName` or `hostname`) |
| ConnectWise (Automate) | Automate computers API |

### Step 4: Query RMM

| Vendor Stack | MCP Tool |
|-------------|----------|
| Kaseya (Datto RMM) | Device API (`status`, `lastSeen`, `lastReboot`) + Alerts API |
| ConnectWise (Automate) | Computer status + alerts |
| NinjaOne | Device info + alerts |

### Step 5: Query Documentation

| Vendor Stack | MCP Tool |
|-------------|----------|
| Kaseya (IT Glue) | `GET /configurations` (by org + hostname), `GET /documents`, `GET /passwords` (names only) |
| ConnectWise (Manage) | Configuration lookup |
| Hudu | Asset lookup |

### Step 6: Query Config Monitoring

| Vendor Stack | MCP Tool |
|-------------|----------|
| Liongard | `POST /api/v1/detections` (filter by `EnvironmentID` + recent `DetectedOn`), `POST /api/v2/metrics/evaluate-systems` |

## Adding a New Vendor Stack

To extend incident correlation to a new vendor, fill in these mapping tables:

### PSA Mapping Template

| Field | Your Vendor Value |
|-------|------------------|
| Ticket ID field | |
| Title field | |
| Description field | |
| Company ID field | |
| Contact ID field | |
| Priority field | |
| Status field | |
| Created date field | |
| MCP tool / API endpoint | |

### RMM Mapping Template

| Field | Your Vendor Value |
|-------|------------------|
| Device ID field | |
| Hostname field | |
| Status field | |
| Last seen field | |
| Last reboot field | |
| IP address field | |
| Alert list endpoint | |
| MCP tool / API endpoint | |

### Documentation Platform Template

| Field | Your Vendor Value |
|-------|------------------|
| Asset/Config ID field | |
| Hostname field | |
| Organization link field | |
| Documents endpoint | |
| Passwords endpoint (names only) | |
| MCP tool / API endpoint | |

### Config Monitoring Template

| Field | Your Vendor Value |
|-------|------------------|
| Detection/Change ID field | |
| Severity field | |
| Change date field | |
| Environment/Company link | |
| Summary field | |
| MCP tool / API endpoint | |
