# Peer dispatch (optional, explicit-request only)

How to add independent voices to an atlas-pov run. This file is read ONLY after Phase 3
(`atlas-verdict.md` exists). Read `verdict-protocol.md` first.

## 1. The substitution - state this honestly, every time

Compound Engineering's `ce-pov` panel shells out to real external CLIs (`codex`, `cursor`,
`grok-cli`) on fixed routes and verifies cross-model independence with identity receipts
proving a different served model family. **Atlas never does that.** Shelling to external
agent binaries is CE's host-specific mechanism and does not belong in atlas: it breaks
host-portability and adds binary dependencies atlas cannot assume.

The honest, portable substitute:

- Peer voices are **one or two additional fresh subagents on the same host, same model
  family**. They are independent in *context* (fresh context, no session history, no host
  verdict, no visibility into each other) - NOT independent in model.
- Every report must say this in one line: `peers: N fresh same-host subagents (contextual
  independence only; same model family as host)`. Never present peers as cross-model oracle
  routing.
- **Optional genuinely-different-model supplement:** when the typesafe/Jev MCP connector is
  available (`typesafe_status` confirms credentials), the orchestrator MAY add one
  `typesafe_decide` call - a `choice` over the options plus a `noul` on the deciding
  question - as a supplementary typed judgment from a different model family (Jev). Label it
  `voice: typesafe-jev (different model family)`. It is best-effort and never a hard
  dependency: if the connector is unavailable, skip it silently and note availability in the
  report. A Jev judgment is a typed signal to weigh in reconciliation, not a persona with a
  full verdict.

## 2. Activation rules

Peers open ONLY on an explicit user request for a second opinion. Triggers:

- "oracle this", "get a second opinion", "cross-check", "independent opinion"
- naming a peer or role: "ask security how they'd call it", "run this past a skeptic"

NEVER by default:

- A warm `atlas-pov` invocation never opens a panel (CE rule, kept verbatim).
- "oracle" with no named peer: up to TWO peers. Named peers: honored as roles (e.g.
  "security reviewer", "a DB specialist"), still capped at two, still non-voting. If the
  named peer maps to an installed specialist agent (e.g. `security-engineer`), dispatch that
  role; otherwise dispatch a fresh `general-purpose` subagent with the named persona stated
  in its ROLE line.

## 3. Independence rules (hard, all five)

1. **Fresh, never fork.** Peers are fresh `Task` subagents. `fork` inherits the
   orchestrator's conversation - including the verdict this whole phase exists to challenge -
   and `subagent-kit.md` already forbids fork for independent judgment. A forked peer is a
   contaminated peer.
2. **Identical packets.** Every peer receives the SAME normalized packet: framing packet
   (five fields from `pov-scope.md`), the grounding dossier (`<run-dir>/grounding-dossier.md`
   - paste it or pass the path; peers are read-only and can read repo paths), the repo-state
   digest, and the verdict schema below. Byte-identical between peers. **No host conclusion,
   no hint toward the atlas verdict, no other peer's answer - none of these may appear in any
   peer prompt, directly, by implication, or by loaded phrasing.** Ask neutrally: "what is
   your position and why", not "should we adopt X".
3. **Concurrent dispatch.** Fire all peers in ONE message (multiple Agent calls in a single
   message) so they run concurrently and cannot see each other.
4. **Read-only.** TOOLS FORBIDDEN: Write, Edit, git push. Peers verify, they do not modify.
5. **Spot-check, don't rubber-stamp.** Each peer must re-open at least the decisive dossier
   citations (the `file:line` items the packet highlights) before taking a position, and must
   explicitly report any dossier error it finds. A peer that finds a dossier flaw is more
   valuable than one that agrees.

## 4. Dispatch template

One peer per call, subagent-kit shape; both peers use the SAME template with only the ROLE
line differing:

```
ROLE: <independent technical peer, fresh context - or the named persona/user-requested specialist>
GOAL: Form your own position on the framed decision and return a verdict in the POV envelope.
CONTEXT:
  <framing packet: decision, options, constraints, what-would-change-the-answer, repo-state digest>
  Grounding dossier: <run-dir>/grounding-dossier.md (read it; spot-check its file:line
  citations yourself - treat it as one input, not as truth; report any error you find)
TOOLS (required):
  ToolSearch first, ONE batched call, per references/tool-routing.md; include web_search +
  Context7 if the packet's deciding facts extend beyond the repo
TOOLS ALLOWED: Read, Glob, Grep, web_search, Context7, lean-ctx/serena reads
TOOLS FORBIDDEN: Write - Edit - git push - any modification
DELIVERABLE: final message = the POV envelope below, nothing else
SUCCESS CRITERIA: position stated; every claim cites file:line or URL; dossier errors (if
  any) listed explicitly; you did NOT see any other reviewer's opinion and none was shown
OUT OF SCOPE: changing any file; asking the user questions (you cannot reach one)
STOP CONDITIONS: if the packet or dossier is too incomplete to reason from, return
  UNDECIDED with the exact missing evidence instead of guessing
REPORT BACK (POV envelope):
  voice: <your role label>
  position: <option + one-line why>
  confidence: 0|25|50|75|100
  reasoning: <short>
  evidence: [ {item: file:line | URL, supports: <one line>} ]
  external_check: needed=true/false; gathered=<urls or n/a>
  dossier_errors: [ <citation + what's wrong, or "none"> ]
  protected_subject: <data-loss|security|concurrency|public-contract|none>
```

Enforce the envelope: a peer returning prose without the fields goes back once with the
schema re-attached; a second failure is recorded as unavailable (never paraphrased into a
fake voice).

## 5. Reconciliation and the schema's role

Reconciliation rules are in `verdict-protocol.md` §5. This schema's `movement` field is how
the run records the outcome:

- `movement: held` - atlas position unchanged; the reason must name which peer arguments
  were answered with existing evidence.
- `movement: moved` - atlas position changed; the reason must cite the NEW evidence item
  (file:line/URL), not the peer's authority.

Final report shape per voice: `voice | position | confidence | external_check | movement`.
End the panel section with the availability note (any peer that failed) and the same-host
substitution line from §1 - always, even when peers agree with the atlas verdict.

## 6. What peers can never do

- Authorize or trigger any code change (the whole skill is read-only regardless of
  consensus).
- Override the atlas verdict by majority (there is no majority; peers are not votes).
- Receive the host verdict, session history, or each other's answers - if a prompt you are
  about to send contains any of these, it is not an independent peer, do not send it.