# atlas-taste: a project's own design system

`plugins/atlas/skills/atlas-taste/` builds and enforces each project's design system. It ships no palette, font, icon set, radius, spacing scale, density, component library or voice. Every visual decision comes from the project's `docs/standards/design-system.md` and the token file it lists; a missing decision is asked of the user (AskUserQuestion), never defaulted.

## Modes

| Mode | What it does |
|---|---|
| `init` | Reads what the project already has (CSS custom properties and `@theme`, Tailwind config, CSS-in-JS themes, token JSON, SCSS variables, platform themes, installed icon and component libraries, logo files) and writes `docs/standards/design-system.md` from `templates/design-system.md` plus one token file in the project's own format. Asks for what is missing. |
| `component` | Turns UI repeated in 2+ places into one shared component in the project's stack, using tokens only, migrates the call sites, and writes `docs/standards/<pattern>.md` with `applies_to` and `reference: path:line`. Example: a taxonomy table becomes DataTable + RowActions + FormModal. |
| `check` | `scripts/taste_check.py` (stdlib Python, static, no browser). FAIL with file:line for a raw color not equal to a token, spacing or radius off the token scale, an import from an icon library other than `icon_library`. Exit 1 on FAIL, 0 clean, 2 when no design-system standard exists. `--json` available. |
| `gate` | Frontmatter Stop hook `taste_check.py --gate`. Silent unless `.atlas/.run/taste/armed.json` exists (written at the start of a UI task); while armed it blocks Stop with the FAIL list; the Nth Stop (`--rounds N`, default 5) gives up with the open count, so at most N-1 blocks (verified: finding `atlas-taste-check`). Never starts a browser. |

`scripts/taste_browser.mjs` is an optional computed-style audit (colors, radii, font sizes, spacing against tokens; horizontal overflow at several widths). It refuses to run without `--allow-browser` (exit 3), and the skill asks the user every time before running it.

## How it connects

- The standards it writes are enforced by `hooks/standards_nudge.py` (see `project-standards.md`): an agent editing a file a standard covers gets that standard's Rule first.
- `atlas-frontend` builds screens against the project's design system and runs `atlas-taste init` first when none exists. Its former fixed rule ("shadcn/ui, Tailwind, Radix only") was removed on 2026-11-24.

## Decisions (2026-11-24, user)

- A full port of the MIT taste-skill (commit 6c0b5c7, 1,634 files, about 39 MB, mostly an art library and its author's palettes, fonts, house rules and copy voice) was rejected. atlas-taste adapts only its method: one-system rules, a consistency checker, a finish gate. No upstream code was copied (`plugins/atlas/skills/PROVENANCE.md`).
- Taste is per project and dynamic; atlas never imposes a third party's or its own opinions.
- No browser runs without the user's permission, in skills, scripts, gates or subagents.

## Limits

- `taste_check.py` reads CSS custom properties and JSON tokens; other token formats get a WARN ("unsupported token format"), not a check.
- The static check sees literals in source, not computed styles; the browser audit covers that, on request only.
