# Domain glossary step

Source: adapted from Matt Pocock's `domain-modeling` skill.

Before renaming anything, read `docs/glossary.md` (or `GLOSSARY.md`) and use its terms. While refactoring:

- Challenge a term that means two things, or two terms for one thing; settle one and rename to it everywhere (same noun across code, endpoints, tables).
- Write each settled term into the glossary at once, with a one-line definition and the names to avoid.
- Record a hard-to-reverse structural choice as a short decision note under `docs/` via atlas:docs-curator.

Done when every renamed symbol maps to a glossary entry and no retired synonym remains (grep it).
