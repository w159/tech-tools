# README Section Standard

The sections every onboarding-grade README must carry, in order, and what
each section is for. atlas-readme generates against this standard; if a
section does not apply, it is omitted rather than left as a stub.

## Section list (canonical order)

1. **What and Why** - one paragraph: what the project is and why it exists.
2. **Quickstart** - the shortest path from clone to running, using the repo's
   actual commands.
3. **Prerequisites and Setup** - exact commands using the repo's real package
   manager; runtime versions sourced from the repo's version pins.
4. **Project Structure** - top-level directory map, one line each.
5. **Architecture and Data Flow** - prose; a Mermaid diagram only if the
   system complexity warrants it, otherwise skipped.
6. **Configuration** - env vars and config keys sourced from the real
   .env.example or config file.
7. **Operations** - run, test, build, and troubleshooting for the common
   failure modes.
8. **External Dependencies** - links to the third-party or vendor docs the
   code actually relies on.

## Sourcing rules

- **Commands**: must appear verbatim in a real script, manifest, or CI file.
  If a command must be inferred, mark it `[verify]` inline.
- **Env vars**: must map to a key in the real `.env.example`, sample config,
  or settings file. Do not list env vars from memory.
- **Runtime versions**: source from `.nvmrc`, `.python-version`, `package.json`
  `engines`, or equivalent. Do not guess.
- **Package manager**: detect from the manifests present (yarn.lock,
  package-lock.json, pnpm-lock.yaml, uv.lock, requirements.txt, pyproject.toml).
  Use the commands that exist in the repo. Do not invent or assume them.
- **External dependencies**: source from the real dependency manifests; link
  to the vendor docs the code actually uses.

## Style constraints

- Plain direct language, U.S.-keyboard ASCII only.
- No marketing fluff, no superlatives (no "seamless", "robust", "powerful").
- Every factual claim traces to a specific file or line.
- Claims that do not trace are either removed or marked `[verify]`.

## The [verify] convention

When a claim or command cannot be traced to a real file but must appear in the
README, mark it `[verify]` inline so the reader knows it is unconfirmed. The
final REPORT section of the skill lists every `[verify]` item and why.

## Audience handling

The skill accepts an audience argument: `contributors`, `internal`, or
`both`. For `contributors`, the README leans toward setup and contribution
flows. For `internal`, it leans toward operations and architecture. For
`both`, it carries the full section set. The section order does not change
by audience; only the depth and emphasis do.

## Seed template

`templates/README.seed.md` carries the skeleton with every section above. The
skill fills it from the repo's actual files and deletes any section the repo
does not warrant.