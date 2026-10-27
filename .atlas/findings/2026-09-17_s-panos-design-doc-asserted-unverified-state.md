# S-panos-design-doc-asserted-unverified-state: A connector contract recorded a fully-ticked propagation checklist while four defects survived in the shipped artifact, because nothing had touched hardware

- id: S-panos-design-doc-asserted-unverified-state
- status: verified
- verified_by: main-agent-live-appliance
- verified_at: 2026-09-17T15:45:00+00:00

## Evidence
- The design doc's 'As shipped' section claimed 60 tools / 32 destructive and a complete checklist, then closed with 'Nothing here has been exercised against live hardware.' Both statements were true simultaneously - the checklist measured build steps, not behavior.
- One hour of live read-only calls found: identifier-destroying XML coercion, credential-blaming error hints, discarded appliance messages, an undocumented job namespace, and a leaked key prefix. None were findable offline; the offline suite was green throughout.
- Earlier the same day the .mcpb freshness box was ticked [x] while the artifact predated its newest source by 32 seconds (S-panos-mcpb-stale-artifact).
- Lesson: a checklist box may only be ticked by the check it names. 'Built and packed' is not 'works against the appliance', and a green offline suite over mocked fetch cannot see wire-format coercion.

## Reproduction
none recorded

## Proposed fix
Connector contracts should carry a live-validation section that names the appliance, the date, and the tool classes actually exercised, with unexercised classes listed by name rather than implied.

## Doc refs
- docs/architecture/panos-connector-design.md
- .atlas/evidence/2026-09-17-panos-live-validation.md

## History
- no earlier verdicts
