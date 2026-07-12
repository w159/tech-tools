---
name: atlas-vendor-assessment
description: Evidence-based vendor security assessment against a framework you name, citing provided docs per finding. Use when the output may reach an auditor or reviewer.
when_to_use: the output may reach an auditor or reviewer, and each finding must cite provided evidence
allowed-tools: Read, Glob, Grep, Bash, Write
argument-hint: '[vendor + services/data access] [framework(s)] [attach evidence: SOC 2, whitepaper, DPA, terms]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-metis/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-metis/references/operating-contract.md` and apply it before proceeding.

# `atlas-vendor-assessment`

Assess the vendor described in `$ARGUMENTS` against the framework(s) the user names, basing every finding strictly on the evidence the user provides.

Inputs to read from `$ARGUMENTS`: the vendor name and what they do or what data they would touch; the framework(s) to assess against, named by the user (examples only: SOC 2, ISO 27001, NIST CSF, GDPR, HIPAA, PCI DSS, or a sector-specific rule set, the user picks which applies); and the vendor's security documentation provided as evidence (SOC 2 report, security whitepaper, DPA, legal terms). If a required input is missing or ambiguous, ask once for it, then proceed. Never assume the user's industry or which regulator applies to them.

## Documentation first
- Treat the user-named framework as the rubric. If you need the exact control or clause text to map a finding, look it up from the framework's published source rather than reconstructing it from memory.
- For a SOC 2 report, note the report type (Type I or Type II), the report date, and whether it is current.

## Execute (evidence-based, no assumptions)
- Extract the exact relevant lines from the provided evidence first, then assess against the framework. Cite the specific source for every finding (document name plus section or page).
- If the evidence does not cover a control, record the status as "not addressed in provided evidence". Do not assume pass and do not assume fail.
- Map every identified gap to the specific control or clause it implicates in the named framework.
- Keep the tone objective. Do not soften or inflate. A gap is a gap, an unknown is an unknown. Use plain professional prose, U.S.-keyboard characters only, since a reviewer or auditor may read it.

## VERIFY
- Re-check each finding against its cited source: open the line again and confirm the citation supports the stated status.
- Confirm every gap is tied to a real control or clause in the named framework, not a generic concern.

## REPORT
- A findings table with columns: Control Area, Evidence Cited, Status, Framework Clause Implicated.
- A list of material gaps.
- A final recommendation on whether the vendor meets the named requirements, with the basis stated.

## Supporting files
- `references/assessment-rubric.md` - the status values (met / partial /
  not_met / not_addressed), severity per gap (blocker / major / minor /
  unknown), SOC 2 report-type handling, and evidence handling rules.
- `templates/assessment-report.seed.md` - the report skeleton with the
  standard sections (scope, findings table, material gaps, recommendation,
  verifications, open questions). Fill from the evidence; delete the blockquote
  before delivery.
