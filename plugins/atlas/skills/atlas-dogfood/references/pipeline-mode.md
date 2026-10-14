# Pipeline-mode server orchestration

Read and follow this file only when invoked with `mode:pipeline` (an automated runner). It
overrides visibility prompts, free-port selection, and dev-server startup. It does not change
the browser-runtime policy. In pipeline mode you run unattended - **never block on a
question.**

## 1. No visibility question

Unattended execution does not mean hidden execution. Dispatched `atlas:ui-runtime-tester`
agents run through the harness's own browser surface; do not ask the user anything before,
during, or after the run. Any question that manual mode would have asked (headed/headless,
fix-now-or-skip, human verification) resolves as: proceed unattended, log the flow as Skip
with the reason, and continue.

## 2. Claim a free port and start the server

Multiple agents may run on the same machine, so never assume the resolved port is free:
`scripts/resolve-port.sh --free` in this skill's directory resolves the port and scans upward
to the first port with no listener, printing it alone on stdout.

Run the whole thing as **one** command. Shell variables do not survive between separate Bash
calls, so the port resolution, the free scan, and the startup all happen inside this block -
it seeds `PORT` by capturing the script's output, not from anything an earlier step printed.
Add the explicit port as a second argument when the user gave `--port N` or your in-context
project instructions state the dev-server port (config files and `.env` are trustworthy;
prose mentions in docs are not - do not grep instruction files for one).

```bash
SKILL_DIR="<absolute path of the directory containing this SKILL.md>";
PORT=$(bash "$SKILL_DIR/scripts/resolve-port.sh" --free);   # append the explicit port as a further argument when you have one
echo "Using dev server port: $PORT"

# start in the background (the scan guarantees this port is free), then wait up to 30s
echo "Starting dev server on port ${PORT}..."
if [ -f "bin/dev" ]; then
  PORT=${PORT} bin/dev > /tmp/dev-server-${PORT}.log 2>&1 &
elif [ -f "bin/rails" ]; then
  bin/rails server -p ${PORT} > /tmp/dev-server-${PORT}.log 2>&1 &
elif [ -f "package.json" ]; then
  PORT=${PORT} npm run dev > /tmp/dev-server-${PORT}.log 2>&1 &
fi
for i in $(seq 1 30); do
  lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1 && break
  sleep 1
done
if ! lsof -i ":${PORT}" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "Server did not start in 30s. Last output:"
  tail -20 /tmp/dev-server-${PORT}.log 2>/dev/null
  exit 1
fi
```

The scan may land on a different port than the resolved one, and `$PORT` does not survive
into later shell calls. Note the number this block echoes ("Using dev server port: N") and
use that literal port in every subsequent dispatched navigation and in the summary - do not
rely on `${PORT}` carrying over. Then return to the "Dispatch the smoke checks" step with
`http://localhost:<N>` as the base URL. Tear the server down when the run completes so a
pipeline port is not left bound.

## 3. Pipeline-mode reporting

Same summary format as manual mode. Additionally:

- Flows needing human verification (OAuth, email, payments, SMS, external APIs) are
  **Skip** with the reason - never pause, never prompt.
- Failures are **Fail** with evidence and never trigger a fix attempt - the summary's final
  line still names `atlas-dogfood` / `atlas-debug` as the remediation path, but an unattended
  runner only consumes the report.
- Stamp the verdict into `.atlas/.run/findings.json` exactly as manual mode does.