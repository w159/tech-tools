# Routes, dispatch, and reporting

Read this before mapping changed files to routes (SKILL.md step 2). It carries the
route-mapping starting points, the port and server commands, the dispatch template, the
per-page checks, and the summary format.

## Map changed files to routes

Map each changed file to the route(s) that render it, then build the list of URLs to test.
The table below is a starting point of common patterns, not an exhaustive rule set - apply
judgment for the project's actual layout:

| File Pattern | Route(s) |
|-------------|----------|
| `app/views/users/*` | `/users`, `/users/:id`, `/users/new` |
| `app/controllers/settings_controller.rb` | `/settings` |
| `app/javascript/controllers/*_controller.js` | Pages using that Stimulus controller |
| `app/components/*_component.rb` | Pages rendering that component |
| `app/views/layouts/*` | All pages (test homepage at minimum) |
| `app/assets/stylesheets/*` | Visual smoke on key pages |
| `app/helpers/*_helper.rb` | Pages using that helper |
| `src/app/*` (Next.js) | Corresponding routes |
| `src/components/*` | Pages using those components |
| shared components/hooks/utils with many importers | Every consumer route the import graph reaches (check importers, not guesses) |

For framework-driven routing, read the router config itself (Next.js file tree, Rails
routes.rb, Express route table) rather than inferring from filenames alone.

## Determine the port and verify the dev server is running (manual mode)

`scripts/resolve-port.sh` resolves the port and prints it alone on stdout, so the shell call
that needs it captures the value instead of a later step re-typing a printed number. Append
the explicit port as an argument when you have one.

```bash
SKILL_DIR="<absolute path of the directory containing this SKILL.md>";
PORT=$(bash "$SKILL_DIR/scripts/resolve-port.sh");
if lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Server running on port ${PORT}";
else
  echo "Server not running on port ${PORT}";
  echo "Start your dev server, then re-run:";
  echo "  Rails: bin/dev  or  rails server -p ${PORT}";
  echo "  Node/Next.js: npm run dev";
  echo "  Custom port: run this skill again with --port <your-port>";
  exit 0;
fi
```

Manual mode uses the resolved port as-is: the user controls their own server, so do not scan
for alternatives and do not start one yourself. (Pipeline mode replaces this block with the
free-port + server-start orchestration in `pipeline-mode.md`.)

## Dispatch template (per route batch)

Use `subagent_type: atlas:ui-runtime-tester` (pink, sonnet, low effort - it already carries
the "never edits code" boundary; restate it anyway). One tester per batch of routes; for a
large diff, one tester per route keeps sessions isolated.

```
ROLE: Live browser smoke tester for routes affected by the current diff
GOAL: Load each of these routes and report Pass/Fail/Skip per route with evidence.
CONTEXT: Dev server at http://localhost:<PORT>. Affected routes from diff
  <branch|PR #>: <route list, one per line, each with the changed files that map to it>.
  Evidence dir: .atlas/evidence/<YYYY-MM-DD>-<slug>/ (create it).
TOOLS (required):
  ToolSearch("select:mcp__lean-ctx__ctx_search,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_glob,mcp__lean-ctx__ctx_shell")
  plus the harness browser surface (Claude_Preview MCP or webapp-testing skill).
DELIVERABLE: A per-route table (Route | Pass/Fail/Skip | Evidence) plus, for each Fail,
  the exact console line, the failing network entry (URL, method, status), and the
  screenshot path. Evidence files saved under the evidence dir.
SUCCESS CRITERIA:
  - Every listed route was loaded and observed, or explicitly Skip with a reason.
  - Each Pass cites observed render + clean console + successful network calls.
  - Each Fail cites the exact error text and the evidence path.
OUT OF SCOPE: Editing any file. Fixing anything. Retrying a failing route more than once.
  Testing routes outside the provided list.
STOP CONDITIONS: Dev server unreachable, or the root URL fails to render - report the
  blocker instead of continuing.
REPORT BACK (final message only): the per-route table, evidence paths, what you could not
  reach and why.
```

## Test each affected route

For each affected route, the tester navigates and captures fresh rendered or interactive
state:

- Page title/heading present; primary content rendered; no visible error messages.
- Forms have expected fields.
- **Console clean** - any error/warning captured verbatim.
- **Network calls fire and succeed** - record URL, method, status, response shape; a failing
  call is cited exactly as observed.
- Critical interactions exercised: click/fill/press derived from freshly inspected state,
  never stale references or guessed selectors.
- Screenshots (viewport + full-page where supported) saved as evidence files under
  `.atlas/evidence/<YYYY-MM-DD>-<slug>/` (dated per the docs-SSOT naming convention).

## Human verification (when required)

| Flow Type | What to Ask |
|-----------|-------------|
| OAuth | "Please sign in with [provider] and confirm it works" |
| Email | "Check your inbox for the test email and confirm receipt" |
| Payments | "Complete a test purchase in sandbox mode" |
| SMS | "Verify you received the SMS code" |
| External APIs | "Confirm the [service] integration is working" |

Manual mode: ask the user with the platform's question tool, or present numbered options and
wait. **Pipeline mode never pauses** - log the flow as Skip with reason and continue.

## Handling failures - capture, do not fix

1. Capture the error state: screenshot of the failure, exact console error, failing network
   request/response, exact repro steps.
2. Mark the route **Fail** with that evidence and continue testing the remaining routes.
3. Do NOT debug, patch, or dispatch an implementer. The fix belongs to `atlas-dogfood`
   (diff-scoped repair loop) or `atlas-debug` (single-issue root-cause fix); the summary's
   final line names them.

## Stamp the verdict

Before emitting the summary, append the run's findings to the durable ledger:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" \
  --id <run-or-route-id> --status verified --title "<route>: <outcome>" \
  --evidence ".atlas/evidence/<YYYY-MM-DD>-<slug>/<file>.png" \
  --reproduction "<exact command / route load>" \
  --surface "frontend" --category "smoke-test" --severity <high|med|low> \
  [--proposed-fix "handoff to atlas-dogfood for repair"]
```

One entry per failed route (status `verified`, evidence paths), plus one entry for the
overall run. This reuses the atlas verification ledger - no parallel run-state file.

## Test summary

```markdown
## Browser Smoke Check Results

**Test Scope:** PR #[number] / [branch name]
**Server:** http://localhost:<port>

### Routes Tested: [count]

| Route | Status | Notes |
|-------|--------|-------|
| `/users` | Pass | evidence: .atlas/evidence/<slug>/users.png |
| `/settings` | Pass | |
| `/dashboard` | Fail | Console error: [msg] - evidence: <path> |
| `/checkout` | Skip | Requires payment credentials |

### Console Errors: [count]
- [List any errors found]

### Human Verifications: [count]
- OAuth flow: Confirmed

### Failures: [count]
- `/dashboard` - [issue description]

### Result: [PASS / FAIL / PARTIAL]

Remediation: run atlas-dogfood (same diff scope + autonomous repair loop) or
atlas-debug (single-issue root-cause fix) with the failed routes above as scope.
```

Every Skip carries its reason. A route that could not be reached at all is Fail (with the
blocker as evidence), not silently omitted.