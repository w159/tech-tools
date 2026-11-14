# Telemetry outage and owner dashboard (atlas 17.19.0)

Date: 2026-11-14. Ask: telemetry from users was not arriving, and there was no place to see it.

## Before

- `telemetry/REPORT.md` showed 1 submission ever (2026-W45), and "Fewer than 3, so no details are published."
- Production `atlas-telemetry` ran code from `2865bb94` (Nov 5) with an allowlist of 1525 keys. Clients
  since 17.16.0 send 45 more keys (`hook.gate_rerun.*`). `lib/validate.js` rejected the whole week on one
  unknown key, so every week from a current client got HTTP 400 and was retried forever. Local repro
  against the old validator: `400 {"errors":["counts key not allowed: \"hook.gate_rerun.context\""]}`.
- The client sent only finished weeks, so a new install showed nothing for up to 7 days.
- A failed send left no record of why (no status, no error class). macOS python.org builds without
  certificates failed TLS silently.
- No dashboard, no health route, no way to see test data, no JSON export. The public aggregate hides
  anything under 3 installs, which at current volume is everything.
- Not counted at all: slash commands, hook faults by class, mod panes and commands, crew runs, delivery
  outcome, active days.

## Root causes

1. Stale deploy plus fail-closed validation (a schema drift turned into total data loss).
2. Visibility: finished weeks only, threshold 3, no owner view.
3. Silent client failures.
4. Coverage gaps in what was counted.

## Fixes

Server (`telemetry/server`):
- Unknown well-formed keys are dropped and counted (`{ok, kept, dropped}`) instead of rejecting the week.
- Schema 3: week-to-date snapshot with required `partial` and optional `test`. Same nonce replaces the
  earlier snapshot through a conditional write on the stored etag (Blob `ifMatch`); a final week cannot be
  overwritten by a partial one (409).
- `GET /api/health` (no secret): storage kind, accepted schemas, allowlist key count and sha256,
  whether the dashboard secret is set, last 2 weeks' real and test counts.
- `GET /api/admin` and `DELETE /api/admin?purge=test`: `Authorization: Bearer <ATLAS_DASHBOARD_TOKEN>`
  only, 24+ characters, 503 if unset, 401 if wrong.
- `GET /dashboard`: totals, weekly trend, top and never-used features per family (skill, command, agent,
  hook, mod), failures, versions (atlas, OS, python, harness), per-week table, Download and Copy JSON.
- The public aggregate keeps its 3-install threshold and excludes test rows.

Client (`plugins/atlas/scripts`, hooks, mod):
- Sends the current week as a partial snapshot at session start, at most once an hour, plus the final
  week once it closes. UTC weeks. File lock and log rotation. No redirects. curl fallback.
- Every send records its outcome in `last_send.json` and a `delivery.ok.*` / `delivery.fail.*` counter.
- New families: `command.*`, `fault.<component>.<errclass>`, `mod.*`, `crew.*`, `active.day.*`.
- Allowlist grew 1570 -> 2126 keys (append-only, nothing removed).
- Anonymity unchanged: no install id, IP, paths or prompt text; allowlisted keys only; `ATLAS_ANALYTICS=off`,
  `DO_NOT_TRACK` and `atlas_analytics.py disable` all honored, including in the mod.

## Adversarial review

A different model (sonnet, `atlas:verifier`) reviewed the diff: 0 high, 6 medium, 10 low. All 16 were
fixed, each with a test that failed first. Anonymity held. Known limits left in place: a tiny append race
on `events.jsonl`, an orphaned rotation side file is not recovered after a crash, and anyone can flood an
anonymous ingest.

## Tests

Final gate before release: pytest on hooks, scripts and repo scripts 8764 pass / 5 skip / 0 fail; the
server node suite 61/61; the mod bun suite 3164 pass / 31 skip / 0 fail.

## After (production)

Evidence from the deployed service.

### Deploy

- Commit `c35b588` deployed to production as `dpl_Bd71PWpbBiNPkG1d2CbM5GKhxmTy` (build completed, no errors).
- `GET https://atlas-telemetry.vercel.app/api/health` after deploy:
  `{"ok":true,"storage":"ok","schemas":[2,3],"allowlist":{"keys":2126,"sha256":"f3d5e9a2...a0a4"},"dashboard_configured":true,"weeks":{"2026-W45":{"submissions":2,"test":0},"2026-W46":{"submissions":0,"test":0}}}`.
  The sha256 matches `telemetry/allowed-keys.json` at that commit (2126 keys); before, production held 1525.
- `ATLAS_DASHBOARD_TOKEN` created as an ordinary (encrypted, readable) production variable.

### Real client against production

GitHub Actions run 43621231362 (`telemetry-e2e`, success). The shipped client recorded three counters and sent them
with `--test`:

```
test submissions held before send: 0
{"atlas_version":"17.19.0","counts":{"agent.planner":1,"delivery.ok.urllib":1,"skill.atlas-plan":1},"nonce":"...","os":"linux","partial":true,"python":"3.14","schema":3,"test":true,"week":"2026-W46"}
sent week-to-date snapshot 2026-W46 (3 counters); counts kept until the week ends.
last send:  ok (HTTP 201, snapshot 2026-W46 via urllib)
test submissions held after send: 1 (before: 0)
```

That row is stored with `test: true`, so it stays out of the public aggregate and the default dashboard view.

### Not verified here

- The dashboard was not opened with the secret from this environment: a safety check stops an agent typing a
  credential into a web page. The login page was rendered and confirmed live; the data view is covered by the
  node tests and by `GET /api/admin` answering 4xx without a secret.
- The test row was not purged from here for the same reason. The dashboard now has a Delete test data button
  (tick "Include test submissions"); locally it answered `{"ok":true,"deleted":1}` with the secret and 401 without.
