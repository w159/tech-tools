# Full Mode

Read this reference when Mode Detection (in SKILL.md) routes to **Full Mode** - no argument given, a PR number was provided, or a whole-PR URL was provided. Full mode processes all unresolved threads on the PR. When the argument is a PR URL, parse the host, `OWNER/REPO`, and number from it - the host feeds the `GH_HOST` prefix below, and `OWNER/REPO` targets the correct repo for a fork-to-upstream PR.

The shape: **fetch once, judge centrally, dispatch subagents only for the fixes.** You, the orchestrator, hold every thread from a single fetch, so you judge validity in your own context, where you can read each file once, spot a reviewer who is wrong across several threads, and weigh the author's design intent. Subagents are dispatched only to *implement* fixes you have already approved. Do not delegate the judgment: a subagent per thread pays per-agent overhead, re-reads the same files, loses the cross-thread view, and you would pay that even for threads that turn out to be skips.

The shape ends at a **confirmation gate** (step 7): nothing is pushed, posted, or resolved until the user has seen the fixes, the commits, and every drafted reply and said yes.

## 1. Fetch Unresolved Threads

If no PR number was provided, detect from the current branch:
```bash
gh pr view --json number -q .number
```

Confirm the repo is GitHub first (`xd://github` `op: repo_view`, or `gh repo view`); the platform rule in SKILL.md covers non-GitHub hosts.

Derive the host: if the caller passed a full PR **URL**, take its host; otherwise read it from `gh repo view --json url -q .url`. Because shell state does not persist between Bash calls, pass the host as a `GH_HOST=<host>` env prefix inline on every `gh` call below. On `github.com`, drop the `GH_HOST=<host> ` prefix entirely. Pass the base `OWNER/REPO` (parsed from the PR URL, when one was given) as `GH_REPO` so a fork-to-upstream PR targets the upstream base repo.

Fetch all feedback with one GraphQL call:
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh api graphql -f query='
query($owner:String!, $name:String!, $num:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$num) {
      author { login }
      pendingReview: reviews(first: 1, states: PENDING) { nodes { id state } }
      comments(first: 100) { nodes { id databaseId body author { login } } }
      reviews(first: 100) { nodes { id body author { login } state } }
      reviewThreads(first: 100) { nodes {
        id isResolved isOutdated path line startLine originalLine originalStartLine
        comments(first: 50) { nodes {
          id databaseId body author { login } url
        } }
      } }
    }
  }
  viewer { login }
}' -f owner=<OWNER> -f name=<REPO> -F num=<PR_NUMBER>
```

For PRs with more than 100 threads, page with the `pageInfo { endCursor hasNextPage }` cursor and re-query.

The query returns:

| Key | Contents | Has file/line? | Resolvable? |
|-----|----------|---------------|-------------|
| `pendingReview` | Your own unsubmitted (PENDING) review, or empty | n/a | n/a |
| `reviewThreads` | Unresolved inline code review threads (includes outdated); node `id` for resolution, comment `databaseId`/`url` for REST replies | Yes | Yes (GraphQL) |
| `comments` | Top-level PR conversation comments | No | No |
| `reviews` | Review submission bodies (filter to non-empty text) | No | No |
| `pr author` / `viewer` | For judging identity in step 2 | n/a | n/a |

**All three kinds of feedback are in scope.** `review_threads`, `comments`, and review bodies are judged the same way in step 3; only the reply and resolve mechanics differ (step 8). The fetch excludes nothing based on who wrote it - a top-level comment from the PR author is the ordinary way a human asks for a change on an agent-opened PR, so it is feedback like any other.

**Stop here if a PENDING review is returned non-empty.** Thread replies posted while you hold an unsubmitted review are absorbed into that draft: the reply call returns a comment ID and URL as if it succeeded, but nothing is visible to the reviewer until the draft is submitted. Do not proceed into steps 2-9. Tell the user they have an unsubmitted review on the PR, that it must be submitted or discarded before this skill can reply, and stop. Do not submit or discard it yourself; a draft review is unsent human writing.

**Tooling note.** The `xd://github` device tool covers PR identification, reading, and diffs (`op: repo_view`; internal reads `pr://<N>`, `pr://<N>/diff`, `pr://<N>/diff/all`), but it exposes no review-thread operations - thread fetch, reply, and resolve go through Bash `gh` as shown. If `gh` is unavailable on the host, run what the device tool covers, report the rest as unavailable, and stop at the gate - do not fake GitHub API access.

## 2. Triage: Separate New from Pending

Before processing, reconcile the reply and resolution state of each piece of feedback.

**Review threads**: An ordinarily handled thread is complete only when it has both a visible, submitted substantive reply and authoritative thread resolution. Reconcile those conditions independently:

- A reply that explicitly defers a human choice (e.g., "need to align on this", options without a decision) is a **pending decision**. Keep the thread open and do not re-process it.
- A reply that records a completed fix or reply verdict while the thread is still open is **resolution-pending**. Do not repost the reply or reapply the fix; carry the existing visible reply to step 8 and complete only the missing resolution after the user confirms at the gate.
- A thread without either kind of substantive response is **new**.

**PR comments and review bodies**: These have no resolve mechanism, so they reappear on every run. Apply two filters in order:

1. **Actionability**: An item is actionable when it is someone's open request to this PR: something to fix, answer, or decide. A reply posted by this run or an earlier one is a record of handling, not a request, so it drops here - that is what keeps the run from looping on its own output. Examples of non-actionable items: review wrapper text ("Here are some automated review suggestions..."), approvals ("this looks great!"), status badges ("Validated"), CI summaries with no follow-up asks. If there's nothing to fix, answer, or decide, it's not actionable - drop it from the count entirely.
2. **Already replied**: For actionable items, check the PR conversation for an existing reply that quotes and addresses the feedback. If a reply already exists, skip. If not, it's new.

The distinction is about content, not who posted what. A deferral from a teammate, a previous run of this skill, or a manual reply all count. Similarly, actionability is about content - bot feedback that requests a specific code change is actionable; a bot's boilerplate header wrapping those requests is not.

**Silent drop.** Non-actionable items are dropped without narration. Do not announce, list, or count dropped items in the summary. Review-bot wrappers from CodeRabbit, Codex, Gemini Code Assist, and Copilot (bodies like "Here are some automated review suggestions...") commonly appear here - recognize them by their boilerplate content, drop silently. Every author and every kind of feedback goes through this content check, so a reused account or a changed format cannot silently hide actionable feedback.

If there are no new or resolution-pending items across all feedback types, skip to step 9. If only resolution-pending threads remain, skip to step 7 (the gate still applies before completing their resolution).

## 3. Consolidate & Decide (the legitimacy gate)

This is where validity is decided. Judge every **new** item here, in your own context, before any fix is dispatched. Apply the rubric in `references/evaluation-rubric.md` (read it now) across the whole batch at once. Working over the full set lets you do what a per-thread subagent can't:

- **Dedup reads by file** - read a file once and judge all its threads together.
- **Cross-item reasoning** - cluster findings by root assumption; a source (often a bot) that's wrong in one place is suspect across its siblings; converging requests from independent reviewers are a strong fix signal.
- **Selective depth** - clear nits need only the comment plus the diff line; deep-read (callers, invariants, `git blame`/PR rationale for author intent) only where a finding is contestable or the code looks deliberate.

Produce a verdict per item and sort into three lists:

- **fix-list** - `fixed` / `fixed-differently`. These get dispatched to implementers in step 4. For each, note the file/location (and for outdated threads, the resolved location or anchor) and a one-line "what to change." **Class fix:** when the cross-item pass found equivalent same-invariant sites this PR touched, record them as **one** fix-list item that enumerates every concrete location (`file:line`) and lists every feedback ID it covers - one class item -> one implementer (step 4), so the sites are edited coherently and every covered thread is replied to and resolved from that single result. Enumerate only sites whose treatment is unambiguous; a site needing its own judgment stays a separate item.
- **reply-list** - `replied` / `not-addressing` / `declined`. No code change. Compose the reply text now per the rubric (you have the evidence) and carry it to the gate.
- **human-list** - `needs-human`. Compose `decision_context` now and run the rubric's "Adjudicate before escalating" step on each judgment-bound item; an adjudicated verdict moves the item to the list it names, and the rest carry to the gate and the summary.

Create a task list of all new items tagged with their verdict, so progress is visible.

**At scale.** If the batch is large (many threads spanning many files) and judging them all inline would overflow your context, process the consolidation in file-clustered groups of ~8-10 threads, emitting the three lists incrementally. Don't fan the judgment out to subagents to avoid this - batch it instead.

If the fix-list is empty (all verdicts are reply/needs-human), skip steps 4-6 and go to step 7.

## 4. Fix (fix-list only)

Dispatch implementers **only** for fix-list items. Reply-list and human-list items never reach a subagent.

### Dispatch

Read `references/fixer-prompt.md` and spawn one `atlas:implementer` per fix-list item, using the dispatch spec from `atlas-orchestrate/references/subagent-kit.md` (GOAL / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS). The implementer only implements: the validity judgment is already done, so it implements and returns; it does not re-judge whether the fix is worthwhile.

Each implementer receives:
- The feedback_id (thread ID or comment ID) and feedback type.
- The file path and location fields: `line`, `originalLine`, `startLine`, `originalStartLine` (for outdated threads, the resolved location/anchor from step 3).
- The reviewer's comment text.
- Your step-3 note: what to change and why it was judged valid.
- The PR number.

For `pr_comment` / `review_body` fix-list items (no file/line), the implementer identifies the relevant files from the comment text and the PR diff (`pr://<N>/diff`).

**No subagent capability - apply the fixes yourself, sequentially.** When the harness exposes no way to dispatch (or a dispatch fails), work the fix-list in this context one item at a time, using the fixer prompt as your own instructions and producing the same per-item result. This is a supported path, not a shortfall to report as lost coverage. Keep the dispatch path's discipline: one item at a time, re-read each file before editing it, and stop to re-evaluate if implementing reveals a contradiction (the `blocked` handling applies unchanged).

### Implementer return format

- **verdict**: `fixed`, `fixed-differently`, or `blocked`
- **feedback_id**, **feedback_type**
- **reply_text**: markdown reply to post (quoting the relevant feedback) - omit for `blocked`
- **files_changed**: list of files modified (empty for `blocked`)
- **reason**: what was done, or the concrete contradiction for `blocked`

**Handling `blocked`.** An implementer returns `blocked` only when implementing revealed a concrete contradiction that the fixer could see and you could not (the change breaks a caller/test it can see, or the code isn't what the finding described). Re-evaluate it yourself with that evidence: either re-dispatch with a corrected instruction, or move it to the reply-list (`not-addressing`/`declined`) or human-list. Don't silently drop it.

### Batching and conflict avoidance

**Batching**: If the fix-list has 1-4 items, dispatch all in parallel. For 5+, batch in groups of 4.

**Conflict avoidance**: No two implementers that touch the same file run in parallel. You already know the target files from step 3 - serialize implementers that share a file (dispatch one, wait, then the next); non-overlapping items run in parallel. For a **class item**, feed the implementer its full enumerated location set and every covered feedback ID (not a single thread), and account for **all** of its sites in this check - a class fix touching files another implementer also touches must be serialized against every one of them. When one implementer handles multiple threads on the same file, it addresses them sequentially.

**Sequential fallback**: Platforms that do not support parallel dispatch run implementers sequentially.

Fixes can occasionally expand beyond their referenced file (e.g., renaming a method updates callers elsewhere). This is rare but can cause parallel implementers to collide. Step 5 (combined validation) catches test breakage; step 9 (verify) catches unresolved threads. If either reveals inconsistent changes, re-run the affected implementers sequentially.

## 5. Verify (atlas:verifier, fresh context)

Every implemented fix is independently confirmed before it counts. Dispatch one `atlas:verifier` per fix in a fresh context (never a fork; law 5 independence) using the subagent-kit dispatch spec. The verifier re-opens the changed lines, re-runs the targeted check the implementer ran (or the smallest check that exercises the fix), and returns a verdict of "verified" or "rejected" with evidence. The verifier prompt ends with the standard atlas closer: "Write your verdict (PASS/FAIL plus evidence paths) to `.atlas/.run/findings.json` before returning. A response without a findings.json write is invalid." The verifier has no Write/Edit tools, so it stamps the ledger via:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id <finding-id> --status verified \
  --title "<one-line: what the fix does>" \
  --evidence "<file:line or test output>" \
  --reproduction "<the command that exercises the fix>"
```

Rejected fixes go back to a fresh `atlas:implementer` with the verifier's failure evidence attached (one retry). A second rejection moves the item to `needs-human` and it drops out of the fix-list - never commit a fix no independent context could confirm.

## 6. Validate Combined State and Commit

Aggregate `files_changed` across every implementer summary. If it's empty, proceed to step 7 with no commits.

Implementers run only targeted tests on their own changes. This step runs the project's full validation **once** against the combined diff to catch cross-agent interactions that targeted runs can't see.

1. **Run the project's validation command** (test suite, type check, or whatever the project's active conventions specify). Run once, not per-agent.
2. **Green** -> commit.
3. **Red, failures touch files implementers changed** -> one inline diagnose-and-fix pass. Re-run validation. If still red, add a `needs-human` item containing the test output and leave those changes uncommitted - do not commit red.
4. **Red, failures touch only files no implementer changed** -> treat as pre-existing. Proceed, but add a footer to the commit message: `Note: pre-existing failure in <test> not addressed by this PR.`

Record the validation outcome (command run, pass/fail counts, any pre-existing failures noted) for the gate and the step 9 summary.

**Commit batching.** Batch sensibly - **never one commit per comment**. Group by whichever cut is most reviewable:

- **By file cluster**: all fixes touching one module/area in one commit (the common case; fixes were serialized by file in step 4 anyway).
- **By reviewer or theme**: group a single reviewer's thread-nits into one commit; keep a security-relevant fix or a behavioral change separate from cosmetic ones.
- A multi-site **class fix** is one commit by definition.

Stage only files reported by implementers (plus verification fixes from step 5) and commit locally with a message referencing the PR:

```bash
git add [files from implementer summaries]
git commit -m "Address PR review feedback (#PR_NUMBER)

- [grouped list of changes]"
```

**Do not push.** Local commits are as far as this step goes.

## 7. Confirmation Gate (STOP AND ASK)

This skill never pushes, posts, or resolves without explicit user confirmation. Posting a reply or resolving a thread is externally visible to reviewers; a push changes the PR head. Both require the user to say yes at this gate. There is no mode, caller, or pipeline setting that waives this - an unattended caller receives this gate as a structured report instead.

Present, grouped by verdict, one line per item describing *what was done*:

1. **Fixed** - the commit hash(es), what each commit contains, the validation result, and the verifier evidence per fix.
2. **Fixed differently** - what was changed and why the approach differed.
3. **Replied** - the drafted reply text per item.
4. **Not addressing / Declined** - the drafted reply and the evidence or harm cited.
5. **Needs your decision** - every `needs-human` `decision_context` from step 3, presented directly (quoted feedback, investigation, reason, options with tradeoffs, recommendation, thread URLs).

Then ask one clear question: approve pushing the commits, posting these replies, and resolving the fixed threads - with any edits the user wants first. Proceed to step 8 only on explicit approval. If the user declines or edits, apply their changes and return to the appropriate earlier step; nothing remote has happened yet.

## 8. Push, Reply, and Resolve

Run only after step 7 approval.

1. **Push:**
```bash
git push
```

2. **Reply to review threads over REST.** Reply directly to the root comment of each thread. Do not substitute a review-submission POST: those operations go through review-submission state, so the reply can sit unsubmitted, while a REST reply is immediately submitted and visible. Feed the body through a quoted heredoc, never `echo "..."` or `printf` - a reply is multi-line Markdown, and `echo` neither interprets `\n` nor survives a body with backticks or `$`:
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh api --method POST \
  repos/{owner}/{repo}/pulls/<PR_NUMBER>/comments/<ROOT_COMMENT_ID>/replies \
  -f body="$(cat <<'EOF'
> the specific sentence being addressed from the reviewer's comment

Fixed in abc1234 - the lookup now null-checks before dereferencing.
EOF
)"
```
The `ROOT_COMMENT_ID` is the thread's first comment's `databaseId` from the step 1 fetch. A **class item** carries multiple covered feedback IDs - post the shared `reply_text` on *every* covered thread, not just the first; a covered thread left unreplied shows up as new work in the next run.

3. **Verify each reply is visible and submitted** before resolving. Take the numeric ID from the returned URL fragment (`#discussion_r2589700` -> `2589700`) and read back what GitHub stored:
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh api repos/{owner}/{repo}/pulls/comments/<REPLY_COMMENT_ID> --jq .body
```
The body must show real line breaks. If it shows literal `\n` characters inside one line, fix the body with a `PATCH ... -f body="$(cat <<'EOF' ... EOF)"` and re-verify before resolving.

4. **Re-fetch pending-review state** after posting, to close the race of a draft created during the reply loop: re-run the step 1 fetch (or just its `pendingReview` field). If non-empty, stop without resolving any thread; report the pending review - do not submit or discard it.

5. **Resolve fixed threads** with the GraphQL thread ID from step 1:
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh api graphql -f query='
mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { isResolved } }
}' -f id=<THREAD_ID>
```

6. **PR comments and review bodies** cannot be resolved via the API. Reply with a top-level PR comment (pass `-R OWNER/REPO` so a fork-to-upstream reply posts on the upstream PR):
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh pr comment <PR_NUMBER> -R OWNER/REPO --body "$(cat <<'EOF'
> the specific sentence being addressed from the reviewer's comment

Fixed in abc1234 - the lookup now null-checks before dereferencing.
EOF
)"
```

**`needs-human` threads stop after their approved reply and remain unresolved** - that is the record of the escalation. Never resolve a needs-human thread in this step.

## 9. Verify and Summarize

Re-fetch feedback (step 1 query) to confirm resolution. The `reviewThreads` array should be empty except `needs-human` items. PR comments and review bodies still appear in the output - verify they were replied to by checking the PR conversation.

**If new threads remain**, check the iteration count - counting rounds **for this PR**, not just this invocation: count the earlier review-fix commits already on the branch (`git log <base>..HEAD` subjects that address review feedback) plus this run's own cycles.

- **First or second fix-verify cycle**: Repeat from step 2 for the remaining threads.
- **After the second fix-verify cycle** (3rd pass would begin): Stop looping. Leave the remaining threads open with drafted replies and show the pattern to the user at a fresh confirmation gate: "Multiple rounds of feedback on [area/theme] suggest a deeper issue. Here's what we've fixed so far and what keeps appearing."

Summarize all work. Group by verdict, one line per item describing *what was done* not just *where* - this is the primary output the user sees, and the place the step 3 judgments become visible:

```
Resolved N of M new items on PR #NUMBER:

Fixed (count): [brief description of each fix, commit hashes, validation result]
Fixed differently (count): [what was changed and why the approach differed]
Replied (count): [what questions were answered]
Not addressing (count): [what was skipped and the evidence]
Declined (count): [what was declined and the harm cited]

Validation: [one line - e.g., "pytest passed (893/893)" or "pytest passed with pre-existing failure in X noted"; omit when no code changes were committed]
Pushed/posted/resolved: [what step 8 executed, under the user's confirmation; "nothing - awaiting approval" before the gate]
```

If any item is `needs-human`, append a decisions section. These are rare but high-signal. Each carries the `needs-human` object composed in step 3: quoted feedback, investigation, the reason autonomous action is unsafe or ambiguous, concrete options with tradeoffs, a recommendation if any, and links to every still-open thread it covers.
