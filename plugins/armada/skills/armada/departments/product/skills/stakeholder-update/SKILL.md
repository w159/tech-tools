---
name: stakeholder-update
description: Generate a stakeholder update tailored to audience and cadence. Use when writing a weekly or monthly status for leadership, announcing a launch, escalating a risk or blocker, or translating the same progress into exec-brief, engineering-detail, or customer-facing versions.
when_to_use: Writing a weekly or monthly status update for leadership; announcing a feature or product launch; escalating a risk or blocker to stakeholders; translating the same progress into exec-brief, engineering-detail, or customer-facing versions.
argument-hint: "<update type and audience>"
allowed-tools: Read, Glob, Grep, Bash
---

# Stakeholder Update

> If you see unfamiliar placeholders or need to check which tools are connected, see [CONNECTORS.md](../../CONNECTORS.md).

Generate a stakeholder update tailored to the audience and cadence.

## Usage

```
/stakeholder-update $ARGUMENTS
```

## Workflow

### 1. Determine Update Type

Ask the user what kind of update:
- **Weekly**: Regular cadence update on progress, blockers, and next steps
- **Monthly**: Higher-level summary with trends, milestones, and strategic alignment
- **Launch**: Announcement of a feature or product launch with details and impact
- **Ad-hoc**: One-off update for a specific situation (escalation, pivot, major decision)

### 2. Determine Audience

Ask who the update is for:
- **Executives / leadership**: High-level, outcome-focused, strategic framing, brief
- **Engineering team**: Technical detail, implementation context, blockers, decisions needed
- **Cross-functional partners**: Context-appropriate detail, focus on shared goals and dependencies
- **Customers / external**: Benefits-focused, clear timelines, no internal jargon
- **Board**: Metrics-driven, strategic, risk-focused, very concise

### 3. Pull Context from Connected Tools

If **~~project tracker** is connected:
- Pull status of roadmap items and milestones
- Identify completed items since last update
- Surface items that are at risk or blocked
- Pull sprint or iteration progress

If **~~chat** is connected:
- Search for relevant team discussions and decisions
- Find blockers or issues raised in channels
- Identify key decisions made asynchronously

If **~~meeting transcription** is connected:
- Pull recent meeting notes and discussion summaries
- Find decisions and action items from relevant meetings

If **~~knowledge base** is connected:
- Search for recent meeting notes
- Find decision documents or design reviews

If no tools are connected, ask the user to provide:
- What was accomplished since the last update
- Current blockers or risks
- Key decisions made or needed
- What is coming next

### 4. Generate the Update

Structure the update for the target audience using the templates and frameworks
in [references/update-templates.md](references/update-templates.md). That file
holds the per-audience formats (executive, engineering, cross-functional,
customer, launch), the Green/Yellow/Red status framework, risk communication
(ROAM), ADR decision documentation, and meeting facilitation guidance.

At a glance, what each audience wants:
- **Executives**: TL;DR, status color (G/Y/R), key progress tied to goals, decisions made, risks with mitigation, specific asks, and next milestones. Keep it under 300 words.
- **Engineering**: What shipped (with links), what is in progress (with owners), blockers, decisions needed (with options and recommendation), and what is coming next.
- **Cross-functional partners**: What is coming that affects them, what you need from them (with deadlines), decisions that impact their team, and areas open for input.
- **Customers**: What is new (framed as benefits), what is coming soon, known issues with workarounds, and how to provide feedback. No internal jargon.
- **Launch announcements**: What launched, why it matters, key details (scope, availability, limitations), success metrics, rollout plan, and feedback channels.

### 5. Review and Deliver

After generating the update:
- Ask if the user wants to adjust tone, detail level, or emphasis
- Offer to format for the delivery channel (email, chat post, doc, slides)
- If **~~chat** is connected, offer to draft the message for sending

## Output Format

Keep updates scannable. Use bold for key points, bullets for lists. Executive updates should be under 300 words. Engineering updates can be longer but should still be structured for skimming.

## Tips

- The most common mistake in stakeholder updates is burying the lead. Start with the most important thing.
- Status colors (Green/Yellow/Red) should reflect reality, not optimism. Yellow is not a failure - it is good risk communication.
- Asks should be specific and actionable. "We need help" is not an ask. "We need a decision on X by Friday" is.
- For executives, frame everything in terms of outcomes and goals, not activities and tasks.
- If there is bad news, lead with it. Do not hide it after good news.
- Match the length to the audience's attention. Executives get a few bullets. Engineering gets the details they need.
