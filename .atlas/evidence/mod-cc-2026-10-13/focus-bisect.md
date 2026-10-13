# Focus bisect: "first Enter does not submit" (2026-10-13)

## Verdict
Not reproduced; neither the mod nor the prompt_optimizer hook is the cause. No code or hook changes were made.
Most likely a probe-side artifact (tmux send-keys timing, or Enter sent into a session that was busy or still starting). Not proven.

## Evidence (tmux `atlaslive` 160x45, `claude --plugin-dir plugins/atlas`, cwd /tmp/atlas-live; NameMux posted "live done" first)
| Probe | Mod | Typing | Result |
|---|---|---|---|
| (a) `say hi` + one Enter, captured every 5 s for 40 s | on | 50 ms per char | Submitted; reply visible at t=5 s, input empty |
| (b) `pgrep -fl 'prompt_optimizer\|ollama'` at each capture | on | n/a | No prompt_optimizer process. Only ollama/xollama serve daemons and a llama-server |
| (c) `/atlas-cc`, Escape, `say hi` + Enter | on | 50 ms per char | Pane opened (`▸ to lead` input); Escape closed it; submitted, reply in under 5 s |
| (c') `/atlas-cc`, NO Escape, `say hi` + Enter | on | 0.3 s between text and Enter | Submitted on the first Enter even with the pane focused. 3 repeat runs, 3 of 3 submitted, then 3 of 3 more after Escape |
| (d) `ATLAS_MOD=off` (no band rendered), `say hi` + Enter | off | 50 ms per char | Submitted; reply by t=5 s |
| paste-style, no delay between text and Enter, 6 trials | on and off | `send-keys -l` then Enter | 6 of 6 submitted on the first Enter |
| typing 4 s, 8 s and 12 s after launch, with a 0.3 s gap | on | `send-keys -l` then Enter | 3 of 3 submitted; first reply took 3-8 s (cold first turn) vs ≤3 s with mod off |
| typing 8 s after launch | off | same | Submitted; first reply under 3 s |

## Hook latency
`prompt_optimizer.py` default mode is `trigger` (only `opt:` / `optimize:` / `++` prefixes call ollama; MINLEN 12 also skips short prompts). Direct run with a `say hi` payload: 0.04-0.05 s wall (3 runs). So the 120 s Ollama timeout is reachable only for trigger-prefixed prompts. The only UserPromptSubmit hooks in play: plugin optimizer, plus user-level `lean-ctx hook observe` and iterm2 cc-status.

## Code read (no change needed)
- `register.ts`: `PANE_DOCK` (auto-open) asks no focus; `PANE_ON_DEMAND` (`focus:true, closeOnEscape:true`) opens only from `/atlas-cc`. `ui.close` clears `paneOpenedState`; Escape was observed to close it and return keyboard to the main input.
- With the pane still open and focused, the main input still received text and a single Enter submitted (c'), so no focus trap.

## Caveats
- A stray `❯ say hi 1` was left in the input once after a rapid trial batch; consistent with Claude Code's greyed prompt suggestion, not a held keystroke. Not investigated further.
- Possible explanations not testable here: probes fired while background agents were running ("← 3 agents" in the status line), or Enter sent while a previous turn was in flight (it then queues).
- Mod on shows a slower first reply (3-8 s) than mod off (≤3 s) in the single paired sample; one sample, not a failure to submit.
