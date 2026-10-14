## Compound Pack health check

Conditionally part of onboard (step 8) and repair mode. Compound Packs are
org/team conventions that atlas grounds plans and reviews in; the resolver
is `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_packs.py`. This step is a no-op when it is
absent - never an error:

1. **Skip check** - if `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_packs.py` does
   not exist, skip this whole step silently.
2. **Detect intent** - check whether the project has a `.claude/atlas.local.md`
   with a `packs:` declaration. If yes, run the resolver on it. If no, ask
   the user once: "Do you have org or team conventions (coding standards,
   review checklists, plan templates) you want atlas to ground plans and
   reviews in?" Only if the user says yes, scaffold a starter block
   (step 4). Never create `.claude/atlas.local.md` unprompted.
3. **Run the resolver and report in plain language** -
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_packs.py" <args shown by its --help>`.
   Translate every warning or error it prints into plain language for the
   user, e.g.: a pack source URL git cannot reach ("this pack's git repo
   is unreachable - check the URL or your network"), a pack path that
   escapes the repo boundary ("this pack points outside this repository,
   which atlas refuses for safety"), or duplicate pack IDs ("two packs
   share the same ID; the second overrides the first"). Do not paste raw
   tracebacks; do not auto-fix a user-authored `packs:` block without
   approval - propose the corrected line and apply only on confirmation.
4. **Offer a starter scaffold** - when the user wants packs but has no
   `packs:` block yet, offer to create `.claude/atlas.local.md` containing
   a commented starter `packs:` entry. Follow the schema in the Compound
   Packs documentation (`references/compound-packs.md` in the atlas plugin)
   for the exact fields. Apply only after the user approves the draft.

If the resolver is present but its output is unintelligible (crash, unknown
flag), say the pack resolver could not run and move on - a failed health
check never blocks the rest of onboarding.
