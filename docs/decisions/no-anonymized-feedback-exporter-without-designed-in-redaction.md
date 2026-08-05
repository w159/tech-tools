# No anonymized feedback exporter without designed-in redaction
Date: 2026-08-05
Status: accepted

## Context

An exporter (`plugins/atlas/scripts/atlas_feedback.py`,
`test_atlas_feedback.py`) was built to let a user share anonymized session
facets and findings (from the `facets`/`findings` tables added this date,
see CHANGELOG 2026-08-05) as feedback, without exposing the specifics of
their own environment. An adversarial verifier reviewed the export and
found it leaked the user's vendor stack into what was meant to be a
shareable, anonymized artifact: MCP connector UUIDs, vendor tool names, and
internal skill codenames all passed through unredacted.

## Decision

Delete the exporter (`atlas_feedback.py`, `test_atlas_feedback.py`) rather
than patch the leak retroactively. Anonymization added after the fact to an
exporter already shaped around raw internal identifiers is a pattern likely
to leak again the next time a new field is added to `facets` or `findings`.

## Consequences

- No anonymized feedback export capability exists today. The `facets` and
  `findings` tables keep accumulating regardless, so a future rebuild has
  the data it needs.
- A future rebuild must design the redaction boundary first (what fields are
  ever eligible to leave the machine, denylist-by-default) rather than
  building the full export and subtracting sensitive fields afterward.
- Tracked as a backlog item in `docs/ROADMAP.md` ("Atlas self-improvement
  follow-ups (added 2026-08-05)"), not scheduled.
