---
name: security-audit
description: "Unified security skill covering six audit types: (1) security review -- scan code for vulnerabilities (SQL injection, XSS, command injection, IDOR, weak crypto, hardcoded secrets); (2) secret scanning -- configure GitHub secret scanning, push protection, custom patterns, alert remediation; (3) MCP security audit -- audit .mcp.json files for hardcoded secrets, shell injection, unpinned dependencies; (4) threat modeling -- STRIDE-A threat model analysis and incremental updates; (5) breach blast radius -- pre-breach sensitive data inventory, data flow tracing, regulatory impact estimation (GDPR, CCPA, HIPAA); (6) GDPR compliance -- apply privacy-by-design engineering practices. Trigger phrases: security review, scan for vulnerabilities, secret scanning, push protection, MCP security audit, .mcp.json, threat model, STRIDE, blast radius, breach impact, GDPR compliance, is my code secure, audit codebase, check for secrets, data exposure."
---

# Security Audit

This skill unifies six security disciplines. The shared vulnerability taxonomy and severity
model live in the body. Each discipline's full workflow and reference material is in a
dedicated reference file below.

## Routing Table

Read the matching reference file first. Do not preload files for disciplines not in scope.

| Trigger | Load |
|---|---|
| "security review", "scan for vulnerabilities", "is my code secure?", "audit this codebase", SQL injection, XSS, IDOR, hardcoded secrets in code | `references/security-review.md` |
| "secret scanning", "push protection", GitHub secret scanning, custom patterns, blocked push, alert remediation | `references/secret-scanning.md` |
| "MCP security audit", ".mcp.json", "audit my MCP servers", shell injection in MCP, unpinned MCP dependencies | `references/mcp-security-audit.md` |
| "threat model", "STRIDE", "threat model analysis", incremental threat model, DFD, trust boundaries | `references/threat-model-analyst.md` |
| "blast radius", "breach impact", "what data could be exposed", sensitive data inventory, GDPR fines, HIPAA, CCPA, data exposure analysis | `references/data-breach-blast-radius.md` |
| "GDPR compliance", "is this GDPR-compliant?", privacy by design, data minimization, retention, anonymization, DPIA, RoPA | `references/gdpr-compliant.md` |

## Shared Vulnerability Taxonomy

All severity ratings follow this scale across all six disciplines:

| Severity | Meaning | Examples |
|---|---|---|
| CRITICAL | Immediate exploitation risk, data breach likely | SQLi, RCE, auth bypass, hardcoded production creds |
| HIGH | Serious vulnerability, exploit path exists | XSS, IDOR, exposed secrets, shell injection in MCP |
| MEDIUM | Exploitable with conditions or chaining | CSRF, open redirect, weak crypto, unpinned MCP deps |
| LOW | Best practice violation, low direct risk | Verbose errors, missing headers, npx without -y |
| INFO | Observation worth noting, not a vulnerability | Outdated dependency with no known CVE |

## Shared Output Rules (All Disciplines)

- Start with a findings summary table (counts by severity) before detail.
- Never auto-apply any patch, config change, or code edit -- present for human review.
- Include confidence rating per finding (High / Medium / Low).
- Group findings by category, not by file.
- Be specific: file path, line number, the exact vulnerable code or config excerpt.
- Explain the risk in plain English -- what could an attacker do with this?
- If the codebase or config is clean, say so clearly and state what was scanned.

## Reference Files -- Load Only When Triggered

| Load this | When |
|---|---|
| `references/security-review.md` | Code vulnerability scanning workflow, data flow analysis, patch generation |
| `references/secret-scanning.md` | GitHub secret scanning setup, push protection, custom patterns, alert management |
| `references/mcp-security-audit.md` | MCP server configuration auditing, hardcoded secrets, shell injection, pinning |
| `references/threat-model-analyst.md` | STRIDE-A threat modeling, DFD generation, incremental updates |
| `references/data-breach-blast-radius.md` | Sensitive data inventory, blast radius calculation, regulatory impact |
| `references/gdpr-compliant.md` | GDPR engineering practices, PR checklist, retention, anonymization |
