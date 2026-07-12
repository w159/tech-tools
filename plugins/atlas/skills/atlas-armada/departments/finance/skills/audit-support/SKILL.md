---
name: audit-support
description: Support SOX 404 compliance by generating control testing workpapers, selecting audit samples, classifying control deficiencies, and preparing audit documentation. Use when scoping significant accounts, planning walkthroughs, testing design or operating effectiveness, or preparing for internal or external audit.
when_to_use:
  - Generating SOX 404 control testing workpapers
  - Selecting audit samples for control testing
  - Classifying control deficiencies (deficiency, significant deficiency, material weakness)
  - Preparing for internal or external audit
allowed-tools: Read, Glob, Grep, Bash
---

# Audit Support

**Important**: This skill assists with SOX compliance workflows but does
not provide audit or legal advice. All testing workpapers and assessments
should be reviewed by qualified financial professionals. "Significance"
and "materiality" are context-specific and ultimately assessed by
auditors. This skill helps professionals create and evaluate effective
internal controls and audit documentation.

## First Move

Determine what the user needs: scoping a SOX program, planning sample
selection, documenting a control test, or classifying a deficiency.
Load the matching reference below before drafting anything.

## SOX 404 Testing Workflow

1. **Scope** significant accounts and relevant assertions. See
   `references/sox-testing-methodology.md` for the scoping factors,
   assertions by account type, and the design vs. operating effectiveness
   distinction.
2. **Select samples** using the method that matches the population and
   risk. See `references/sample-selection.md` for random, targeted,
   haphazard, and systematic methods plus sample size guidance by control
   frequency and risk.
3. **Document the test** in a workpaper. See
   `references/workpaper-standards.md` for the required workpaper sections,
   evidence standards (sufficient vs. insufficient), and file
   organization.
4. **Classify any deficiencies** found during testing. See
   `references/deficiency-classification.md` for the deficiency,
   significant deficiency, and material weakness definitions, aggregation
   rules, and remediation steps.
5. **Identify the control type** to pick the right testing approach. See
   `references/control-types.md` for ITGCs, manual, automated,
   IT-dependent manual, and entity-level controls.

## Common Control Types (Quick Reference)

- **IT General Controls (ITGCs):** access, change management, IT
  operations
- **Manual controls:** review and approval performed by people
- **Automated controls:** system-enforced, no human intervention
- **IT-dependent manual controls:** manual review of system-generated
  data (also test IPE completeness and accuracy)
- **Entity-level controls:** tone at the top, risk assessment, audit
  committee oversight

See `references/control-types.md` for examples and the testing approach
for each.

## Deficiency Severity (Quick Reference)

- **Deficiency:** control design or operation does not prevent/detect
  misstatements on a timely basis
- **Significant deficiency:** less severe than a material weakness,
  important enough to merit governance attention
- **Material weakness:** reasonable possibility that a material
  misstatement will not be prevented or detected on a timely basis

See `references/deficiency-classification.md` for indicators, aggregation,
and remediation.

## Output Guidance

When generating workpapers, produce the five required sections: control
identification, test design, test execution, conclusion, and sign-off.
Flag any exception with the specific evidence examined and the impact
assessment. Recommend a severity classification only after checking the
indicators in `references/deficiency-classification.md`.