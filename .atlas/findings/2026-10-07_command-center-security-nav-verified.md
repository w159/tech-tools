# command-center-security-nav-verified: open-file/open-editor strict root+target validation and Settings nav order independently reproduced

- id: command-center-security-nav-verified
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-07T10:57:10+00:00

## Evidence
- SEC: isolated dashboard :63374 on sqlite .backup of ~/.atlas/atlas.db + 20 injected hostile roots; 20 roots x4 probes (open-file root/rel/target, open-editor) all 403 (unknown_root|path_outside_root; files as root 400 bad_root), stub spawns=0
- SEC: in-project .git/config .env .env.local id_rsa key.pem auth.json credentials.json .npmrc .netrc server.key sub/.ssh .vscode, symlinks->~/.ssh/id_ed25519 & /etc/hosts, ../ escapes, prefix sibling projevil, roots .git/.ssh/symlinkdir -> all 403 both routes, 0 spawns; no/wrong token 401 x4
- LEGIT: DB copy 456 roots (+3 agent cwds): 225 not-a-dir, 50 effective accepted unique realpaths -> 50/50 open-editor 200, 49/50 open-file 200 (ComfyUI-Installs has no top-level file; nested ComfyUI/manifest.json 200); tech-tools + 30 others under ~/MEGA/Projects 200; space path + symlinked parent 200; .github/workflows/ci.yml + .gitignore 200
- REFUSED with marker (77): 67 under dot-dirs (~/.claude-instances outputs, ~/.atlas/worktrees/tech-tools-selffix-48, ~/.omp, ~/.hyper_plugins), 9 iCloud/OneDrive repos under ~/Library (stale 92.8d), home itself; 104 no-marker (e.g. ~/MEGA, osprey-private, falcon-mcp, ~/bin)
- ARGV exact: herdr plugin pane open --plugin herdr-file-viewer --entrypoint file-viewer --placement split --direction right --focus --env HERDR_FILE_VIEWER_ROOT=<realroot> --env HERDR_FILE_VIEWER_OPEN=<rel[:line|:a-b]>; tode <dir>; tode --goto <abs>:<line>:1; hostile name $(touch /tmp/pwned_sec);`touch pwned2`;x.md passed literally, markers absent
- NAV (real Chrome, playwright-core): Move Projects up -> editor+rail change immediately and after reload, saved nav_order persisted; legacy [overview,activity,health,colony,work,irc,improve,projects,settings] -> editor 8 canonical ids no alias/dupes, rail 11 links canonical; mobile 390 tabbar = first 4 of saved order + More (rest); custom order followed; 0 console/page errors
- NOTE (non-blocking): rail sorts whole groups so it cannot mirror arbitrary editor order (after move: editor Projects,Self-improvement,Settings vs rail projects,settings,improve; legacy: editor puts Herdr console last, rail keeps it in Operate); mobile TABS omits herdr entirely
- SUITES: pytest integrations+dashboard+live 101 passed; bun nav-order 4 pass; hooks unittest 1169 OK (skipped=3); sweep (ATLAS_SELFFIX=0) 60/60 cells 10/10 deep; $TMPDIR/.atlas and /tmp/.atlas absent; my procs gone; managed.ts=1, herdr server=1

## Reproduction
isolated atlas_dashboard serve --foreground (ATLAS_HOME=/var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/secnav_qz9m36sd/atlas_home, stub tode/herdr on PATH, DB .backup + injected roots) + POST matrix; bun /var/folders/t4/3yydl26s5mqb99t84qw3_wrm0000gn/T/secnav_qz9m36sd/nav.mjs; pytest/bun test/hooks unittest/sweep run.mjs as dispatched

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
