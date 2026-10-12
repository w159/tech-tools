# Testing the Atlas mod

The mod's hooks and UI run under the `claude-code/testing` kit via Claude Code's
plugin test host: `*.test.ts` / `*.test.tsx` files in the plugin tree, executed
in an environment like the one the hooks run in — no Node `fs`, no network, no
`process`. Helpers and tests are plain ES modules importing types from
`./contract.ts` and `claude-code` / `claude-code/testing` (type-only imports;
at run time those imports are empty).

## Run

```sh
claude plugin test plugins/atlas
```

From the repo root. This loads the plugin the way the engine does and runs each
test file; it exercises the mod (hooks and the rendered native element trees of the band and
sidebar), not a surface's paint.

## Measured state (2026-10-12)

Full run from the repo root:

```sh
claude plugin test plugins/atlas
```

Expectation is two-tier:

- **Mod lines must be fully green.** The mod test files load and pass,
  309 pass (includes `mod/pane/sidebar.test.ts`, `mod/register-sidebar.test.ts`
  and `mod/sprites/sprites.test.ts`, which injects `memFs` from
  `mod/test_helpers.ts` instead of importing `node:fs`, which the host forbids).
- **Colony/omp residuals are expected failures of the walk.** 169 pre-existing
  load failures, each a `plugins/atlas/colony/**` or `plugins/atlas/omp/**` file
  importing `bun:test`, which the mod test host forbids. Those suites stay on
  `bun test` and are not mod regressions.

Host facts: `claude plugin test [dir]` requires a plugin directory whose
`hooks/hooks.json` names a module (`claude plugin test mod` fails with "no
hooks module to load"; the single-file form is unsupported, and there is no
exclude/config flag in `--help`); discovery walks the whole plugin tree at any
nesting depth, independent of cwd. A mod test file may import only its own
relative files plus `claude-code` / `claude-code/testing`.

## Helpers (`mod/test_helpers.ts`)

| Export | What it is |
| --- | --- |
| `FIXTURE_EPOCH_MS` | Fixed base timestamp all fixtures derive from; tests stay deterministic. |
| `FIXTURE_CONTRACT` | A valid `Contract`: the 8 phases with glyphs, `todoPhases`, header pattern, item phase prefix. |
| `memFs(files?)` | In-memory `FsLike` (per contract.ts) seeded from a `{ path: text }` map. Returned as `MemFs`, which adds two extras: |
| — `bump(path?)` | Advances the mtime of one path (or every path) by 1ms — simulates a file change for rebuild-on-change logic. |
| — `write(path, text)` | Sets content and bumps mtime — simulates an edit. |
| `makeSnapshot(over?)` | A valid `AtlasSnapshot`: 8 phases with glyphs, 3 squad agents (`running`/`idle`/`parked`), 5 todos across phases, 3 notes, members, personas, counts. `over` shallow-merges on top; if it swaps `todos`, the default `counts` are recomputed unless `over.counts` is given. |

All sizes/mtimes are counters over a fixed clock (never `Date.now`), so
snapshots and assertions are reproducible.

## Example

```ts
import { expect, mock, test } from 'claude-code/testing';
import { memFs, makeSnapshot } from './mod/test_helpers';
import { buildSnapshot } from './mod/data'; // pure data reader over FsLike

test('rebuilds when a watched file changes', async $ => {
  const fs = memFs({
    '/tmp/atlas-fixture/todos.json': JSON.stringify([{ id: 't1', content: '[research] map', status: 'pending', phase: 'research' }]),
  });
  const before = await buildSnapshot(fs, makeSnapshot());
  expect(before.todos.length).toBe(1);

  fs.write('/tmp/atlas-fixture/todos.json', '[]');
  const after = await buildSnapshot(fs, makeSnapshot());
  expect(after.todos.length).toBe(0);
});
```

For UI tests, call the pure tree builders (`bandTree`, `sidebarTree`) with a recording
elements object and handler stubs, as `mod/pane/sidebar.test.ts` does; pass
`mock.clock(on)` when the component schedules work. Live key behavior (ctrl+x tab,
Tab, arrows, Enter) is checked in a real session, not here.

## Conventions

- Every fixture timestamp derives from `FIXTURE_EPOCH_MS`; bump the clock only
  via `memFs`'s `bump`/`write`, never `Date.now`.
- Keep helpers in `mod/test_helpers.ts` only; data readers stay pure over
  `FsLike` so they are testable through `memFs` alone.
