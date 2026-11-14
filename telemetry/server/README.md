# atlas-telemetry

Receiver and aggregator for Atlas usage telemetry. One submission is one install-week of
counts. There is no install id.

## What it stores

Per accepted submission, exactly the validated body and nothing else:

```json
{"schema":3,"atlas_version":"17.19.0","os":"linux","python":"3.12","week":"2026-W44",
 "nonce":"<uuid4>","partial":true,"counts":{"skill.atlas-plan":3}}
```

stored at `submissions/<week>/<nonce>.json` (Vercel Blob, private) or `<dir>/<week>/<nonce>.json`
(filesystem). Schemas 2 and 3 are accepted. Only keys listed in `../allowed-keys.json` are kept,
each count an integer 1..max_count.

Schema 3 adds `partial` (required bool) and `test` (optional, only `true`). A schema 3 payload is a
week-to-date snapshot: a second payload with the same week nonce replaces the first (200 replaced,
201 created). A final week (`partial` false) cannot be replaced by a partial one (409). Schema 2
stays create-only: a repeated nonce is 409.

Unknown but well-formed keys are dropped and counted, not rejected: ingest answers
`{ok, kept, dropped}`. A malformed key or count still gets 400. (The server deployed before this
release rejected the whole week on one unknown key, which is why telemetry stopped arriving.)

## What it never stores

No IP address, headers, user agent, cookies, timestamps, or request bodies in logs. The handlers
never read those values and never log the body. The nonce only deduplicates retries (409).

Honest caveat: the hosting platform (Vercel) may keep its own request logs, including IP
addresses, under its own retention. This code never reads or stores them. Adjust log retention and
drains in the Vercel project if that matters to you.

## Publishing rules

`GET /api/aggregate?week=2026-W44` (default: last finished ISO week) returns
`{week, submissions, atlas_version, os, python, counts: {key: {installs, total}}}`.
A key is published only if at least `min_installs_published` (3) submissions reported it.
Version, OS and Python buckets below the threshold fold into `other`. With fewer than 3
submissions only `{week, submissions}` is returned. The response is cached for an hour. Test
submissions (`test: true`) are excluded.

`POST /api/ingest`: 200 replaced (schema 3), 201 stored, 400 `{errors}`, 405 non-POST, 409 nonce
already stored (schema 2) or a partial snapshot sent over a final week, 413 body over 64 KB. Weeks
must not be in the future or older than 9 weeks.

## Owner routes

| Route | Auth | Returns |
|---|---|---|
| `GET /api/health` | none | Storage kind, accepted schemas, allowlist key count and sha256, whether the dashboard secret is configured, submission counts for the last 2 weeks. No secrets. |
| `GET /api/admin?weeks=N` | secret | JSON summary for the last N weeks (default 10, max 26): totals, weekly trend, top keys, per-family features (with `pct`, the share of install-weeks) and never-used features for skill, command, agent, hook and mod (a skill is used when reported as `skill.X` or `command.X`; a hook is used only when it denied, asked or added context, and its reason sub-keys are not summed again), `rates` (gate block share, send failure share, failed team runs, slow dispatches), `signals` (what to fix or build next, each with its evidence), failures (with `pct` and `per_100_sessions`: hook fault and slow, `fault.*`, gate blocks, team and crew failures, crew check fail, `mod.error.*`, `delivery.fail.*`), versions (atlas, OS, python, harness), all keys and a reading guide. |
| `DELETE /api/admin?purge=test` | secret | Removes test submissions in the window. |
| `GET /dashboard` (and `/`) | secret, typed in the page | HTML dashboard: totals, weekly trend chart, top and unused features, failures, versions, a per-week table, Download and Copy JSON, and Delete test data (shown with "Include test submissions" ticked). |

The secret goes in `Authorization: Bearer <secret>` only; a `?token=` query parameter is not accepted. The dashboard asks for it and
keeps it only in the browser's localStorage. Test data is hidden everywhere unless the admin call
passes `include_test=1`. Admin answers 503 when `ATLAS_DASHBOARD_TOKEN` is unset or shorter than 24
characters, and 401 on a wrong secret.

## Local run

```sh
cd telemetry/server
node --test                          # unit tests, no network, no install needed
TELEMETRY_DATA_DIR=/tmp/atlas-tel PORT=8787 node dev.js
curl -s 'http://127.0.0.1:8787/api/aggregate?week=2026-W44'
python3 ../../scripts/telemetry_report.py --url http://127.0.0.1:8787 --week 2026-W44

# owner routes, local only: the secret must be at least 24 characters
ATLAS_DASHBOARD_TOKEN=<24+ char secret> TELEMETRY_DATA_DIR=/tmp/atlas-tel PORT=8787 node dev.js
curl -s http://127.0.0.1:8787/api/health
curl -s -H 'Authorization: Bearer <secret>' 'http://127.0.0.1:8787/api/admin?weeks=4&include_test=1'
```

Open `http://127.0.0.1:8787/dashboard` for the HTML view.

`dev.js` serves the same routes and always uses the filesystem store. Without `BLOB_READ_WRITE_TOKEN` the deployed
handlers do too (under `TELEMETRY_DATA_DIR`, default `./.data`), which is not durable on Vercel:
always attach a Blob store there.

## Deploy (Vercel)

1. Create a Vercel project from this repo with Root Directory `telemetry/server`. Keep "Include
   source files outside of the Root Directory" enabled: the functions import
   `telemetry/allowed-keys.json`. `vercel.json` rewrites `/` and `/dashboard` to
   `/api/dashboard`; the other files in `api/` are detected automatically.
2. In the project, Storage, create a Blob store and connect it. Use a private store. This sets
   `BLOB_READ_WRITE_TOKEN`, which switches the backend to Blob.
3. Add the dashboard secret: Vercel > atlas-telemetry > Settings > Environment Variables, name
   `ATLAS_DASHBOARD_TOKEN`, at least 24 characters, enabled for Production. Generate one with
   `openssl rand -base64 32`. Leave "Sensitive" off if you want to read the value back later from
   that page (an ordinary variable is still stored encrypted); Vercel makes a Sensitive value
   write-only after saving, so with Sensitive on keep your own copy. To rotate, edit the value and
   redeploy; the old secret stops working on the new deployment. Never commit it or put it in a
   URL you share.
4. Deploy. The endpoint is `https://<project>.vercel.app/api/ingest`.
5. Put that URL in `plugins/atlas/contracts/analytics-schema.json` as `endpoint`. The
   `telemetry-report` workflow reads it (base URL = endpoint without `/api/ingest`) and commits
   `telemetry/reports/<week>.json` and `telemetry/REPORT.md` every Monday 06:00 UTC and on any push
   to `main` that changes the schema or the workflow. The repo variable `ATLAS_TELEMETRY_URL` is
   optional: when set, it overrides the schema endpoint.

Current deployment: the project is deployed as `atlas-telemetry` on Vercel at
https://atlas-telemetry.vercel.app (functions `/api/ingest`, `/api/aggregate`, `/api/health`, `/api/admin` and `/api/dashboard`) with a private Blob
store. The shipped schema endpoint is `https://atlas-telemetry.vercel.app/api/ingest`.

When `allowed-keys.json` changes (new schema keys), redeploy so the server accepts them. Check
`GET /api/health` for the allowlist key count and sha256 and compare with `telemetry/allowed-keys.json`;
a stale deploy was the cause of the 17.19.0 outage. Unknown keys are now dropped and counted rather
than rejecting the week, but they are lost until the server is redeployed.
