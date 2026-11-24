---
name: atlas-taste
description: "Builds and enforces a project's own design system: tokens, brand, icon set, shared components, consistency check. Use when starting UI in a project, when pages look inconsistent, when adding a repeated UI pattern, or when asked for a design system, taste or brand (init, component, check, gate mode)."
when_to_use: "design system, brand, tokens, icon set, pages look inconsistent, same UI in many places, shared component, consistent tables, taste"
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, AskUserQuestion
argument-hint: '[init|component|check|gate] [project] [pattern]'
hooks:
  Stop:
    - hooks:
        - type: command
          command: 'python3 "${CLAUDE_SKILL_DIR}/scripts/taste_check.py" --gate'
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

# `atlas-taste`

Builds and enforces the project's own design system. atlas-taste ships no palette, font, icon set, radius, density or voice. All of it comes from the project's `docs/standards/design-system.md` and the token file it lists.

## Core law

1. Every visual decision comes from `docs/standards/design-system.md` and its token file.
2. When a decision is absent, ask the user with AskUserQuestion (batch up to 3 questions per call), then record the answer and its date in the standard's Decision log. Never choose a palette, font, icon set, radius, density or voice yourself, and never offer your own taste as a default.
3. Never import a library the project does not already use without asking.
4. A value that is not a token is added to the token file first (after asking), then used. Never edit `allow_raw_values_in` to hide a finding.

This builds on atlas standards: `docs/standards/*.md` with `applies_to` globs, injected before edits by `hooks/standards_nudge.py`. atlas-taste writes standards of that shape; it does not add a second injection path.

## Modes

Pick from the first argument or the ask.

| Mode | When | Do |
|---|---|---|
| `init` | No `docs/standards/design-system.md`, or the user wants a design system | Read `${CLAUDE_SKILL_DIR}/references/init.md`. Discover, ask, write the standard from `templates/design-system.md` plus one token file. |
| `component` | A pattern appears in 2+ places, or the user wants consistent screens | Read `${CLAUDE_SKILL_DIR}/references/components.md`. Extract one shared component from tokens only, migrate call sites, write `docs/standards/<pattern>.md`. |
| `check` | Review or audit existing UI | Run `python3 "${CLAUDE_SKILL_DIR}/scripts/taste_check.py"` from the project root (`--json` for tooling). Report FAIL and WARN with file:line. Exit 2 means no standard exists: run `init`. |
| `gate` | Start of a UI task that should not finish dirty | Run `python3 "${CLAUDE_SKILL_DIR}/scripts/taste_check.py" --arm --rounds 5` (the user may pick another count). |

Read `${CLAUDE_SKILL_DIR}/references/system-rules.md` before writing or reviewing any UI. It states the one-system rules; the values come from the tokens.

## Checks

`scripts/taste_check.py` is static and starts no browser. It reads the standard's frontmatter (`applies_to`, `tokens`, `icon_library`, `allow_raw_values_in`) and reports:

- FAIL: a raw color (hex, rgb, hsl) that equals no token value.
- FAIL: an import from an icon library other than `icon_library`.
- WARN: a px or rem spacing or radius literal off the token scale (only when the tokens define that scale).
- WARN: an unsupported token format (only CSS custom properties, including `@theme`, and JSON tokens are parsed), no tokens listed, or `icon_library` unset.

Exit 1 on any FAIL, 0 otherwise, 2 when no standard exists. SwiftUI, Android and Flutter themes are not parsed; review those by reading.

## Finish gate

The skill's Stop hook runs `taste_check.py --gate`. It does nothing unless `.atlas/.run/taste/armed.json` exists, which `gate` mode writes at the start of a UI task. While armed and FAILs remain, it blocks the stop with the FAIL list and counts the round. After the max rounds (default 5) it disarms and prints "gate gave up: N FAILs open"; tell the user which remain. It disarms silently once the check is clean. It never starts a browser. Self-tests for the check and the gate: `scripts/test_taste_check.py`.

## Browser check (optional, needs permission every time)

`scripts/taste_browser.mjs <url> --tokens <token.css> --allow-browser` loads the page at several widths and flags computed colors not in the tokens, off-token radii, font sizes and spacing, and horizontal overflow. It launches a browser, so ask the user before every run, and pass `--allow-browser` only after a yes in this conversation. Without the flag it refuses and exits 3. It needs playwright or puppeteer already installed in the project; if neither is, ask before adding one.

## Boundaries

- Edit the project's UI and `docs/standards/`; never this plugin's files or any install cache.
- Existing violations are reported, not mass-rewritten, unless the user asks for a migration.
