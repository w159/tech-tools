# Features

Per-feature specs-as-built. After a feature ships, this folder holds the
record of what was actually built (as opposed to what was planned in
specs/).

## What lives here

- `<feature>/README.md` - feature overview, entry points, status
- `<feature>/as-built.md` - what was built, with file:line refs
- `<feature>/evidence.md` - verification evidence for the feature

## As-built template

```
# <feature> - as-built
Date shipped: YYYY-MM-DD
Status: shipped | partial | reverted

## What was built
- <component> at <file:line>

## Verification
- <command> -> <actual output> (pass/fail)

## Deviations from spec
- <what changed and why>
```

atlas-feature and atlas-orchestrate write here. atlas-setup only creates it.