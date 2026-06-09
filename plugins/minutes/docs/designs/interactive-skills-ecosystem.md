# Interactive Skills Ecosystem

> Design doc promoted from CEO plan review on 2026-03-19.
>
> **Status (as of v0.8.0):** this doc captures the original design thinking
> behind the interactive skill pattern. The plugin has since expanded to 18
> skills — adding `/minutes-brief`, `/minutes-mirror`, `/minutes-tag`, and
> `/minutes-graph` to close the proactive / coaching / intelligence gaps that
> this doc only hinted at. **For the current skill catalog see `README.md` and
> `plugin.json` — they are the source of truth.** Everything below reflects
> the March 2026 snapshot and should be read as history, not spec.

## Problem

Minutes has 8 Claude Code plugin skills that are **passive CLI reference docs** — they tell Claude what commands to run but don't guide users through multi-step workflows. Meanwhile, gstack's skills (e.g., `/office-hours`) demonstrate that interactive, multi-phase skills with `AskUserQuestion` create coaching experiences that are dramatically more engaging and useful.

Minutes already has the intelligence layer (people profiles, consistency checking, structured intents, cross-meeting search) but users don't discover or use these features because the skills don't guide them there. The gap is UX, not capability.

## Vision

### 10x Check
Minutes becomes a **meeting operating system** — not standalone tools but an interconnected intelligence layer. Skills chain together: prep produces a brief → meeting happens → debrief compares outcomes to intentions → weekly synthesizes everything forward. Relationship intelligence surfaces patterns humans miss ("Alex's brought up pricing 3x in 2 weeks"). Decision evolution tracking shows the arc of how choices shift. Post-recording alerts catch contradictions before they become problems.

### Platonic Ideal
The best meeting companion feels like a chief of staff who never forgets anything. You sit down for a call and already know every conversation you've had with this person, every open commitment, every decision that touches their topics. After the call, it asks "did you get what you came for?" and at the end of the week, it tells you what deserves your attention Monday. The user never needs to manually search, recall, or track — it's all surfaced proactively through interactive coaching flows.

## Scope

### New Interactive Skills

**`/minutes-prep`** — Interactive meeting preparation
- Ask who you're meeting with (push back on vague answers)
- Search all past meetings with them
- Build relationship brief: meeting history, recurring topics with trends, open commitments in both directions
- Ask what you want to accomplish (push back on vague goals)
- Produce talking points brief
- Save `.prep.md` to `~/.minutes/preps/` for debrief pickup
- Three-beat closing ritual

**`/minutes-debrief`** — Post-meeting analysis
- Auto-detect most recent recording
- Check for matching `.prep.md` file
- If prep exists: compare outcomes to intentions ("You wanted to resolve pricing. Did you?")
- If no prep: standalone debrief (decisions + actions)
- Decision evolution check (flag conflicts with prior decisions)
- Mark intents as resolved/open
- Three-beat closing ritual with next-skill nudge

**`/minutes-weekly`** — Weekly synthesis and forward planning
- Scan all recordings from the past week
- Cross-reference themes across meetings
- Surface decision evolution arcs (VOLATILE / STABLE / CONFLICTING)
- Flag stale action items and overdue commitments
- Find unresolved preps (prepped but never debriefed)
- Produce forward-looking brief: "what deserves your attention Monday"
- Three-beat closing ritual

### Upgraded Existing Skills

**`/minutes-recap`** — Now interactive
- Surfaces conflicts between meetings ("Meeting A decided X, Meeting B discussed Y")
- Asks follow-up: "Want me to dig into that conflict?"

**`/minutes-search`** — Now coaching
- Pushes back on vague queries: "What specifically are you trying to find out?"
- Suggests search strategies based on query type

**`meeting-analyst` agent** — Now pushes back
- Asks clarifying questions for broad queries instead of returning noisy results

### Accepted Expansions

1. **Skill Chaining** — `.prep.md` files link prep → debrief → weekly into a lifecycle
2. **Relationship Intelligence** — Topic trending, commitment tracking, behavioral signals in prep briefs
3. **Decision Evolution Tracking** — VOLATILE / STABLE / CONFLICTING classification in debrief and weekly
4. **Post-Recording Proactive Alert** — PostToolUse hook upgraded with consistency check + overdue alert
5. **Garry-Style Closing Ritual** — Three-beat close on all interactive skills: signal reflection, concrete assignment, next-skill nudge

### Architecture

```
┌─────────────────────────────────────────┐
│ Interactive Skills Layer                 │
│                                          │
│ /minutes-prep ──→ .prep.md file         │
│       │                                  │
│       ▼                                  │
│ /minutes-debrief ←── .prep.md           │
│       │                                  │
│       ▼                                  │
│ /minutes-weekly (synthesizes all)        │
│                                          │
│ PostToolUse hook (consistency + alert)   │
│ Upgraded: recap, search, analyst         │
└──────────┬──────────────────────────────┘
           │ uses (read-only)
           ▼
┌──────────────────────────────────────────┐
│ Existing Infrastructure                   │
│ minutes search | minutes actions | list   │
│ people profiles | consistency | intents   │
│ meeting-analyst | YAML frontmatter        │
└──────────────────────────────────────────┘
```

### State Convention

Prep files: `~/.minutes/preps/YYYY-MM-DD-{person-slug}.prep.md`
- Created by `/minutes-prep`
- Read by `/minutes-debrief` (matched by date + attendee)
- Scanned by `/minutes-weekly` (unresolved = prepped but not debriefed)
- Stale after 48 hours (ignored by debrief)
- Permissions: `0600` (sensitive content)

### Deferred (ROADMAP.md)

- Calendar bridge for `/minutes-prep` (P2)
- Proactive meeting reminders via SessionStart hook (P2)
- Open source interactive skill template (P3)

## Inspiration

Pattern inspired by [gstack](https://github.com/garrytan/gstack) `/office-hours` skill by Garry Tan — multi-phase interactive flow with `AskUserQuestion`, forced specificity, premise challenge, and signature closing ritual.
