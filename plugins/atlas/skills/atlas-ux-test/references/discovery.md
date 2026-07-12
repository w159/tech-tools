# Phase 0: Discovery

Discovery runs FIRST, before any data entry, and has two jobs: regenerate the coverage
matrices from live frontend source, and probe the REAL client contract so the swarm later
grades the surface the client actually reads. It is dispatched as a general-purpose subagent
with references/roles/cartographer.md as the prompt prefix.

Why phase 0 exists: the previous run wrote a value to a backend table, read it back, saw
HTTP 200, and declared COMPLETE - while the value the CLIENT reads on the dashboard was null
for all personas and the app showed "needs work." Discovery captures the real primary-write
call so the harness mirrors it instead of guessing.

## What discovery does

1. Coverage cartography. Scan the frontend router file and pages directory for routes and all
   of the frontend source for user-editable fields. Rebuild the canonical route-matrix.csv and
   field-matrix.csv in .atlas/docs/claude_testers/coverage/, diff against the previous run, and copy
   both into RUN_DIR/coverage/ with two extra columns: status (init untested) and evidence_ref.

   Start by locating the router (look for router.tsx, App.tsx, routes.ts, or equivalent) and
   the pages directory (pages/, views/, screens/). Then scan the full frontend source for
   editable inputs: JSX input/select/textarea, form library fields (react-hook-form
   register()/Controller names, Formik field names, VeeValidate fields, Angular FormControl
   names), and custom widget components.

2. Live-contract probe. Read the frontend source to capture how the real client SETS and READS
   the primary onboarding/profile record. Start at the setup/onboarding wizard entry point -
   look for components whose names include Setup, Onboarding, Wizard, or Profile in the
   frontend source tree. Trace each form submission to its API client call. Capture:
   - the primary write endpoint + HTTP method + payload field names,
   - the read-back endpoint the client uses to display the submitted values,
   - the API client module (look for api.ts, apiClient.ts, http.ts, or equivalent under
     frontend/src/utils/, frontend/src/services/, or frontend/src/lib/),
   - whether any key value is sent explicitly or assumed derived from another field (verify
     from source; never assume the backend derives a value it does not).
   Cite file:line for every claim; write "unknown" rather than guess.

## Outputs (all under RUN_DIR/coverage/)

- route-matrix.csv  - run-local copy, status + evidence_ref columns added.
- field-matrix.csv  - run-local copy, status + evidence_ref columns added.
- contract-snapshot.json - the live client contract the scripted harness MUST mirror:
  {
    "dev_url": "<discovered or user-provided>",
    "api_base": "<discovered or relative path>",
    "primary_write": {"endpoint": "...", "method": "...", "payload_fields": [...]},
    "secondary_writes": [...],
    "primary_read": {"endpoint": "...", "fields": [...]},
    "derived_fields": {},
    "source_refs": ["file:line", ...]
  }

The canonical matrices in .atlas/docs/claude_testers/coverage/ are also overwritten with the fresh
scan, and COVERAGE-NOTES.md gets the scan date + per-app_area counts.

## Downstream dependency

contract-snapshot.json is the source of truth for the scripted-persona role and the harness:
the primary write and the read-back assertion both use the call it names. If the probe could
not resolve the real call (values are "unknown"), that is a blocker for data entry - the
harness cannot mirror a call it does not know. Resolve it before running phase 2.

## Caching

Under coverage=smoke the matrices may be reused from a recent run if the frontend has not
changed since (a docs-only or harness-only diff). The live-contract probe still runs unless a
current contract-snapshot.json already exists for an unchanged frontend. When in doubt, re-probe.
