# components: extract a repeated pattern into one shared component

## 1. Spot it

A pattern is repeated when the same markup and behavior appear in 2 or more places. Find candidates with the code-nav tools: search for a distinctive class name, a handler name, an icon import, or the same JSX / template shape. Also ask which surfaces the user expects to match ("every taxonomy table"). List each call site as file:line before changing anything.

## 2. Extract

1. Read every call site and write down what differs (data, labels, handlers) and what does not (structure, icon, hover, actions). The differences become props or slots; the rest is the component.
2. Create the component in the project's own stack and folder convention (React component, Vue SFC, SwiftUI View, Compose function, Flutter widget, server template partial). Do not introduce a framework the project lacks.
3. Style it with tokens only. Any value the tokens lack: ask the user, add it to the token file, use it.
4. Take icons from `icon_library` only. If the pattern fixes an icon to a domain object (a row type icon), the component owns that mapping.

## 3. Migrate

Replace each call site with the component, one site at a time, running the project's tests or build between sites. Delete the old markup. Leave no copy behind. Run `taste_check.py` at the end.

## 4. Record

Write `docs/standards/<pattern>.md`:

```
---
title: <Pattern name>
applies_to: [<globs of files that render this pattern>]
reference: <path/to/Component.tsx>:<line>
last_updated: YYYY-MM-DD
---
## Rule
<what every instance must share, as a checklist, naming tokens not values>
## Why
## Example
## Decision log
```

Add a one-line entry to the Components section of `docs/standards/design-system.md`. The `standards_nudge` hook then injects the Rule before edits to matching files.

## Worked example: taxonomy tables

A financial app has several taxonomy screens (account types, asset classes, fee schedules). Each renders a table whose rows show a type icon, change color on hover, offer a pencil and a trash action, and open that object's form modal when clicked. The markup was copied per screen and has drifted.

- `DataTable`: takes columns, rows and an `onRowClick`. Owns the row hover color (a token), the row type icon slot and keyboard behavior.
- `RowActions`: the pencil (edit) and trash (delete) controls, icons from the project icon library, sized from the icon size tokens. Stops click propagation so an action does not also open the row. Delete asks for confirmation.
- `FormModal`: takes the object kind and an id (or none for create), renders that object's form, handles dismissal and focus return.
- Per-screen code supplies only the columns, the object kind, its icon and its form.

The standard `docs/standards/taxonomy-table.md` has `applies_to` set to the taxonomy screen globs and `reference` pointing at the `DataTable` definition. Its Rule says: use `DataTable` with `RowActions`; the row type icon, the hover token and the action pair are not overridden per screen; row click opens that object's `FormModal`. A new taxonomy table that hand-rolls rows is then caught at edit time by the nudge and at review by the check.
