# Assessment Rubric

How atlas-vendor-assessment scores a vendor against the user-named framework.
Every finding must cite provided evidence; the rubric is the yardstick, not a
substitute for the evidence.

## Status values (per control area)

| Status | Meaning | When to use |
|---|---|---|
| met | The evidence shows the control is in place and operating. | Cited source explicitly demonstrates the control. |
| partial | The evidence shows the control is in place but with gaps. | Cited source shows the control exists but a sub-requirement is missing or scoped out. |
| not_met | The evidence shows the control is absent or fails. | Cited source explicitly shows the control is missing or fails. |
| not_addressed | The provided evidence does not cover this control. | No cited line speaks to the control. Never assume pass or fail. |

## Severity (per gap)

| Severity | Definition |
|---|---|
| blocker | The control is absent or fails and the framework treats it as a hard requirement. Recommend against the vendor for the named scope until resolved. |
| major | The control is partially met and the gap materially weakens the posture. Recommend conditional approval with a remediation timeline. |
| minor | The control is partially met and the gap is administrative or cosmetic. Recommend approval with a note. |
| unknown | The evidence does not cover the control. Recommend follow-up to request more evidence before scoring. |

## Mapping to the framework

Every finding implicates a specific control or clause in the user-named
framework. Look up the exact clause text from the framework's published source
when mapping a finding - do not reconstruct clause text from memory. If the
framework is sector-specific and the user did not name a sector, ask once.

## SOC 2 specifics

When the user names SOC 2:
- Note the report type (Type I = design at a point in time; Type II =
  design and operating effectiveness over a period).
- Note the report date and whether it is current (within the typical
  12-month window).
- A Type I report cannot demonstrate operating effectiveness; record that
  limitation as a major gap if the user needs effectiveness evidence.

## Evidence handling rules

- Extract the exact relevant lines from the provided evidence first, then
  assess. Never assess from a summary alone.
- Cite the document name plus section or page for every finding.
- If the evidence is redacted in a way that obscures the control, record
  `not_addressed` and note the redaction.
- Do not infer a control from a marketing claim. A whitepaper's claim of
  "encryption at rest" is not the same as a SOC 2 control describing the
  mechanism; cite the control, not the marketing.

## Tone

Objective. Do not soften or inflate. A gap is a gap, an unknown is an unknown.
Plain professional prose, U.S.-keyboard ASCII only, since a reviewer or
auditor may read it. No marketing language, no superlatives.