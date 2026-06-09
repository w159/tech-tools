# Data Breach Blast Radius

Sourced from the data-breach-blast-radius skill. Pre-breach impact analysis: inventories
sensitive data, traces data flows, scores exposure vectors, and produces a regulatory blast
radius report with fine ranges sourced from GDPR Art. 83, CCPA, and HIPAA 45 CFR 160.404.

## When to Activate

- Auditing a codebase before a security review or pentest
- Preparing a data processing impact assessment (DPIA)
- Building or reviewing a disaster recovery / incident response plan
- Onboarding a new system that handles customer data
- Preparing for regulatory compliance (GDPR, CCPA, HIPAA, SOC 2)
- Any request mentioning: blast radius, breach impact, data exposure, sensitive data
  inventory, data risk, worst-case scenario
- Direct invocation: `/data-breach-blast-radius`

## Output Calibration

- **Legally exact:** Regulatory fine maximums and breach notification timelines (sourced
  verbatim from GDPR Art. 83, CCPA, 45 CFR 160.404, etc.)
- **Planning estimates:** Blast radius scores, financial impact ranges, record counts
  (heuristic models based on OWASP risk methodology and IBM benchmarks)
- Always state in output which figures are law-sourced (exact) vs. model-derived (estimate).
- Never replace qualified legal counsel or a formal DPIA/risk assessment.

## Execution Workflow

### Step 1 -- Scope and Stack Detection

- Detect language(s) and frameworks (package.json, requirements.txt, go.mod, pom.xml, etc.)
- Identify the database layer (ORM models, schema files, migrations, Prisma, SQLAlchemy, etc.)
- Identify API layer (REST controllers, GraphQL schemas, gRPC proto files, OpenAPI specs)
- Identify infrastructure-as-code (Terraform, Bicep, CloudFormation) for storage resource exposure

### Step 2 -- Sensitive Data Inventory

Scan ALL files for sensitive data definitions across:

**Data model layer:** schemas, migrations, ORM models, entity classes, GraphQL types
**API contract layer:** REST DTOs, GraphQL return types, gRPC proto messages, OpenAPI fields
**Configuration and secrets:** .env files, CI/CD pipeline files, Docker/Kubernetes configs
**Log and audit layer:** logging statements, analytics/telemetry integrations, audit tables

For each sensitive data field found, record:
```
| Field | Table/Source | Data Tier | Purpose | Encrypted? | Notes |
```

Classification basis follows GDPR Article 9 (special categories), PCI-DSS v4.0, and HIPAA
45 CFR Part 164.

### Step 3 -- Data Flow Tracing

Trace how sensitive data moves through the system:

- **Ingestion points:** form submissions, API endpoints, file uploads, webhooks, SSO, ETL
- **Processing points:** business logic, caching (Redis), message queues (Kafka, SQS),
  background jobs
- **Storage points:** primary databases, file storage (S3, Blob), search indexes
  (Elasticsearch), analytics warehouses, backup stores
- **Transmission points:** outbound API calls, webhook deliveries, report exports,
  email/SMS notifications
- **Exposure points:** public API endpoints, missing auth checks (IDOR/BOLA), overly broad
  responses, CORS misconfigs, public storage buckets, sensitive data in logs or error messages

### Step 4 -- Blast Radius Calculation

```
Blast Radius Score = Data Sensitivity Tier x Exposure Likelihood x Population Scale x Data Completeness
```

Population scale estimates (use when count is not in code):
- SaaS product: assume 10K-1M users
- Internal tool: assume 100-10K users
- Consumer app: assume 100K-10M users

Regulatory multipliers: minors (x2), health data (x3), financial credentials (x5).

Jurisdiction detection:
- GDPR: EU currencies/phone formats/.eu domains/EU datacenter regions
- CCPA: California residents/US .com/Stripe US/state-specific tax logic
- HIPAA: health record fields (diagnosis, medication, ICD codes, FHIR resources)
- LGPD: Brazilian users/BRL currency/CPF fields
- PDPA: Singapore/Thailand/Malaysia/Philippines data patterns

Apply ALL matching jurisdictions -- the most restrictive governs notification timeline.

### Step 5 -- Regulatory Impact Estimation

For each triggered jurisdiction:
- Maximum fine exposure (regulatory formula)
- Minimum fine exposure (realistic for first offense with cooperation)
- Breach notification cost (legal, communications, credit monitoring)
- Reputational multiplier (public-facing breach vs. internal tool)

Financial Impact Summary Table:
```
| Regulation | Max Fine | Realistic Fine | Notification Cost | Timeline |
```

### Step 6 -- Blast Radius Report

The report MUST include:
1. Executive Summary (2-3 paragraphs, no jargon)
2. Sensitive Data Inventory (table of all PII/PHI/financial/credential fields)
3. Data Flow Map (Mermaid diagram; use `fill:#ff4444` for critical, `fill:#ff8800` for high)
4. Top 5 Exposure Vectors (ranked by blast radius score)
5. Regulatory Blast Radius Table (per-jurisdiction)
6. Financial Impact Estimate (realistic range)
7. Hardening Roadmap (prioritized by impact x severity / effort)

### Step 7 -- Hardening Roadmap

For each critical or high-severity exposure vector:
- What to fix: specific code/config change
- Why: regulatory risk and user impact
- Effort: Low / Medium / High
- Impact: blast radius reduction percentage (estimated)
- Quick win flag: mark items fixable in < 1 day

Sort by: (Impact x Severity) / Effort -- highest value first.

## Sensitivity Tiers

| Tier | Label | Examples | Multiplier |
|---|---|---|---|
| T1 | Catastrophic | Government IDs, biometric data, health records, financial credentials, passwords | x5 |
| T2 | Critical | Full name + address + DOB combined, PAN, SSN, passport numbers | x4 |
| T3 | High | Email + password (hashed), phone numbers, precise geolocation, IP addresses | x3 |
| T4 | Elevated | First name only, email address only, general location, usage analytics | x2 |
| T5 | Standard | Non-personal config data, public content, anonymized aggregates | x1 |

## Output Rules

- Always start with the Executive Summary.
- Always include the Sensitive Data Inventory table.
- Always produce the Financial Impact Estimate.
- Never auto-apply any code changes.
- Be specific: cite file paths, field names, and line numbers for every finding.
- State assumptions: if record count is estimated, say so explicitly.
- Distinguish "this is definitely exposed" from "this could be exposed under conditions X".
