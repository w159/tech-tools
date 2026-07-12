# Inter-stage handoff seed

Copy this template into the running stack to carry the baton from one
stage to the next. One handoff per stage boundary. See
`references/handoff-format.md` for the rules behind each field.

```
PRODUCED: {artifact path or "none (read-only stage)"}
EVIDENCE: {evidence path or test result, or "none (read-only stage)"}
STATUS:   {verified | rejected | partial}
NEXT:     {the single constraint the next stage must honor, or "none"}
```

Example, an atlas-athena stage handing to an atlas-metis remediation
stage:

```
PRODUCED: .atlas/docs/audits/atlas-athena-2026-07-11/report.md (12 verified findings: 3 HIGH, 6 MED, 3 LOW)
EVIDENCE: .atlas/docs/audits/atlas-athena-2026-07-11/handoffs/<finding-id>.md per accepted finding
STATUS:   verified
NEXT:     remediate the 3 HIGH findings first; each handoff ends with `atlas-launch <finding-id>`
```

Example, a discovery-only atlas-ariadne stage handing to a redesign
stage:

```
PRODUCED: .atlas/docs/audits/atlas-ariadne-2026-07-11/proposal.md (2 systems targeted for unification)
EVIDENCE: none (read-only mapping stage)
STATUS:   partial
NEXT:     the proposal rejects any unification that adds an abstraction layer; honor that when implementing
```

Fill every field. An empty field is a bug: the next stage is guessing
what this stage left behind. If a field genuinely has no value, say so
explicitly (for example `EVIDENCE: none (read-only stage)`) rather than
leaving it blank.