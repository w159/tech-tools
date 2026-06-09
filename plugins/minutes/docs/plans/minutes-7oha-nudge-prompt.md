Minutes roadmap execution contract for `minutes-7oha`.

Your job is to finish the roadmap completely, one bead at a time, without wandering.

Rules for every bead:
- Read the bead acceptance criteria first and treat them as the real definition of done.
- Before implementing, write down the full constraint set you need to preserve.
- Verify by measuring or reading the real output, not by theorizing.
- Run Rust verification sequentially in this repo. Do not launch multiple Cargo commands in parallel.
- If you discover more work, create linked `bd` issues instead of leaving TODOs in prose.
- Do not close a bead until its acceptance criteria are genuinely satisfied.

Mandatory adversarial review loop for every implementation bead:
1. Implement the bead.
2. Run the right targeted verification.
3. Review your own diff in a findings-first way, looking specifically for:
   - false-ready or false-healthy states
   - stale config or model/tokenizer drift
   - broken first-use or onboarding transitions
   - silent UX gaps where nothing happens after a user action
   - platform-specific regressions
   - tests that look busy but would not catch the real bug
4. If you find a real issue, fix it before closing the bead.
5. Only then close the bead.

Stop conditions:
- If the bead is blocked on a real human decision or missing external information, leave it open and clearly say why.
- Otherwise do not stop early just because a partial implementation exists.

Roadmap intent:
- Near-term beads should materially improve Minutes as a product, not just move code around.
- The Apple-native coordinator spike must end in a grounded recommendation, not architecture fan fiction.

Final behavior:
- Keep advancing through ready descendant beads until none remain.
- When all actionable descendants are closed, the outer runner should be able to close the epic cleanly.
