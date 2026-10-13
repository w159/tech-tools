# Verify run 2026-10-13 (atlas 12.0.0 Command Center)
## Gates
- `claude plugin test plugins/atlas`: 249 pass / 169 fail, "Ran 418 tests across 200 files". All 169 fails = "cannot import bun:test / file did not load": colony/ 144, omp/ 21 (+4 other non-mod); mod/ = 0.
- `bunx tsc --noEmit -p plugins/atlas/mod/tsconfig.json`: exit 0, no output.
- pytest unusable (brew shim points at missing python3.12; python3.15 has no pytest). Equivalent `python3 -m unittest discover` in hooks/: Ran 1447, FAILED (failures=2):
  - test_status_contract.BootMainStyleTest.test_omp_ignores_claude_output_style: `assertNotIn("ATLAS | <glyph>", ctx)` fails; boot context now contains the header rule (session_boot.py status_contract_lines change) under omp. REPRODUCED in isolation.
  - test_atlas_contract.InstalledParityContract.test_installed_hook_files_match_repo: failed in full run (siblings were editing), passes in isolation (skipped=1) => flaky/concurrent.
## Live (tmux atlaslive)
(a) PASS band during run: `◎ research 0/0 ▱▱▱▱▱ · ⠼ probe-verify Bash 2s · ✗2 gates · ▸ /atlas-cc` (later `⠇ probe-verify Bash 17s`, `⠦ ... Bash 52s`). Note age restarts per tool call.
(b) PASS team tab: `│ ⠴▸ probe-verify  explorer  Bash  22s      3 │` + `● lead  running 1 · 0 done · 0 blocked`
(c) PASS channel tab: `#channel  1 nicks`
(d) PARTIAL: first assistant line one-line with both pipes: ` ATLAS | 🔍 research | DISPATCH -> atlas:explorer (probe-verify · haiku/low) (sleep 30 then report done), dispatched once since the request was duplicated; wai…` ; final ` ATLAS | 🏁 done | Completion notice for probe-verify arrived; ...`. Receipt `▸ 9m02s · 1 workers · ctx 13% · $0.09` present (9m02s looks wrong for a 77s turn). Header says "dispatched once since the request was duplicated": my send-keys duplicated the prompt text. Band did NOT return to `⚑ idle`: stays `⚑ done 0/0 ▱▱▱▱▱ · ⏸ probe-verify awaits input · ✗2 gates · ▸ /atlas-cc` because worker is parked `⏸ awaits lead reply` with 1 blocked (agent never reported finished state); team row `⏸▸ probe-verify explorer awaits lead reply 4s 4 1. Bash sleep 30 ...`.
(e) PASS at 100x30: pane is 8 rows (╭..╰), band `⚑ done 0/0 ▱▱▱▱▱ · ⏸ probe-verify awaits input · ✗2 gates   [-]` (no `▸ /atlas-cc` hint, no ages in band; pane table still shows age `51s`).
Other: pane opens on last tab (channel) not route; Tab/Up keys did not change tab, letter `t` did.
