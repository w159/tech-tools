# Reference files

External and vendor documentation snippets. When an atlas skill needs a
short excerpt of an external doc (an API reference, a vendor schema, a
regulatory clause), it copies the excerpt here rather than hot-linking,
so the project stays self-contained and offline-capable.

## What lives here

- `<vendor>/` - one folder per vendor (e.g. `ninjaone/`, `vanta/`)
- `<standard>/` - one folder per standard (e.g. `owasp/`, `cis/`)

## Conventions

- Every excerpt cites its source URL and fetch date at the top.
- Excerpts are copies, not links, so they survive source churn.
- Keep excerpts short; link to the source for the full doc.

atlas-setup and atlas-audit write here.
atlas-setup only creates it.