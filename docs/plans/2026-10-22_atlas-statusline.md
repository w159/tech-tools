# Atlas statusline: one look on omp and Claude Code

Date: 2026-10-22. Status: shipped 12.8.0 (unreleased).

## Ask

Ship the omp usage statusline as an atlas feature. On omp, atlas renders the
same widget the user runs today from `~/.omp/agent/extensions/usage-statusline.ts`.
On Claude Code, atlas renders the closest equivalent from the `statusLine`
stdin JSON and drops what Claude Code cannot supply.

## Source of truth for the look

The user's omp extension (1048 lines, with the local patch applied) renders:

```
📁 project   🐸 ···✦··  2m14s · 38 tok/s · tools 7 · $0.12     👾 Claude Opus 5.5  ·  high
(blank row)
📚 ctx  51% ▅▅▅▅▅▅▅▁▁▁▁▁▁▁  513.3k / 1M       │  💰 session    $10.26  391.7M tok  cache 99%
⏳ 5h   62% ▅▅▅▅▅▅▅▅▅▁▁▁▁▁  4h40m anthropic   │  🔌 anthropic     plan  350.1M tok  claude-opus-5-5
📅 7d   18% ▅▅▅▁▁▁▁▁▁▁▁▁▁▁  6d15h anthropic   │
(blank row)
```

Layout rules the two renderers share (all from the omp source):

- Colors: `R=\e[0m CYAN=\e[1;36m MAGENTA=\e[1;35m GREEN=\e[1;32m YELLOW=\e[1;33m RED=\e[1;31m DIM=\e[1;90m BOLD=\e[1m BLUE=\e[1;34m WHITE=\e[1;37m SOFT=\e[37m MONEY=\e[35m TRACK=\e[38;5;238m`.
- Heat gradient stops (RGB): (80,250,123) (241,250,140) (255,184,108) (255,85,85); cell i of N colored at position i/(N-1); when `heat` is false use the threshold color of the percentage.
- Bar: `filled = pct>0 ? max(1, round(pct/100*cells)) : 0`; styles `lower ▅/▁`, `full █/░`, `seg ▰/▱`, `line ━/─`; `undefined` reading = empty track.
- Threshold colors: `pctColor` green <=50, yellow <=75, red; `ctxColor` green <=60, yellow <=85, red.
- Meter cell: `<icon><gap><label padEnd 3> <pct padStart 4> <bar>  <detail clipped to detailW>`; fixed width `METER_W = iconW + gap + 3 + 1 + 4 + 1 + barCells + 2 + detailW`.
- Column rule: `COL_GAP = " "*colGap + DIM│R + " "*colGap`; every grid row is `padEnd(left, METER_W) + COL_GAP + right`.
- Right table: `<icon><gap><name padEnd nameW> <cost padStart costW>  <tok padStart tokW> DIM tok  <extra clipped to extraW>`; cost/tok widths start at 7 and only grow. Session row name is WHITE, provider rows CYAN; cost is bold MAGENTA for the session total, MONEY for providers, GREEN when the value is `plan`.
- Formatting: `formatTokens` 1.2M/3.4k with floor truncation, `formatSize` 1M/200k, `formatCost` `$10` >=100, `$1.23`, `$0.00`, `<$0.01`, `formatDuration` `2m14s`/`1h3m`/`1d2h`, `timeLeft` from a reset timestamp (`4h40m`, `6d15h` when days allowed).
- Widths: emoji are 2 cells; ANSI is zero. Rows wider than the real terminal width are hard-clipped with `…`; when `METER_W + COL_GAP + widest right head` does not fit, drop the right column.
- Config file `~/.omp/agent/usage-statusline.json` (keys `glyphGap lineGap colGap blankLine spacerPipe line1Mode showEffort line1Pipe cwdWidth modelWidth mCtx m5h m7d barCells barStyle heat detailW showRight provRows showCache nameW extraW iconStyle showTools showRunCount renderMs pollS`, defaults in the omp source). Both harnesses read the same file so one edit restyles both.

## omp side: `plugins/atlas/omp/usage-statusline.ts`

The user's extension, verbatim apart from:

- Export `registerUsageStatusline(pi: ExtensionAPI): void` (the former default export) and `export const USAGE_STATUSLINE_WIDGET_KEY`.
- `FALLOW_BIN`: `Bun.which("fallow")` only; no hard coded home path. When it resolves to nothing the fallow column is skipped.
- `index.ts` calls `registerUsageStatusline(pi)` from `atlasOmpExtension` unless `ATLAS_STATUSLINE=off` or a user copy exists at `~/.omp/agent/extensions/usage-statusline.ts` or `<cwd>/.omp/extensions/usage-statusline.ts` (two copies would race on the same widget key). Config and widget key stay the same so a user who deletes the personal copy sees no change.

## Claude Code side: `plugins/atlas/scripts/atlas_statusline.py`

Stdlib Python, stdin JSON per https://code.claude.com/docs/en/statusline, prints the rows. Field mapping:

| omp element | Claude Code source | Note |
|---|---|---|
| 📁 project | `workspace.current_dir` basename, else `cwd` | |
| 👾 model · effort | `model.display_name`, `effort.level` | effort omitted when absent |
| activity lane (critter, tok/s, tools, run cost) | `cost.total_duration_ms`, `cost.total_lines_added/removed` | rendered as `⏱ 2m14s · +12/-3 lines`; no run span events exist, so no critter animation, tok/s, tool count or run count |
| 📚 ctx | `context_window.current_usage` (input + cache_creation + cache_read) over `context_window_size`; `used_percentage` when `current_usage` is null | `--%` placeholder before the first call |
| ⏳ 5h / 📅 7d | `rate_limits.five_hour / seven_day` `used_percentage`, `resets_at` (epoch seconds) | provider label `anthropic`; rows render the empty track when `rate_limits` is absent |
| 💰 session | `cost.total_cost_usd`, `context_window.total_input_tokens + total_output_tokens`; cache % = `cache_read / (input + cache_creation + cache_read)` of `current_usage` | cost shows `plan` (green) when `rate_limits` is present (subscriber), `$x` otherwise |
| 🔌 provider row | one row: `anthropic`, same cost rule, same tokens, `model.id` shortened (vendor prefix and `-YYYYMMDD` dropped) | one provider only on Claude Code |
| fallow column | `fallow --root <cwd> impact statusline`, first line, only when it starts with `fallow impact`; cached 60 s in `~/.atlas/statusline-fallow.cache` keyed by cwd | printed as a final row; skipped when `fallow` is not on PATH |

Excluded with no substitute: critter lane, `tok/s`, `tools N`, `N runs`, multi provider rows and `+N more`, pi-lens/ponytail row merge, the ZWSP spacer rows (Claude Code collapses nothing, so blank rows are plain empty lines).

CLI:

- `python3 atlas_statusline.py` (no args): render from stdin.
- `install`: write `statusLine` = `{"type":"command","command":"python3 \"<abs path>\""}` into `~/.claude/settings.json`; the previous value is saved to `~/.atlas/statusline.previous.json` once (never overwritten by a second install). `--settings <path>` for tests.
- `uninstall`: restore the saved previous value (or delete the key when none was saved).
- `--width N` overrides the terminal width (default `COLUMNS`, then `shutil.get_terminal_size`, then 120).

Tests: `plugins/atlas/scripts/test_atlas_statusline.py` (unittest, no network): fixture JSON renders the expected rows (ANSI stripped), the widths line up (every grid row has the rule at the same column), empty input renders placeholders, install/uninstall round trip on a temp settings file.

## Outcome

Shipped as 12.8.0 (unreleased, 2026-10-22); see `plugins/atlas/CHANGELOG.md`. Verification:

- `python3 -m unittest plugins/atlas/scripts/test_atlas_statusline.py`: Ran 7 tests, OK.
- `cd plugins/atlas/omp && bun test`: 476 pass, 0 fail.
- tsc: the two errors at `omp/index.ts:760` and `omp/mission-panel.ts:11` are unchanged from the committed baseline.
