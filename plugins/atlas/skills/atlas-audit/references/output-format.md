## Output

All artifacts land under docs/audits/atlas-audit-<date>/ as the single source of truth. No loose files in the repo root. Every findings file and report.md use the same severity scale: HIGH / MED / LOW.

```
docs/audits/atlas-audit-<date>/
  graph-summary.md          - merged hot spots and communities surfaced by graphify across all roots (file:line)
                              (per-root graphs live in each root's own graphify-out/, not under this audit dir)
  findings/
    correctness.md          - verified correctness/bug findings (file:line + severity)
    security.md             - verified OWASP/security findings (file:line + severity)
    quality.md              - verified SOLID/DRY/KISS findings (file:line + severity)
    risk-hotspots.md        - verified risk hotspot findings (file:line + severity)
    dead-code.md            - verified dead code findings (file:line)
    coverage-gaps.md        - verified test-coverage gap findings (file:line)
    docs-drift.md           - verified code-vs-docs drift findings (file:line)
  report.md                 - prioritized master list: all verified findings, severity HIGH/MED/LOW
  handoffs/
    <finding-id>.md         - one handoff prompt per accepted finding (ends with `atlas-audit act <finding-id>`)
  hub/
    manifest.json           - node<->finding bridge (each handoff mapped to its graphify node)
    index.html              - branded Atlas expedition map; click a node -> finding + `atlas-audit act` cmd
```

Each finding in report.md carries: dimension, severity (HIGH / MED / LOW), file:line, a one-sentence description of the flaw, and the verifier's evidence. Rejected findings are not mentioned.

**Compliance mapping (optional, elicited):** when the user selected frameworks at elicitation time, each verified finding additionally carries a `compliance:` line mapping it to the specific control IDs from the chosen frameworks that the finding touches - e.g. FTC Safeguards section (9.x), GLBA 16 CFR 314.4(x), SOC 2 CC-series criterion, or an OWASP ASVS requirement ID. Map from the finding's dimension and described flaw; cite the control ID, never paraphrase it into a new numbering. If a verified finding touches no control in the selected frameworks, state that explicitly rather than forcing a tag. Frameworks were not selected: emit no `compliance:` lines at all. Each verified verdict is also appended to `.atlas/.run/findings.json` by the `atlas:verifier` via `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py` (flat flags, no subcommands):

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id <finding-id> --status verified --title "<one line>" --evidence <file:line> --reproduction "<exact command>" --severity <HIGH|MED|LOW> --surface <dimension>
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id <finding-id> --status rejected --title "<one line>" --evidence <file:line>
```

That ledger's entry schema, verified stamp, and append-only intent are documented in `${CLAUDE_PLUGIN_ROOT}/references/findings-schema.md`. The ledger holds verdicts and evidence references only - findings must never carry credential values; reference configuration by environment variable NAME only.

The orchestrator writes handoff prompts only for findings the user accepts for remediation. Each `<finding-id>` used as a filename must be a filesystem-safe slug: lowercase, with every character outside `a-z 0-9 . _ -` (notably the Windows-reserved set `< > : " / \ | ? *`, plus spaces) replaced by `-`. A colon in any audit filename makes the repo un-checkout-able on Windows and blocks everyone syncing it. Each handoff is self-contained: it names the file:line, states the flaw and acceptance criterion, specifies which atlas squad agent should lead the fix, and ends with `Remediate with: atlas-audit act <finding-id>`. After writing handoffs/, the orchestrator builds the hub so findings are navigable and one-command launchable:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_hub.py" "docs/audits/atlas-audit-<date>" <each per-root graphify-out/graph.json>
```

`atlas-audit act <finding-id>` then loads that handoff into the `atlas-orchestrate` skill to remediate it. (Act mode is the remediation launcher; `atlas-handoff` is the separate session-resume checkpoint.)
