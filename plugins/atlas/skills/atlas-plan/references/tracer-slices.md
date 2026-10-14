# Tracer-bullet slices and blocking edges

Source: adapted from Matt Pocock's `to-tickets` skill. Applies to the unit decomposition in `units.md`.

- A unit is a vertical slice: a narrow but complete path through every layer it needs (schema, API, UI, tests), not one layer across the whole feature. Done when the slice is demoable or verifiable alone.
- One unit = one worker task = one failing check written first (red), then made green. A unit with no failable check is not a unit yet.
- Size each unit to one fresh worker context. The lead hands exactly one unit at a time to one fresh worker; nothing in a unit may assume another worker's memory.
- Declare blocking edges per unit (`Blocked by: U<N>` or `none`). A unit with no blockers can start at once; blockers decide wave order and which units run in parallel.
- Prefactor first: if the change is hard, the first unit makes it easy ("make the change easy, then make the easy change").
- Wide refactors (one mechanical change fanning across the codebase) are the exception: sequence expand, migrate in batches by blast radius, then contract (delete the old form), each batch blocked by the expand and the contract blocked by every batch.
- Present the numbered breakdown (title, blocked by, what it delivers) to the user before writing the plan when granularity or edges are uncertain; fold the answers back in.
