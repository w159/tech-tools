# atlas-telemetry

Receiver and aggregator for Atlas usage telemetry. One submission is one install-week of
counts. There is no install id.

## What it stores

Per accepted submission, exactly the validated body and nothing else:

```json
{"schema":2,"atlas_version":"17.0.0","os":"linux","python":"3.12","week":"2026-W44",
 "nonce":"<uuid4>","counts":{"skill.atlas-plan":3}}
```

stored at `submissions/<week>/<nonce>.json` (Vercel Blob, private) or `<dir>/<week>/<nonce>.json`
(filesystem). Only keys listed in `../allowed-keys.json` are accepted, each count an integer
1..max_count.

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
submissions only `{week, submissions}` is returned. The response is cached for an hour.

`POST /api/ingest`: 201 stored, 400 `{errors}`, 405 non-POST, 409 nonce already stored, 413 body
over 64 KB. Weeks must not be in the future or older than 9 weeks.

## Local run

```sh
cd telemetry/server
node --test                          # unit tests, no network, no install needed
TELEMETRY_DATA_DIR=/tmp/atlas-tel PORT=8787 node dev.js
curl -s 'http://127.0.0.1:8787/api/aggregate?week=2026-W44'
python3 ../../scripts/telemetry_report.py --url http://127.0.0.1:8787 --week 2026-W44
```

`dev.js` always uses the filesystem store. Without `BLOB_READ_WRITE_TOKEN` the deployed
handlers do too (under `TELEMETRY_DATA_DIR`, default `./.data`), which is not durable on Vercel:
always attach a Blob store there.

## Deploy (Vercel)

1. Create a Vercel project from this repo with Root Directory `telemetry/server`. Keep "Include
   source files outside of the Root Directory" enabled: the functions import
   `telemetry/allowed-keys.json`. No `vercel.json` is needed; files in `api/` are detected
   automatically.
2. In the project, Storage, create a Blob store and connect it. Use a private store. This sets
   `BLOB_READ_WRITE_TOKEN`, which switches the backend to Blob.
3. Deploy. The endpoint is `https://<project>.vercel.app/api/ingest`.
4. Put that URL in `plugins/atlas/contracts/analytics-schema.json` as `endpoint`. The
   `telemetry-report` workflow reads it (base URL = endpoint without `/api/ingest`) and commits
   `telemetry/reports/<week>.json` and `telemetry/REPORT.md` every Monday 06:00 UTC and on any push
   to `main` that changes the schema or the workflow. The repo variable `ATLAS_TELEMETRY_URL` is
   optional: when set, it overrides the schema endpoint.

Current deployment: the project is deployed as `atlas-telemetry` on Vercel at
https://atlas-telemetry.vercel.app (functions `/api/ingest` and `/api/aggregate`) with a private Blob
store. The shipped schema endpoint is `https://atlas-telemetry.vercel.app/api/ingest`.

When `allowed-keys.json` changes (new schema keys), redeploy so the server accepts them.
