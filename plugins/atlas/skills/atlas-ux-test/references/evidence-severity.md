# Evidence and severity protocol

The contract every finding, story, and feedback entry obeys so the synthesis gate (G2) can
pass or reject it mechanically. If a deliverable is missing a required field below, the
synthesis-reporter rejects the entry and flags the run.

## Evidence capture

- Screenshots live under `RUN_DIR/evidence/ux/<persona_id>/NN-desc.png`, all paths relative
  to RUN_DIR. The project drives real Chrome via the browser-harness CLI
  (`capture_screenshot()`, `click_at_xy()`, `new_tab()`, `wait_for_load()`).
- Before/after per mutating step is a first-class requirement, not optional. Every step that
  writes data (submit, save, next) produces a pair: `NN-before-<desc>.png` taken immediately
  before the action, `NN-after-<desc>.png` immediately after. The pair is the proof the action
  changed state. A mutating step with no pair is not evidence.
- Evidence chain per finding: the exact route, the selector acted on, the exact value shown on
  screen, and the screenshot file(s) that show it. "Route visited" is never proof of correct
  data; only a screenshot of the displayed value is.

## Nielsen 0-4 severity

Severity is computed, not guessed, from three factors:
- frequency: how often the problem occurs across personas and steps.
- impact: how hard it is for the persona to overcome once hit.
- persistence: a one-time obstacle vs a repeated one the persona keeps hitting.

A common, hard-to-overcome, repeated problem rates 4. Map the Nielsen scale to the run's
disposition labels:

| Nielsen | Meaning                          | Run label |
|---------|----------------------------------|-----------|
| 0       | not a usability problem          | (drop)    |
| 1       | cosmetic, fix only if spare time | Cosmetic  |
| 2       | minor, low priority              | Minor     |
| 3       | major, important, high priority  | Major     |
| 4       | catastrophe, fix before release  | Blocker   |

Release rule: do not release with any unresolved level-4 (Blocker). A run carrying only
level-1 (Cosmetic) findings may proceed. Any accuracy mismatch beyond 1 cent is automatically
a Blocker (fiduciary surface). A G1 client-surface failure (entered value not displayed, or a
calc card that will not resolve) is automatically a Blocker.

## Required fields per deliverable

Bug report (`templates/bug-report.md`) - reject if ANY missing:
- title
- before screenshot path (file must exist)
- after screenshot path (file must exist)
- reproduction steps
- expected-vs-actual
- Nielsen severity (0-4) with the frequency/impact/persistence basis
- route + selector
- persona id
- layer the symptom points to (frontend / backend / admin-webapp / database)
- evidence_ref that resolves to an existing file

User story (`templates/user-story.md`):
- "As a [rank] with [situation], I want to [goal] so that [outcome]"
- acceptance criteria, each with a pass/fail verdict
- persona id
- at least one linked screenshot

Persona feedback (`templates/persona-feedback.md`):
- persona id and review lens
- friction log entries (each: route, selector, expected-vs-actual, severity, before+after
  screenshots)
- acceptance verdicts
- G1 verdict (met / not met, with the values that failed to display or cards that failed)
- ranked feature requests / complaints in the persona's voice, tagged free-tier or premium
- at least one linked screenshot
