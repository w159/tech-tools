# API

OpenAPI/Swagger specs for this project's HTTP API, plus the human-facing
endpoint reference at `docs/endpoints.md`. Only present when the project
has an API -- atlas-setup creates this folder on detecting an API signal
(an OpenAPI/Swagger file, a routes/controllers/api directory, or a web
framework dependency).

## What lives here

- `<name>.openapi.yaml` / `<name>.openapi.json` - the spec(s)
- `docs/endpoints.md` (sibling, not nested here) - human-readable
  endpoint reference generated or curated from the spec(s)

atlas:docs-curator owns this folder. atlas-setup only creates it.
