# Atlas round 3 audit: terminal UI, working signal, critic scores

Date: 2026-11-12. Release build: a7bc7b0d (atlas 17.14.0). Data paths below are under `/mnt/project-files/atlas-ui-redesign/`.

## The ask

The owner said the UI looked cheap, and that he could not tell whether Atlas was still working because the animations were gone.

## Root cause of the lost animation

Commit 298d4895 (Command Center redesign, 12.0.0) gated the mod's tick on `liveWorkers`. A turn with only the lead and no running worker therefore animated nothing. Evidence: `plugins/atlas/mod/register.ts:1030`, `git show 298d4895 -- plugins/atlas/mod/restyle.tsx`, frames f0074-f0090 of `round2/after/live-150-4b5b5a94-1` (finding `.atlas/findings/2026-11-12_rootcause-lead-only-anim.md`, verified).

## Working signal

Twelve runs per build (`round3/working-signal-<build>.json`, `rows`). `alive_pct` is the share of working frames where the band shows motion or a state word; `moving_pairs_pct` is the share of consecutive working frame pairs that differ; `longest_no_motion_s` is the longest still stretch (capture period 0.5 s).

| Build | alive_pct | moving_pairs_pct | longest_no_motion_s (max) |
|---|---|---|---|
| 3f9f8566 | 65.0-100 | 64.7-100 | 6.58 |
| 2cf10943 | 100 | 81.1-98.0 | 3.04 |
| 513bb41c | 80.0-100 | 60.6-90.7 | 5.57 |
| bfb52164 | 100 | 100 | 0.0 |
| a5fa582a | 100 | 100 | 0.0 |
| 46d4825c | 100 | 100 | 0.0 |
| a7bc7b0d | 100 | 100 | 0.0 |

a7bc7b0d is 100% / 100% / 0.0 s in all 12 runs (`working-signal-a7bc7b0d.json`).

## Hostile critic scores

Overall mean line of each critique (`round2/after/critique-21.md` to `critique-28.md`):

| Critique | Overall mean | Note |
|---|---|---|
| 21 | 5.5 | |
| 22 | 5.6 | |
| 23 | 5.7 | 513bb41c |
| 24 | 1.1 | build 09a0dd86, failed to load |
| 25 | 6.0 | bfb52164 |
| 26 | 6.0 | a5fa582a |
| 27 | 6.1 | 46d4825c |
| 28 | 5.6 | a7bc7b0d; stricter showcase bar |

The critic moved from 5.5 to 5.6-6.1 over the builds that loaded. Critique 28 scored each surface against the showcase TUIs instead of earlier Atlas builds; it says against 46d4825c itself the fixes and regressions roughly cancel out. The score did not reach the showcase field.

## Load failure of 09a0dd86

Build 09a0dd86 failed to load because it assigned the host's `$` object (critique-24.md, overall 1.1). The fix is in bfb52164, with host-load-rule tests that keep a mod from assigning host-owned objects.

## Wave 28 and 29

Wave 28 added a 250 ms blocked hold. The side panel showed `done` while work was still running. Wave 29 removed the hold; a7bc7b0d does not show `done` while a dispatch is open or a worker runs.

## Remaining defects (critique-28.md, on a7bc7b0d)

- Band: it moves between rows within a run (rows 38, 25, 24, 28). Blocked appears about half a second late and carries a spinner.
- HUD: it loses its corners and bottom rule while three agents run, and leaves empty grey rows.
- SUBAGENTS at 110 columns draws one row under `3 running · +2 more`.
- Board: about 45% of the pane is blank, with no motion.
- Side panel: the team tab is nearly empty, and all channel rows share one time.
- Cards are bare bars.

## README screenshots

`cc-band-running.png`, `cc-band-idle.png` and `cc-card-done.png` are real claude CLI captures of a7bc7b0d (`round2/after/live-150-a7bc7b0d-1/mod-band_workers.png`, `mod-band_counts.png`, `mod-transcript_cards.png`). `cc-team.png`, `cc-scope-deny.png` and `omp-widget.png` are kept from an earlier build because no a7bc7b0d capture shows tmux tiles, a scope deny or the omp widget. No capture shows the blocked band as a standalone frame, so no `cc-band-blocked.png` was added.

## Recording harness constraint

The read-only scorer requires circle glyphs on TODO and band worker rows and the `◖ ◆ ATLAS ◗` markers, so a recording that drops those glyphs scores as not working.
