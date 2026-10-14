# Deep-module vocabulary

Source: adapted from Matt Pocock's `codebase-design` skill. Use these terms exactly when naming problems and target structure; do not swap in "component", "service", "API" or "boundary".

- Module: anything with an interface and an implementation, at any scale (function, class, package, slice).
- Interface: everything a caller must know: signature, invariants, ordering, error modes, config, performance.
- Depth: behavior available per unit of interface. Deep = much behavior behind a small interface. Shallow = interface nearly as complex as the body.
- Seam: the place where behavior can change without editing in place; where a module's interface lives.
- Adapter: a concrete thing satisfying an interface at a seam, named by role.
- Leverage (callers) and locality (maintainers): the payoff of depth; change, bugs and verification concentrate in one place.

Refactor aim: deepen shallow modules and move seams so tests exercise the interface, not internals. Done when each changed module has a smaller interface than implementation and its tests cross only the interface. Pass-through modules that only forward calls are deletion candidates.
