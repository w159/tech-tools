# Evidence: why three sessions render ATLAS three different ways (2026-11-06)

Observed on this machine. Read-only investigation: no settings changed, no plugin
installed or purged. Command output quoted verbatim.

## The three shapes

| # | Shape | Session |
|---|---|---|
| A | `◆ ATLAS · idle · last wave: 1 worker · 32m00s · ✔ ok` + rows `CONTRACT / VERDICT / OFFLOAD / ROUTE` + `tasks … 5/7 r: route t: team c: channel g: core o: board` | Claude Code, cwd `~/MEGA/Projects/Web/gwh-doc-analyzer` |
| B | `◆ ATLAS ✗ IMPLEMENT 3/7 …` pills on the assistant message header | Claude Code, cwd `~/MEGA/Projects/Web/gwh-firstrespondersapp` |
| C | `ATLAS │ 🔧 implement │ 1/5 (3 implementers running)` raw header, no restyle | omp runtime, third workspace (path unproven) |

## Finding 1 - the two live Claude Code sessions run DIFFERENT atlas versions

```
ls ~/.claude/plugins/cache/tech-tools/atlas/*/.in_use
  17.1.0/.in_use/1983   (created Nov 5 16:51)
  17.2.0/.in_use/58350  (created Nov 6 08:56)
ps -axo pid,lstart,command | grep claude
  1983   Nov 5 16:47  claude resume 41e6b90d          cwd gwh-firstrespondersapp
  58350  Nov 6 08:47  claude session-id aa162b87       cwd gwh-doc-analyzer
ls ~/.claude/plugins/cache/tech-tools/atlas/17.1.0/.orphaned_at   # exists
```

The transcript hook paths agree with the markers: session `5fa73dfc` (pid 1983)
cites only `tech-tools/atlas/17.1.0` from `2026-11-06T12:22Z` through `20:13Z`;
session `aa162b87` cites only `17.2.0`. The registry moved at
`2026-11-06T12:29:06Z` (`~/.claude/plugins/installed_plugins.json` lastUpdated),
i.e. AFTER pid 1983 had already started and pinned the old tree.

**A plugin update does not reach a session that is already running.** That is why
the CLI prints `✓ Update installed · Restart to update` (visible in the
firstrespondersapp screenshot) and why a reboot only helps if the session itself
is restarted, not merely the machine.

## Finding 2 - the version skew does NOT explain the shape difference

```
shasum -a 256 {17.1.0,17.2.0,~/.omp/plugins/cache/plugins/tech-tools___atlas___17.2.0}/mod/{band.tsx,restyle.tsx,register.ts,theme.ts}
  band.tsx    3b9ff3b7796e…  identical in all three trees
  restyle.tsx 6d6da4f0ec54…  identical in all three trees
  register.ts b65cecb7a86f…  identical in 17.1.0 and 17.2.0
  theme.ts    0ee40cdd7862…  identical in 17.1.0 and 17.2.0
```

The renderer sources are byte-identical. What DOES differ between the two
versions (`diff -rq 17.1.0 17.2.0 -x '__pycache__' -x '.in_use'`):

```
hooks/session_boot_core.py        omp/usage-statusline.ts    omp/proc.ts
hooks/worker_report_gate_core.py  mod/pane/sidebar.golden-*.ts
scripts/atlas_dashboard.py        scripts/dashboard_ui/js/*.js
```

So the shapes are different DRAW SITES of one mod, not different code versions:

- `plugins/atlas/mod/band.tsx` -> the band (`idleTitle` 258, `lastWave` 239,
  `MARK = '◆'` 13), drawn in the AbovePrompt / bottom slot.
- `plugins/atlas/mod/restyle.tsx` -> the header pills (`pills` 167,
  `assistantTree` 192), i.e. the `◆ ATLAS  ✗ IMPLEMENT 3/7` row.
- raw header (shape C) -> where the restyle does not run: the omp host loads
  `./omp/index.ts`, which has no restyle (only `omp/style.ts` supplies the
  header instruction and a fallback rule).

## Finding 3 - render-time gates decide what survives

- `plugins/atlas/mod/register.ts:721` - the whole mod is off when
  `ATLAS_MOD=off`.
- `plugins/atlas/mod/restyle.tsx:236-238` - `ready()` returns a null snapshot
  when `ATLAS_MOD=off`, so no pills.
- `plugins/atlas/mod/discipline.ts:3` - every hook is gated by
  `ATLAS_MOD != off` AND an interactive session.
- `plugins/atlas/mod/band.tsx:259` - `const wave = c.cols >= MID ? lastWave(c, all) : ''`
  with `MID = 120`: below 120 columns the band collapses to `◆ ATLAS · idle`.
- `plugins/atlas/mod/band.tsx:239-241` - no workers -> no wave text.
- commit `c06754b6` changed `ATLAS_MOD` from read-once-at-session-start to
  read-per-render (`restyle.tsx:236-238`), so the toggle now takes effect
  mid-session; before that, the value was frozen for the session's lifetime.

## Finding 4 - per-workspace state isolation explains the CONTENT, not the shape

```
gwh-doc-analyzer        .atlas/.run Nov 6 15:24   .atlas/evidence Nov 6 10:45   .atlas/findings Nov 6 14:39
gwh-firstrespondersapp  .atlas/.run Nov 6 15:24   .atlas/evidence Nov 6 07:50   .atlas/findings Nov 6 08:21
tech-tools (global)     .atlas/.run Nov 6 14:47
OMP global state        ~/.omp/.atlas/.run  Oct 30 11:24   (stale)
```

Each workspace keeps its own `.atlas/`; the global `~/.omp/.atlas/.run` is a
month stale. That is why the counts differ (`5/7` vs `3/7`, `idle` vs
`implement`, verdict tallies). The `✗` in shape B is the glyph the model wrote,
not a code difference.

## Finding 5 - the stale omp cache dir is a red herring

`~/.omp/plugins/cache/plugins/tech-tools___atlas___8.0.1` (stub, only
`scripts/`, Oct 14 15:03) is unreachable: it is in neither
`~/.omp/plugins/installed_plugins.json` nor `omp-plugins.lock.json`, and the
fallback resolver (`plugins/atlas/omp/plugin-path.ts:14-22,41-54`) semver-compares
siblings, so 17.2.0 wins. It would only be selected if 17.2.0 were deleted.

The omp loader (`~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/discovery/helpers.ts:1386-1470`)
reads BOTH `~/.claude/plugins/installed_plugins.json` and
`~/.omp/plugins/installed_plugins.json` and treats the omp registry as
authoritative - `drop all Claude-sourced entries for this plugin ID`. Roots are
memoized per process, which is exactly why a running session keeps its old tree.
(The on-disk omp source is 18.13.3; the running binary is 18.16.0, so this read
is approximate for the live process.)

## Finding 6 - atlas-doctor cannot see any of this

`plugins/atlas/scripts/atlas_doctor.py` checks plugin registration, omp bridge
wiring, content drift vs source, codex wiring and typesafe scoring. It does NOT
check orphaned cache dirs, does NOT compare the Claude cache against the omp
cache, and does NOT compare the running session's pinned version against the
registry. So `atlas-doctor` can pass while sessions still render differently.

## Finding 7 - shape C is MODEL PROSE, not an ATLAS renderer

The `ATLAS | 🔧 implement 1/8 | 3 implementers running (...)` line is a text
block the model wrote inside its own reply:

```
~/.claude/projects/-Users-jerry-MEGA-Projects-Web-gwh-doc-analyzer/aa162b87-74f3-43b7-8ec9-c126522987e1.jsonl:784
  type: assistant   role: assistant
  block text: ATLAS | 🔧 implement 1/8 | 3 implementers running (backend Sentry,
                frontend Sentry, backfills); S5 queued until one returns
```

So shape C is not a third renderer. It is the model narrating an ATLAS line,
which happens where the host gives it no band to render - omp applies the
atlas **output style** instead (`plugins/atlas/omp/style.ts:23` points at
`output-styles/atlas-orchestrator.md`, with a tool-name translation addendum),
and `plugins/atlas/omp/mission-panel.ts:131-137` paints phase pills only in the
Mission Control widget, never in the message header. omp has no call into
`mod/band.tsx` or `mod/restyle.tsx`, so an omp session can never draw shape A
or shape B.

Note that shape A and shape C came from the SAME session
(`gwh-doc-analyzer`, `aa162b87`): one session can show the band and the raw
prose line at different moments, depending on which host is rendering.

## Unverified

- The exact atlas path loaded by the omp binary is not directly observable
  (compiled binary, `lsof` shows no open atlas files).

## Reproduction

```bash
# which plugin tree each live Claude session pinned
ls ~/.claude/plugins/cache/tech-tools/atlas/*/.in_use
ps -axo pid,lstart,command | grep claude

# renderer sources identical across versions -> shape is a draw site, not a version
shasum -a 256 ~/.claude/plugins/cache/tech-tools/atlas/{17.1.0,17.2.0}/mod/{band.tsx,restyle.tsx}

# what actually changed between the two versions
diff -rq ~/.claude/plugins/cache/tech-tools/atlas/17.1.0 ~/.claude/plugins/cache/tech-tools/atlas/17.2.0 \
  -x '__pycache__' -x '.in_use' -x '*.pyc' | grep -vE '\.test\.|test_|CHANGELOG|conftest'

# the stale omp cache dir is unreferenced
grep -o 'atlas[^}]*' ~/.omp/plugins/installed_plugins.json ~/.omp/plugins/omp-plugins.lock.json
```
