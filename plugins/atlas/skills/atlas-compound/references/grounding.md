# Grounding-Claims Check (mechanical)

Ported from CE `ce-compound`'s `references/grounding-validation.md` + `scripts/validate-doc-claims.py` semantics (w159/compound-engineering-plugin). This check runs on the FULL assembled draft (frontmatter + body) in Phase 5, before the docs-curator dispatch. It is mechanical: each step either passes with counted evidence or fails with a named claim. A draft that cannot be grounded is skipped, never written on faith.

## 1. Re-verify every file:line citation against CURRENT source

For each `file:line` citation and each quoted snippet in the draft:

- Re-open the file at the cited lines NOW (fresh read; the working tree may have moved since you last looked). The cited symbol/behavior/error must actually be there at those lines.
- A citation that no longer matches is corrected to the current location, or the claim is deleted. Never adjust the draft to "what the file used to say."
- Count verified citations for the terminal signal's `grounding` field.

This is the core mechanic and is never reduced in Lightweight mode.

## 2. Merge-state claims cite remote truth, not local state

Claims about what is merged/shipped/deployed cite PR numbers, issue numbers, or remote refs - never a local commit SHA (it may not exist remotely), never "as of this session", never `HEAD`.

## 3. Command claims cite observed output

A claim that "X passes" / "Y returns Z" cites a command actually run this session with observed output, or evidence under `.atlas/evidence/` / a `.atlas/.run/findings.json` verdict. Anything else is marked `[unverified]` - and an unverified load-bearing claim fails the gate in Phase 1 (the lesson wasn't verified).

## 4. No drafting scaffolds

The final artifact contains no `TODO`, `[placeholder]`, `Learning N` references, bracketed template remnants, or section placeholders. Search the draft for the template's bracketed tokens from `references/templates.md` and confirm none survived.

## 5. Relative links resolve

Any relative link or cross-reference in the body (`Related Issues`/`Related` entries, linked docs) must point at a file that exists in the target project right now. Cross-tree references to `.atlas/findings/<date>-<slug>.md` are verified to exist (or the reference is dropped).

## 6. Frontmatter validation

Run the full checklist at the end of `references/schema.md`: track determination, required fields, enums exact, date format, YAML-safety quoting, `title` matches H1, slug is filesystem-safe and date-first (`<YYYY-MM-DD>-<slug>.md`).

## Verdict

- All checks pass -> proceed to the Phase 6 dispatch; record the verified-claims count.
- Any claim fails and cannot be corrected -> return to Phase 4 and fix the draft; if it still cannot be grounded -> emit `Learning skipped` with the ungroundable claim list. A lesson grounded in stale memory is worse than no lesson: the corpus's entire value is that future engineers can trust its citations.