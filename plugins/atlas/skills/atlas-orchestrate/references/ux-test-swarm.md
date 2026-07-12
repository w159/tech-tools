# UX Test Swarm

> **Moved.** The UX test swarm is owned solely by the `atlas-ux-test` skill. Its
> full runbook, phase contract, agent roster, and gate definitions now live there.

Canonical home: `plugins/atlas/skills/atlas-ux-test/` (invoke with `/atlas-ux-test`,
or dispatch `atlas-ux-test`). Use it for every UX/UI test-swarm run and for re-tests
after fixes. There is no separate UX-swarm agent roster in `atlas-orchestrate` anymore; the
dedicated `ux-*` subagents were removed and their responsibilities fold into
atlas-ux-test.

This file is retained only so older citations resolve. Do not treat it as an entry point.
