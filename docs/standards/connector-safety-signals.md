# Connector safety signals: the contract every MCP connector is held to

In-house standard, not an extracted reference. It governs every connector under
`mcp_servers/` and every bundle under `plugins/atlas/mcp/`. Written 2026-09-17,
after a checklist item that had required a boot harness since it was authored was
found to reference a file nothing had ever created, and the harness caught a live
mislabeled destructive tool on its first run.

## Why the annotation half is the load-bearing half

An MCP tool carries two descriptions of what it does:

- **Prose** - the `description` a human reads, prefixed `DESTRUCTIVE:` or
  `VISIBLE-TO-OTHERS:` when the tool warrants it (`AGENTS.md:114`).
- **Annotations** - `readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`, the machine-readable hints a client automates on.

`readOnlyHint` is the flag a client reads to decide it may run a tool *without
asking the operator first*. A tool whose prose says DESTRUCTIVE while its
annotation says read-only therefore warns the human and invites the machine to do
the thing the warning is about. That is not a cosmetic inconsistency; it is the
failure mode this contract exists to prevent.

## The rules

1. **The description marker is authoritative.** `DESTRUCTIVE:` or
   `VISIBLE-TO-OTHERS:` at the start of a description is the declaration of
   effect. Annotations must agree with it; where they disagree, the marker is
   right and the annotations are the defect.
2. **One decision per tool sets both halves.** A tool declares its effect class
   once, at its declaration site, and that single decision produces both the
   description prefix and the annotation flags. Prose and flags cannot drift
   apart because nothing sets them independently. In `panos-mcp` this is the
   four-wrapper set in `src/domains/_helpers.ts`
   (`readOnlyTool` / `destructiveTool` / `credentialIssuingTool` /
   `unknownEffectTool`). The other nine connectors each carry their own copy of
   the classifier at `<svc>-mcp/src/annotate-tool.ts`; those copies are not
   imports of `mcp_servers/_shared/annotate-tool.ts` but duplicates of it, so a
   change to this contract lands in all ten files or in none.
3. **Never infer effect from the tool's name.** A name-pattern classifier that
   defaults to "read" for unmatched names fails toward unattended execution. It
   is exactly how `ninjaone_devices_service_control` shipped `readOnlyHint: true`:
   `service_control` matched no pattern in a `DESTRUCTIVE_PATTERNS` table that
   carries `restart`, `reboot`, `reset` and `delete` but no `control`. Where
   pattern tables still exist they must return `undefined` on no match, with
   corrections declared by name in that connector's `CLASS_OVERRIDES`.
4. **An unclassified tool fails closed.** No match, no default: annotate it
   mutating and name it on stderr (stdout is the JSON-RPC channel, so a warning
   written there corrupts the protocol). A tool the classifier does not understand
   is never advertised as safe to auto-run.
5. **Every tool has a `readOnlyHint`.** A missing annotation is not "unknown", it
   is an absent signal a client may read as permission.
6. **`test-mcp-tools.mjs` enforces agreement**, and a connector change is not done
   until it passes. See "The gate" below.

## The four annotation classes in use

| Class | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` | Description prefix |
|---|---|---|---|---|---|
| read-only | `true` | `false` | `true` | `true` | none |
| mutating | `false` | `true` | `false` | `true` | `DESTRUCTIVE:` (plus `VISIBLE-TO-OTHERS:` when others see the effect) |
| credential-issuing | `false` | `false` | `true` | `true` | none - see below |
| unprefixed-mutating (passthrough) | `false` | `true` | `false` | `true` | none - the description already spells out the hazard |

**read-only.** Nothing changes; a client may run it without prompting.
`idempotentHint: true` because reading twice reads the same thing.

**mutating.** Changes vendor or appliance state. `idempotentHint` is `false` on
purpose: a second commit pushes whatever landed in the candidate config
meanwhile, and a second install or reboot takes the box down again, so a retry is
not free.

**credential-issuing.** For a tool whose output *is* credential material.
`panos_keygen` is the only member today
(`mcp_servers/panos-mcp/src/annotate-tool.ts:62-67`, wrapper
`credentialIssuingTool()` at `src/domains/_helpers.ts:105`). Neither other class
is honest about it: read-only would advertise "safe to run unattended" for a call
that prints a long-lived PAN-OS API key into the transcript, and mutating would
claim it destroys something. Per flag: `readOnlyHint: false` because issuance is
a real side effect; `destructiveHint: false` because nothing on the appliance is
destroyed or overwritten; `idempotentHint: true` because PAN-OS returns the same
key for the same credentials; `openWorldHint: true` as everywhere, because the
call leaves the process. It carries **no `DESTRUCTIVE:` prefix** - it is not
destructive, and its description already warns that the key lands in the
transcript. Do not add a prefix to make the counts line up.

**unprefixed-mutating (passthrough).** A tool that takes the mutating flags while
keeping an unprefixed description, because its description already states the
hazard in full and a blanket prefix would misdescribe it. `panos_op` is the only
member: arbitrary `<cmd>` XML, so its effect depends on the caller's payload.

Note how the counts read. The boot probe's `unprefixed-mutating` bucket counts
every tool that is annotated non-read-only without carrying a prefix, so it holds
two tools - `panos_op` (this class) and `panos_keygen` (credential-issuing) - and
panos reports `read=26, mutating=32, unprefixed-mutating=2` = 60 with 32 prefixed
tools against 34 annotated-mutating and zero mismatches. The annotations are
stricter than the prose there, never looser. Strictness in that direction is
allowed; the reverse is the defect the gate exists to catch.

## The gate

`node test-mcp-tools.mjs` at the repo root launches every connector exactly as
`plugins/atlas/.mcp.json` declares it - the eleven Node connectors as
`plugins/atlas/mcp/<name>/server.mjs` over MCP stdio, `falcon` as
`uv run --project plugins/atlas/mcp/falcon python mcp/_env/load.py
falcon_mcp.server` - with placeholder credentials in a from-scratch child
environment, so it needs no real credentials and cannot reach a live vendor
appliance. Per connector it asserts:

1. **BOOT** - the bundle answers `initialize` and `tools/list`.
2. **FLOOR** - the tool count has not regressed below the observed baseline
   recorded in the harness. An intentional tool-surface change updates the floor
   in the same commit.
3. **AGREEMENT** - every `DESTRUCTIVE:` / `VISIBLE-TO-OTHERS:` tool carries
   `readOnlyHint: false`, and no tool omits `readOnlyHint`.
4. **SHAPE** - non-empty description, object `inputSchema`.

`node test-mcp-tools.mjs <svc>` probes one connector; `--list` prints the known
names; an unknown name exits 2 with the valid names listed. Per-connector probes
may assert more: `mcp_servers/panos-mcp/tests/boot-probe.mjs`
(`npm run test:boot`) additionally pins `panos_op` and `panos_keygen` to their
exact four flag values, so a listed exception cannot drift on the flags that were
not the reason it was listed.

**Every tool a connector can register must be reachable by the gate.** A tool the
harness never lists is a tool whose safety signals were never checked, so a
credential-less `tools/list` is not the end of the probe:

- A connector that swaps its listed surface behind a `<vendor>_navigate` domain
  step is walked domain by domain and the results unioned. `blumira` lists 2 tools
  cold and 30 more across its five domains (findings, agents, users, msp,
  resolutions), so it is gated no longer: 32 tools, all four checks applied.
- A connector that registers its tools only after a successful credential
  exchange gets a stub, not a skip. `falcon` registers its domain modules only
  after an OAuth token exchange - 4 inert diagnostic tools otherwise - so the
  probe points `FALCON_BASE_URL` at a loopback socket answering `POST
  /oauth2/token` and nothing else, and asserts the stub was never asked for any
  other route. That takes falcon from unprobed to 145 tools checked.
- `GATED` and `SKIP` verdicts still exist for a surface that genuinely cannot be
  enumerated (a missing `uv` or venv for falcon reports a named SKIP with the
  command that fixes it), but nothing currently uses them: the run reports
  `12/12 connector(s), 523 tools` fully enumerated, 0 gated, 0 skipped. A new
  connector that cannot be fully enumerated must say why in its COVERAGE line
  rather than pass quietly on a partial surface.

## Known limitation: agreement only catches disagreement

AGREEMENT compares prose against annotations. A connector that marks **nothing**
as mutating agrees with itself and passes vacuously, no matter how many of its
tools write. The harness refuses to hide this: such a row reads
`ok (no prose effect markers - agreement check vacuous here)` rather than a bare
`ok` (`test-mcp-tools.mjs:553`). As of 2026-09-17 that applies to auvik,
connectwise, falcon (145 tools, 45 annotated `readOnlyHint: false`, zero prose
markers), knowbe4, paylocity and vanta. It no longer applies to blumira, which
reports 6 marked against 6 annotated-mutating once its domains are walked.

`.atlas/.run/vacuous-check.mjs` is the second-order heuristic used to probe that
blind spot from the other side: it flags tools that *look* like writes (an HTTP
verb in the description, a mutating verb in the name) while carrying
`readOnlyHint: true` and no effect marker. It is a heuristic by design and
produces candidates for human review, not verdicts - on its first run three of
four candidates were false positives (two NinjaOne GETs and a ThreatLocker list
call) and one was real (`panos_keygen`). Re-run it when a connector's tool
surface changes; do not wire it into the gate as if it returned verdicts.

## Out of scope for these flags: the disclosure surface

`panos_cert_export` (and `panos_export` with `category=certificate`) returns a
full private key when `include-key=yes`, yet changes no appliance state and issues
no credential. That is a *disclosure* class, not an effect class: none of the four
annotation sets above describes it, and forcing it into one would misreport it.
The current answer is prose - the description must say what the response contains
and that it lands in the transcript. `panos_cert_export`'s description ends
"Read-only." with no such warning, which is an open gap recorded here rather than
papered over with a flag that does not fit.
