---
name: armada-brand
description: 'Set up or update the organization''s branding so every agent output carries it: org name, voice and tone, colors, commit style, doc template. Writes the org and branding blocks of .atlas/org-config.yaml. Run this first, before onboarding any department.'
when_to_use: first-time org setup, changing org name/voice/colors/commit style, or auditing whether agent outputs are carrying org branding
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, AskUserQuestion
paths: [".atlas/org-config.yaml"]
argument-hint: '[org name, or "audit" to check current branding]'
---

Set up org branding: $ARGUMENTS

This is step 1 of an armada deployment. Departments inherit branding from here,
so run this before `armada-department`.

## Detect before you ask

Never ask for something the repo already tells you. Gather all of this in one
pass, in parallel, before opening your mouth:

| Fact | Where to look |
|---|---|
| org name | `.atlas/org-config.yaml` `org.name`, then `package.json` `name`/`author`, then the H1 of `README.md`, then the owner segment of `git remote get-url origin` |
| short_name | filesystem-safe slug of the org name |
| website | `package.json` `homepage`, `git remote`, README badges |
| logo | `assets/`, `public/`, `docs/assets/` for `*logo*.{png,svg,jpg}` |
| colors | `tailwind.config.*`, `**/theme.css`, `**/globals.css` for `--primary`/`--color-primary`, `:root` custom properties, or a `brand` palette key |
| voice / tone | the tone of existing `README.md` and `docs/` prose |
| commit_style | `git log --oneline -30`: conventional-commit prefixes present or not |
| doc_template | `docs/templates/*.md` |

If `.atlas/org-config.yaml` already exists, load it and treat its values as the
current state. This skill merges, it never truncates a config it did not write.

## Ask at most once

Open exactly ONE `AskUserQuestion` covering only the fields you could not
detect, each option pre-filled with your detected value as the recommended
choice. Cap it at 4 questions. Typical shape:

- **Org name** - detected value (Recommended) / other
- **Voice** - professional / friendly / technical / plain
- **Primary color** - detected hex (Recommended) / other
- **Commit style** - conventional (detected from git log) / custom / none

Everything else (logo path, website, colors you found, doc template) goes in
without asking. If you detected every field, write the config and skip the
question entirely: say what you detected and what you wrote.

Never ask about departments, connectors, or compliance frameworks here. Those
belong to `armada-department` and `armada-connect`.

## Write

Merge into `.atlas/org-config.yaml`, creating the file and the `.atlas/`
directory if absent. Only the `org:` and `branding:` blocks are yours; leave
`policies:`, `departments:`, and `connectors:` exactly as found.

```yaml
org:
  name: "Acme Corporation"
  short_name: "acme"
  logo: "assets/acme-logo.png"        # omit the key if not found
  website: "https://acme.example"     # omit the key if not found

branding:
  voice: "professional"
  tone_guidelines: |
    <2-4 concrete lines, derived from the repo's existing prose>
  colors:
    primary: "#0066CC"
    secondary: "#FF6600"
  commit_style: "conventional"
  doc_template: "docs/templates/acme-doc.md"   # omit the key if not found
```

The full schema, including the `policies:` block you are not writing here, is
in `${CLAUDE_PLUGIN_ROOT}/skills/armada/references/org-config-schema.md`.

## What branding then does

Once written, the branding block is loaded by the `armada-*` department agents
before they start work, so they produce branded output from the start rather
than being asked to rewrite it after. It governs:

- **Docs**: README, CHANGELOG, and `docs/` entries use the org name and voice
- **Code comments**: follow the org's commenting standards
- **Commit messages**: follow `branding.commit_style`
- **Reports**: audits and assessments use the org template and colors

## Audit mode

With the argument `audit`, write nothing. Report a three-column table: field,
configured value, and whether the repo's actual outputs match it. Check at
least: does `git log --oneline -20` match `commit_style`; does `README.md` use
`org.name`; does the logo path resolve to a real file; do the color values
appear in the theme files. Cite `file:line` for every mismatch.

## Verify before you report

1. `cat .atlas/org-config.yaml` - show the written file.
2. Confirm it parses:
   `python3 -c "import yaml,sys;yaml.safe_load(open('.atlas/org-config.yaml'));print('org-config.yaml: valid YAML')"`
   (if PyYAML is missing, say so rather than claiming validity).
3. Confirm any `logo` or `doc_template` path you wrote resolves to a real file;
   drop the key if it does not.

## Report

The path written, the fields set, and one line: `Next: /armada:armada-department
<name>` to activate the first department.
