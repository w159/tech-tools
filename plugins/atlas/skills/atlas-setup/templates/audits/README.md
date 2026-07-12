# Audits

Audit reports: security, quality, performance, and compliance.

## What lives here

- `security/` - atlas-audit security audit reports
- `quality/` - atlas-audit code-quality audit reports
- `performance/` - performance audit reports
- `compliance/` - compliance framework audits (SOC 2, HIPAA, ISO 27001)

## Report template

```
# <type> audit - YYYY-MM-DD
Auditor: <skill>
Scope: <files/modules scanned>

## Findings
| ID | Severity | File:line | Finding | Recommendation |
|----|----------|-----------|---------|----------------|

## Verdict
Pass / fail with the count of findings by severity.
```

atlas-audit owns this folder. atlas-setup only creates it.