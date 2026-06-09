# Invariants — DO NOT BREAK

Load-bearing rules of this codebase. Each entry: the rule, *why* it exists, and where it's
enforced. This is the file that lets an agent push back **before** going the wrong way.
Delete the examples; keep the format.

> Example shape (replace):

- **<The rule, stated as an imperative>** — e.g. "All DB writes go through `repo/` — never
  raw SQL in handlers."
  - **Why:** <what breaks if violated — data integrity, a contract other code depends on, a
    deploy/runtime constraint>
  - **Where:** `path/to/file.ext:line` (where it's defined / enforced / would break)

- **<Intentionally-weird thing> is deliberate.** — e.g. "The retry loop in
  `worker/queue.ts:88` looks redundant; it guards against a known broker double-deliver. Do
  not 'simplify' it."
  - **Why:** <the non-obvious reason>
  - **Where:** `path/to/file.ext:line`
