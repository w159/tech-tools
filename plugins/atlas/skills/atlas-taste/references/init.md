# init: discover, ask, record

Goal: leave the project with `docs/standards/design-system.md` (from `templates/design-system.md`) and exactly one token file in the project's own format, referenced by the standard's `tokens:` frontmatter. Nothing is invented. A decision the project has not made is asked of the user.

## 1. Discover what already exists (read only)

Search with the code-nav tools, stack by stack. Record each hit as file:line.

| Stack | Look for |
|---|---|
| Web CSS | `:root { --x: ... }` custom properties, `@theme` blocks (Tailwind v4), `@layer base` |
| Tailwind v3 | `tailwind.config.*` `theme` / `theme.extend` |
| CSS-in-JS | theme objects passed to a provider (`ThemeProvider`, `createTheme`, `defineConfig`, vanilla-extract, Stitches, Panda) |
| Token JSON | `tokens.json`, `*.tokens.json`, Style Dictionary or Tokens Studio exports (`$value` / `value`) |
| SCSS / Less | `$variables`, `@use` token partials, maps |
| SwiftUI | `Color` / `Font` extensions, asset catalog color sets, a `Theme` type |
| Android | `res/values/colors.xml`, `dimens.xml`, `themes.xml`, Compose `MaterialTheme` |
| Flutter | `ThemeData`, `ColorScheme`, `ThemeExtension` |

Also read the package manifest (`package.json`, `Package.swift`, `build.gradle`, `pubspec.yaml`, `pyproject.toml`) for installed icon libraries and component libraries, and look for logo and brand files (`logo*`, `brand*`, `assets/`, `public/`).

## 2. Classify

- Tokens found in one place: that file is the candidate single source.
- Tokens found in several places or none: the user picks the single source (see step 3). Do not merge on your own.
- Several icon libraries installed: the user picks one.
- Raw values scattered through UI source with no tokens: report the count and the most repeated values as evidence, not as a proposal to adopt them.

## 3. Ask (AskUserQuestion, batch up to 3 per call)

Ask only what discovery could not answer. Typical questions: which token file is canonical (or what format to create), which icon library, whether brand assets exist and where, spacing and radius scale if tokens do not define them, whether copy voice matters. Offer discovered options as choices; the user's free-text answer always wins. Never offer your own taste as a default.

## 4. Write

1. Create `docs/standards/design-system.md` from the template. Fill frontmatter from the answers: `applies_to` (UI source globs), `tokens` (the one token file), `icon_library`, `allow_raw_values_in` (the token file and anything the user names), `last_updated`.
2. If no token file exists, create one in the format the user chose, containing only values the user gave or that discovery found in existing code and the user confirmed. Missing values stay out of the file; the check then skips that scale.
3. Fill Brand, Tokens (names only), Icons and the Decision log with the answers and their dates.
4. The standard needs a `## Rule` section so the `standards_nudge` hook injects it before edits that match `applies_to`.

## 5. Verify

Run `python3 "${CLAUDE_SKILL_DIR}/scripts/taste_check.py"` from the project root. Existing violations are expected: report the FAIL and WARN counts to the user and offer migration as a separate step. Do not rewrite existing UI during init.
