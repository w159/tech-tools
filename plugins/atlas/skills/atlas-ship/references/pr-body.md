# PR title and body: compose from the diff, ground in the artifacts

The diff is already visible on GitHub. The description exists to explain what the diff cannot show: what was impossible before and is now possible, what was broken and is now fixed, what shape changed. Cut any sentence a reader could reconstruct from the diff itself.

- Bad (lists what was edited): "Adds `evidence-decider.ts`, modifies `SKILL.md` to call it, and updates two test files."
- Good: "Evidence capture now decides automatically whether a change has observable behavior. CLI tools and libraries are now eligible alongside web UIs."

If the lead describes what was edited rather than what is now different for someone using this, rewrite it. For user-facing bugs, name the visible before/after first; mention the technical cause only if it helps assess risk.

## Step A - Resolve the range and base

- **Current-branch mode** (default) - describe HEAD vs the repo's default base.
- **PR mode** - describe an existing PR (the open-PR path from Step 1, or an update). Resolve `<base>` and `<head>` from the PR metadata, not from local guesses.

Resolve `<base>` in priority order: `git rev-parse --abbrev-ref origin/HEAD` (strip `origin/`) -> `gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'` -> `main`/`master`/`develop` via `git rev-parse --verify origin/<candidate>`. If none resolve, ask the user. `<head>` is `HEAD`.

Then (each command its own argv-form call):

```bash
git fetch --no-tags <base-remote> <base>
```

```bash
git log --oneline "<base-remote>/<base>..<head>"
```

```bash
git log --format=fuller "<base-remote>/<base>..<head>"
```

```bash
git diff "<base-remote>/<base>...<head>"
```

`--format=fuller` full messages are the hunting ground for linked plan/finding references. If the commit list is empty, report "No commits to describe" and stop. When local git cannot reach the refs (fork with no matching remote, shallow clone, offline), fall back to `gh pr diff <ref>` and `gh pr view <ref> --json commits` - and say the API fallback was used.

## Step B - Size by decision cost, build the scope map

Decision cost is how much a reviewer still has to work out before approving - not changed-line count. Build a compact internal **scope map** from the complete oneline commit list and the final three-dot diff: group the range into material outcome clusters (one is fine), name one umbrella outcome that covers them, and identify each cluster's material claims - what became possible, fixed, riskier, or which design decision the reviewer must assess. Derive the umbrella from the full range, never from the latest commit, the branch name, or the story of how the work started. Write the map down (three or four lines) before composing; every later check audits against it, not memory.

| Change profile | Description approach |
| --- | --- |
| Small + simple (typo, config, dep bump) | 1-2 sentences, no headers. Under ~300 characters. |
| Small + non-trivial (bug fix, behavioral change) | 3-5 sentences. No headers unless two distinct concerns. User-visible before/after when the bug was observable. |
| Medium feature or refactor | Opening (one or two sentences), then only sections that each answer one remaining reviewer question; call out design decisions. |
| Large or architecturally significant | Same, plus 3-5 design-decision callouts and a brief test summary. Target ~100 lines, cap ~150. |
| Performance improvement | Before/after measurements as a markdown table. |

Prefer the shortest description that still lets a reviewer decide. A project PR-body contract (template at repo root, `docs/`, `.github/`, or referenced contribution guidance) sets the structural floor; this table sizes content within it. The project contract wins on conflict.

## Step C - Title

`type: description` or `type(scope): description`. Type by intent, same default as the commit: `fix:` over `feat:` when ambiguous, `feat:` only for capabilities the user could not previously accomplish; user override wins. Description from the scope map's umbrella, imperative, lowercase, under 72 chars, no trailing period, matching recent-commit conventions. Never use `!` or `BREAKING CHANGE:` without explicit user confirmation.

## Step D - Related work references

Gather candidate work-item references from the user prompt, the caller handoff, branch name, full commit messages, an existing PR body, the PR template, and linked plan/finding paths in hand (`docs/plans/<slug>.md`, `.atlas/findings/<YYYY-MM-DD>-<slug>.md`). Preserve existing related references when rewriting a PR unless asked to remove them. Classify each:

- **closing reference** - the PR fully resolves the item and the tracker's closing syntax is known (`Fixes #123` for GitHub Issues; `Fixes ENG-123` for Linear). Use closing only when the PR targets the default branch and truly resolves the item.
- **non-closing reference** - related, partial, follow-up, validation-only, or tracker semantics unknown: `Related: #123`, or the full URL / artifact path. It gets its own sentence or `## Related` block; never place it next to close/fix/resolve wording in prose.
- **uncertain** - item is clear but ID or close-intent is missing: ask (interactive) or use non-closing / omit. **Never invent a closing keyword** - magic words are workflow actions, not decoration.

## Step E - Atlas-grounded sections (in order)

1. **Opening** - one or two sentences carrying one idea: what is now different and the gap it replaces. A reviewer who reads only this can say what the PR changes and why it takes this shape.
2. **Body sections** - each answers one remaining reviewer question; a bullet is one clause. Design decisions state the reasoning and the alternative rejected. Deliberately deferred scope is stated once.
3. **Related references** - when they need their own block (per Step D).
4. **Verification** - one short, concrete block: what was run and what it showed (the verifier's gate commands and results from Step 2, and the `.atlas/.run/findings.json` verdict path). Stated results, not "tests passed". Never label validation output "Demo" or "Screenshots"; a caller-passed capture splices in as `## Demo`.
5. **Session-settled provenance** - only when a plan with `session-settled:` labeled decisions is already in hand: one static sentence naming them. Never hunt for plans.
6. **Visual aids** - a diagram or table only when faster than prose; a navigation hint only when the reviewer would start in the wrong place. Never a list of changed files (the diff shows that), never hand-drawn box-drawing. GitHub list items are never prefixed with `#` (auto-links as issues) - use `org/repo#123` or a full URL for real refs.

No CE branding badge - that block was deliberately not ported. No model/harness attribution section unless the project's own PR-body contract requires one.

## Step F - Pre-apply coverage audit

Against the written scope map, before returning the title and body:

- Is the umbrella an outcome - what is now different for someone using this - not the mechanism that produced it?
- Does the title express the umbrella, not one cluster?
- Does the opening express every peer outcome at parity, one idea in one or two sentences?
- Does any section restate what the Files-changed tab already shows? Cut it. Does any section answer no remaining reviewer question? Cut it.
- Is every material claim the diff can't establish present - and any claim the diff does show restated needlessly?
- Is every linked plan/finding reference classified per Step D - no invented closes?
- Is the verification block stated results with evidence paths?
- Can any sentence be cut without lowering reviewer confidence? Cut it - except headings, fields, and checklists the project's PR-body contract requires.

## Existing-PR updates (description update mode)

Compose against the PR's current body as the base. Preview before applying: new title, the first two sentences, total line count. If identical to the existing title/body, keep them and do not apply. Apply via the device (`pr_create` is create-only; updates go through `gh pr edit --title "<TITLE>" --body-file <path>`) only after the explicit yes at the Step 4 gate - a PR-body edit is a remote write like a push. Declined = keep the existing description, report, stop.
