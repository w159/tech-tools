---
title: Design system
applies_to: []
tokens: []
icon_library: ""
allow_raw_values_in: []
last_updated: YYYY-MM-DD
---

# Design system

Fill the frontmatter by asking the user, then delete this paragraph: `applies_to` is the UI source globs (the folders holding screens and components), `tokens` the token file paths (single source, the project's own format), `icon_library` the package name or path of the one icon library, `allow_raw_values_in` the globs where raw values are legitimate (normally just the token file).

## Rule

Every visual value in UI source comes from the token files listed above. A color, spacing, radius, type size, motion duration or icon that is not a token is added to the token file first (after asking the user), then used. Icons come from `icon_library` only. Repeated patterns live in a shared component listed under Components; do not copy their markup.

Follow it. If this change deliberately alters the standard, update that doc and its Decision log in the same change.

## Brand

Ask the user: product name, logo files and where they live, any brand guideline document. Record the answers here. Leave blank what the user has not decided.

## Tokens

Ask the user which token file is canonical. List here, by token name only (never copy values; the token file is the single source):

- Color roles: ask the user
- Spacing scale: ask the user
- Radius family: ask the user
- Type scale and font families: ask the user
- Motion durations: ask the user
- Hairline / border: ask the user

## Icons

Ask the user which icon library the project uses. State the size set (token names) and the stroke or fill style. Record any icon assigned to a domain object, for example "row type icon for <object>", so every surface uses the same one.

## Components

Index of shared components. One line each: `Name` - what it is - `docs/standards/<pattern>.md`.

- (none yet)

## Voice

Optional. Ask the user whether copy tone matters; record their words if so. Otherwise delete this section.

## Decision log

| Date | Decision | Asked / decided by | Why |
|---|---|---|---|
| YYYY-MM-DD | Created from template | | |
