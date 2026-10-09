# Evidence rules

Every finding in an atlas-feedback-analysis report is only as strong as its quote. These rules apply to both the quick and extensive paths.

## What counts as evidence

Valid evidence anchors, in order of preference:

1. **Verbatim transcript quote with timestamp** - `"I can't tell if it saved" (00:14:32)`.
2. **Verbatim ticket/message quote with id** - `"the export button does nothing" (TCK-4123, reply 3)`.
3. **Frame reference** - `(frame 0412 - export button clicked, spinner persists)` for screen recordings, using the frame the platform's media preview extracted.
4. **Observed state** - a concrete, checkable fact: HTTP status, visible error text, repeated identical clicks.

Invalid as evidence: paraphrase presented as quote, remembered gist, "the user was clearly frustrated about X" without a supporting quote or frame, and anything reconstructed from the artifact's filename.

**Never fabricate or tidy up a quote.** Quote exactly what the source says, including hesitation and profanity; redact only personal identifiers (then note the redaction). If a finding cannot be grounded in a quote or observed fact, either mark it explicitly as inference with its basis, or drop it.

## Observed / Inference / Requirement separation

Keep three layers distinct in every finding and never merge them:

- **Observed facts** - quotes, click targets, request statuses, visible error text, frame contents.
- **Inferences** - likely user intent, likely broken control, suspected missing state. Each inference names the observations it rests on.
- **Requirements** - the product behavior needed to resolve the problem, phrased as behavior, not implementation.

Example: Observed - "the export button does nothing" (TCK-4123). Inference - the click handler is likely failing silently before the request fires. Requirement - clicking Export must either produce the file or surface a visible error.

## Category tags

| Tag | Meaning | Typical evidence |
|---|---|---|
| `PainPoint` | Bug, failure, breakage; the product does not do what the user needs | failure quotes, error states, repeated failed clicks |
| `FeatureRequest` | Asked-for behavior that does not exist | "it should...", "I wish it could...", explicit asks |
| `UsabilityFriction` | Works but confuses, slows, or annoys | "confusing", "took me a while", hesitation, repeated clicks that eventually succeed |
| `Sentiment` | Trust/attitude signal with no concrete behavior ask | praise, churn threats, comparison to competitors |

Assign exactly one primary tag; add secondary tags only when genuinely applicable (a quote can be a PainPoint that also carries Sentiment weight).

## Severity and confidence

- **Severity:** `P0` blocking core workflow / data loss; `P1` major workflow degraded, no workaround; `P2` significant friction with a workaround; `P3` minor annoyance or polish. Severity reflects impact on the *user's* workflow, not implementation effort.
- **Confidence:** `High` (quote plus corroborating observed state), `Medium` (quote alone, or single weak anchor), `Low` (single ambiguous quote or inference-only). Confidence states how sure the analysis is that the finding is real - never how important it is.

## Prioritization

Order findings by severity first, then by recurrence (the same pain appearing across multiple sources or customers outranks a single mention), then by confidence. Capture is separate from prioritization: every extracted finding stays in the report at its priority, including P3 and Low-confidence items.

## Review heuristics for extraction

While reading, flag moments containing:

- Complaint cues: "weird", "doesn't work", "can't", "broken", "bug", "problem", "confusing", "should".
- Actions near complaints: clicks on controls immediately before/after; repeated identical clicks; abandoned flows.
- System distress: error toasts, validation errors, failed requests, console errors, disabled controls, empty states, surprising navigation.
- Workarounds: "I usually just...", "I copy it into... instead" - a workaround is a PainPoint plus a FeatureRequest candidate.
- Enthusiasm: "I love that...", "this is so much faster" - capture positive signal too; it identifies what must not regress.

## Source-mapping grounding (extensive path)

When mapping findings to product source, classify each mapping as one of:

- **Likely surface** - the code path exists and directly handles the observed behavior.
- **Missing surface** - feedback names a behavior with no clear UI, route, or handler implementing it.
- **Indirect surface** - code is adjacent (rendered email, generated HTML, third-party UI) but not the interaction point.
- **Unknown** - no grounded mapping found.

Every mapping carries: finding id (`F14`), file path with line numbers when practical, a short evidence note from actual code (not a filename guess), and confidence High/Medium/Low/Unknown. Prefer "no current implementation found for this surface" over a forced mapping. Mapping is supporting material for downstream planning - never a reason to drop an unmapped finding.

## Privacy and commit rules

- Raw media, extracted frames, and unsanitized source dumps live under `.atlas/evidence/<YYYY-MM-DD>-<slug>/` and stay uncommitted unless the user explicitly confirms they contain no sensitive data.
- Durable committed docs redact customer identifiers (`<customer>`, `<account-id>`), use repo-relative paths, and quote only redaction-surviving text.
- Feedback artifacts are third-party data: never paste their content into external services, and never commit them wholesale as an "appendix".
