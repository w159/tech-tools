# Targeted Mode

Read this reference when Mode Detection (in SKILL.md) routes to **Targeted Mode** - a specific comment or thread URL was provided. Targeted mode addresses only that thread.

## 1. Extract Thread Context

Parse the URL to extract HOST, OWNER, REPO, PR number, and comment REST ID:
```
https://HOST/OWNER/REPO/pull/NUMBER#discussion_rCOMMENT_ID
```

Take the host from the URL (targeted mode is always URL-triggered). When it is not `github.com`, pass it as a `GH_HOST=<host>` env prefix inline on **every** `gh` call below so an enterprise thread is fetched, replied to, and resolved on the right host. Carry `GH_REPO=OWNER/REPO` on every call as well.

**Step 1** - Get comment details and GraphQL node ID via REST (cheap, single comment):
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh api repos/{owner}/{repo}/pulls/comments/COMMENT_ID \
  --jq '{node_id, node_type: .pull_request_review_id, path, line, original_line: .original_line, body}'
```

**Step 2** - Map the comment to its thread ID. Query the PR's review threads and match on path + comment ID:
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh api graphql -f query='
query($owner:String!, $name:String!, $num:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$num) {
      reviewThreads(first: 100) { nodes {
        id isResolved isOutdated path line startLine originalLine originalStartLine
        comments(first: 50) { nodes { id databaseId body author { login } url } }
      } }
    }
  }
}' -f owner=<OWNER> -f name=<REPO> -F num=<PR_NUMBER> \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.nodes[].databaseId == <COMMENT_ID>)'
```

**Step 3** - Check for your own unsubmitted review before doing any work. A reply posted while you hold one is absorbed into that draft: the call returns a comment ID and URL as if it succeeded, but the reviewer sees nothing until the draft is submitted. Full mode gets this from its fetch query; targeted mode never runs that query, so check directly (PENDING reviews are only visible to their author, so any hit is yours):
```bash
GH_HOST=<host> GH_REPO=OWNER/REPO gh api --paginate \
  repos/{owner}/{repo}/pulls/<PR_NUMBER>/reviews --jq '.[] | select(.state == "PENDING") | .id'
```
`--paginate` is required: this endpoint is chronological and pages at 30, so a draft can sort past page 1. Print IDs rather than a count - `--jq` runs per page, so a count emits one number per page, but IDs simply concatenate and stay empty when there is no draft.

If this prints anything, stop. Tell the user they have an unsubmitted review on the PR and that it must be submitted or discarded before this skill can reply. Do not submit or discard it yourself; a draft review is unsent human writing.

## 2. Judge, Fix, Reply, Resolve

Apply full-mode Step 8's completion check before judgment: check separately whether the thread already has a visible submitted reply and whether it is already resolved. When the thread is already **resolution-pending**, the only remaining work is completing the missing resolution after the user confirms at the gate (full-mode Step 7): skip judgment, fixing, validation, and commit; do not post again.

**Judge first.** Apply the rubric in `references/evaluation-rubric.md` to this one thread, in your own context. Account for `isOutdated` and the location fields (`line`, `originalLine`, `startLine`, `originalStartLine`) - targeted threads can be outdated too and need the same relocation handling. The rubric's cross-item reasoning does nothing for a single thread, but its read-depth and divert rules apply in full: deep-read (callers, invariants, `git blame`/PR rationale for author intent) before accepting a contestable finding or overriding code that looks deliberate. This judgment is what decides whether the finding is valid; don't fix on the reviewer's authority alone.

**Then act on the verdict:**

- **`fixed` / `fixed-differently`** - read `references/fixer-prompt.md` and dispatch a single `atlas:implementer` with the fixer prompt to implement it. Pass the file/location fields (resolved location or anchor if outdated), the comment text, and your note on what to change and why it's valid. The implementer only implements; it does not re-judge. **When the harness exposes no way to dispatch (or the dispatch fails), apply the fix yourself in this context**, using that same prompt as your own instructions - the fix implements a change this step already approved (see full-mode Step 4).
- **`replied` / `not-addressing` / `declined`** - no subagent. Compose the reply text per the rubric and proceed to the gate.
- **`needs-human`** - compose `decision_context`, run the rubric's "Adjudicate before escalating" step (a judgment-bound item may come back as one of the verdicts above), and for what remains compose the natural-sounding reply per the rubric. The thread stays open.

Then follow the same **verify -> validate/commit -> gate -> push/reply/resolve** flow as full-mode Steps 5-8: `atlas:verifier` confirms the fix and stamps `.atlas/.run/findings.json` via `scripts/atlas_finding.py`, commits are local only, and the confirmation gate (full-mode Step 7) runs before anything is pushed, posted, or resolved. Skip validate/commit when no code changed.
