# Execution & Real Testing

The principle: **validate by observed behavior, not by reading code.** "The code looks right" is not evidence. Run it, watch what happens, capture the result. Dispatch these to `orc-ui-runtime-tester`, `test-executor`, `orc-db-prober`, or a domain specialist — not the orchestrator's own context.

Always derive commands from the project's manifests/scripts (`package.json` scripts, `pyproject.toml`, `Makefile`, CI config). Never invent a command. Route any noisy output through `context-mode`.

## Frontend (and admin webapps)

1. **Detect** dev/build/test/lint/typecheck scripts from `package.json`.
2. **Static gate** (fast, cheap, run first): typecheck, lint, dead-code (knip if present), unit tests, prod build. A red here stops before you bother running the app.
3. **Run it live**: start the dev server in the background; capture the URL.
4. **Drive the real UI** with the **Claude_Preview MCP** (`preview_start`/navigate, `preview_click`, `preview_fill`, `preview_console_logs`, `preview_network`, `preview_screenshot`) or the `webapp-testing` skill (Playwright). Confirm by observation:
   - the page renders; **console is clean** (capture errors/warnings);
   - the **network calls fire and succeed** (status + payload shape) — this is the bridge to the backend;
   - every user-facing **state** is handled: loading, empty, error, success;
   - responsive at mobile width; reduced-motion respected.
5. **Capture** screenshots + console + network into `docs/evidence/`. Tear down the server.

## Backend / API

1. **Detect** the run command and test runner.
2. **Static gate**: lint, type check, test collection, then the suite (`pytest -x` / equivalent). Read logs.
3. **Exercise routes for real**: start the API in the background (or use the live dev service), then hit endpoints with `curl` (route exists? correct status? response body matches the declared schema/Pydantic model?). Test an error path too (bad auth, missing field, not-found).
4. **Verify writes by reading back** — after a POST/PUT, read the row/resource to confirm it actually persisted.
5. Check timeouts/retries on outbound calls, idempotency on mutating routes, and that errors return structured responses, not stack traces.

## Database (read-only)

`orc-db-prober` only. **Zero writes. No migrations. No `CREATE INDEX` (even `CONCURRENTLY`). Only propose them.**

1. **Connect** read-only using the project's configured credential (env/DSN/secret). If none is available, stop and request one — never guess.
2. **Inspect**: does the table/column exist? nullability, FKs, `ON DELETE`, PK present, sensible defaults, `created_at`/`updated_at`?
3. **Permissions & policies** (the silent killers): row-level-security policies, `GRANT`s for the *runtime* role (not just your admin/superuser connection — a query that works for you may return zero rows for the app), required session GUCs.
4. **Performance**: `EXPLAIN` (no `ANALYZE` against prod) for filters/joins seen in the backend; missing/unused indexes; slow queries if `pg_stat_statements` is already enabled (do not enable it).
5. Use `whodb`/data-agent-kit plugins or `gcloud` if present and helpful. Capture plans into `docs/evidence/`.

## Cross-surface fault localization (which layer owns the bug?)

When a symptom could live anywhere, run the ladder and let evidence at each hop localize it:

1. **Reproduce at the UI** (`orc-ui-runtime-tester`): trigger the symptom; capture the console error AND the failing network request (URL, method, status, request/response body).
2. **Inspect the request**: is the FE even calling the right endpoint with the right shape? (If not → FE bug. Bypassing the shared API client is a common cause.)
3. **Confirm the route** (`backend-architect`/`orc-implementer`): does it exist, accept that shape, and return the expected status + body when hit directly with `curl`? (Works via curl but not via the app → contract/CORS/auth drift. 404/405 → missing or misrouted endpoint.)
4. **Trace to data** (`orc-db-prober`): does the query the route runs return what the route expects? Zero rows for the app but rows for you → RLS/GRANT/GUC. Null/constraint error → schema. Slow → index.
5. **Pin the owner** with the full evidence chain (UI error → request → route behavior → query result). If no layer owns it, suspect the environment or the Claude Code setup itself → `claude-code-tuning.md`.

## When you *can't* test

If a stack can't be exercised because a needed capability is missing (no LSP for diagnostics, no browser driver, no DB credential, no test runner configured), that absence is itself a finding — record it and route to `claude-code-tuning.md` to recommend the fix, rather than silently skipping validation.
