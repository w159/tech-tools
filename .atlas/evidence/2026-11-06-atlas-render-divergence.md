# Evidence: why three sessions render ATLAS three different ways (2026-11-06)

Observed on this machine. Read-only investigation: no settings changed, no plugin
installed or purged. Command output quoted verbatim.

## The three shapes

| # | Shape | Session |
|---|---|---|
| A | `◆ ATLAS · idle · last wave: 1 worker · 32m00s · ✔ ok` + rows `CONTRACT / VERDICT / OFFLOAD / ROUTE` + `tasks … 5/7 r: route t: team c: channel g: core o: board` | Claude Code, cwd `~/MEGA/Projects/Web/gwh-doc-analyzer` |
| B | `◆ ATLAS ✗ IMPLEMENT 3/7 …` pills on the assistant message header | Claude Code, cwd `~/MEGA/Projects/Web/gwh-firstrespondersapp` |
| C | `ATLAS │ 🔧 implement │ 1/5 (3 implementers running)` raw header, no restyle | workspace and host unproven; line is model prose, not a captured draw site |

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

So shape C is not a third renderer: it is the model narrating an ATLAS line in
prose. Note that this occurrence is in a CLAUDE Code session, so prose lines
are not omp-exclusive.

What the code does establish is host CAPABILITY: omp has no call into
`mod/band.tsx` or `mod/restyle.tsx` (its phase pills live in the Mission
Control widget, `omp/mission-panel.ts:131-137`, and its ATLAS guidance reaches
the model as an output style, `omp/style.ts:23` -> `output-styles/atlas-orchestrator.md`),
so an omp session cannot draw shape A or shape B - while a Claude Code session
can produce the prose form, as the transcript above shows.

RETRACTED (2026-11-06): an earlier version of this note claimed shape A and
shape C came from the SAME session. They do not. The transcript hit is
`gwh-doc-analyzer` / `aa162b87` with a Sentry `1/8` line; image 1 shows
different content (Penny memory, Telegram, n8n, Teams, S1-S5 stages) and a `1/5`
count. Image 1's workspace and host stay UNPROVEN, so the host-based
attribution above is a capability statement, not an identification of image 1.

## Finding 8 - HEALTH FINDING, not a cause of the observed divergence

```
~/.omp/plugins/cache/marketplaces/tech-tools   -> git clone, HEAD 92c78c0 "atlas 17.2.0", cloned Nov 6 07:56
~/.claude/plugins/installed_plugins.json       -> atlas@tech-tools 17.2.0, gitCommitSha 92c78c03afb0af6522dde5c289c111a5342a704b
~/.omp/plugins/installed_plugins.json          -> atlas@tech-tools 17.2.0, installedAt 2026-11-06T12:56:26Z
this repo                                       -> branch claude/gateway-broker-mode-main, plugins/atlas version 16.4.1 (HEAD), 16.4.2 (working tree)
python3 plugins/atlas/scripts/atlas_doctor.py --hook
  -> ATLAS-DOCTOR WARNING: ... omp-bridge: omp runs 17.2.0 but this plugin is 16.4.2: omp enforcement is stale
```

**This is NOT the cause of the divergence between the three sessions.** Every session
in this investigation executed a tree from the plugin CACHE
(`~/.claude/plugins/cache/tech-tools/atlas/<version>`), never this checkout, and no
session was shown loading it. The repo/cache split therefore explains nothing about
the screenshots; it is a separate health problem:

- Edits under `plugins/atlas/` in this repo are not in the running plugin.
- Re-publishing or re-installing from this branch would install a **lower-numbered**
  tree (16.4.x) than the 17.2.0 already in the caches, and every semver-newest-wins
  resolver (`omp/plugin-path.ts:14-22`, and the Claude Code shim's cache fallback)
  would keep preferring the other tree. That is a future risk, not an observed cause.
- `atlas-doctor --hook` already reports the mismatch (`omp-bridge: omp runs 17.2.0 but
  this plugin is 16.4.2`), so the tool is not blind to it - it is blind to the
  *session* skew.

## Correction to Finding 1 - the pin is per PROCESS, not per machine

An earlier version of this note said "rebooting the machine does not help; only
restarting the session does". That was wrong. The plugin tree is resolved once, at
process start, and held for that process's life - so **any** restart, a reboot
included, re-resolves the registry and picks up the current version (17.2.0 today).
What is not enough is *resuming* a conversation whose process is still alive.

The process start times say the machine has not rebooted since the long-running
session began:

```
ps -axo pid,lstart,command | grep claude
  1983   Nov 5 16:47  claude resume 41e6b90d   cwd gwh-firstrespondersapp
  58350  Nov 6 08:47  claude session-id aa162b87   cwd gwh-doc-analyzer
```

pid 1983 has been alive since Nov 5 16:47, so it pinned 17.1.0 (the registered
version then) and has held it ever since; pid 58350 started after the 17.2.0 install
and holds 17.2.0. The divergence is the two sessions having started on either side of
the Nov 6 07:56 install - not the machine's state, and not a reboot's failure to
help.

## Unverified

- The exact atlas path loaded by the omp binary is not directly observable
  (compiled binary, `lsof` shows no open atlas files).
- Image 1's workspace and host are not identified. The only transcript hit for
  `implementers running` is gwh-doc-analyzer/aa162b87, with Sentry content and 1/8,
  which does not match image 1's Penny/Telegram/n8n/Teams content and 1/5 count.

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
