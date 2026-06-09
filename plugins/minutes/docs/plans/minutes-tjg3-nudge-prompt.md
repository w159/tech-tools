Minutes roadmap execution contract for `minutes-tjg3`.

Your job is to execute the transcription coordinator roadmap in the intended order, without skipping straight to the shiny backend spike.

Rules for every bead:
- Read the bead acceptance criteria first and treat them as the real definition of done.
- Read `docs/plans/minutes-tjg3-transcription-coordinator.md` before implementing. It is the execution memo for this epic.
- Preserve the current helper-backed Parakeet path unless the bead explicitly says otherwise.
- Do not blur architecture work and native-backend experimentation together.
- Verify by measuring or reading the real output, not by theorizing.
- Run Cargo commands sequentially in this repo.
- If you discover more work, create linked `bd` issues instead of leaving TODOs in prose.

Mandatory review loop for every implementation bead:
1. Implement the bead.
2. Run the right targeted verification.
3. Review your own diff in a findings-first way, looking specifically for:
   - backend status drift between CLI and Tauri
   - helper-specific assumptions leaking back into product surfaces
   - fragile diagnostics that look useful but would not support backend comparison
   - product wording that would have to be rewritten again for the native spike
   - architecture that still makes the native backend a repo-wide refactor
4. Fix real issues before closing the bead.
5. Only close the bead when the acceptance criteria and the memo's success definition both hold.

Roadmap intent:
- Phase 1 is the coordinator and its contracts.
- Phase 2 is the macOS-native backend spike behind those contracts.
- Do not reverse that order.

Final behavior:
- Keep advancing through ready descendant beads until none remain.
- When all actionable descendants are closed, the outer runner should be able to close the epic cleanly.
