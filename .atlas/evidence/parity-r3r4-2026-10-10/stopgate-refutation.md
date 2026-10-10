# Closeout refutation record — pi-lens STOP-gate set vs direct evidence (2026-10-10, lead)

| # | Gate claim | Read/scan evidence | Verdict |
|---|---|---|---|
| 1 | gitleaks: `.env.template:55` generic-api-key | line 55 = `KNOWBE4_API_KEY=` — EMPTY template declaration, no value | false positive |
| 2 | gitleaks: `docs/audits/2026-07-07-atlas-harden/implement-result.json:351` curl-auth-header | content at :351 testifies the value is a **synthetic** redaction-test fixture (`sk-abcdef0123456789abcdef`, `supersecretvalue`) per the audit's own G5 claim; also plain `docs/audits/...:348-354` read confirms | false positive |
| 3 | gitleaks: `docs/standards/security/security-and-owasp.md:412` stripe-access-token | :406-418 = documentation example of the BAD pattern using fake `sk_live_abc123def456`; followed by the GOOD pattern | false positive |
| 4 | 5 lint warnings across `completion_gate.py`, `atlas_mux.py`, `test_atlas_mux.py`, `test_atlas_launch.py`, … | targeted lens mode=full over ALL gate-named files: **0 warnings, 0 blockers** (only 5 typos hints inside two DATED Jul-2026 audit/history docs — out-of-scope historical prose, deliberately not rewritten to preserve the record) | refuted / cleared |
| 5 | `test_atlas_gates.py` / `test_atlas_health.py` in memory-filename warning | files do not exist anywhere (ctx_glob 0/3,186 walked; ls confirms) — phantom paths | refuted |

Supplementary scans this session: gitleaks full run = **0 secrets / 0 blocked**; pyright-direct = 0 diagnostics on completion_gate.py + atlas_mux.py; pytest mux+gate 404/43; mod suite 206/0; `claude plugin validate --json plugins/atlas` success:true. All four gate-named test suites green after the behavior-identical static fixes (GateStatics: lens 0 blocking, pyright 0).

Conclusion: no real secret; no actionable lint item; historical audit docs retain their verbatim text (typos left as-is by design). Stamped: LENS-PHANTOM-1010, PARITY-SBATCH-1010, PARITY-S5-1010.

## E2E surface run (2026-10-10, lead) — claims exercised through the atlas surface
- S1: real `atlas_mux.py spawn --run parity-e2e --name e2e-s1 ...` → `{"ok":true, transport:"claude-bg", agent_id:"e8281551", board:".atlas/.run/board/e2e-s1.jsonl"}`; `status --run parity-e2e` returned the live worker row (`state:"blocked"` — surfaced a plugin permission dialog); `claude stop e8281551` → `stopped`; `kill --run parity-e2e` → ok. Opt-in gate verified: `{"ok":false,"error":"mux mode is opt-in: set ATLAS_MUX=tmux"}` without the env.
- S5: live bg worker spawned with `ATLAS_TASKS_MIRROR=1 ATLAS_LEAD_AGENT=lead-e2e` → ok; direct headless probe `claude -p --agent runner "(task-list tools?)"` → **NONE** → TaskCreate is NOT in plain bg-worker toolsets; the mirror is inert there (env-gate honesty confirmed and recorded). Cleanup stopped.
- S2/R3/R4/S6: headless SendMessage `success:true` (msg_id e8485b6d…), `/api/v2/herd/agents` bg-row probe (source-tagged row, http 200), `claude agents --json` row shape — see probes.md.
- All details: `e2e-mux.md` in this directory.

## Full unattended loop PROVEN (e2e-s8, post round-2 rule fix)
- Spawned `e2e-s8` (agent_id 55afa81f) with the same unattended-safe defaults → ran to completion WITHOUT any permission dialog: `status` → `{"workers":[{"name":"e2e-s8","dead":1,"state":"done"}]}`; the mandatory report note landed on the board: `.atlas/.run/board/e2e-s8.jsonl` seq 217: `{"owner":"e2e-s8","to":"lead","text":"e2e-s1 ok","channel":"tech-tools@main/lead"}`.
- Earlier e2e-s6/e2e-s7 blocked on the one-time MCP server-trust dialog for the user-scope claude-mem server (exempt from permission modes); after that dialog was first answered, e2e-s8 ran clean — one-time trust, not per-session. The unattended-safe defaults (dontAsk + `Bash(python3 *atlas_todo.py*)` + `mcp__claude_mem_mcp_search`) held: no hang on Bash or search, report note, done state.
- Kill path: `kill --run` returned `killed:true` on live rows twice (e2e-s6, e2e-s7) and `killed:false` honestly on already-stopped/completed runs (e2e-s1, e2e-s3, e2e-s5).

## Headless pipeline proof (e2e-s13-probe, source-loaded worker 2026-10-10)
- `claude --bg --agent runner --permission-mode dontAsk --settings '{"crossSessionInbound":"accept","permissions":{"allow":["Bash(python3 *atlas_todo.py*)","mcp__claude_mem_mcp_search"]}}' --plugin-dir plugins/atlas` — no interactive approval, ran to completion headless.
- Worker made the allowed Bash call under dontAsk and posted to `.atlas/.run/board/e2e-s13-probe.jsonl` seq 221 (`owner:"e2e-s13-probe", to:"lead"`); the TEXT arg read back as `--text` because the hand-built probe prompt mis-quoted the CLI args — a probe-prompt artifact, not a pipeline defect (the mux brief composes args JSON-safe via `_bg_brief`; S5-TaskMirror/s9's board rows through the real brief carried clean text, e.g. e2e-s8's "e2e-s1 ok").
- Root cause of s10/s11 (previous silent fails — done, 0 notes): the atlas recall_gate denied every main-thread tool call in worker sessions lacking a claude-mem recall; fixed by WorkerRecallSkip (hooks/recall_gate.py skips arming for ATLAS_WORKER_NAME sessions, worker_inbox.is_worker_env, 10.4.1 analogy; red-first tests test_recall_gate.py 25 passed; completion_gate 325/13). WorkerRecallSkip + this probe prove the unattended loop headless.
- Caveat: the loop was NOT re-verified through atlas_mux `_bg_brief` after the recall fix (my probe bypassed the mux); mux CLI loop is proven via e2e-s8 pre-fix. Suggested third-pass: `atlas_mux.py spawn` once on the next run.