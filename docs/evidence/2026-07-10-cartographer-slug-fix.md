# Evidence: atlas 3.1.2 - filesystem-safe audit filenames

Date: 2026-07-10
Change: `plugins/atlas/skills/atlas-cartographer/SKILL.md`, `plugins/atlas/skills/atlas-survey/SKILL.md` (+ version bump, changelog)
Commit: `940087e fix(atlas): 3.1.2 - slug audit filenames so Windows can sync the repo`

## Reported problem

A Windows clone of `henssler-financial/gwh-firstrespondersapp` failed to check out
branch `development` with a wall of `error: invalid path` lines. Every rejected
path was a cartographer chart whose filename contained a colon, e.g.:

```
error: invalid path 'docs/audits/atlas-cartographer-2026-07-09/charts/frontend:public-site-and-auth.md'
```

Windows reserves `:` (drive separator) and forbids it in filenames, so Git aborts
the entire checkout - not just the offending files. No one on Windows could sync.

## Root cause

atlas-cartographer wrote `charts/<feature>.md` from the model-chosen feature name
with no filesystem-safety constraint. The 2026-07-09 run minted composite names
like `admin-webapp:authentication-and-shell`. The colon rode straight into the path.

`plugins/atlas/scripts/build_hub.py` was ruled out as a source: it only reads
existing handoff files via `os.listdir` (build_hub.py:118) and writes fixed names
(`manifest.json`, `index.html`); it never derives a filename from a raw label.

## Fix

Added a "Filename safety" slug rule to atlas-cartographer/SKILL.md and a matching
constraint to atlas-survey/SKILL.md. The rule: lowercase; replace every character
outside `a-z 0-9 . _ -` (the Windows-reserved set `< > : " / \ | ? *` plus spaces)
with `-`; collapse and trim; guard empty results, reserved device names, and slug
collisions.

## Observed-behavior proof

The slug algorithm exactly as documented was applied to the real filenames from
the git error. Command and actual output:

```
$ python3 slug_demo.py
original (Windows-rejected)                         -> slug (Windows-valid)
--------------------------------------------------------------------------------------------
[OK ] admin-webapp:authentication-and-shell.md           -> admin-webapp-authentication-and-shell.md
[OK ] admin-webapp:client-outputs-and-document-delivery.md -> admin-webapp-client-outputs-and-document-delivery.md
[OK ] admin-webapp:organization-compensation-and-wellness-configuration.md -> admin-webapp-organization-compensation-and-wellness-configuration.md
[OK ] backend:admin-access-user-and-organization.md      -> backend-admin-access-user-and-organization.md
[OK ] backend:user-account-household-onboarding-and-documents.md -> backend-user-account-household-onboarding-and-documents.md
[OK ] frontend:investing-retirement-pension-and-accounts.md -> frontend-investing-retirement-pension-and-accounts.md
[OK ] frontend:public-site-and-auth.md                   -> frontend-public-site-and-auth.md
--------------------------------------------------------------------------------------------
all filenames Windows-valid after slug: True
unique outputs (no silent overwrite): 7 of 7 inputs

edge cases:
  'CON'                        -> 'feature-con'
  ':::'                        -> 'system-1'
  '  '                         -> 'feature-1'
  'Frontend / Auth: Login'     -> 'frontend-auth-login'
exit=0
```

Error path exercised: the edge cases prove the guard branches fire - a reserved
device name (`CON`), an all-reserved string (`:::`), whitespace-only, and a
mixed name with slash and colon all produce a non-empty, reserved-char-free slug.

## Scope boundary

This fixes the generator so future audits cannot emit colon paths. It does NOT
rename the files already committed to `gwh-firstrespondersapp`; those must be
renamed in that repo (colon -> hyphen) from a macOS/Linux checkout, since Windows
cannot check the branch out to fix it in place.
