# Updating an existing strategy doc

Required read before editing any strategy doc that already exists. Covers whose shape the file is in and how the update run proceeds.

## Meaning is the contract; shape belongs to whoever created the doc

When this skill creates the doc, it writes the house format in `references/strategy-template.md`. When a doc already exists that is not solely this skill's - written by hand or by another skill, or carrying their sections; an earlier version's house-format file is solely this skill's, per the ownership test below - adapt to it: read it by meaning (a section counts as present when the doc expresses it anywhere, under any heading or in prose), make only additive or minimal changes in its own idiom, and never restructure it, add frontmatter or headings uninvited, or duplicate a meaning under a new heading. Sections this skill did not write are someone else's captured intent: leave them in place; if this run learned something that makes one false, make the smallest edit that keeps its intent true and say so in chat. A section marked as approved by its author (an HTML comment naming the tool and the approval, for example `<!-- atlas-strategy: author-approved 2026-07-10 -->`), or a doc the user does not own, is not edited at all - report the conflict, or write to a separate file with a link, and leave the rest to its owner. The worst outcome is turning someone's existing doc into this template and breaking what already reads it.

## Whose file is it - decide before you edit

The conduct above protects other writers' content. Applying it to a file that has none freezes this skill's own old format for no reason, so decide from the file itself (history cannot attribute a section to a writer):

- **Solely this skill's** when the file positively has this skill's shape - at least one `##` heading from the template (`Purpose`, `Positioning`, `Users`, `Boundaries`, `Key metrics`, `Tracks`, `Milestones`, `Brand`), every `##` heading is one of those, and no HTML-comment marker from another tool appears anywhere in it. Frontmatter with `product` and `last_updated` and a `# <name> Strategy` title corroborate; a hand-written file that copied this shape is treated the same way, while a prose-only file with no template heading takes the adapt-in-place path. Such a file is *maintained* in house format on any write: sections put in the template's current order, a missing required section offered, `last_updated` set - the file ends the run in the current shape, and this stays true for as long as no one else has written into it.
- **Multi-writer** the moment any other heading or another tool's marker is present. This skill's own headings are still its to rename, but nothing is reordered - not this skill's sections and not anyone else's - and nothing foreign is restyled or edited. Ordering into the template belongs to solely-owned files only.
- **A different home entirely** (a repo-root `STRATEGY.md` in another tool's format): follow `references/grounding.md` - adapt in that file's shape if the user treats it as the strategy home, or write the atlas doc as a separate file that links to it. Never migrate a foreign doc into this template.

## The update run

Read the existing doc thoroughly. Summarize current state in 3-5 lines so the user sees what is on file, and note any section carrying `_Repo-derived - needs owner review._` as a natural revisit candidate.

Check for drift: compare every section of the doc against the repo model - stated intent, structure, and recent history (commits or PRs, plans under `docs/plans/`, findings under `.atlas/findings/INDEX.md`) - not only against what changed since the last write, since a targeted update advances `last_updated` without reviewing the rest. Name any section the evidence suggests is stale, with the evidence, as a candidate - not a verdict.

If the focus hint named a specific section, jump to that section in `references/interview.md`. Preserve every other section's content exactly, including sections this skill did not write, and its place per the ownership test above (a solely-owned file takes the template's order; a multi-writer file is never reordered). Apply pushback as if this were a first run - do not rubber-stamp existing weak content just because it is already written.

If no specific target, ask the user which section to revisit using the host's blocking question tool, listing any drift candidates first. Options:

- "Purpose"
- "Positioning"
- "Users"
- "Metrics, tracks, boundaries, or other"

For each revisited section, re-interview with full pushback. For sections the user confirms are still accurate, leave their content untouched. If the file is in this skill's house format and no section carries a meaning the template now requires (Boundaries - it is always present in the current template), offer to add it among this skill's own sections - do not add it silently, and do not add it to a file whose own portion is not in house format. Set `last_updated` to today's ISO date when the file has frontmatter; when it has none, leave it that way - readers fall back to the file's own date.

Write the updated doc back to its existing path (never relocate it out from under its readers).
