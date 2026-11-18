# Testing the Atlas mod

The mod's hooks and UI run under the `claude-code/testing` kit via Claude Code's
plugin test host: `*.test.ts` / `*.test.tsx` files in the plugin tree, executed
in an environment like the one the hooks run in — no Node `fs`, no network, no
`process`. Helpers and tests are plain ES modules importing types from
`./contract.ts` and `claude-code` / `claude-code/testing` (type-only imports;
at run time those imports are empty).

## Layout

`plugins/atlas/mod/` after the 2026-11-18 reorganization (plan: `docs/plans/2026-11-18_atlas-mod-reorg-plan.md`):

| Directory | Holds |
| --- | --- |
| `host/` | hook wiring and the register entry points (`register-*.test.ts`, `notify`, `poll`, `hooks`, `motion-feed`, `usage`) |
| `data/` | pure readers over `FsLike` (`core`, `todos`, `snapshot`, `live`, `orchestration`, `channels`, `crew`, `mux`, `herdr`, ...) |
| `design/` | theme, paint, vocabulary, chart/rail/spark primitives |
| `view/` | rendering: `band/`, `board/`, `hud/`, `panel/` (with `panel/pane/` for the sidebar), `transcript/` (`*.test.tsx`), plus cross-surface truth tests |
| `motion/` | motion and 256-colour tests |
| `input/` | click, intent and routing tests |
| `sprites/` | sprite art, palette and golden tests |

Top-level files: `register.ts`, `contract.ts`, `test_helpers.ts`, `test-shim.ts`, `test-preload.ts`, `live_fixture.ts`.

## Run

```sh
claude plugin test plugins/atlas
```

`bun test` runs the same files without the host, through a shim: from `plugins/atlas`, `bun test mod`
(or `bun test`, which also runs omp and colony). `bunfig.toml` preloads `mod/test-shim.ts`, which stands in for
`claude-code/testing` (describe, expect, test delegate to bun:test) and for `atom` / `read` / `update` from
`claude-code`. It is a shim, not the real kit: tests whose body takes the host engine
(`test(name, async ($, on) => ...)`, most of them the 17 in `host/register-sidebar.test.ts`, which use `mock.clock`,
`mock.env` and `$.ui.mount`) are skipped under bun and run only under `claude plugin test`.

Measured 2026-11-18 at atlas 17.29.0, each command run from `plugins/atlas`:

| Command | pass | skip | fail | tests | files |
| --- | --- | --- | --- | --- | --- |
| `bun test mod` | 4298 | 31 | 0 | 4329 | 233 |
| `bun test omp` | 839 | 4 | 0 | 843 | 54 |
| `bun test` (mod, omp, colony; herdr-web-ui is ignored by `bunfig.toml`) | 6774 | 35 | 0 | 6809 | 342 |

Of the 31 `mod` skips, 17 are in `host/register-sidebar.test.ts`; the other 14 are skipped in other files.
The host kit (`claude plugin test`) was not run for these numbers: it needs the Claude Code CLI, which this
measurement did not use.

From the repo root, `claude plugin test plugins/atlas` loads the plugin the way the engine does and runs each
test file; it exercises the mod (hooks and the rendered native element trees of the band and
sidebar), not a surface's paint.

## CI tiers

`.github/workflows/tests.yml` runs these on every pull request and push to main (Bun 1.4.4, from `plugins/atlas`
so `bunfig.toml` loads the preloads):

| Job | Command |
| --- | --- |
| `atlas-bun` | `bun test omp mod`, then a tsc step that fails when a relative import (`./` or `../`) does not resolve |
| `atlas-py-fast` | `python -m pytest -q -p no:cacheprovider hooks scripts` with `--ignore=<file>` for each `hooks/` and `scripts/` line of `ci-slow-tests.txt` |
| `atlas-py-slow` (matrix `hooks`, `scripts`) | `python -m pytest -q -p no:cacheprovider $(grep -E '^<dir>/' ci-slow-tests.txt)` |
| `atlas-herdr` | in `colony/herdr-web-ui`: `bun run build`, `bun run test:unit`, `bun run test:integration` (checksum-pinned herdr 0.9.3) |
| `atlas-mod-gate` | `python3 plugins/atlas/scripts/atlas_mod_gate.py --live --require-live` against `@anthropic-ai/claude-code@2.1.325` |
| `full` (push, schedule, dispatch) | root `python -m pytest -q -p no:cacheprovider`, then `bun test` in `plugins/atlas` |

`scripts/test_ci_tiers.py` proves every `test_*.py` under `hooks/` and `scripts/` is in exactly one Python tier.

## Typecheck

```sh
cd plugins/atlas && bun run typecheck   # tsc --noEmit -p tsconfig.json
```

`tsconfig.json` and `mod/tsconfig.json` extend `.claude-plugin/types/tsconfig.json`, which the Claude Code host
generates locally and `.gitignore` excludes. Without it tsc reports TS5083 and host-type errors: on 2026-11-18, two
identical runs gave 890 `error TS` lines, 369 of them TS2307 (all on the bare specifiers `claude-code` and
`claude-code/testing`) and 0 TS2307 on a relative specifier. The total is not a stable ratchet, so CI gates only on
the relative-specifier TS2307 count, which catches a broken file move. A full clean typecheck needs the host types
generated locally; the shared snapshot types in `contract.ts` and `types/index.d.ts` are kept in sync by hand.

Host facts: `claude plugin test [dir]` requires a plugin directory whose
`hooks/hooks.json` names a module (`claude plugin test mod` fails with "no
hooks module to load"; the single-file form is unsupported, and there is no
exclude/config flag in `--help`); discovery walks the whole plugin tree at any
nesting depth, independent of cwd. A mod test file may import only its own
relative files plus `claude-code` / `claude-code/testing`. Colony and omp files import `bun:test`, which
the host forbids, so they stay on `bun test` and fail to load under `claude plugin test` by design; that is not a
mod regression. `sprites/sprites.golden.test.ts` injects `memFs` from `mod/test_helpers.ts` instead of importing
`node:fs`, which the host forbids.

## Helpers (`mod/test_helpers.ts`)

| Export | What it is |
| --- | --- |
| `FIXTURE_EPOCH_MS` | Fixed base timestamp all fixtures derive from; tests stay deterministic. |
| `FIXTURE_CONTRACT` | A valid `Contract`: the 8 phases with glyphs, `todoPhases`, header pattern, item phase prefix. |
| `memState(seed?)` | In-memory, versioned `$.state` double (`get`, `set` with `ifVersion`) seeded from a `{ key: value }` map. |
| `memFs(files?)` | In-memory `FsLike` (per contract.ts) seeded from a `{ path: text }` map. Returned as `MemFs`, which adds two extras: |
| — `bump(path?)` | Advances the mtime of one path (or every path) by 1ms — simulates a file change for rebuild-on-change logic. |
| — `write(path, text)` | Sets content and bumps mtime — simulates an edit. |
| `makeSnapshot(over?)` | A valid `AtlasSnapshot`: 8 phases with glyphs, 3 squad agents (`running`/`idle`/`parked`), 5 todos across phases, 3 notes, members, personas, counts. `over` shallow-merges on top; if it swaps `todos`, the default `counts` are recomputed unless `over.counts` is given. |

All sizes/mtimes are counters over a fixed clock (never `Date.now`), so
snapshots and assertions are reproducible.

## Example

```ts
import { expect, test } from 'claude-code/testing';
import { FIXTURE_CONTRACT, memFs } from '../test_helpers';
import { readTodos } from './todos'; // pure reader over FsLike (mod/data/todos.ts)

test('re-reads the board when the file changes', async () => {
  const fs = memFs({
    '/r/.atlas/.run/todos.json': JSON.stringify({ items: [{ id: 't1', content: '[research] map', status: 'pending' }] }),
  });
  const before = await readTodos(fs, '/r', 's1', [], FIXTURE_CONTRACT);
  expect(before.items.length).toBe(1);

  fs.write('/r/.atlas/.run/todos.json', JSON.stringify({ items: [] }));
  const after = await readTodos(fs, '/r', 's1', [], FIXTURE_CONTRACT, before.cache);
  expect(after.items.length).toBe(0);
});
```

For UI tests, call the pure tree builders (`bandTree` in `view/band/band.tsx`, `sidebarTree` in
`view/panel/pane/sidebar.tsx`) with a recording elements object and handler stubs, as
`view/panel/pane/sidebar.test.ts` does; pass `mock.clock(on)` when the component schedules work. Live input
behavior (mouse clicks on chips and `▸` toggles; the mods print no key hints) is checked in a real session, not here.

## Conventions

- Every fixture timestamp derives from `FIXTURE_EPOCH_MS`; bump the clock only
  via `memFs`'s `bump`/`write`, never `Date.now`.
- Keep shared helpers in `mod/test_helpers.ts`; data readers stay pure over
  `FsLike` so they are testable through `memFs` alone. A test file sits beside its subject, named for it.
