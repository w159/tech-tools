# Threat Model Analyst

Sourced from the threat-model-analyst skill. Full STRIDE-A threat model analysis and
incremental update workflow for repositories and systems.

## Modes

### Incremental Mode (preferred for follow-up analyses)

Trigger when the user mentions: "update", "refresh", "re-run", "incremental", "what changed",
"since last analysis" -- AND a prior `threat-model-*` folder exists with a
`threat-inventory.json`, OR the user explicitly provides a baseline report folder.

Examples:
- "Update the threat model using threat-model-20260309-174425 as the baseline"
- "Run an incremental threat model analysis"
- "What changed security-wise since the last threat model?"

Incremental workflow:
1. Load the prior report's threat inventory (`threat-inventory.json`).
2. For each prior finding, check whether it is still present, resolved, or changed.
3. Scan current codebase for new threats not in the prior report.
4. Generate a new standalone report with status annotations (new / resolved / still-present).
5. Embed an HTML comparison table showing before/after state for every finding.

### Single Analysis Mode

For all other requests: analyze a repo, generate a threat model, perform STRIDE-A analysis.

## STRIDE-A Framework

STRIDE-A extends classic STRIDE with Abuse cases:

| Letter | Category | Examples |
|---|---|---|
| S | Spoofing | Auth bypass, identity impersonation |
| T | Tampering | Data modification, parameter injection |
| R | Repudiation | Missing audit logs, forged timestamps |
| I | Information Disclosure | Data exposure, verbose errors |
| D | Denial of Service | Rate limit bypass, resource exhaustion |
| E | Elevation of Privilege | IDOR, privilege escalation, SSRF |
| A | Abuse | Business logic misuse, account takeover flows |

## Single Analysis Workflow

### Step 1 -- Scope and Architecture Discovery
- Identify language(s), frameworks, databases, and external integrations.
- Map the application's main components and trust boundaries.
- Identify data entry points (HTTP, queues, files, webhooks) and data sinks.

### Step 2 -- Data Flow Diagram (DFD)
- Create a Mermaid DFD showing components, data flows, and trust boundaries.
- Use distinct shapes: rectangles for processes, cylinders for data stores,
  parallelograms for external entities, dashed lines for trust boundaries.
- Label each arrow with the data flowing across it.

### Step 3 -- STRIDE-A Analysis
- For each component and data flow, enumerate applicable STRIDE-A threats.
- For each threat: describe the attack scenario, identify mitigating controls (present or
  absent), and assign severity (CVSS 4.0 where applicable) and CWE/OWASP mapping.

### Step 4 -- Findings
- Produce a prioritized findings list (CRITICAL -> LOW).
- Each finding: threat category, component, attack scenario, current controls, gap,
  recommended remediation, effort estimate.

### Step 5 -- Executive Assessment
- 2-3 paragraph summary for non-technical leadership.
- Overall risk posture (High / Medium / Low).
- Top 3 recommended actions.

## Output Files

Standard single-analysis output structure (write to `threat-model-<date>/`):
- `0.1-architecture.md` -- architecture overview
- `1-threatmodel.md` -- DFD and component inventory
- `2-stride-analysis.md` -- full STRIDE-A analysis table
- `3-findings.md` -- prioritized findings with remediation
- `0-assessment.md` -- executive summary
- `threat-inventory.json` -- machine-readable finding registry (used as baseline for
  incremental mode)

## Verification Rules

Before delivering any threat model output:
- All Mermaid diagrams must render without syntax errors.
- Every finding must cite the component, the specific threat, and at least one CWE or OWASP
  reference.
- The threat inventory JSON must be well-formed and include all findings from the report.
- Cross-check: every finding in `3-findings.md` must appear in `threat-inventory.json`.

## When to Activate

**Incremental mode:** update/refresh/re-run an existing threat model; track fixed vs. new
threats; when a prior `threat-model-*` folder exists.

**Single analysis mode:** first-time threat model; STRIDE-A analysis of a component;
generating DFD from code; validating security controls; trust boundary analysis.
